import { describe, expect, it } from 'vitest';
import { createScanQueue } from './scanQueue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createScanQueue', () => {
  it('runs codes one at a time, in submission order', async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const enqueue = createScanQueue(async (c) => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(`start ${c}`);
      await tick();
      log.push(`end ${c}`);
      active--;
    });
    enqueue('A');
    enqueue('B');
    enqueue('C');
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(['start A', 'end A', 'start B', 'end B', 'start C', 'end C']);
    expect(maxActive).toBe(1);
  });

  it('drops a code identical to the one in flight or already queued', async () => {
    const seen: string[] = [];
    const enqueue = createScanQueue(async (c) => {
      seen.push(c);
      await tick();
    });
    enqueue('A');
    enqueue('A');
    enqueue('B');
    enqueue('B');
    enqueue('A'); // A is no longer in flight? it still is until its run ends
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['A', 'B']);
  });

  it('accepts the same code again once it has finished', async () => {
    const seen: string[] = [];
    const enqueue = createScanQueue(async (c) => {
      seen.push(c);
    });
    enqueue('A');
    await new Promise((r) => setTimeout(r, 5));
    enqueue('A');
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(['A', 'A']);
  });

  it('a rejected scan does not block the queue', async () => {
    const seen: string[] = [];
    const enqueue = createScanQueue(async (c) => {
      seen.push(c);
      if (c === 'A') throw new Error('boom');
    });
    enqueue('A');
    enqueue('B');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['A', 'B']);
  });
});
