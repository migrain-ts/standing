import { describe, expect, it } from 'vitest';
import { remainingSeconds } from './countdown';

describe('remainingSeconds', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  it('is 0 for past dates', () => {
    expect(remainingSeconds('2026-10-18T11:59:00Z', now)).toBe(0);
    expect(remainingSeconds('2026-10-18T12:00:00Z', now)).toBe(0);
  });
  it('counts whole seconds, rounding up', () => {
    expect(remainingSeconds('2026-10-18T12:10:00Z', now)).toBe(600);
    expect(remainingSeconds('2026-10-18T12:00:00.400Z', now)).toBe(1);
  });
  it('is 0 for an invalid date', () => {
    expect(remainingSeconds('nope', now)).toBe(0);
  });
});
