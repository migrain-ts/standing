import { describe, expect, it } from 'vitest';
import { describeRun, validateRush, type RushRunView } from './rush';

const ok = { buyers: 300, maxSeatsPerBuyer: 2, durationSeconds: 10 };

describe('validateRush', () => {
  it('accepts the limits', () => {
    expect(validateRush(ok).ok).toBe(true);
    expect(validateRush({ buyers: 1, maxSeatsPerBuyer: 1, durationSeconds: 5 }).ok).toBe(true);
    expect(validateRush({ buyers: 5000, maxSeatsPerBuyer: 4, durationSeconds: 300 }).ok).toBe(true);
  });
  it('rejects 0 buyers, 5001 buyers, 5 seats per buyer and 4 seconds, naming the field', () => {
    const bad = (patch: object) => validateRush({ ...ok, ...patch });
    expect(bad({ buyers: 0 })).toMatchObject({ ok: false, errors: { buyers: expect.any(String) } });
    expect(bad({ buyers: 5001 })).toMatchObject({ ok: false, errors: { buyers: expect.any(String) } });
    expect(bad({ maxSeatsPerBuyer: 5 })).toMatchObject({ ok: false, errors: { maxSeatsPerBuyer: expect.any(String) } });
    expect(bad({ durationSeconds: 4 })).toMatchObject({ ok: false, errors: { durationSeconds: expect.any(String) } });
    expect(bad({ buyers: 10.5 }).ok).toBe(false);
  });
});

const run = (over: Partial<RushRunView['counters']>, status: RushRunView['status'] = 'running', requests = 0): RushRunView => ({
  id: 'r1', status, startedAt: '2026-10-18T10:00:00.000Z', params: ok, requests,
  counters: { started: 0, queued: 0, admitted: 0, holdsOk: 0, holdsConflict: 0, paid: 0, declined: 0, abandoned: 0, expired: 0, soldOut: 0, errors: 0, ...over },
});
const T = Date.parse('2026-10-18T10:00:10.000Z');

describe('describeRun', () => {
  it('computes progress of a running run from the finished buyers', () => {
    const d = describeRun(run({ paid: 60, abandoned: 15, expired: 5, soldOut: 15, errors: 5 }, 'running', 500), T);
    expect(d.progress).toBeCloseTo(100 / 300);
    expect(d.label).toBe('Running');
    expect(d.rate).toBe(50);
  });
  it('is 1 for a finished run and never exceeds 1', () => {
    const d = describeRun(run({ paid: 400 }, 'finished'), T);
    expect(d.progress).toBe(1);
    expect(d.label).toBe('Run finished');
    expect(describeRun(run({ paid: 400 }), T).progress).toBe(1);
  });
  it('labels a stopped run and keeps the rate over the run duration', () => {
    const r = { ...run({ paid: 3 }, 'stopped', 40), finishedAt: '2026-10-18T10:00:04.000Z' };
    const d = describeRun(r, T);
    expect(d.label).toBe('Run stopped');
    expect(d.rate).toBe(10);
  });
});
