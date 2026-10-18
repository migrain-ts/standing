import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from './api';

function stubFetch(res: Response) {
  const fn = vi.fn<typeof fetch>().mockResolvedValue(res);
  vi.stubGlobal('fetch', fn);
  return fn;
}
function lastInit(fn: ReturnType<typeof stubFetch>): RequestInit {
  const init = fn.mock.calls[0]?.[1];
  if (!init) throw new Error('fetch was not called with init');
  return init;
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('prefixes /api, sends the cookie and returns parsed JSON', async () => {
    const fn = stubFetch(Response.json({ ok: true }));
    await expect(api<{ ok: boolean }>('/auth/me')).resolves.toEqual({ ok: true });
    expect(fn.mock.calls[0]?.[0]).toBe('/api/auth/me');
    expect(lastInit(fn).credentials).toBe('same-origin');
  });

  it('sends content-type and a JSON body only when json is given', async () => {
    const withJson = stubFetch(Response.json({}));
    await api('/x', { method: 'POST', json: { a: 1 } });
    expect(lastInit(withJson).headers).toMatchObject({ 'content-type': 'application/json' });
    expect(lastInit(withJson).body).toBe('{"a":1}');

    const without = stubFetch(Response.json({}));
    await api('/x');
    expect(lastInit(without).headers).not.toHaveProperty('content-type');
    expect(lastInit(without).body).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiClientError with status, code, message and details', async () => {
    stubFetch(Response.json({ error: { code: 'seat_taken', message: 'Seat taken', details: { seatId: 's1' } } }, { status: 409 }));
    const err = await api('/holds').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 409, code: 'seat_taken', message: 'Seat taken', details: { seatId: 's1' } });
  });

  it('falls back to http_error and the status text when the body is not JSON', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    const err = await api('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'http_error', message: 'Bad Gateway' });
  });
});
