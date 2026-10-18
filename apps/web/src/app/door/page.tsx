'use client';
import Link from 'next/link';
import { QueryError } from '@/components/QueryError';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { H1 } from '@/components/ui/typography';
import { scannedPercent, useDoorEvents } from '@/lib/door';
import { formatDateTime } from '@/lib/format';
import { joinPath } from '@/lib/paths';

export default function DoorEventsPage() {
  const q = useDoorEvents();
  return (
    <div className="space-y-4">
      <div>
        <H1 className="text-2xl">Tonight at the door</H1>
        <p className="text-sm text-muted-foreground">Pick the event you are scanning for. Counts refresh every 5 seconds.</p>
      </div>
      {q.isError && <QueryError title="Could not load events" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-28 w-full" />}
      {q.data && q.data.length === 0 && (
        <p className="rounded-lg border border-border p-5 text-muted-foreground">
          No upcoming events in your organizations right now.
        </p>
      )}
      <ul className="space-y-3">
        {q.data?.map((e) => (
          <li key={e.id}>
            <Link
              href={joinPath('door', e.id)}
              className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Card className="min-h-11 space-y-3 p-4 transition-colors hover:bg-accent">
                <div>
                  <p className="text-lg font-semibold leading-tight">{e.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.tenantName} · {formatDateTime(e.startsAt)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm tabular-nums">
                    {e.scanned} / {e.sold} scanned
                  </p>
                  <Progress
                    value={scannedPercent(e.scanned, e.sold)}
                    aria-label={`${e.scanned} of ${e.sold} tickets scanned`}
                    className="h-2"
                  />
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
