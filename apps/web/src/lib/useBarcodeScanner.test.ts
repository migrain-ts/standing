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

import { startScanner, type Detector, type FrameSource, type ScannerDeps } from './useBarcodeScanner';

function harness(opts: { play?: () => Promise<void>; getUserMedia?: () => Promise<MediaStream>; codes?: string[] } = {}) {
  const stopped: boolean[] = [];
  const tracks = [{ stop: () => stopped.push(true) }, { stop: () => stopped.push(true) }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const timers: { fn: () => void; cleared: boolean }[] = [];
  const got: string[] = [];
  const queue = [...(opts.codes ?? [])];
  const detector: Detector = { detect: async () => (queue.length ? [{ rawValue: queue.shift() as string }] : []) };
  const frames: FrameSource = { source: {} as CanvasImageSource, play: opts.play ?? (async () => undefined), isReady: () => true, release: () => undefined };
  const deps: ScannerDeps = {
    createDetector: () => detector,
    getUserMedia: opts.getUserMedia ?? (async () => stream),
    createFrameSource: () => frames,
    setInterval: (fn) => {
      const t = { fn, cleared: false };
      timers.push(t);
      return t;
    },
    clearInterval: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    now: () => 0,
    onCode: (c) => got.push(c),
  };
  return { deps, stopped, timers, got };
}

describe('startScanner', () => {
  it('unmount while play() is pending: no interval is started, tracks are stopped, callback never fires', async () => {
    let release: () => void = () => undefined;
    const play = () => new Promise<void>((r) => (release = r));
    const h = harness({ play, codes: ['X'] });
    let cancelled = false;
    const started = startScanner(h.deps, () => cancelled);
    await Promise.resolve();
    await Promise.resolve();
    cancelled = true;
    release();
    const res = await started;
    expect(res.status).toBe('unsupported');
    expect(h.timers).toHaveLength(0);
    expect(h.stopped).toHaveLength(2);
    expect(h.got).toEqual([]);
  });

  it('unmount while getUserMedia is pending stops the late stream', async () => {
    let resolve: (s: MediaStream) => void = () => undefined;
    const h0 = harness();
    const stream = await h0.deps.getUserMedia?.();
    const h = harness({ getUserMedia: () => new Promise<MediaStream>((r) => (resolve = r)) });
    let cancelled = false;
    const started = startScanner(h.deps, () => cancelled);
    cancelled = true;
    resolve(stream as MediaStream);
    await started;
    expect(h0.stopped).toHaveLength(2);
    expect(h.timers).toHaveLength(0);
  });

  it('a failing play() stops the tracks and reports unsupported', async () => {
    const h = harness({ play: async () => Promise.reject(new Error('nope')) });
    const res = await startScanner(h.deps, () => false);
    expect(res.status).toBe('unsupported');
    expect(h.stopped).toHaveLength(2);
    expect(h.timers).toHaveLength(0);
  });

  it('permission denial is reported as denied', async () => {
    const h = harness({ getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
    expect((await startScanner(h.deps, () => false)).status).toBe('denied');
  });

  it('delivers a code, and stop() clears the interval and stops the tracks; nothing is delivered after cancel', async () => {
    const h = harness({ codes: ['A', 'B'] });
    let cancelled = false;
    const res = await startScanner(h.deps, () => cancelled);
    if (res.status !== 'supported') throw new Error('expected supported');
    h.timers[0]?.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.got).toEqual(['A']);
    cancelled = true;
    res.stop();
    h.timers[0]?.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.got).toEqual(['A']);
    expect(h.timers[0]?.cleared).toBe(true);
    expect(h.stopped).toHaveLength(2);
  });
});
