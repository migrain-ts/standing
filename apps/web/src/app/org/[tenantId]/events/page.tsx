'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { EventForm, type NewEvent } from '@/components/EventForm';
import { EventManager } from '@/components/EventManager';
import { PageHeader, StatusBadge, TenantMissing } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { AddLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { orgKeys, toastError, useOrgTenant, type EventDetail, type OrgEvent, type VenueRow } from '@/lib/organizer';
import { canManage } from '@/lib/tenants';
import { trapTab } from '@/lib/focusTrap';
import { orgPath, tenantApi } from '@/lib/paths';

function EventsContent() {
  const { tenantId, tenant, ready } = useOrgTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const creating = params.get('new') === '1';
  const [managed, setManaged] = useState<OrgEvent | null>(null);

  const events = useQuery({
    queryKey: orgKeys.events(tenantId),
    queryFn: () => api<{ events: OrgEvent[] }>(tenantApi(tenantId, 'events')),
    enabled: tenant != null,
  });
  const venues = useQuery({
    queryKey: orgKeys.venues(tenantId),
    queryFn: () => api<{ venues: VenueRow[] }>(tenantApi(tenantId, 'venues')),
    enabled: tenant != null,
  });
  const setCreating = (on: boolean) => router.replace(on ? `${orgPath(tenantId, 'events')}?new=1` : orgPath(tenantId, 'events'));

  const create = useMutation({
    mutationFn: (e: NewEvent) => api<{ event: EventDetail }>(tenantApi(tenantId, 'events'), { method: 'POST', json: e }),
    onSuccess: async ({ event }) => {
      toast.success(`Draft "${event.name}" created. Set prices, then publish.`);
      setCreating(false);
      await qc.invalidateQueries({ queryKey: orgKeys.events(tenantId) });
      setManaged({ id: event.id, name: event.name, startsAt: event.startsAt, status: event.status, venueName: '', capacity: 0, sold: 0 });
    },
    onError: toastError,
  });
  if (ready && !tenant) return <TenantMissing />;
  const manage = tenant ? canManage(tenant.role) : false;
  const list = events.data?.events ?? [];
  const venueList = venues.data?.venues ?? [];

  return (
    <>
      <PageHeader
        title="Events"
        description="Create a draft, set a price for every section, then publish."
        action={
          manage ? (
            <Button className="h-11 md:h-9" onClick={() => setCreating(true)}>
              <AddLineIcon className="size-4" aria-hidden />
              New event
            </Button>
          ) : undefined
        }
      />
      {events.isError && <QueryError title="Could not load events" error={events.error} onRetry={() => events.refetch()} />}
      {events.isPending && <Skeleton className="h-40 w-full" aria-busy="true" />}
      {events.isSuccess &&
        (list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet. Create the first one.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 sm:px-4">Event</TableHead>
                <TableHead className="px-2 sm:px-4 hidden md:table-cell">Venue</TableHead>
                <TableHead className="px-2 sm:px-4 hidden sm:table-cell">Date</TableHead>
                <TableHead className="px-2 sm:px-4">Status</TableHead>
                <TableHead className="px-2 sm:px-4 hidden text-right sm:table-cell">Sold</TableHead>
                <TableHead className="px-2 sm:px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="px-2 sm:px-4 font-medium">
                    <Link href={orgPath(tenantId, 'events', e.id)} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:min-h-0">
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell className="px-2 sm:px-4 hidden text-muted-foreground md:table-cell">{e.venueName}</TableCell>
                  <TableCell className="px-2 sm:px-4 hidden text-muted-foreground sm:table-cell">{formatDateTime(e.startsAt)}</TableCell>
                  <TableCell className="px-2 sm:px-4">
                    <StatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="px-2 sm:px-4 hidden text-right tabular-nums sm:table-cell">
                    {e.sold}/{e.capacity}
                  </TableCell>
                  <TableCell className="px-2 sm:px-4 text-right">
                    <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setManaged(e)}>
                      Manage<span className="sr-only"> {e.name}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent onKeyDown={trapTab} className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New event</SheetTitle>
            <SheetDescription>Events start as drafts. Nothing is visible to buyers until you publish.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {venues.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : venueList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create a venue first.{' '}
                <Link href={orgPath(tenantId, 'venues')} className="text-primary underline underline-offset-4">
                  Go to venues
                </Link>
              </p>
            ) : (
              <EventForm venues={venueList} pending={create.isPending} onSubmit={(e) => create.mutate(e)} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={managed != null} onOpenChange={(o) => !o && setManaged(null)}>
        <SheetContent onKeyDown={trapTab} className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{managed?.name ?? 'Event'}</SheetTitle>
            <SheetDescription>Prices, publishing and closing sales.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">{managed && <EventManager key={managed.id} tenantId={tenantId} eventId={managed.id} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" aria-busy="true" />}>
      <EventsContent />
    </Suspense>
  );
}
