import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDateTime, formatDay, formatMoney } from './format';

describe('format', () => {
  it('formats integer cents as euros', () => {
    expect(formatMoney(7500)).toBe('€75.00');
    expect(formatMoney(0)).toBe('€0.00');
    expect(formatMoney(123456)).toBe('€1,234.56');
  });
  it('formats a countdown as mm:ss and clamps at zero', () => {
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(-3)).toBe('00:00');
  });
  it('formats dates in en-IE', () => {
    expect(formatDay('2026-11-05T19:30:00.000Z')).toMatch(/2026/);
    expect(formatDateTime('2026-11-05T19:30:00.000Z')).toMatch(/2026/);
  });
});
