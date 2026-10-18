import { z } from 'zod';
import type { AppConfig } from '../app';
import { ApiError } from '../errors';

const TIMEOUT_MS = 5_000;
const unavailable = () => new ApiError(503, 'simulator_unavailable', 'The load simulator is not available');

// The simulator answers { id, stats }; the API exposes it flat as the run stats plus the run id.
const runBody = z.object({ id: z.string(), stats: z.record(z.string(), z.unknown()) });
const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type RushRun = { id: string } & Record<string, unknown>;
export type RushParams = { buyers: number; maxSeatsPerBuyer: number; durationSeconds: number };

type Raw = { status: number; json: unknown };

async function send(config: AppConfig, method: string, path: string, body?: unknown): Promise<Raw> {
  const { simulatorUrl, simulatorToken } = config;
  if (!simulatorUrl || !simulatorToken) throw unavailable();
  try {
    const res = await fetch(`${simulatorUrl}${path}`, {
      method,
      headers: { 'x-simulator-token': simulatorToken, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, json: await res.json() };
  } catch {
    throw unavailable(); // network error, timeout or a non-JSON answer
  }
}

function toRun(raw: Raw): RushRun {
  const parsed = runBody.safeParse(raw.json);
  if (raw.status >= 300 || !parsed.success) throw fail(raw);
  return { id: parsed.data.id, ...parsed.data.stats };
}

/** A 409 from the simulator keeps its code; everything else means the simulator cannot be relied on. */
function fail(raw: Raw): ApiError {
  const e = errorBody.safeParse(raw.json);
  if (raw.status === 409 && e.success) return new ApiError(409, e.data.error.code, e.data.error.message);
  return unavailable();
}

export async function startRush(config: AppConfig, eventId: string, params: RushParams): Promise<RushRun> {
  return toRun(await send(config, 'POST', '/runs', { eventId, ...params, apiUrl: config.simulatorApiUrl }));
}

export async function rushStatus(config: AppConfig, eventId: string): Promise<RushRun | null> {
  const raw = await send(config, 'GET', `/runs?eventId=${encodeURIComponent(eventId)}`);
  if (raw.status === 404) return null;
  return toRun(raw);
}

export async function stopRush(config: AppConfig, eventId: string): Promise<void> {
  const run = await rushStatus(config, eventId);
  if (run) toRun(await send(config, 'DELETE', `/runs/${encodeURIComponent(run.id)}`));
}
