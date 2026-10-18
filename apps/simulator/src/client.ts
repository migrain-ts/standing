import { Agent, fetch, setGlobalDispatcher } from 'undici';

export type ApiResponse = { status: number; body: unknown; ms: number };
export type ApiClient = {
  get(path: string, signal?: AbortSignal): Promise<ApiResponse>;
  post(path: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal): Promise<ApiResponse>;
  del(path: string, signal?: AbortSignal): Promise<ApiResponse>;
};

const TIMEOUT_MS = 15_000;
let installed = false;
function installDispatcher(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(new Agent({ connections: 256 }));
}

/** Never throws on a non-2xx answer; a network failure or timeout comes back as status 0. An abort rethrows. */
export function createApiClient(baseUrl: string, token: string, onRequest: () => void = () => {}): ApiClient {
  installDispatcher();
  async function send(method: string, path: string, body: unknown, extra: Record<string, string>, signal?: AbortSignal): Promise<ApiResponse> {
    const started = performance.now();
    onRequest();
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed, ms: performance.now() - started };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { status: 0, body: null, ms: performance.now() - started };
    }
  }
  return {
    get: (path, signal) => send('GET', path, undefined, {}, signal),
    post: (path, body, headers = {}, signal) => send('POST', path, body ?? {}, headers, signal),
    del: (path, signal) => send('DELETE', path, undefined, {}, signal),
  };
}
