import { Badge } from '@/components/ui/badge';
import { H1 } from '@/components/ui/typography';
import { statusLabel, type EventStatus } from '@/lib/organizer';

/** Title, one supporting line and the primary action in one group. */
export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <H1 className="text-2xl md:text-3xl">{title}</H1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

const STATUS_VARIANT = { draft: 'default', published: 'success-light', closed: 'outline' } as const satisfies Record<EventStatus, string>;

export function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge variant={STATUS_VARIANT[status]} className="whitespace-nowrap">{statusLabel(status)}</Badge>;
}

export function TenantMissing() {
  return (
    <div role="alert" className="rounded-lg border border-border p-6">
      <p className="font-medium">Organization not found</p>
      <p className="mt-1 text-sm text-muted-foreground">You are not a member of this organization. Pick another one from the menu.</p>
    </div>
  );
}
