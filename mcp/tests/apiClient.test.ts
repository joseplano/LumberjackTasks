import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { apiFetch, BackendError, resetTokenCache } from '../src/apiClient';

interface StubResponse {
  status: number;
  body: unknown;
}

function stubFetch(handler: (url: URL, init: RequestInit) => StubResponse) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  resetTokenCache();
  config.backendUrl = 'http://backend.test:4000';
  config.jwt = 'static-token';
  config.email = undefined;
  config.password = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('GETs /api/v1 paths with bearer token and query params', async () => {
    const calls = stubFetch(() => ({ status: 200, body: [{ id: 'p1' }] }));
    const result = await apiFetch('/projects', { query: { search: 'demo', missing: undefined } });
    expect(result).toEqual([{ id: 'p1' }]);
    expect(calls[0].url.pathname).toBe('/api/v1/projects');
    expect(calls[0].url.searchParams.get('search')).toBe('demo');
    expect(calls[0].url.searchParams.has('missing')).toBe(false);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      'Bearer static-token',
    );
  });

  it('POSTs JSON bodies', async () => {
    const calls = stubFetch(() => ({ status: 201, body: { id: 'p2' } }));
    await apiFetch('/projects', { method: 'POST', body: { name: 'Demo' } });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe(JSON.stringify({ name: 'Demo' }));
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('throws BackendError carrying the backend code and message', async () => {
    stubFetch(() => ({
      status: 409,
      body: { error: { code: 'PARENT_MOVE', message: 'Subtickets must move first' } },
    }));
    const err = await apiFetch('/tickets/t1/move', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).status).toBe(409);
    expect((err as BackendError).code).toBe('PARENT_MOVE');
    expect((err as BackendError).message).toBe('Subtickets must move first');
  });

  it('logs in with credentials when no static JWT is set', async () => {
    config.jwt = undefined;
    config.email = 'bot@example.com';
    config.password = 'secret';
    const calls = stubFetch((url) => {
      if (url.pathname === '/api/v1/auth/login') {
        return { status: 200, body: { token: 'fresh-token', user: { id: 'u1' } } };
      }
      return { status: 200, body: [] };
    });
    await apiFetch('/projects');
    expect(calls[0].url.pathname).toBe('/api/v1/auth/login');
    expect(calls[0].init.body).toBe(
      JSON.stringify({ email: 'bot@example.com', password: 'secret' }),
    );
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe(
      'Bearer fresh-token',
    );
    // token is cached: a second call does not log in again
    await apiFetch('/projects');
    expect(calls).toHaveLength(3);
    expect(calls[2].url.pathname).toBe('/api/v1/projects');
  });

  it('re-logs in once when the cached token expires (401)', async () => {
    config.jwt = undefined;
    config.email = 'bot@example.com';
    config.password = 'secret';
    let issued = 0;
    const calls = stubFetch((url, init) => {
      if (url.pathname === '/api/v1/auth/login') {
        issued += 1;
        return { status: 200, body: { token: `token-${issued}` } };
      }
      const auth = (init.headers as Record<string, string>).authorization;
      if (auth === 'Bearer token-1') {
        return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } };
      }
      return { status: 200, body: [{ id: 'p1' }] };
    });
    const result = await apiFetch('/projects');
    expect(result).toEqual([{ id: 'p1' }]);
    // login, 401 request, re-login, retried request
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/projects',
      '/api/v1/auth/login',
      '/api/v1/projects',
    ]);
  });

  it('fails fast when neither MCP_JWT nor credentials are configured', async () => {
    config.jwt = undefined;
    stubFetch(() => ({ status: 200, body: [] }));
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).code).toBe('MCP_CONFIG');
  });

  it('throws AUTH_FAILED when the login response is not ok', async () => {
    config.jwt = undefined;
    config.email = 'bot@example.com';
    config.password = 'wrong';
    stubFetch(() => ({ status: 401, body: {} }));
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).status).toBe(401);
    expect((err as BackendError).code).toBe('AUTH_FAILED');
    expect((err as BackendError).message).toBe('Login against the backend failed');
  });

  it('throws AUTH_FAILED when the login response is ok but carries no token', async () => {
    config.jwt = undefined;
    config.email = 'bot@example.com';
    config.password = 'secret';
    stubFetch(() => ({ status: 200, body: { user: { id: 'u1' } } }));
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).code).toBe('AUTH_FAILED');
    expect((err as BackendError).message).toBe('Login against the backend failed');
  });

  it('propagates network errors when the backend is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(BackendError);
    expect((err as TypeError).message).toBe('fetch failed');
  });

  it('does not retry a 401 when a static JWT is configured', async () => {
    const calls = stubFetch(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Bad token' } },
    }));
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).status).toBe(401);
    expect((err as BackendError).code).toBe('UNAUTHORIZED');
    // no login retry: the single failing request is the only fetch call
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/api/v1/projects');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('returns null for an empty response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    await expect(apiFetch('/projects/p1')).resolves.toBeNull();
  });

  it('throws BAD_RESPONSE when a failing response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Bad Gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).status).toBe(502);
    expect((err as BackendError).code).toBe('BAD_RESPONSE');
    expect((err as BackendError).message).toBe('<html>Bad Gateway</html>');
  });

  it('falls back to UNKNOWN and an HTTP status message when the error body has no code/message', async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const err = await apiFetch('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).code).toBe('UNKNOWN');
    expect((err as BackendError).message).toBe('Backend returned HTTP 500');
  });
});
