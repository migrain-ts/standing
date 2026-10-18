import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';
import { createSimulatedBuyers } from './accounts';
import { runBuyer, sleep, type Outcome } from './buyer';
import { createApiClient } from './client';
import { mulberry32, seedFromId } from './rng';
import { createStats, type RunStats, type RushParams } from './stats';

export type { RunStats, RushParams } from './stats';
export type RushDeps = { apiUrl: string; db: Db; clock?: Clock };
export type Rush = { id: string; stats: () => RunStats; stop(): void; done: Promise<RunStats> };

export const rushParamsSchema = z.object({
  eventId: z.string().min(1),
  buyers: z.number().int().min(1).max(100_000),
  maxSeatsPerBuyer: z.number().int().min(1).max(8),
  durationSeconds: z.number().min(0).max(3600),
  abandonRate: z.number().min(0).max(1).optional(),
  thinkMs: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  maxInFlight: z.number().int().min(1).max(5000).optional(),
});

const mapBody = z.object({ seatIds: z.array(z.string()) });
const OUTCOME_COUNTER = { paid: 'paid', abandoned: 'abandoned', expired: 'expired', soldOut: 'soldOut', error: 'errors' } as const satisfies Record<Outcome, string>;

class Semaphore {
  private waiters: (() => void)[] = [];
  constructor(private free: number) {}
  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.free++;
  }
}

export function startRush(deps: RushDeps, params: RushParams): Rush {
  const id = randomUUID();
  const now = () => deps.clock?.now() ?? new Date();
  const rng = mulberry32(seedFromId(id));
  const stats = createStats(params, now());
  const abort = new AbortController();
  let status: RunStats['status'] = 'running';
  let finishedAt: Date | undefined;

  const abandonRate = params.abandonRate ?? 0.08;
  const thinkMs = params.thinkMs ?? [200, 1500];
  const gate = new Semaphore(params.maxInFlight ?? 400);

  async function main(): Promise<void> {
    const tokens = await createSimulatedBuyers(deps.db, id, params.buyers, now());
    const mapClient = createApiClient(deps.apiUrl, tokens[0] ?? '', stats.request);
    const mapRes = await mapClient.get(`/public/events/${params.eventId}/map`, abort.signal);
    const map = mapBody.parse(mapRes.body);
    if (mapRes.status !== 200) throw new Error(`map request failed with ${mapRes.status}`);

    const startedAtMs = performance.now();
    const flows = tokens.map(async (token) => {
      const arrival = rng() * params.durationSeconds * 1000;
      try {
        await sleep(arrival - (performance.now() - startedAtMs), abort.signal);
        await gate.acquire();
      } catch {
        return; // stopped before this buyer arrived
      }
      stats.inc('started');
      let outcome: Outcome;
      try {
        outcome = await runBuyer({
          client: createApiClient(deps.apiUrl, token, stats.request),
          eventId: params.eventId,
          seatIds: map.seatIds,
          maxSeatsPerBuyer: params.maxSeatsPerBuyer,
          abandonRate,
          thinkMs,
          rng,
          stats,
          signal: abort.signal,
        });
      } catch {
        outcome = abort.signal.aborted ? 'abandoned' : 'error';
      } finally {
        gate.release();
      }
      stats.inc(OUTCOME_COUNTER[outcome]);
    });
    await Promise.all(flows);
  }

  const done = main().then(
    () => {
      status = abort.signal.aborted ? 'stopped' : 'finished';
      finishedAt = now();
      return stats.snapshot(status, finishedAt);
    },
    (err: unknown) => {
      if (!abort.signal.aborted) console.error(`[simulator] run ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      status = abort.signal.aborted ? 'stopped' : 'failed';
      finishedAt = now();
      return stats.snapshot(status, finishedAt);
    },
  );

  return {
    id,
    stats: () => stats.snapshot(status, finishedAt),
    stop: () => abort.abort(new Error('stopped')),
    done,
  };
}
