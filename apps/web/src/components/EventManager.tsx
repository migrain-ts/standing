'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { TiersEditor } from '@/components/TiersEditor';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { canPublish } from '@/lib/eventForm';
import { formatDateTime, formatMoney } from '@/lib/format';
import { orgKeys, toastError, type EventDetail, type Tier, type VenueDetail } from '@/lib/organizer';
import { cn } from '@/lib/utils';
import { trapTab } from '@/lib/focusTrap';

/** Prices, publish and close for one event. The API stays the authority; buttons only mirror its rules. */
export function EventManager({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: orgKeys.event(tenantId, eventId),
    queryFn: () => api<{ event: EventDetail; tiers: Tier[] }>(`/tenants/${tenantId}/events/${eventId}`),
  });
  const venueId = detail.data?.event.venueId;
  const venue = useQuery({
    queryKey: orgKeys.venue(tenantId, venueId ?? ''),
    queryFn: () => api<{ venue: VenueDetail }>(`/tenants/${tenantId}/venues/${venueId}`),
    enabled: venueId != null,
  });

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: orgKeys.event(tenantId, eventId) }),
      qc.invalidateQueries({ queryKey: orgKeys.events(tenantId) }),
      qc.invalidateQueries({ queryKey: orgKeys.overview(tenantId) }),
    ]);
  const saveTiers = useMutation({
    mutationFn: (tiers: Tier[]) => api(`/tenants/${tenantId}/events/${eventId}/tiers`, { method: 'PUT', json: tiers }),
    onSuccess: () => {
      toast.success('Prices saved');
      return refresh();
    },
    onError: toastError,
  });
  const publish = useMutation({
    mutationFn: () => api(`/tenants/${tenantId}/events/${eventId}/publish`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Event published');
      return refresh();
    },
    onError: toastError,
  });
  const close = useMutation({
    mutationFn: () => api(`/tenants/${tenantId}/events/${eventId}/close`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Sales closed');
      return refresh();
    },
    onError: toastError,
  });

  if (detail.isError) return <QueryError title="Could not load the event" error={detail.error} onRetry={() => detail.refetch()} />;
  if (venue.isError) return <QueryError title="Could not load the venue" error={venue.error} onRetry={() => venue.refetch()} />;
  if (!detail.data || !venue.data) return <Skeleton className="h-40 w-full" aria-busy="true" />;

  const { event, tiers } = detail.data;
  const sections = venue.data.venue.sections;
  const check = canPublish(event, sections, tiers, new Date());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={event.status} />
          <span className="text-sm text-muted-foreground">{formatDateTime(event.startsAt)}</span>
        </div>
        <p className="text-sm text-muted-foreground">Admission limit {event.admissionLimit}</p>
      </div>

      {event.status === 'draft' ? (
        <>
          <section aria-labelledby="tiers-heading">
            <h3 id="tiers-heading" className="mb-3 text-sm font-medium">
              Prices per section
            </h3>
            <TiersEditor key={JSON.stringify(tiers)} sections={sections} tiers={tiers} pending={saveTiers.isPending} onSave={(t) => saveTiers.mutate(t)} />
          </section>
          <div className="space-y-2">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-block" tabIndex={check.ok ? -1 : 0} />}>
                <Button className="h-11 md:h-9" disabled={!check.ok || publish.isPending} onClick={() => publish.mutate()}>
                  Publish
                </Button>
              </TooltipTrigger>
              {!check.ok && <TooltipContent>{check.reason}</TooltipContent>}
            </Tooltip>
            {!check.ok && <p className="text-sm text-muted-foreground">{check.reason}.</p>}
          </div>
        </>
      ) : (
        <ul className="space-y-1 text-sm">
          {sections.map((s) => {
            const price = tiers.find((t) => t.sectionId === s.id);
            return (
              <li key={s.id} className="flex justify-between gap-4">
                <span>{s.name}</span>
                <span className="tabular-nums text-muted-foreground">{price ? formatMoney(price.priceCents) : 'No price'}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={`/org/${tenantId}/events/${eventId}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 md:h-9')}>
          Open live page
        </Link>
        {event.status === 'published' && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" className="h-11 md:h-9" />}>Close sales</AlertDialogTrigger>
            <AlertDialogContent onKeyDown={trapTab}>
              <AlertDialogHeader>
                <AlertDialogTitle>Close sales for {event.name}?</AlertDialogTitle>
                <AlertDialogDescription>Buyers can no longer reserve seats. Tickets already sold stay valid. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11 md:h-9">Keep selling</AlertDialogCancel>
                <AlertDialogAction className="h-11 md:h-9" onClick={() => close.mutate()}>
                  Close sales
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
