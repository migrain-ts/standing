'use client';
import { useEffect, useRef } from 'react';

/** Live camera preview. The page renders it only when the scanner hook reports support. */
export function CameraScanner({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      aria-label="Camera view, point it at a ticket QR code"
      className="aspect-video w-full rounded-lg border border-border bg-black object-cover"
    />
  );
}
