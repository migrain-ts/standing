'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader, StatusBadge, TenantMissing } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { SalesChart } from '@/components/SalesChart';
import { AddLineIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { fillPercent, orgKeys, useOrgTenant, type Overview } from '@/lib/organizer';
import { canManage } from '@/lib/tenants';
import { cn } from '@/lib/utils';

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default function OverviewPage() {
  const { tenantId, tenant, ready } = useOrgTenant();
  const q = useQuery({
    queryKey: orgKeys.overview(tenantId),
    queryFn: () => api<Overview>(`/tenants/${tenantId}/overview`),
    enabled: tenant != null,
  });
  if (ready && !tenant) return <TenantMissing />;

  const data = q.data;
  const now = Date.now();
  const revenue = data?.days.reduce((n, d) => n + d.revenueCents, 0) ?? 0;
  const tickets = data?.days.reduce((n, d) => n + d.tickets, 0) ?? 0;
  const upcoming = data?.events.filter((e) => e.status === 'published' && new Date(e.startsAt).getTime() > now) ?? [];
  const withCapacity = upcoming.filter((e) => e.capacity > 0);
  const avgFill = withCapacity.length ? Math.round(withCapacity.reduce((n, e) => n + fillPercent(e.sold, e.capacity), 0) / withCapacity.length) : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={tenant ? `Sales for ${tenant.name} over the last 30 days.` : 'Sales over the last 30 days.'}
        action={
          tenant && canManage(tenant.role) ? (
            <Link href={`/org/${tenantId}/events?new=1`} className={cn(buttonVariants(), 'h-11 md:h-9')}>
              <AddLineIcon className="size-4" aria-hidden />
              New event
            </Link>
          ) : undefined
        }
      />
      {q.isError && <QueryError title="Could not load the overview" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && (
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {data && (
        <div className="space-y-10">
          <section aria-label="Key figures" className="flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <p className="text-sm text-muted-foreground">Revenue, last 30 days</p>
              <p data-testid="revenue-30d" className="text-5xl font-semibold tabular-nums tracking-tight md:text-6xl">
                {formatMoney(revenue)}
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <Figure label="Tickets sold" value={String(tickets)} />
              <Figure label="Upcoming events" value={String(upcoming.length)} />
              <Figure label="Average fill rate" value={`${avgFill}%`} />
            </dl>
          </section>

          <section aria-labelledby="sales-heading">
            <h2 id="sales-heading" className="mb-3 text-lg font-semibold">
              Sales per day
            </h2>
            <SalesChart days={data.days} />
          </section>

          <section aria-labelledby="events-heading">
            <h2 id="events-heading" className="mb-3 text-lg font-semibold">
              Events
            </h2>
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet. Create one to start selling.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 sm:px-4">Event</TableHead>
                    <TableHead className="px-2 sm:px-4 hidden sm:table-cell">Date</TableHead>
                    <TableHead className="px-2 sm:px-4">Status</TableHead>
                    <TableHead className="px-2 sm:px-4">Fill</TableHead>
                    <TableHead className="px-2 sm:px-4 text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.map((e) => {
                    const pct = fillPercent(e.sold, e.capacity);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="px-2 sm:px-4 font-medium">
                          <Link href={`/org/${tenantId}/events/${e.id}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:min-h-0">
                            {e.name}
                          </Link>
                        </TableCell>
                        <TableCell className="px-2 sm:px-4 hidden text-muted-foreground sm:table-cell">{formatDateTime(e.startsAt)}</TableCell>
                        <TableCell className="px-2 sm:px-4">
                          <StatusBadge status={e.status} />
                        </TableCell>
                        <TableCell className="px-2 sm:px-4">
                          <div className="flex items-center gap-2">
                            <Progress value={pct} aria-label={`${e.name} fill`} className="h-2 w-16 sm:w-20" />
                            <span className="hidden text-xs sm:inline tabular-nums text-muted-foreground">
                              {e.sold}/{e.capacity}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-2 sm:px-4 text-right tabular-nums">{formatMoney(e.revenueCents)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
