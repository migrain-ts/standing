/** Wire types of the public and buyer endpoints, plus small pure helpers for the storefront. */
export type EventSummary = {
  id: string;
  name: string;
  startsAt: string;
  tenantName: string;
  venueName: string;
  minPriceCents: number;
  capacity: number;
  available: number;
};
export type EventSection = { id: string; name: string; ord: number; priceCents: number };
export type EventDetail = Omit<EventSummary, 'minPriceCents'> & { venueId: string; admissionLimit: number; sections: EventSection[] };

export type HoldDto = {
  id: string;
  eventId: string;
  expiresAt: string;
  totalCents: number;
  seats: { seatId: string; idx: number; sectionId: string; priceCents: number }[];
};
export type TicketDto = { id: string; seatId: string; rowLabel: string; number: number; sectionName: string; priceCents: number; code: string };
export type OrderDto = { id: string; eventId: string; totalCents: number; createdAt: string; documentId: string | null; tickets: TicketDto[] };
export type OrderRow = { id: string; eventId: string; eventName: string; totalCents: number; createdAt: string };
export type DocumentDto = { id: string; kind: 'ticket_pdf' | 'report_pdf'; status: 'queued' | 'running' | 'ready' | 'failed'; error?: string };

/** "Selling fast" only when more than 80% of the seats are gone. Never shown for an unknown capacity. */
export function isSellingFast(capacity: number, available: number): boolean {
  return capacity > 0 && (capacity - available) / capacity > 0.8;
}

export const seatsLabel = (n: number): string => `${n} ${n === 1 ? 'seat' : 'seats'}`;

/** `details.taken` of a 409 seats_unavailable, narrowed from unknown. */
export function takenSeatIds(details: unknown): string[] {
  if (typeof details !== 'object' || details === null || !('taken' in details)) return [];
  const taken = (details as { taken: unknown }).taken;
  return Array.isArray(taken) ? taken.filter((t): t is string => typeof t === 'string') : [];
}
