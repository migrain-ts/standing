import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeApp, makeUser, type TestApp } from '../test-helpers';
import { makeTenantFixture } from '../fixtures';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

describe('tenants', () => {
  it('creating a tenant makes the caller its owner and lists it with the role', async () => {
    const u = await makeUser(t, 'founder');
    const res = await call(t.app, u.cookie, 'POST', '/tenants', { name: 'Blue Note Events' });
    expect(res.status).toBe(201);
    const list = (await (await call(t.app, u.cookie, 'GET', '/tenants')).json()) as { tenants: { name: string; role: string }[] };
    expect(list.tenants).toEqual([expect.objectContaining({ name: 'Blue Note Events', role: 'owner' })]);
  });
  it('does not list tenants the caller does not belong to', async () => {
    const f = await makeTenantFixture(t);
    const list = (await (await call(t.app, f.outsider.cookie, 'GET', '/tenants')).json()) as { tenants: { id: string }[] };
    expect(list.tenants.map((x) => x.id)).not.toContain(f.tenantId);
  });
});

describe('members', () => {
  it('adds an existing user by email, refuses unknown emails and duplicates', async () => {
    const f = await makeTenantFixture(t);
    const target = await makeUser(t, 'newcomer');
    const email = ((await (await call(t.app, target.cookie, 'GET', '/auth/me')).json()) as { user: { email: string } }).user.email;
    expect((await call(t.app, f.owner.cookie, 'POST', `/tenants/${f.tenantId}/members`, { email, role: 'door' })).status).toBe(201);
    expect((await call(t.app, f.owner.cookie, 'POST', `/tenants/${f.tenantId}/members`, { email, role: 'door' })).status).toBe(409);
    expect((await call(t.app, f.owner.cookie, 'POST', `/tenants/${f.tenantId}/members`, { email: 'ghost@example.com', role: 'door' })).status).toBe(404);
  });
  it('treats an upper-case tenant id like the lower-case one', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, f.owner.cookie, 'GET', `/tenants/${f.tenantId.toUpperCase()}/members`)).status).toBe(200);
  });
  it('keeps at least one owner when removing or demoting', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, f.owner.cookie, 'DELETE', `/tenants/${f.tenantId}/members/${f.owner.id}`)).status).toBe(409);
    expect((await call(t.app, f.owner.cookie, 'PATCH', `/tenants/${f.tenantId}/members/${f.owner.id}`, { role: 'manager' })).status).toBe(409);
  });
  it('lets only one of two concurrent demotions succeed when two owners exist', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, f.owner.cookie, 'PATCH', `/tenants/${f.tenantId}/members/${f.manager.id}`, { role: 'owner' })).status).toBe(200);
    const [a, b] = await Promise.all([
      call(t.app, f.owner.cookie, 'PATCH', `/tenants/${f.tenantId}/members/${f.owner.id}`, { role: 'door' }),
      call(t.app, f.manager.cookie, 'PATCH', `/tenants/${f.tenantId}/members/${f.manager.id}`, { role: 'door' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
