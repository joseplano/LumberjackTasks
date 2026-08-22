import { clearToken, getToken } from './auth';
import type { GitBranchDetail, GitCommitDetail, GitHistoryResponse } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`);
  }

  return data as T;
}

// T045: typed fetcher for contracts/http-api.md section 1. GET-only, on top
// of the shared `api` helper -- never a second client (constitution
// Principle I: the frontend is an HTTP consumer only).
export function getGitHistory(projectId: string): Promise<GitHistoryResponse> {
  return api<GitHistoryResponse>(`/projects/${projectId}/git-history`);
}

// T053/T058: typed fetchers for contracts/http-api.md sections 2 and 3.
// Like `getGitHistory` these go through the shared `api` helper and inherit
// its default `GET` -- the repository view issues nothing else (FR-003,
// constitution Principle I). T072 asserts that executably.
export function getGitCommitDetail(projectId: string, sha: string): Promise<GitCommitDetail> {
  return api<GitCommitDetail>(`/projects/${projectId}/git-history/commits/${sha}`);
}

export function getGitBranchDetail(projectId: string, branchId: string): Promise<GitBranchDetail> {
  return api<GitBranchDetail>(`/projects/${projectId}/git-history/branches/${branchId}`);
}
