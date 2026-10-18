import { describe, expect, it } from 'vitest';
import { createRepeatGuard } from './useBarcodeScanner';

describe('createRepeatGuard', () => {
  it('ignores the same code for 2 s, then accepts it again', () => {
    const accept = createRepeatGuard();
    expect(accept('A', 0)).toBe(true);
    expect(accept('A', 1999)).toBe(false);
    expect(accept('B', 1000)).toBe(true);
    expect(accept('A', 2000)).toBe(true);
  });
});
