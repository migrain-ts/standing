import { MAX_RUSH_BUYERS } from '@standing/shared';

export type RushForm = { buyers: number; maxSeatsPerBuyer: number; durationSeconds: number };
export const RUSH_LIMITS = {
  buyers: { min: 1, max: MAX_RUSH_BUYERS },
  maxSeatsPerBuyer: { min: 1, max: 4 },
  durationSeconds: { min: 5, max: 300 },
} as const satisfies Record<keyof RushForm, { min: number; max: number }>;

export const RUSH_DEFAULTS: RushForm = { buyers: 300, maxSeatsPerBuyer: 2, durationSeconds: 30 };

export type RushValidation = { ok: true; value: RushForm } | { ok: false; errors: Partial<Record<keyof RushForm, string>> };

const LABEL = { buyers: 'Buyers', maxSeatsPerBuyer: 'Seats per buyer', durationSeconds: 'Duration (seconds)' } as const satisfies Record<keyof RushForm, string>;

/** Same limits as the API's rushSchema. */
export function validateRush(form: RushForm): RushValidation {
  const errors: Partial<Record<keyof RushForm, string>> = {};
  for (const key of Object.keys(RUSH_LIMITS) as (keyof RushForm)[]) {
    const { min, max } = RUSH_LIMITS[key];
    const v = form[key];
    if (!Number.isInteger(v) || v < min || v > max) errors[key] = `${LABEL[key]} must be a whole number from ${min} to ${max}`;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: form };
}

export type RushCounters = {
  started: number; queued: number; admitted: number; holdsOk: number; holdsConflict: number;
  paid: number; declined: number; abandoned: number; expired: number; soldOut: number; requeued: number; errors: number;
};
export type RushStatus = 'running' | 'finished' | 'stopped' | 'failed';
export type RushRunView = {
  id: string;
  status: RushStatus;
  startedAt: string;
  finishedAt?: string;
  params: RushForm;
  counters: RushCounters;
  requests: number;
};

export function describeRun(run: RushRunView, now: number = Date.now()): { progress: number; label: string; rate: number } {
  const c = run.counters;
  const done = c.paid + c.abandoned + c.expired + c.soldOut + c.errors;
  const raw = run.params.buyers > 0 ? done / run.params.buyers : 0;
  const progress = run.status === 'finished' ? 1 : Math.min(1, Math.max(0, raw));
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0.001, (end - start) / 1000) : 0;
  const rate = seconds > 0 ? Math.round((run.requests / seconds) * 10) / 10 : 0;
  const label = run.status === 'running' ? 'Running' : run.status === 'finished' ? 'Run finished' : run.status === 'stopped' ? 'Run stopped' : 'Run failed';
  return { progress, label, rate };
}

/** The slider grid: buyers start at 100 (validateRush still accepts 1..5000). */
export const RUSH_SLIDER = {
  buyers: { min: 100, max: 5000, step: 100 },
  maxSeatsPerBuyer: { min: 1, max: 4, step: 1 },
  durationSeconds: { min: 5, max: 300, step: 5 },
} as const satisfies Record<keyof RushForm, { min: number; max: number; step: number }>;
