import { describe, expect, it } from 'vitest';
import { ApiClientError } from './api';
import { backoffMs, nextQueueAction, queueViewOf } from './queue';

describe('nextQueueAction', () => {
  it('rejoins when there is no response yet or the ticket is unknown', () => {
    expect(nextQueueAction(null, null)).toBe('rejoin');
    expect(nextQueueAction({ ticket: 't', state: 'unknown' }, null)).toBe('rejoin');
  });
  it('polls while waiting', () => {
    expect(nextQueueAction({ ticket: 't', state: 'waiting', position: 3, queueLength: 9 }, null)).toBe('poll');
  });
  it('proceeds when admitted', () => {
    expect(nextQueueAction({ ticket: 't', state: 'admitted', expiresAt: 1 }, null)).toBe('proceed');
  });
  it('proceeds when degraded', () => {
    expect(nextQueueAction({ ticket: 'open', state: 'admitted', degraded: true }, null)).toBe('proceed');
  });
  it('polls on a network error', () => {
    expect(nextQueueAction(null, new ApiClientError(0, 'network', 'down'))).toBe('poll');
  });
});

describe('queueViewOf', () => {
  it('describes each phase', () => {
    expect(queueViewOf(null)).toEqual({ phase: 'joining' });
    expect(queueViewOf({ ticket: 't', state: 'waiting', position: 3, queueLength: 9 })).toEqual({ phase: 'waiting', position: 3, queueLength: 9, ticket: 't' });
    expect(queueViewOf({ ticket: 't', state: 'admitted', expiresAt: 1 })).toEqual({ phase: 'admitted', ticket: 't' });
    expect(queueViewOf({ ticket: 'open', state: 'admitted', degraded: true })).toEqual({ phase: 'open' });
  });
});

describe('backoffMs', () => {
  it('grows and caps', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(10)).toBe(8000);
  });
});
