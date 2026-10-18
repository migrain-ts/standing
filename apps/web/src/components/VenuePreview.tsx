'use client';
import { useEffect, useRef } from 'react';
import type { SeatSpec } from '@standing/shared';
import { FREE_ALPHA, fitView, sectionToken } from '@/lib/seatmap';

/** Miniature canvas of the generated map: one dot per seat in the section token colour. No interaction. */
export function VenuePreview({ seats, label }: { seats: readonly SeatSpec[]; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const probe = document.createElement('span');
      wrap.appendChild(probe);
      const cache = new Map<number, string>();
      const colour = (ord: number): string => {
        const hit = cache.get(ord);
        if (hit) return hit;
        probe.style.color = `var(${sectionToken(ord)})`;
        const c = getComputedStyle(probe).color;
        cache.set(ord, c);
        return c;
      };
      const view = fitView({ seats: seats.map((s) => [s.x, s.y, s.sectionIndex, s.rowLabel, s.number]) }, w, h);
      const r = Math.max(0.8, 6 * view.scale);
      ctx.globalAlpha = FREE_ALPHA;
      for (const s of seats) {
        ctx.fillStyle = colour(s.sectionIndex);
        ctx.beginPath();
        ctx.arc(s.x * view.scale + view.offsetX, s.y * view.scale + view.offsetY, r, 0, Math.PI * 2);
        ctx.fill();
      }
      probe.remove();
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [seats]);

  return (
    <div ref={wrapRef} className="relative h-44 w-full overflow-hidden rounded-md border border-border bg-card">
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 size-full" />
    </div>
  );
}
