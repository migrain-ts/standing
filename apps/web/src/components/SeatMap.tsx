'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoney } from '@/lib/format';
import { fitView, freeSeatSummary, hitTest, sectionToken, type Status, type VenueMap, type View } from '@/lib/seatmap';

const RADIUS = 7;

type Props = {
  map: VenueMap;
  status: readonly Status[];
  priceByOrd: ReadonlyMap<number, number>;
  onToggle: (idx: number) => void;
  variant: 'buyer' | 'organizer';
};

type Hover = { idx: number; x: number; y: number };

/** Resolves a CSS variable (including relative-colour tokens) to a colour the canvas can paint. */
function makeResolver(probe: HTMLElement) {
  const cache = new Map<string, string>();
  return (token: string): string => {
    const hit = cache.get(token);
    if (hit) return hit;
    probe.style.color = `var(${token})`;
    const value = getComputedStyle(probe).color;
    cache.set(token, value);
    return value;
  };
}

export function SeatMap({ map, status, priceByOrd, onToggle, variant }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const frameRef = useRef(0);
  const statusRef = useRef(status);
  const hoverRef = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });
  const [hover, setHover] = useState<Hover | null>(null);

  statusRef.current = status;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const probe = wrap.querySelector<HTMLElement>('[data-probe]');
    if (!probe) return;
    const colour = makeResolver(probe);
    const v = viewRef.current;
    const st = statusRef.current;
    const r = Math.max(2.5, RADIUS * v.scale);

    // Stage band and section names are drawn from the seat extents.
    const bounds = new Map<number, { min: number; max: number }>();
    let minX = Infinity;
    let maxX = -Infinity;
    for (const s of map.seats) {
      minX = Math.min(minX, s[0]);
      maxX = Math.max(maxX, s[0]);
      const b = bounds.get(s[2]) ?? { min: s[0], max: s[0] };
      b.min = Math.min(b.min, s[0]);
      b.max = Math.max(b.max, s[0]);
      bounds.set(s[2], b);
    }
    if (map.seats.length > 0) {
      ctx.fillStyle = colour('--muted');
      ctx.fillRect(minX * v.scale + v.offsetX - r, 8 * v.scale + v.offsetY, (maxX - minX) * v.scale + 2 * r, 30 * v.scale);
      ctx.fillStyle = colour('--muted-foreground');
      ctx.font = `600 ${Math.max(11, 12 * v.scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STAGE', ((minX + maxX) / 2) * v.scale + v.offsetX, 23 * v.scale + v.offsetY);
      ctx.textAlign = 'left';
      for (const sec of map.sections) {
        const b = bounds.get(sec.ord);
        if (!b) continue;
        ctx.fillText(sec.name, b.min * v.scale + v.offsetX - r, 58 * v.scale + v.offsetY);
      }
    }

    const sold = colour('--muted');
    const held = colour('--muted-foreground');
    const primary = colour('--primary');
    const ring = colour('--ring');
    const mine = colour('--foreground');
    const free = [0, 1, 2, 3, 4].map((i) => colour(`--chart-${i + 1}`));
    const selected: number[] = [];
    for (let i = 0; i < map.seats.length; i++) {
      const seat = map.seats[i];
      if (!seat) continue;
      const x = seat[0] * v.scale + v.offsetX;
      const y = seat[1] * v.scale + v.offsetY;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      const s = st[i] ?? 'free';
      ctx.beginPath();
      switch (s) {
        case 'free':
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = free[Number(sectionToken(seat[2]).slice(-1)) - 1] ?? primary;
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'held':
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = held;
          ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'sold':
          ctx.globalAlpha = 1;
          ctx.fillStyle = sold;
          ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'mine':
          ctx.globalAlpha = 1;
          ctx.fillStyle = mine;
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'selected':
          selected.push(i);
          break;
        default: {
          const never: never = s;
          return never;
        }
      }
    }
    ctx.globalAlpha = 1;
    // Selected seats last so the ring is never covered by a neighbour.
    for (const i of selected) {
      const seat = map.seats[i];
      if (!seat) continue;
      const x = seat[0] * v.scale + v.offsetX;
      const y = seat[1] * v.scale + v.offsetY;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = primary;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ring;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [map]);

  const schedule = useCallback(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const resetView = useCallback(() => {
    viewRef.current = fitView(map, sizeRef.current.w, sizeRef.current.h);
    schedule();
  }, [map, schedule]);

  // Size the backing store for devicePixelRatio and fit the map on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      sizeRef.current = { w, h };
      viewRef.current = fitView(map, w, h);
      schedule();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [map, schedule]);

  useEffect(() => {
    schedule();
  }, [status, schedule]);

  const zoomAt = (px: number, py: number, factor: number) => {
    const v = viewRef.current;
    const fit = fitView(map, sizeRef.current.w, sizeRef.current.h);
    const scale = Math.min(Math.max(v.scale * factor, fit.scale * 0.8), fit.scale * 8);
    const k = scale / v.scale;
    viewRef.current = { scale, offsetX: px - (px - v.offsetX) * k, offsetY: py - (py - v.offsetY) * k };
    schedule();
  };

  // Wheel needs a non-passive listener to stop the page from scrolling while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // zoomAt only reads refs and `map`
  }, [map]);

  const local = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    gesture.current = { moved: 0, pinch: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      const idx = hitTest(map.seats, viewRef.current, p.x, p.y, 10);
      if (idx !== hoverRef.current) {
        hoverRef.current = idx;
        setHover(idx === null ? null : { idx, x: p.x, y: p.y });
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.current.pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesture.current.pinch);
        gesture.current.pinch = d;
        gesture.current.moved = 99;
      }
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved > 6) {
      const v = viewRef.current;
      viewRef.current = { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy };
      schedule();
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTap = pointers.current.size === 1 && gesture.current.moved <= 6;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = 0;
    if (wasTap) {
      const p = local(e);
      const idx = hitTest(map.seats, viewRef.current, p.x, p.y, e.pointerType === 'touch' ? 16 : 10);
      if (idx !== null) onToggle(idx);
    }
  };
  const onPointerLeave = () => {
    hoverRef.current = null;
    setHover(null);
  };

  const free = useMemo(() => status.filter((s) => s === 'free').length, [status]);
  const summary = useMemo(() => freeSeatSummary(map.seats, status), [map.seats, status]);
  const hoverSeat = hover ? map.seats[hover.idx] : undefined;
  const hoverStatus = hover ? status[hover.idx] : undefined;
  const hoverPrice = hoverSeat ? priceByOrd.get(hoverSeat[2]) : undefined;
  const sectionName = (ord: number) => map.sections.find((s) => s.ord === ord)?.name ?? `Section ${ord + 1}`;

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative max-h-[32rem] min-h-56 w-full overflow-hidden rounded-lg border border-border bg-card"
        style={{ aspectRatio: `${map.width + 80} / ${map.height + 70}` }}
      >
        <span data-probe aria-hidden className="pointer-events-none absolute size-0 opacity-0" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full touch-none cursor-pointer"
          role="img"
          aria-label={`${variant === 'organizer' ? 'Venue' : 'Seat'} map, ${free} free seats. Scroll to zoom, drag to pan. Use Best available to choose seats with the keyboard.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
        {hover && hoverSeat && (
          <Tooltip open>
            <TooltipTrigger
              render={<span aria-hidden className="pointer-events-none absolute size-px" style={{ left: hover.x, top: hover.y }} />}
            />
            <TooltipContent side="top" sideOffset={12}>
              {sectionName(hoverSeat[2])}, row {hoverSeat[3]}, seat {hoverSeat[4]}
              {hoverPrice !== undefined ? `, ${formatMoney(hoverPrice)}` : ''}
              {hoverStatus && hoverStatus !== 'free' ? ` (${hoverStatus === 'mine' ? 'yours' : hoverStatus})` : ''}
            </TooltipContent>
          </Tooltip>
        )}
        <Button type="button" variant="secondary" size="sm" className="absolute bottom-2 right-2" onClick={resetView}>
          Reset view
        </Button>
      </div>
      <Table className="sr-only">
        <caption>Free seats by section and row</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Section</TableHead>
            <TableHead>Row</TableHead>
            <TableHead>Free seats</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.map((r) => (
            <TableRow key={`${r.sectionOrd}-${r.row}`}>
              <TableCell>{sectionName(r.sectionOrd)}</TableCell>
              <TableCell>{r.row}</TableCell>
              <TableCell>{r.seats}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
