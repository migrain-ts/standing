'use client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { CameraScanner } from '@/components/CameraScanner';
import { ManualEntry } from '@/components/ManualEntry';
import { QueryError } from '@/components/QueryError';
import { ScanResultPanel, TONE, ToneIcon } from '@/components/ScanResultPanel';
import { Progress } from '@/components/ui/progress';
import { H1 } from '@/components/ui/typography';
import { api, ApiClientError } from '@/lib/api';
import { DOOR_EVENTS_KEY, HISTORY_LIMIT, scannedPercent, useDoorEvents } from '@/lib/door';
import { createScanQueue } from '@/lib/scanQueue';
import { formatClock, describeScan, type ScanResult, type ScanView } from '@/lib/scanResult';
import { useBarcodeScanner } from '@/lib/useBarcodeScanner';
import { cn } from '@/lib/utils';

type HistoryItem = { n: number; at: string; view: ScanView };

export default function DoorScanPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const qc = useQueryClient();
  const events = useDoorEvents();
  const event = events.data?.find((e) => e.id === eventId);
  const inputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [view, setView] = useState<ScanView | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const scan = useCallback(
    async (code: string) => {
      let next: ScanView;
      try {
        const res = await api<ScanResult>('/door/scan', { method: 'POST', json: { code, eventId } });
        next = describeScan(res);
        if (res.result === 'admitted') void qc.invalidateQueries({ queryKey: DOOR_EVENTS_KEY });
      } catch (e) {
        next = describeScan(e instanceof ApiClientError ? e : new ApiClientError(0, 'network', 'Network error'));
      }
      setView(next);
      counter.current += 1;
      const item: HistoryItem = { n: counter.current, at: formatClock(new Date().toISOString()), view: next };
      setHistory((h) => [item, ...h].slice(0, HISTORY_LIMIT));
      inputRef.current?.focus();
    },
    [eventId, qc],
  );

  // Scans run strictly one at a time, in submission order (wedge scanners, camera repeats).
  const scanRef = useRef(scan);
  useEffect(() => {
    scanRef.current = scan;
  });
  const queueRef = useRef<((code: string) => void) | null>(null);
  if (queueRef.current === null) queueRef.current = createScanQueue((c) => scanRef.current(c));
  const submit = useCallback((code: string) => queueRef.current?.(code), []);

  const camera = useBarcodeScanner(submit);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/door" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          All events
        </Link>
        <H1 className="text-2xl">{event?.name ?? 'Scan tickets'}</H1>
        {event && <p className="text-sm text-muted-foreground">{event.tenantName}</p>}
      </div>

      {events.isError && <QueryError title="Could not load the event" error={events.error} onRetry={() => events.refetch()} />}

      <ScanResultPanel view={view} />

      <ManualEntry ref={inputRef} onSubmit={submit} />

      {camera.supported && camera.stream ? (
        <CameraScanner stream={camera.stream} />
      ) : (
        (camera.status === 'unsupported' || camera.status === 'denied') && (
          <p className="text-sm text-muted-foreground">
            {camera.status === 'denied'
              ? 'Camera access was denied, use the field below'
              : 'Camera scanning is not available in this browser, use the field below'}
          </p>
        )
      )}

      <section aria-label="Scanned count" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Scanned</h2>
          <p className="text-lg font-semibold tabular-nums">
            {event ? `${event.scanned} / ${event.sold}` : '- / -'}
          </p>
        </div>
        <Progress value={event ? scannedPercent(event.scanned, event.sold) : 0} aria-label="Scanned tickets" className="h-2" />
      </section>

      <section aria-label="Recent scans" className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Last {HISTORY_LIMIT} scans this session</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scanned yet.</p>
        ) : (
          <ol className="space-y-2">
            {history.map((h) => (
              <li key={h.n} className="flex items-center gap-3 rounded-lg border border-border p-2">
                <ToneIcon tone={h.view.tone} className={cn('size-9 border-0', TONE[h.view.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{h.view.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{h.view.detail}</p>
                </div>
                <time className="shrink-0 text-sm tabular-nums text-muted-foreground">{h.at}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
