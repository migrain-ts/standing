import { describe, expect, expectTypeOf, it } from 'vitest';
import { asId, assertNever, isUuid, type EventId, type SeatId } from './ids';

describe('ids', () => {
  it('recognises uuids case-insensitively and rejects everything else', () => {
    expect(isUuid('3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80')).toBe(true);
    expect(isUuid('3F2B8D2E-9D57-4F0A-8F3E-2A1C5D6E7F80')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
  it('keeps ids of different kinds apart at compile time', () => {
    const seat = asId<'SeatId'>('3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80');
    expectTypeOf(seat).toEqualTypeOf<SeatId>();
    // @ts-expect-error a SeatId is not an EventId
    const event: EventId = seat;
    expect(event).toBe(seat);
  });
  it('assertNever throws with the unexpected value', () => {
    expect(() => assertNever('x' as never)).toThrow('Unexpected value: x');
  });
});
