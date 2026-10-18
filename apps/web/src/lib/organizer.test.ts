import { describe, expect, it } from 'vitest';
import { fillPercent, statusLabel } from './organizer';

describe('organizer helpers', () => {
  it('fillPercent rounds and guards zero capacity', () => {
    expect(fillPercent(50, 200)).toBe(25);
    expect(fillPercent(1, 3)).toBe(33);
    expect(fillPercent(5, 0)).toBe(0);
  });
  it('statusLabel names every status', () => {
    expect(statusLabel('draft')).toBe('Draft');
    expect(statusLabel('published')).toBe('On sale');
    expect(statusLabel('closed')).toBe('Closed');
  });
});
