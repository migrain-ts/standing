'use client';
import { useEffect, useRef, useState } from 'react';

type Detected = { rawValue: string };
type Detector = { detect(source: CanvasImageSource): Promise<Detected[]> };
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

export type BarcodeScanner = {
  /** 'checking' until the browser has been probed once. */
  status: 'checking' | 'supported' | 'unsupported';
  supported: boolean;
  stream: MediaStream | null;
};

function detectorCtor(): DetectorCtor | null {
  try {
    const ctor: unknown = Reflect.get(globalThis, 'BarcodeDetector');
    return typeof ctor === 'function' ? (ctor as DetectorCtor) : null;
  } catch {
    return null;
  }
}

/**
 * Camera QR scanning where BarcodeDetector and getUserMedia both exist. Anything else (or a denied camera)
 * reports unsupported; nothing here throws into the page.
 */
export function useBarcodeScanner(onCode: (code: string) => void): BarcodeScanner {
  const [state, setState] = useState<{ status: BarcodeScanner['status']; stream: MediaStream | null }>({
    status: 'checking',
    stream: null,
  });
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let tracks: MediaStreamTrack[] = [];
    const unsupported = () => {
      if (!cancelled) setState({ status: 'unsupported', stream: null });
    };
    const start = async () => {
      try {
        const Ctor = detectorCtor();
        if (!Ctor || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          unsupported();
          return;
        }
        const detector = new Ctor({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        tracks = stream.getTracks();
        if (cancelled) {
          tracks.forEach((t) => t.stop());
          return;
        }
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        const accept = createRepeatGuard();
        let busy = false;
        timer = setInterval(() => {
          if (busy || video.readyState < 2) return;
          busy = true;
          detector
            .detect(video)
            .then((found) => {
              const code = found[0]?.rawValue;
              if (code && accept(code, Date.now())) cb.current(code);
            })
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }, POLL_MS);
        if (!cancelled) setState({ status: 'supported', stream });
      } catch {
        unsupported();
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      tracks.forEach((t) => t.stop());
    };
  }, []);

  return { status: state.status, supported: state.status === 'supported', stream: state.stream };
}
