declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type VenueId = Brand<string, 'VenueId'>;
export type SectionId = Brand<string, 'SectionId'>;
export type SeatId = Brand<string, 'SeatId'>;
export type EventId = Brand<string, 'EventId'>;
export type HoldId = Brand<string, 'HoldId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type OrderItemId = Brand<string, 'OrderItemId'>;
export type TicketId = Brand<string, 'TicketId'>;
export type DocumentId = Brand<string, 'DocumentId'>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Brands a string that has already been validated (database row, parsed request). */
export function asId<B extends string>(v: string): Brand<string, B> {
  return v as Brand<string, B>;
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
