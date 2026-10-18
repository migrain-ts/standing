'use client';
import { useEffect, useRef, useState } from 'react';

export type Detected = { rawValue: string };
export type Detector = { detect(source: CanvasImageSource): Promise<Detected[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export const REPEAT_WINDOW_MS = 2000;
const POLL_MS = 250;

/** Remembers when each code was last accepted; the same code is ignored for `windowMs`. */
export function createRepeatGuard(windowMs = REPEAT_WINDOW_MS) {
  const seen = new Map<string, number>();
  return (code: string, now: number): boolean => {
    const last = seen.get(code);
    if (last !== undefined && now - last < windowMs) return false;
    seen.set(code, now);
    for (const [c, t] of seen) if (now - t >= windowMs) seen.delete(c);
    return true;
  };
}

export type ScannerStatus = 'checking' | 'supported' | 'unsupported' | 'denied';

export type BarcodeScanner = { status: ScannerStatus; supported: boolean; stream: MediaStream | null };

/** The hidden element the detector reads frames from. */
export type FrameSource = { source: CanvasImageSource; play(): Promise<void>; isReady(): boolean; release(): void };

export type ScannerDeps = {
  createDetector: () => Detector | null;
  getUserMedia: (() => Promise<MediaStream>) | null;
  createFrameSource: (stream: MediaStream) => FrameSource;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
  onCode: (code: string) => void;
};

export type StartResult =
  | { status: 'supported'; stream: MediaStream; stop: () => void }
  | { status: 'unsupported' | 'denied' };

const isDenied = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'name' in e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');

/**
 * Opens the camera and starts polling the detector. `isCancelled` is re-checked after every await so an unmount
 * while the camera opens or the video starts never leaves a running interval or a live track behind. Any failure
 * stops every track before reporting; nothing throws.
 */
export async function startScanner(deps: ScannerDeps, isCancelled: () => boolean): Promise<StartResult> {
  let tracks: MediaStreamTrack[] = [];
  let frames: FrameSource | null = null;
  let timer: unknown;
  let timerStarted = false;
  const stop = () => {
    if (timerStarted) deps.clearInterval(timer);
    timerStarted = false;
    tracks.forEach((t) => t.stop());
    tracks = [];
    frames?.release();
    frames = null;
  };
  try {
    const detector = deps.createDetector();
    if (!detector || !deps.getUserMedia) return { status: 'unsupported' };
    const stream = await deps.getUserMedia();
    tracks = stream.getTracks();
    if (isCancelled()) {
      stop();
      return { status: 'unsupported' };
    }
    frames = deps.createFrameSource(stream);
    await frames.play();
    if (isCancelled()) {
      stop();
      return { status: 'unsupported' };
    }
    const accept = createRepeatGuard();
    const source = frames;
    let busy = false;
    timer = deps.setInterval(() => {
      if (busy || isCancelled() || !source.isReady()) return;
      busy = true;
      detector
        .detect(source.source)
        .then((found) => {
          const code = found[0]?.rawValue;
          if (code && !isCancelled() && accept(code, deps.now())) deps.onCode(code);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    timerStarted = true;
    return { status: 'supported', stream, stop };
  } catch (e) {
    stop();
    return { status: isDenied(e) ? 'denied' : 'unsupported' };
  }
}

function browserDeps(onCode: (code: string) => void): ScannerDeps {
  return {
    createDetector: () => {
      try {
        const ctor: unknown = Reflect.get(globalThis, 'BarcodeDetector');
        // Feature-detected above: the only construction signature BarcodeDetector has is { formats }.
        return typeof ctor === 'function' ? new (ctor as DetectorCtor)({ formats: ['qr_code'] }) : null;
      } catch {
        return null;
      }
    },
    getUserMedia:
      typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
        ? () => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        : null,
    createFrameSource: (stream) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      return {
        source: video,
        play: () => video.play(),
        isReady: () => video.readyState >= 2,
        release: () => {
          video.srcObject = null;
        },
      };
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    now: () => Date.now(),
    onCode,
  };
}

/** Camera QR scanning where BarcodeDetector and getUserMedia both exist; otherwise reports unsupported or denied. */
export function useBarcodeScanner(onCode: (code: string) => void): BarcodeScanner {
  const [state, setState] = useState<{ status: ScannerStatus; stream: MediaStream | null }>({ status: 'checking', stream: null });
  const cb = useRef(onCode);
  useEffect(() => {
    cb.current = onCode;
  });

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    void startScanner(browserDeps((c) => cb.current(c)), () => cancelled).then((res) => {
      if (res.status === 'supported') {
        if (cancelled) res.stop();
        else {
          stop = res.stop;
          setState({ status: 'supported', stream: res.stream });
        }
      } else if (!cancelled) setState({ status: res.status, stream: null });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return { status: state.status, supported: state.status === 'supported', stream: state.stream };
}
