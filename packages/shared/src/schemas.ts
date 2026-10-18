import { z } from 'zod';
import { DEMO_USERS, MAX_SEATS_PER_VENUE } from './constants';

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
