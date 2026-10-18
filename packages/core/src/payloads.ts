import { z } from 'zod';

export const ticketSoldPayload = z.object({
  orderId: z.string(),
  at: z.string().datetime(),
  revenueCents: z.number().int(),
  seats: z.array(z.object({ seatId: z.string(), idx: z.number().int(), sectionId: z.string(), priceCents: z.number().int() })),
});
export const ticketScannedPayload = z.object({ ticketId: z.string(), at: z.string().datetime() });
export type TicketSoldPayload = z.infer<typeof ticketSoldPayload>;
export type TicketScannedPayload = z.infer<typeof ticketScannedPayload>;

/** Aggregated change for one event, published on Redis after a projection batch commits. */
export type EventDelta = {
  eventId: string;
  tenantId: string;
  tickets: number;
  revenueCents: number;
  seats: { idx: number; sectionId: string }[];
  scanned: number;
  at: string;
};
