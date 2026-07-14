import { config } from './config';

export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let cachedToken: string | null = null;

export function resetTokenCache() {
  cachedToken = null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } };
  }
}

async function login(): Promise<string> {
  const res = await fetch(new URL('/api/v1/auth/login', config.backendUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  const body = (await parseBody(res)) as ErrorBody & { token?: string };
  if (!res.ok || !body?.token) {
    throw new BackendError(
      res.status,
      body?.error?.code ?? 'AUTH_FAILED',
      body?.error?.message ?? 'Login against the backend failed',
    );
  }
  return body.token;
}

async function getToken(): Promise<string> {
  if (config.jwt) return config.jwt;
  if (!config.email || !config.password) {
    throw new BackendError(
      401,
      'MCP_CONFIG',
      'Set MCP_JWT or MCP_EMAIL/MCP_PASSWORD environment variables',
    );
  }
  if (!cachedToken) cachedToken = await login();
  return cachedToken;
}

export interface ApiFetchInit {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const call = async (token: string) => {
    const url = new URL(`/api/v1${path}`, config.backendUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };

  let res = await call(await getToken());
  if (res.status === 401 && !config.jwt) {
    // cached token likely expired (backend JWTs last 12h) — re-login once
    cachedToken = null;
    res = await call(await getToken());
  }
  const body = (await parseBody(res)) as (ErrorBody & T) | null;
  if (!res.ok) {
    throw new BackendError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `Backend returned HTTP ${res.status}`,
    );
  }
  return body as T;
}
