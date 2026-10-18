import { z } from 'zod';
import { DEMO_USERS } from './constants';

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
