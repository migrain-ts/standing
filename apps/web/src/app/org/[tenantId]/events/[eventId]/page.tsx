'use client';
import { useParams } from 'next/navigation';
import { LiveDashboardView } from '@/components/LiveDashboardView';
import { TenantMissing } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgTenant } from '@/lib/organizer';
import { joinPath, tenantApi } from '@/lib/paths';
import { canManage } from '@/lib/tenants';
import { useLive, useReport, useRush } from '@/lib/useLive';

const message = (e: unknown): string | null => (e instanceof Error ? e.message : null);

export default function LiveEventPage() {
  const { eventId = '' } = useParams<{ eventId?: string }>();
  const { tenantId, tenant, ready } = useOrgTenant();
  const allowed = tenant != null && canManage(tenant.role);
  const live = useLive(tenantId, eventId, allowed);
  const rush = useRush(tenantId, eventId, allowed);
  const report = useReport(tenantId, eventId);

  if (ready && !tenant) return <TenantMissing />;
  if (ready && !allowed) {
    return (
      <div role="alert" className="rounded-lg border border-border p-6">
        <p className="font-medium">Managers only</p>
        <p className="mt-1 text-sm text-muted-foreground">The live dashboard is for managers and owners of this organization.</p>
      </div>
    );
  }
  if (!live.state) {
    if (live.loadError) return <QueryError title="Could not load the live figures" error={live.loadError} onRetry={() => void live.reload()} />;
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const published = live.state.snapshot.event.status === 'published';
  const q = `?eventId=${encodeURIComponent(eventId)}`;
  return (
    <LiveDashboardView
      state={live.state}
      map={live.map}
      status={live.status}
      rush={{
        run: rush.run,
        blockedReason: published ? (rush.unavailable ? 'The load simulator is not available.' : null) : 'Only a published event can receive a rush.',
        pending: rush.start.isPending,
        error: message(rush.start.error) ?? message(rush.stop.error),
        onStart: (form) => rush.start.mutate(form),
        onStop: () => rush.stop.mutate(),
      }}
      csvHref={`/api${tenantApi(tenantId, 'exports', 'sales.csv')}${q}`}
      xlsxHref={`/api${tenantApi(tenantId, 'exports', 'sales.xlsx')}${q}`}
      report={{
        status: report.status,
        pending: report.request.isPending,
        downloadHref: report.documentId ? `/api${joinPath('documents', report.documentId, 'download')}` : null,
        error: message(report.request.error),
        onGenerate: () => report.request.mutate(),
      }}
    />
  );
}
