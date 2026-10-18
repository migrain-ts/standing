import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => ts('created_at').notNull().defaultNow();

export const tenantRoleEnum = pgEnum('tenant_role', ['owner', 'manager', 'door']);
export const eventStatusEnum = pgEnum('event_status', ['draft', 'published', 'closed']);
export const seatStatusEnum = pgEnum('seat_status', ['available', 'held', 'sold']);
export const holdStatusEnum = pgEnum('hold_status', ['active', 'paid', 'cancelled']);
export const orderStatusEnum = pgEnum('order_status', ['paid', 'cancelled']);
export const paymentStatusEnum = pgEnum('payment_status', ['succeeded', 'failed']);
export const documentKindEnum = pgEnum('document_kind', ['ticket_pdf', 'report_pdf']);
export const documentStatusEnum = pgEnum('document_status', ['queued', 'running', 'ready', 'failed']);

export type TenantRole = (typeof tenantRoleEnum.enumValues)[number];
export type EventStatus = (typeof eventStatusEnum.enumValues)[number];
export type SeatStatus = (typeof seatStatusEnum.enumValues)[number];
export type HoldStatus = (typeof holdStatusEnum.enumValues)[number];
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];
export type DocumentKind = (typeof documentKindEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];

export const users = pgTable('users', {
  id: pk(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  isSimulated: boolean('is_simulated').notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  id: pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const tenants = pgTable('tenants', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: tenantRoleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

export const venues = pgTable(
  'venues',
  {
    id: pk(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('venues_tenant_idx').on(t.tenantId)],
);

export const sections = pgTable(
  'sections',
  {
    id: pk(),
    venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ord: integer('ord').notNull(),
    rows: integer('rows').notNull(),
    seatsPerRow: integer('seats_per_row').notNull(),
  },
  (t) => [uniqueIndex('sections_venue_ord_uq').on(t.venueId, t.ord)],
);

export const seats = pgTable(
  'seats',
  {
    id: pk(),
    venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').notNull().references(() => sections.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    rowLabel: text('row_label').notNull(),
    number: integer('number').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
  },
  (t) => [uniqueIndex('seats_venue_idx_uq').on(t.venueId, t.idx), index('seats_section_idx').on(t.sectionId)],
);

export const events = pgTable(
  'events',
  {
    id: pk(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    venueId: uuid('venue_id').notNull().references(() => venues.id),
    name: text('name').notNull(),
    startsAt: ts('starts_at').notNull(),
    status: eventStatusEnum('status').notNull().default('draft'),
    admissionLimit: integer('admission_limit').notNull().default(200),
    createdAt: createdAt(),
  },
  (t) => [index('events_tenant_idx').on(t.tenantId, t.status), index('events_public_idx').on(t.status, t.startsAt)],
);

export const priceTiers = pgTable(
  'price_tiers',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').notNull().references(() => sections.id),
    priceCents: integer('price_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.sectionId] }), check('price_tiers_price_ck', sql`${t.priceCents} >= 0`)],
);

export const holds = pgTable(
  'holds',
  {
    id: pk(),
    buyerId: uuid('buyer_id').notNull().references(() => users.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    seatCount: integer('seat_count').notNull(),
    status: holdStatusEnum('status').notNull().default('active'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('holds_buyer_event_idx').on(t.buyerId, t.eventId, t.status)],
);

export const orders = pgTable(
  'orders',
  {
    id: pk(),
    buyerId: uuid('buyer_id').notNull().references(() => users.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    holdId: uuid('hold_id').notNull().unique().references(() => holds.id),
    totalCents: integer('total_cents').notNull(),
    status: orderStatusEnum('status').notNull().default('paid'),
    createdAt: createdAt(),
  },
  (t) => [index('orders_event_idx').on(t.eventId), index('orders_buyer_idx').on(t.buyerId)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: pk(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id),
    seatId: uuid('seat_id').notNull().references(() => seats.id),
    sectionId: uuid('section_id').notNull().references(() => sections.id),
    priceCents: integer('price_cents').notNull(),
  },
  // A seat can be sold once per event, enforced by the database even if application code is wrong.
  (t) => [uniqueIndex('order_items_event_seat_uq').on(t.eventId, t.seatId), index('order_items_order_idx').on(t.orderId)],
);

export const eventSeats = pgTable(
  'event_seats',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    seatId: uuid('seat_id').notNull().references(() => seats.id),
    status: seatStatusEnum('status').notNull().default('available'),
    holdId: uuid('hold_id').references(() => holds.id),
    heldUntil: ts('held_until'),
    orderId: uuid('order_id').references(() => orders.id),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.seatId] }),
    index('event_seats_status_idx').on(t.eventId, t.status),
    index('event_seats_hold_idx').on(t.holdId),
    check('event_seats_held_ck', sql`${t.status} <> 'held' or (${t.holdId} is not null and ${t.heldUntil} is not null)`),
    check('event_seats_sold_ck', sql`${t.status} <> 'sold' or ${t.orderId} is not null`),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: pk(),
    orderItemId: uuid('order_item_id').notNull().unique().references(() => orderItems.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id),
    seatId: uuid('seat_id').notNull().references(() => seats.id),
    scannedAt: ts('scanned_at'),
    scannedBy: uuid('scanned_by').references(() => users.id),
  },
  (t) => [index('tickets_event_idx').on(t.eventId), index('tickets_order_idx').on(t.orderId)],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    holdId: uuid('hold_id').notNull().references(() => holds.id),
    idempotencyKey: text('idempotency_key').notNull(),
    status: paymentStatusEnum('status').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payments_hold_key_uq').on(t.holdId, t.idempotencyKey)],
);

export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    eventId: uuid('event_id').notNull(),
    payload: jsonb('payload').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdAt: createdAt(),
    processedAt: ts('processed_at'),
  },
  (t) => [index('outbox_pending_idx').on(t.id).where(sql`${t.processedAt} is null`)],
);

export const salesByMinute = pgTable(
  'sales_by_minute',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    bucket: ts('bucket').notNull(),
    tickets: integer('tickets').notNull().default(0),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.bucket] })],
);

export const salesBySection = pgTable(
  'sales_by_section',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').notNull().references(() => sections.id),
    tickets: integer('tickets').notNull().default(0),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.sectionId] })],
);

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    kind: documentKindEnum('kind').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    eventId: uuid('event_id').references(() => events.id),
    requestedBy: uuid('requested_by').references(() => users.id),
    params: jsonb('params'),
    status: documentStatusEnum('status').notNull().default('queued'),
    content: bytea('content'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('documents_status_idx').on(t.status, t.createdAt), index('documents_order_idx').on(t.orderId)],
);
