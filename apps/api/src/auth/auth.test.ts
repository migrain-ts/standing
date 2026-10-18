import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@standing/db';
import { DEMO_USERS } from '@standing/shared';
import { call, makeApp, register, sha256, type TestApp } from '../test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

describe('registration', () => {
  it('creates the user with a lower-cased email and a session cookie', async () => {
    const { cookie, user } = await register(t.app, 'Ada@Example.com', 'Ada');
    expect(user.email).toBe('ada@example.com');
    const me = await call(t.app, cookie, 'GET', '/auth/me');
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe('ada@example.com');
  });
  it('rejects a duplicate email with 409 and an invalid body with the standard error shape', async () => {
    await register(t.app, 'dup@example.com');
    const dup = await call(t.app, null, 'POST', '/auth/register', { email: 'dup@example.com', password: 'correct horse battery', name: 'X' });
    expect(dup.status).toBe(409);
    const bad = await call(t.app, null, 'POST', '/auth/register', { email: 'nope', password: 'x', name: '' });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; message: string } };
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.code).toBe('invalid_request');
  });
  it('stores only the SHA-256 hash of the session token', async () => {
    const { cookie } = await register(t.app);
    const token = cookie.replace('sid=', '');
    const rows = await t.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
    expect(rows).toHaveLength(1);
    expect(await t.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, token))).toHaveLength(0);
  });
});

describe('sessions', () => {
  it('accepts the cookie and a Bearer token, rejects unknown, expired and revoked tokens', async () => {
    const { cookie } = await register(t.app);
    const token = cookie.replace('sid=', '');
    expect((await call(t.app, null, 'GET', '/auth/me', undefined, { authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await call(t.app, 'sid=unknown', 'GET', '/auth/me')).status).toBe(401);
    expect((await call(t.app, cookie, 'POST', '/auth/logout')).status).toBe(204);
    expect((await call(t.app, cookie, 'GET', '/auth/me')).status).toBe(401);
    const second = await register(t.app);
    t.clock.advanceMinutes(31 * 24 * 60);
    expect((await call(t.app, second.cookie, 'GET', '/auth/me')).status).toBe(401);
    t.clock.advanceMinutes(-31 * 24 * 60);
  });
  it('counts only failed logins toward the rate limit', async () => {
    const f = await makeApp();
    try {
      const { user } = await register(f.app, 'rl@example.com');
      for (let i = 0; i < 12; i++) {
        expect((await call(f.app, null, 'POST', '/auth/login', { email: user.email, password: 'correct horse battery' })).status).toBe(200);
      }
      let last = 0;
      for (let i = 0; i < 11; i++) last = (await call(f.app, null, 'POST', '/auth/login', { email: user.email, password: 'wrong password' })).status;
      expect(last).toBe(429);
    } finally {
      await f.close();
    }
  });
});

describe('demo login', () => {
  it('is a 404 when disabled', async () => {
    expect((await call(t.app, null, 'POST', '/auth/demo', { persona: 'organizer' })).status).toBe(404);
  });
  it('signs in the seeded persona when enabled and 404s when that user is not seeded', async () => {
    const demo = await makeApp({ config: { demoLogin: true } });
    expect((await call(demo.app, null, 'POST', '/auth/demo', { persona: 'buyer' })).status).toBe(404);
    await demo.db.insert(schema.users).values({ email: DEMO_USERS.buyer, passwordHash: 'x', name: 'Demo Buyer' });
    const ok = await call(demo.app, null, 'POST', '/auth/demo', { persona: 'buyer' });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')?.split(';')[0] ?? null;
    expect((await call(demo.app, cookie, 'GET', '/auth/me')).status).toBe(200);
    expect((await call(demo.app, null, 'POST', '/auth/demo', { persona: 'hacker' })).status).toBe(400);
    await demo.close();
  });
});

describe('unknown routes and bad JSON', () => {
  it('use the standard error body', async () => {
    const nf = await call(t.app, null, 'GET', '/nope');
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    const bad = await t.app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()) as object)).toEqual(['error']);
  });
});
