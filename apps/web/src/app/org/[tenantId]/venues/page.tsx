'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { VenueCreateInput } from '@standing/shared';
import { PageHeader, TenantMissing } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { VenueForm } from '@/components/VenueForm';
import { AddLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { orgKeys, toastError, useOrgTenant, type VenueRow } from '@/lib/organizer';
import { canManage } from '@/lib/tenants';
import { trapTab } from '@/lib/focusTrap';

export default function VenuesPage() {
  const { tenantId, tenant, ready } = useOrgTenant();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: orgKeys.venues(tenantId),
    queryFn: () => api<{ venues: VenueRow[] }>(`/tenants/${tenantId}/venues`),
    enabled: tenant != null,
  });
  const create = useMutation({
    mutationFn: (v: VenueCreateInput) => api<{ venue: VenueRow }>(`/tenants/${tenantId}/venues`, { method: 'POST', json: v }),
    onSuccess: ({ venue }) => {
      toast.success(`${venue.name} created with ${venue.seatCount.toLocaleString('en-IE')} seats`);
      setOpen(false);
      return qc.invalidateQueries({ queryKey: orgKeys.venues(tenantId) });
    },
    onError: toastError,
  });
  if (ready && !tenant) return <TenantMissing />;
  const venues = q.data?.venues ?? [];
  const manage = tenant ? canManage(tenant.role) : false;

  return (
    <>
      <PageHeader
        title="Venues"
        description="Seat layouts you can host events in."
        action={
          manage ? (
            <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
              <AddLineIcon className="size-4" aria-hidden />
              New venue
            </Button>
          ) : undefined
        }
      />
      {q.isError && <QueryError title="Could not load venues" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-40 w-full" aria-busy="true" />}
      {q.isSuccess &&
        (venues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No venues yet. Create one to lay out your seats.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 sm:px-4">Venue</TableHead>
                <TableHead className="px-2 sm:px-4 text-right">Seats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venues.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="px-2 sm:px-4 font-medium">{v.name}</TableCell>
                  <TableCell className="px-2 sm:px-4 text-right tabular-nums">{v.seatCount.toLocaleString('en-IE')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent onKeyDown={trapTab} className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New venue</SheetTitle>
            <SheetDescription>Define sections; the map is generated from rows and seats per row.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">{open && <VenueForm pending={create.isPending} onSubmit={(v) => create.mutate(v)} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
