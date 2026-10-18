import Link from 'next/link';
import { CalendarLineIcon, Building2LineIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatDateTime, formatMoney } from '@/lib/format';
import { isSellingFast, type EventSummary } from '@/lib/storefront';
import { joinPath } from '@/lib/paths';

const TOKENS = ['--chart-2', '--chart-3', '--chart-4'] as const;

function tokenFor(id: string): string {
  let n = 0;
  for (const ch of id) n += ch.charCodeAt(0);
  return TOKENS[n % TOKENS.length] ?? '--chart-3';
}

export function EventCard({ event }: { event: EventSummary }) {
  const d = new Date(event.startsAt);
  const soldOut = event.available <= 0;
  return (
    <Link
      href={joinPath('events', event.id)}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="flex h-full flex-col overflow-hidden transition-colors group-hover:border-primary/60">
        <div
          className="flex h-32 items-end justify-between p-4"
          style={{ backgroundImage: `linear-gradient(135deg, var(${tokenFor(event.id)}), var(--chart-5))` }}
        >
          <div className="leading-none text-foreground">
            <div className="text-4xl font-semibold tabular-nums">{d.getDate()}</div>
            <div className="mt-1 text-sm font-medium uppercase tracking-wide">{d.toLocaleString('en-IE', { month: 'short' })}</div>
          </div>
          {soldOut ? (
            <Badge variant="default">Sold out</Badge>
          ) : isSellingFast(event.capacity, event.available) ? (
            <Badge variant="warning">Selling fast</Badge>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{event.name}</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <CalendarLineIcon className="size-4 shrink-0" aria-hidden />
              {formatDateTime(event.startsAt)}
            </li>
            <li className="flex items-center gap-2">
              <Building2LineIcon className="size-4 shrink-0" aria-hidden />
              {event.venueName}
            </li>
          </ul>
          <p className="mt-auto pt-2 text-xl font-semibold tabular-nums">
            <span className="mr-1.5 text-sm font-normal text-muted-foreground">From</span>
            {formatMoney(event.minPriceCents)}
          </p>
        </div>
      </Card>
    </Link>
  );
}
