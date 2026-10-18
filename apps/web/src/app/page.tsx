'use client';
import { useQuery } from '@tanstack/react-query';
import { EventCard } from '@/components/EventCard';
import { QueryError } from '@/components/QueryError';
import { SiteHeader } from '@/components/SiteHeader';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import type { EventSummary } from '@/lib/storefront';

export default function HomePage() {
  const q = useQuery({ queryKey: ['events'], queryFn: () => api<{ events: EventSummary[] }>('/public/events') });
  const events = q.data?.events ?? [];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:py-12">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <H1 className="text-2xl md:text-3xl">Upcoming events</H1>
          {q.isSuccess && events.length > 0 && <p className="text-sm text-muted-foreground">{events.length} on sale</p>}
        </div>
        {q.isError && <QueryError title="Could not load events" error={q.error} onRetry={() => q.refetch()} />}
        {q.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72 w-full" />
            ))}
          </div>
        )}
        {q.isSuccess && events.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">No events are on sale right now. Check back soon.</Card>
        )}
        {events.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <li key={e.id}>
                <EventCard event={e} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
