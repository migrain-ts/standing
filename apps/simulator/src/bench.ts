import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from '@standing/db';
import { startRush } from './run';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://standing:standing@localhost:5441/standing';
const API_URL = process.env.API_URL ?? 'http://localhost:4100';
const PARAMS = { buyers: 5000, durationSeconds: 60, abandonRate: 0, maxSeatsPerBuyer: 2 } as const;

let cookie = '';
async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}: ${await res.text()}`);
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0] ?? '';
  return (await res.json()) as T;
}

/** A fresh published event in the largest demo venue, every section priced, so 5,000 buyers can sell through. */
async function createBenchEvent(): Promise<string> {
  await api('POST', '/auth/demo', { persona: 'organizer' });
  const { tenants } = await api<{ tenants: { id: string; name: string }[] }>('GET', '/tenants');
  const tenant = tenants.find((t) => t.name === 'Halcyon Arena');
  if (!tenant) throw new Error('Halcyon Arena not found: is the demo seed loaded?');
  const { venues } = await api<{ venues: { id: string; seatCount: number }[] }>('GET', `/tenants/${tenant.id}/venues`);
  const venue = [...venues].sort((a, b) => b.seatCount - a.seatCount)[0];
  if (!venue) throw new Error('no venue');
  const { venue: detail } = await api<{ venue: { sections: { id: string }[] } }>('GET', `/tenants/${tenant.id}/venues/${venue.id}`);
  const base = `/tenants/${tenant.id}/events`;
  const { event } = await api<{ event: { id: string } }>('POST', base, {
    venueId: venue.id,
    name: `Benchmark ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    startsAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    admissionLimit: 2000,
  });
  await api('PUT', `${base}/${event.id}/tiers`, detail.sections.map((s, i) => ({ sectionId: s.id, priceCents: 4000 + i * 1500 })));
  await api('POST', `${base}/${event.id}/publish`);
  console.log(`event ${event.id} (${venue.seatCount} seats)`);
  return event.id;
}

const { db, pool } = createDb(DATABASE_URL);
const eventId = await createBenchEvent();
const rush = startRush({ apiUrl: API_URL, db }, { eventId, ...PARAMS });
const stats = await rush.done;
if (stats.status !== 'finished') throw new Error(`run ended as ${stats.status}`);

const r = await db.execute(sql`
  select
    (select count(*) from tickets where event_id = ${eventId}::uuid)::int as tickets,
    (select count(*) from event_seats where event_id = ${eventId}::uuid and status = 'sold')::int as sold,
    (select count(*) from (select seat_id from order_items where event_id = ${eventId}::uuid group by seat_id having count(*) > 1) d)::int as dup`);
const row = r.rows[0];
const oversold = Math.abs(Number(row?.tickets) - Number(row?.sold)) + Number(row?.dup);
await pool.end();

const seconds = (Date.parse(stats.finishedAt ?? stats.startedAt) - Date.parse(stats.startedAt)) / 1000;
const c = stats.counters;
const l = stats.latencyMs;
const rows: [string, string][] = [
  ['Date', new Date().toISOString()],
  ['CPU', `${os.cpus()[0]?.model ?? 'unknown'}`],
  ['Cores', String(os.cpus().length)],
  ['Memory', `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`],
  ['Node', process.version],
  ['Parameters', `${PARAMS.buyers} buyers, ${PARAMS.durationSeconds} s arrival window, up to ${PARAMS.maxSeatsPerBuyer} seats each, abandon rate ${PARAMS.abandonRate}`],
  ['Duration', `${seconds.toFixed(1)} s`],
  ['HTTP requests', String(stats.requests)],
  ['Requests per second', (stats.requests / seconds).toFixed(1)],
  ['Holds ok / conflicts', `${c.holdsOk} / ${c.holdsConflict}`],
  ['Orders paid', String(c.paid)],
  ['Seats sold (database)', String(row?.sold)],
  ['Hold latency p50 / p95', `${l.holdP50.toFixed(0)} ms / ${l.holdP95.toFixed(0)} ms`],
  ['Pay latency p50 / p95', `${l.payP50.toFixed(0)} ms / ${l.payP95.toFixed(0)} ms`],
  ['Oversold', String(oversold)],
];
const table = ['| Metric | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
const md = `# Benchmark\n\n${table}\n\nThese numbers describe one laptop running the load generator, the API, the worker, Postgres, Redis and the web app together in Docker. They are not a capacity claim for a real deployment. Reproduce with \`npm run bench\` against the compose stack.\n`;
const out = path.resolve(import.meta.dirname, '../../../docs/bench/latest.md');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, md);
console.log(table);
if (oversold !== 0) process.exitCode = 1;
