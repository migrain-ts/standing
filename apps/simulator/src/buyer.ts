import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApiClient } from './client';
import { between, pickRun, type Rng } from './rng';
import type { RunStatsRecorder } from './stats';

export type Outcome = 'paid' | 'abandoned' | 'expired' | 'soldOut' | 'error';

export type BuyerCtx = {
  client: ApiClient;
  eventId: string;
  seatIds: readonly string[];
  maxSeatsPerBuyer: number;
  abandonRate: number;
  thinkMs: readonly [number, number];
  rng: Rng;
  stats: RunStatsRecorder;
  signal: AbortSignal;
};

const queueBody = z.object({
  ticket: z.string(),
  state: z.enum(['admitted', 'waiting', 'unknown']),
  degraded: z.boolean().optional(),
});
const availabilityBody = z.object({ held: z.array(z.number()), sold: z.array(z.number()) });
const holdBody = z.object({ hold: z.object({ id: z.string() }) });
const errorBody = z.object({ error: z.object({ code: z.string() }) });

const MAX_JOINS = 5;
const MAX_HOLD_ATTEMPTS = 3;

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Joins the waiting room and polls until admitted. Returns the ticket, or null when the API keeps failing. */
async function enterQueue(ctx: BuyerCtx): Promise<string | null> {
  const { client, eventId, signal, rng, stats } = ctx;
  const base = `/public/events/${eventId}/queue`;
  for (let join = 0; join < MAX_JOINS; join++) {
    const res = await client.post(base, undefined, {}, signal);
    const parsed = queueBody.safeParse(res.body);
    if (res.status !== 200 || !parsed.success) return null;
    let { ticket, state } = parsed.data;
    if (state === 'waiting') stats.inc('queued');
    while (state === 'waiting') {
      await sleep(between(rng, 250, 750), signal);
      const poll = await client.get(`${base}/${encodeURIComponent(ticket)}`, signal);
      const next = queueBody.safeParse(poll.body);
      if (poll.status !== 200 || !next.success) return null;
      state = next.data.state;
      ticket = next.data.ticket;
    }
    if (state === 'admitted') {
      stats.inc('admitted');
      return ticket;
    }
    // 'unknown': the ticket was lost, join again
  }
  return null;
}

async function freeSeats(ctx: BuyerCtx): Promise<number[] | null> {
  const res = await ctx.client.get(`/public/events/${ctx.eventId}/availability`, ctx.signal);
  const parsed = availabilityBody.safeParse(res.body);
  if (res.status !== 200 || !parsed.success) return null;
  const taken = new Set([...parsed.data.held, ...parsed.data.sold]);
  const free: number[] = [];
  for (let idx = 0; idx < ctx.seatIds.length; idx++) if (!taken.has(idx)) free.push(idx);
  return free;
}

/** Frees the admission slot. Not tied to the run's abort signal, so a stopped run releases too; failures are swallowed. */
async function releaseAdmission(ctx: BuyerCtx, ticket: string): Promise<void> {
  try {
    await ctx.client.del(`/public/events/${ctx.eventId}/queue/${encodeURIComponent(ticket)}`);
  } catch {
    // the slot lapses on its own after the active TTL
  }
}

export async function runBuyer(ctx: BuyerCtx): Promise<Outcome> {
  const { client, eventId, rng, stats, signal } = ctx;
  let ticket: string | null = null;
  let paid = false;
  // An admission slot is only freed by a payment; every other ending must free it, or abandoners stall the queue.
  try {
    ticket = await enterQueue(ctx);
    if (ticket === null) return 'error';

    let holdId: string | null = null;
    for (let attempt = 0; attempt < MAX_HOLD_ATTEMPTS && holdId === null; attempt++) {
      const free = await freeSeats(ctx);
      if (free === null) return 'error';
      const wanted = 1 + Math.floor(rng() * ctx.maxSeatsPerBuyer);
      let run: number[] | null = null;
      for (let k = wanted; k >= 1 && run === null; k--) run = pickRun(free, k, rng);
      if (run === null) return 'soldOut';
      const seatIds = run.map((idx) => ctx.seatIds[idx]);
      const res = await client.post(`/public/events/${eventId}/holds`, { seatIds }, { 'x-queue-ticket': ticket }, signal);
      stats.recordHold(res.ms);
      const parsed = holdBody.safeParse(res.body);
      if (res.status === 201 && parsed.success) {
        stats.inc('holdsOk');
        holdId = parsed.data.hold.id;
      } else if (res.status === 409) {
        stats.inc('holdsConflict');
      } else if (res.status === 403 && errorBody.safeParse(res.body).data?.error.code === 'queue_required') {
        const next = await enterQueue(ctx);
        if (next === null) return 'error';
        ticket = next;
      } else {
        return 'error';
      }
    }
    if (holdId === null) return 'soldOut'; // the seats kept going to other buyers

    if (rng() < ctx.abandonRate) return 'abandoned'; // the hold expires on its own
    await sleep(between(rng, ctx.thinkMs[0], ctx.thinkMs[1]), signal);

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await client.post(`/holds/${holdId}/pay`, undefined, { 'idempotency-key': randomUUID(), 'x-queue-ticket': ticket }, signal);
      stats.recordPay(res.ms);
      if (res.status === 201) {
        paid = true; // the pay call released the admission through its X-Queue-Ticket header
        return 'paid';
      }
      if (res.status === 410) return 'expired';
      if (res.status === 402) {
        stats.inc('declined');
        continue;
      }
      return 'error';
    }
    return 'abandoned'; // declined twice: the buyer gives up and the hold lapses
  } finally {
    if (!paid && ticket !== null && ticket !== 'open') await releaseAdmission(ctx, ticket);
  }
}
