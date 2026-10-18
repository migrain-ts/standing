import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { schema } from '@standing/db';
import { DEMO_USERS, demoLoginSchema, loginSchema, registerSchema } from '@standing/shared';
import type { Deps, Env } from '../app';
import { ApiError } from '../errors';
import { rateLimit } from '../rate-limit';
import { validator } from '../validate';
import { requireAuth, SESSION_COOKIE, tokenFrom } from './middleware';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { createSession, revokeSession, SESSION_TTL_MS } from './sessions';

export function authRoutes(deps: Deps) {
  const loginLimiter = rateLimit({ clock: deps.clock, trustProxy: deps.trustProxy, windowMs: 15 * 60_000, max: 10, failuresOnly: true });
  const registerLimiter = rateLimit({ clock: deps.clock, trustProxy: deps.trustProxy, windowMs: 15 * 60_000, max: 50 });

  const issueCookie = (c: Parameters<typeof setCookie>[0], token: string) =>
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: deps.secureCookies ?? false,
      maxAge: SESSION_TTL_MS / 1000,
    });

  return new Hono<Env>()
    .post('/register', registerLimiter, validator('json', registerSchema), async (c) => {
      const body = c.req.valid('json');
      const { db, clock } = c.get('deps');
      const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, body.email));
      if (existing) throw new ApiError(409, 'email_taken', 'This email is already registered');
      const [user] = await db
        .insert(schema.users)
        .values({ email: body.email, passwordHash: await hashPassword(body.password), name: body.name })
        .returning();
      if (!user) throw new Error('user insert failed');
      issueCookie(c, await createSession(db, user.id, clock.now()));
      return c.json({ user: { id: user.id, email: user.email, name: user.name } }, 201);
    })
    .post('/login', loginLimiter, validator('json', loginSchema), async (c) => {
      const body = c.req.valid('json');
      const { db, clock } = c.get('deps');
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email));
      const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, body.password).catch(() => false);
      if (!user || !ok) throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');
      issueCookie(c, await createSession(db, user.id, clock.now()));
      return c.json({ user: { id: user.id, email: user.email, name: user.name } });
    })
    .post('/demo', validator('json', demoLoginSchema), async (c) => {
      const deps = c.get('deps');
      if (!deps.config.demoLogin) throw new ApiError(404, 'not_found', 'Not found');
      const { persona } = c.req.valid('json');
      const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.email, DEMO_USERS[persona]));
      if (!user) throw new ApiError(404, 'not_found', 'Demo data is not seeded');
      issueCookie(c, await createSession(deps.db, user.id, deps.clock.now()));
      return c.json({ user: { id: user.id, email: user.email, name: user.name } });
    })
    .post('/logout', requireAuth, async (c) => {
      const { db, clock } = c.get('deps');
      const token = tokenFrom(c);
      if (token) await revokeSession(db, token, clock.now());
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.body(null, 204);
    })
    .get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));
}
