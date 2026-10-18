'use client';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import type { TenantRoleName } from '@standing/shared';
import { useMe, type TenantSummary } from './auth';

export type EventStatus = 'draft' | 'published' | 'closed';

export type OverviewDay = { day: string; tickets: number; revenueCents: number };
export type OverviewEvent = { id: string; name: string; startsAt: string; status: EventStatus; capacity: number; sold: number; revenueCents: number };
export type Overview = { days: OverviewDay[]; events: OverviewEvent[]; totals: { tickets: number; revenueCents: number } };

export type VenueRow = { id: string; name: string; seatCount: number };
export type VenueSection = { id: string; name: string; ord: number; rows: number; seatsPerRow: number };
export type VenueDetail = { id: string; name: string; sections: VenueSection[] };

export type OrgEvent = { id: string; name: string; startsAt: string; status: EventStatus; venueName: string; capacity: number; sold: number };
export type EventDetail = { id: string; name: string; startsAt: string; status: EventStatus; venueId: string; admissionLimit: number };
export type Tier = { sectionId: string; priceCents: number };

export type Member = { userId: string; email: string; name: string; role: TenantRoleName };

/** Query keys always carry the tenant id. */
export const orgKeys = {
  overview: (t: string) => ['org', t, 'overview'] as const,
  venues: (t: string) => ['org', t, 'venues'] as const,
  venue: (t: string, v: string) => ['org', t, 'venue', v] as const,
  events: (t: string) => ['org', t, 'events'] as const,
  event: (t: string, e: string) => ['org', t, 'event', e] as const,
  members: (t: string) => ['org', t, 'members'] as const,
};

export function statusLabel(s: EventStatus): string {
  switch (s) {
    case 'draft':
      return 'Draft';
    case 'published':
      return 'On sale';
    case 'closed':
      return 'Closed';
    default: {
      const never: never = s;
      return never;
    }
  }
}

/** Sold share of capacity as a whole percent (0 for an unknown capacity). */
export const fillPercent = (sold: number, capacity: number): number => (capacity > 0 ? Math.round((sold / capacity) * 100) : 0);

/** The tenant of the current /org/[tenantId] route and the signed-in user's role in it. */
export function useOrgTenant(): { tenantId: string; tenant: TenantSummary | null; ready: boolean } {
  const { tenantId = '' } = useParams<{ tenantId?: string }>();
  const me = useMe();
  const tenant = me.data?.tenants.find((t) => t.id === tenantId) ?? null;
  return { tenantId, tenant, ready: me.isSuccess };
}

/** Reports the API's own message through Sonner. */
export function toastError(e: unknown): void {
  toast.error(e instanceof Error ? e.message : 'Something went wrong');
}
