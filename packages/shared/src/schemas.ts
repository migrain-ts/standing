import { z } from 'zod';
import { DEMO_USERS, MAX_RUSH_BUYERS, MAX_SEATS_PER_HOLD, MAX_SEATS_PER_VENUE } from './constants';
import { UUID_RE } from './ids';

const email = z.string().trim().toLowerCase().email();

export const registerSchema = z.object({
  email,
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const demoLoginSchema = z.object({ persona: z.enum(Object.keys(DEMO_USERS) as [keyof typeof DEMO_USERS, ...(keyof typeof DEMO_USERS)[]]) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DemoLoginInput = z.infer<typeof demoLoginSchema>;

export const tenantRoleSchema = z.enum(['owner', 'manager', 'door']);
export const tenantCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const memberAddSchema = z.object({ email, role: tenantRoleSchema });
export const memberUpdateSchema = z.object({ role: tenantRoleSchema });

export const sectionSpecSchema = z.object({
  name: z.string().trim().min(1).max(50),
  rows: z.number().int().min(1).max(60),
  seatsPerRow: z.number().int().min(1).max(80),
});
export const venueCreateSchema = z
  .object({ name: z.string().trim().min(1).max(100), sections: z.array(sectionSpecSchema).min(1).max(12) })
  .refine((v) => v.sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0) <= MAX_SEATS_PER_VENUE, {
    message: `A venue holds at most ${MAX_SEATS_PER_VENUE} seats`,
    path: ['sections'],
  });
export type VenueCreateInput = z.infer<typeof venueCreateSchema>;

const uuid = z.string().regex(UUID_RE, 'Expected a UUID');
const eventName = z.string().trim().min(1).max(120);
const eventStartsAt = z.coerce.date();
const admissionLimit = z.number().int().min(0).max(2000);
export const eventCreateSchema = z.object({
  venueId: uuid,
  name: eventName,
  startsAt: eventStartsAt,
  admissionLimit: admissionLimit.default(200),
});
// No default here: zod 4 re-applies defaults through .partial(), which would overwrite the stored limit on every PATCH.
export const eventUpdateSchema = z.object({ name: eventName, startsAt: eventStartsAt, admissionLimit }).partial();
export const tiersSchema = z
  .array(z.object({ sectionId: uuid, priceCents: z.number().int().min(0).max(1_000_000) }))
  .min(1)
  .max(12)
  .refine((t) => new Set(t.map((x) => x.sectionId.toLowerCase())).size === t.length, 'Duplicate section');
export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type TiersInput = z.infer<typeof tiersSchema>;

export const holdCreateSchema = z.object({
  seatIds: z
    .array(z.string().regex(UUID_RE, 'Expected a UUID'))
    .min(1)
    .max(MAX_SEATS_PER_HOLD)
    .refine((ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length, 'Duplicate seat'),
});
export type HoldCreateInput = z.infer<typeof holdCreateSchema>;

export const scanSchema = z.object({ code: z.string().trim().min(1).max(200), eventId: uuid.optional() });
export type ScanInput = z.infer<typeof scanSchema>;

export const reportRequestSchema = z.object({ kind: z.literal('report_pdf') });
export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a calendar date');
export const MAX_EXPORT_RANGE_DAYS = 366;
/** Query of the sales exports. `from` and `to` are inclusive UTC days. */
export const exportQuerySchema = z
  .object({ from: isoDay.optional(), to: isoDay.optional(), eventId: uuid.optional() })
  .refine(
    (q) => !q.from || !q.to || (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= MAX_EXPORT_RANGE_DAYS,
    { message: `The range is at most ${MAX_EXPORT_RANGE_DAYS} days`, path: ['to'] },
  );
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const rushSchema = z.object({
  buyers: z.number().int().min(1).max(MAX_RUSH_BUYERS),
  maxSeatsPerBuyer: z.number().int().min(1).max(4).default(2),
  durationSeconds: z.number().int().min(5).max(300).default(30),
});
export type RushInput = z.infer<typeof rushSchema>;
