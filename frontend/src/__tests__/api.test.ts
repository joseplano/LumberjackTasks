import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { setToken, clearToken, getToken } from '@/lib/auth';

function mockFetch(status: number, json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  });
}

describe('auth token helpers', () => {
  afterEach(clearToken);

  it('stores and clears the token', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('api client', () => {
  beforeEach(() => {
    clearToken();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs JSON from the backend with /api/v1 prefix', async () => {
    const fetchMock = mockFetch(200, [{ id: 'p1' }]);
    vi.stubGlobal('fetch', fetchMock);
    const result = await api<{ id: string }[]>('/projects');
    expect(result).toEqual([{ id: 'p1' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/projects',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the bearer token and JSON body on POST', async () => {
    setToken('tok-1');
    const fetchMock = mockFetch(201, { id: 'new' });
    vi.stubGlobal('fetch', fetchMock);
    await api('/projects', { method: 'POST', body: { name: 'X' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'X' }));
  });

  it('throws ApiError with backend code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(409, { error: { code: 'PARENT_MOVE_BLOCKED', message: 'Cannot move parent' } }),
    );
    const err = (await api('/tickets/1/move', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('PARENT_MOVE_BLOCKED');
    expect(err.message).toBe('Cannot move parent');
  });

  it('clears the token on 401', async () => {
    setToken('expired');
    vi.stubGlobal(
      'fetch',
      mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } }),
    );
    vi.stubGlobal('location', { ...window.location, href: '', pathname: '/projects' });
    await api('/projects').catch(() => undefined);
    expect(getToken()).toBeNull();
  });

  it('redirects to /login on 401 when not already there', async () => {
    setToken('expired');
    vi.stubGlobal(
      'fetch',
      mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } }),
    );
    vi.stubGlobal('location', { href: '', pathname: '/projects' });
    await api('/projects').catch(() => undefined);
    expect(window.location.href).toBe('/login');
  });

  it('does not redirect on 401 when already on /login', async () => {
    setToken('expired');
    vi.stubGlobal(
      'fetch',
      mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } }),
    );
    vi.stubGlobal('location', { href: '', pathname: '/login' });
    await api('/auth/login', { method: 'POST', body: {} }).catch(() => undefined);
    expect(window.location.href).toBe('');
  });

  it('falls back to UNKNOWN code and a generic message on non-JSON error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    const err = (await api('/projects').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('Request failed (502)');
  });

  it('sends no Content-Type header on a body-less GET', async () => {
    const fetchMock = mockFetch(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await api('/projects');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.body).toBeUndefined();
  });
});
