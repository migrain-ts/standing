import { describe, expect, it } from 'vitest';
import { parsePrice } from './money';

const cents = (s: string) => {
  const r = parsePrice(s);
  return r.ok ? r.cents : r.error;
};

describe('parsePrice', () => {
  it('converts euros to integer cents without float drift', () => {
    expect(cents('12.34')).toBe(1234);
    expect(cents('0.1')).toBe(10);
    expect(cents('4.35')).toBe(435);
    expect(cents('8.2')).toBe(820);
    expect(cents('45')).toBe(4500);
    expect(cents('0')).toBe(0);
    expect(cents(' 45 ')).toBe(4500);
  });
  it('accepts a decimal comma', () => {
    expect(cents('8,20')).toBe(820);
  });
  it('rejects more than two decimals', () => {
    expect(parsePrice('1.005').ok).toBe(false);
  });
  it('rejects empty, negative and non numeric input', () => {
    for (const bad of ['', '  ', '-1', '-0.5', 'abc', '1e3', '1.', '.5', '1,000.00', '€5']) expect(parsePrice(bad).ok, bad).toBe(false);
  });
  it('caps at 10,000 euros', () => {
    expect(cents('10000')).toBe(1_000_000);
    expect(parsePrice('10000.01').ok).toBe(false);
  });
});
