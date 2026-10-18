'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { CheckoutPanel, type PanelSeat } from '@/components/CheckoutPanel';
import { releaseTicket, useWaitingRoom } from '@/components/QueuePanel';
import { QueryError } from '@/components/QueryError';
import { SeatMap } from '@/components/SeatMap';
import { SiteHeader } from '@/components/SiteHeader';
import { Building2LineIcon, CalendarLineIcon, GroupLineIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { H1 } from '@/components/ui/typography';
import { api, ApiClientError } from '@/lib/api';
import { bestAvailable } from '@/lib/bestAvailable';
import { checkoutReducer, initialCheckout } from '@/lib/checkoutMachine';
import { remainingSeconds } from '@/lib/countdown';
import { useMe } from '@/lib/auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import { selectionReducer, type SelectionAction } from '@/lib/selection';
import { sectionToken, statusArray, type Availability, type VenueMap } from '@/lib/seatmap';
import { isSellingFast, seatsLabel, takenSeatIds, type EventDetail, type HoldDto, type OrderDto } from '@/lib/storefront';
import { MAX_SEATS_PER_HOLD } from '@standing/shared';

const NONE: ReadonlySet<number> = new Set();

export default function EventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const signedIn = Boolean(me.data);

  const eventQ = useQuery({ queryKey: ['event', eventId], queryFn: () => api<{ event: EventDetail }>(`/public/events/${eventId}`) });
  const mapQ = useQuery({ queryKey: ['map', eventId], queryFn: () => api<VenueMap>(`/public/events/${eventId}/map`), staleTime: Infinity });
  // Polled every 2 s; TanStack pauses the interval while the tab is hidden.
  const availQ = useQuery({
    queryKey: ['availability', eventId],
    queryFn: () => api<Availability>(`/public/events/${eventId}/availability`),
    refetchInterval: 2000,
  });

  const [checkout, dispatch] = useReducer(checkoutReducer, initialCheckout);
  const [selection, dispatchSel] = useReducer((s: ReadonlySet<number>, a: SelectionAction) => selectionReducer(s, a, MAX_SEATS_PER_HOLD), NONE);
  const [takenLocal, setTakenLocal] = useState<ReadonlySet<number>>(NONE);
  const [bestCount, setBestCount] = useState(2);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const ticketRef = useWaitingRoom(eventId, checkout.phase, dispatch);
  const map = mapQ.data;
  const event = eventQ.data?.event;

  // Signed-in visitors join the waiting room as soon as they open the page.
  useEffect(() => {
    if (signedIn && checkout.phase === 'idle') dispatch({ type: 'start' });
  }, [signedIn, checkout.phase]);

  const hold = checkout.phase === 'paying' || checkout.phase === 'declined' ? checkout.hold : null;
  const mine = useMemo<ReadonlySet<number>>(() => (hold ? new Set(hold.seatIdxs) : NONE), [hold]);

  const status = useMemo(() => {
    if (!map) return [];
    const avail = availQ.data ?? { held: [], sold: [] };
    return statusArray(map.seats.length, { held: avail.held, sold: [...avail.sold, ...takenLocal] }, selection, mine);
  }, [map, availQ.data, takenLocal, selection, mine]);

  // Drop selected seats that someone else took meanwhile, without touching the rest.
  useEffect(() => {
    if (!availQ.data || selection.size === 0) return;
    const gone = [...selection].filter((i) => availQ.data.sold.includes(i) || availQ.data.held.includes(i) || takenLocal.has(i));
    if (gone.length > 0) {
      dispatchSel({ type: 'set', idxs: [...selection].filter((i) => !gone.includes(i)) });
      setNotice(`${seatsLabel(gone.length)} you picked ${gone.length === 1 ? 'was' : 'were'} just taken.`);
    }
  }, [availQ.data, selection, takenLocal]);

  const priceByOrd = useMemo(() => new Map((event?.sections ?? []).map((s) => [s.ord, s.priceCents])), [event]);
  const seatLabel = useCallback(
    (idx: number): PanelSeat | null => {
      const s = map?.seats[idx];
      if (!map || !s) return null;
      const name = map.sections.find((x) => x.ord === s[2])?.name ?? `Section ${s[2] + 1}`;
      return { idx, label: `${name}, row ${s[3]}, seat ${s[4]}`, priceCents: priceByOrd.get(s[2]) ?? 0 };
    },
    [map, priceByOrd],
  );
  const selectedSeats = useMemo(() => [...selection].sort((a, b) => a - b).flatMap((i) => seatLabel(i) ?? []), [selection, seatLabel]);
  const heldSeats = useMemo(() => (hold ? hold.seatIdxs.flatMap((i) => seatLabel(i) ?? []) : []), [hold, seatLabel]);

  // Countdown: ticks once a second while a hold exists; expiry is decided by the machine.
  useEffect(() => {
    if (!hold) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => clearInterval(t);
  }, [hold]);
  const remaining = hold ? remainingSeconds(hold.expiresAt, now) : 0;
  useEffect(() => {
    if (hold && remaining === 0) {
      dispatch({ type: 'expire' });
      void qc.invalidateQueries({ queryKey: ['availability', eventId] });
    }
  }, [hold, remaining, qc, eventId]);

  const onToggle = (idx: number) => {
    if (checkout.phase === 'paying' || checkout.phase === 'declined' || checkout.phase === 'holding') return;
    setNotice(null);
    dispatchSel({ type: 'toggle', idx, free: status[idx] === 'free' || status[idx] === 'selected' });
  };

  const onBest = () => {
    if (!map) return;
    setNotice(null);
    const base = statusArray(map.seats.length, { held: availQ.data?.held ?? [], sold: [...(availQ.data?.sold ?? []), ...takenLocal] }, NONE, mine);
    const picked = bestAvailable(map.seats, base, bestCount);
    if (picked.length === 0) toast.error(`There are not ${bestCount} seats left to pick.`);
    else dispatchSel({ type: 'set', idxs: picked });
  };

  const ticket = checkout.phase === 'selecting' || checkout.phase === 'paying' || checkout.phase === 'declined' ? checkout.ticket : null;
  const queueHeader = ticket ? { 'x-queue-ticket': ticket } : undefined;

  const onReserve = async () => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
      return;
    }
    if (checkout.phase !== 'selecting' || !map) return;
    const seatIds = [...selection].sort((a, b) => a - b).flatMap((i) => map.seatIds[i] ?? []);
    setNotice(null);
    dispatch({ type: 'reserve' });
    try {
      const { hold: h } = await api<{ hold: HoldDto }>(`/public/events/${eventId}/holds`, {
        method: 'POST',
        json: { seatIds },
        ...(queueHeader ? { headers: queueHeader } : {}),
      });
      dispatchSel({ type: 'clear' });
      dispatch({
        type: 'held',
        hold: { id: h.id, expiresAt: h.expiresAt, totalCents: h.totalCents, seatIdxs: h.seats.map((s) => s.idx) },
        key: crypto.randomUUID(),
      });
    } catch (e) {
      dispatch({ type: 'reserveFailed' });
      if (e instanceof ApiClientError && e.code === 'seats_unavailable') {
        const takenIdx = new Set(takenSeatIds(e.details).flatMap((id) => map.seatIds.indexOf(id)).filter((i) => i >= 0));
        setTakenLocal((prev) => new Set([...prev, ...takenIdx]));
        dispatchSel({ type: 'set', idxs: [...selection].filter((i) => !takenIdx.has(i)) });
        setNotice(`${seatsLabel(takenIdx.size || 1)} you picked ${takenIdx.size === 1 ? 'was' : 'were'} just taken. Choose again.`);
      } else if (e instanceof ApiClientError && e.code === 'queue_required') {
        dispatch({ type: 'requeue' });
        setNotice('Your turn timed out. You are back in the waiting room.');
      } else {
        setNotice(e instanceof Error ? e.message : 'Could not reserve these seats.');
      }
    } finally {
      void qc.invalidateQueries({ queryKey: ['availability', eventId] });
    }
  };

  const submitPayment = async (h: { id: string }, key: string) => {
    dispatch({ type: 'submit' });
    try {
      const { order } = await api<{ order: OrderDto }>(`/holds/${h.id}/pay`, {
        method: 'POST',
        headers: { 'idempotency-key': key, ...(queueHeader ?? {}) },
      });
      ticketRef.current = null; // the server released the admission with the payment
      dispatch({ type: 'paid', orderId: order.id });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['availability', eventId] });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 402) dispatch({ type: 'declined' });
      else if (e instanceof ApiClientError && e.status === 410) {
        dispatch({ type: 'submitFailed' });
        dispatch({ type: 'expire' });
      } else {
        dispatch({ type: 'submitFailed' });
        toast.error(e instanceof Error ? e.message : 'The payment could not be sent. Try again.');
      }
    }
  };
  const onPay = () => {
    if (checkout.phase === 'paying') void submitPayment(checkout.hold, checkout.key);
  };
  // A retry uses a fresh idempotency key, otherwise the server would replay the decline.
  const onRetry = () => {
    if (checkout.phase !== 'declined') return;
    const key = crypto.randomUUID();
    dispatch({ type: 'retry', key });
    void submitPayment(checkout.hold, key);
  };

  const onCancel = async () => {
    const declined = checkout.phase === 'declined';
    const h = hold;
    dispatch({ type: 'cancel' });
    if (h) await api(`/holds/${h.id}`, { method: 'DELETE' }).catch(() => undefined);
    if (declined) {
      // A buyer who gave up after a decline frees the admission slot and rejoins the line if they come back.
      releaseTicket(eventId, ticketRef.current);
      ticketRef.current = null;
      dispatch({ type: 'requeue' });
    }
    void qc.invalidateQueries({ queryKey: ['availability', eventId] });
  };

  if (eventQ.isError) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl px-4 py-8">
          <QueryError title="This event is not available" error={eventQ.error} onRetry={() => eventQ.refetch()} />
        </main>
      </>
    );
  }

  const free = availQ.data && map ? Math.max(0, map.seats.length - availQ.data.sold.length - availQ.data.held.length) : event?.available;

  return (
    <TooltipProvider delay={0}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          All events
        </Link>
        {event ? (
          <header className="mt-3 space-y-3">
            <H1 className="text-2xl md:text-4xl">{event.name}</H1>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <CalendarLineIcon className="size-4" aria-hidden />
                {formatDateTime(event.startsAt)}
              </li>
              <li className="flex items-center gap-2">
                <Building2LineIcon className="size-4" aria-hidden />
                {event.venueName}
              </li>
              <li className="flex items-center gap-2">
                <GroupLineIcon className="size-4" aria-hidden />
                {event.tenantName}
              </li>
              <li className="flex items-center gap-2">
                {free !== undefined && <span className="font-medium text-foreground tabular-nums">{free} seats left</span>}
                {isSellingFast(event.capacity, event.available) && <Badge variant="warning">Selling fast</Badge>}
              </li>
            </ul>
          </header>
        ) : (
          <div className="mt-3 space-y-3">
            <Skeleton className="h-10 w-80 max-w-full" />
            <Skeleton className="h-5 w-96 max-w-full" />
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Seat map" className="space-y-4">
            {mapQ.isError && <QueryError title="Could not load the seat map" error={mapQ.error} onRetry={() => mapQ.refetch()} />}
            {map && event ? (
              <SeatMap map={map} status={status} priceByOrd={priceByOrd} onToggle={onToggle} variant="buyer" />
            ) : (
              <Skeleton className="h-[22rem] w-full sm:h-[30rem]" />
            )}
            {event && (
              <Card className="space-y-4 p-4">
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {event.sections.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <span aria-hidden className="size-3 rounded-full" style={{ background: `var(${sectionToken(s.ord)})`, opacity: 0.55 }} />
                      <span className="font-medium">{s.name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatMoney(s.priceCents)}</span>
                    </li>
                  ))}
                </ul>
                <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span aria-hidden className="size-3 rounded-full bg-primary ring-2 ring-ring ring-offset-0" /> Selected
                  </li>
                  <li className="flex items-center gap-2">
                    <span aria-hidden className="size-3 rounded-full bg-foreground" /> Yours
                  </li>
                  <li className="flex items-center gap-2">
                    <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/35" /> Held by another buyer
                  </li>
                  <li className="flex items-center gap-2">
                    <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" /> Sold
                  </li>
                </ul>
              </Card>
            )}
          </section>
          <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Your order">
            <CheckoutPanel
              state={checkout}
              seats={selectedSeats}
              heldSeats={heldSeats}
              maxSeats={MAX_SEATS_PER_HOLD}
              bestCount={bestCount}
              onBestCount={setBestCount}
              onBest={onBest}
              onClear={() => dispatchSel({ type: 'clear' })}
              onReserve={onReserve}
              onPay={onPay}
              onRetry={onRetry}
              onCancel={onCancel}
              onRestart={() => dispatch({ type: 'restart' })}
              remaining={remaining}
              notice={notice}
            />
          </aside>
        </div>
      </main>
    </TooltipProvider>
  );
}
