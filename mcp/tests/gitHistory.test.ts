import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { resetTokenCache } from '../src/apiClient';
import { connectClient, stubBackendFetch, textOf } from './helpers';

beforeEach(() => {
  resetTokenCache();
  config.backendUrl = 'http://backend.test:4000';
  config.jwt = 'test-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SHA_A = 'a'.repeat(40);

function validBranch(overrides: Record<string, unknown> = {}) {
  return {
    name: 'main',
    isTrunk: true,
    state: 'ACTIVE',
    ...overrides,
  };
}

function validCommit(overrides: Record<string, unknown> = {}) {
  return {
    sha: SHA_A,
    branchName: 'main',
    message: 'Initial commit',
    authorName: 'author',
    committedAt: '2026-08-21T00:00:00.000Z',
    pushed: true,
    isMerge: false,
    parentShas: [],
    truncatedFileCount: 0,
    ...overrides,
  };
}

function without<T extends Record<string, unknown>>(obj: T, key: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...obj };
  delete clone[key];
  return clone;
}

describe('sync_git_history tool (T030/T031)', () => {
  it('T030: registers the sync_git_history tool', async () => {
    const { client, close } = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('sync_git_history');
    await close();
  });

  it('T030: rejects a bad state at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch({ state: 'BOGUS' })],
        commits: [],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('T030: rejects a bad changeType at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits: [
          validCommit({
            files: [{ path: 'src/index.ts', changeType: 'X' }],
          }),
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('T030: rejects a malformed sha at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits: [validCommit({ sha: 'not-a-valid-sha' })],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('T030: rejects more than 50 commits at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const commits = Array.from({ length: 51 }, () => validCommit());
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('T030: rejects more than 500 files on one commit at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const files = Array.from({ length: 501 }, (_, i) => ({
      path: `src/file${i}.ts`,
      changeType: 'A',
    }));
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits: [validCommit({ files })],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('T031: a backend error surfaces through run() as CODE (HTTP nnn): message, never success-shaped', async () => {
    stubBackendFetch(() => ({
      status: 400,
      body: {
        error: { code: 'VALIDATION', message: 'commits[0].branchName is not a known branch' },
      },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits: [validCommit()],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'VALIDATION (HTTP 400): commits[0].branchName is not a known branch',
    );
    await close();
  });

  it('forwards parentShas: [] and truncatedFileCount: 0 for a root commit without dropping them', async () => {
    const calls = stubBackendFetch(() => ({
      status: 200,
      body: {
        branchesUpserted: 1,
        commitsUpserted: 1,
        filesUpserted: 0,
        ticketLinksUpserted: 0,
        lastSyncedAt: '2026-08-21T00:00:00.000Z',
      },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'sync_git_history',
      arguments: {
        projectId: 'p1',
        branches: [validBranch()],
        commits: [validCommit()],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/git-history/sync');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.commits[0].parentShas).toEqual([]);
    expect(Object.keys(body.commits[0])).toContain('parentShas');
    expect(body.commits[0].truncatedFileCount).toBe(0);
    expect(Object.keys(body.commits[0])).toContain('truncatedFileCount');
    await close();
  });
});

describe('sync_git_history required fields (fix round 2)', () => {
  const branchCases: Array<[string, () => Record<string, unknown>]> = [
    [
      'branches[].isTrunk',
      () => ({
        projectId: 'p1',
        branches: [without(validBranch(), 'isTrunk')],
        commits: [validCommit()],
      }),
    ],
  ];

  const commitFields = ['pushed', 'isMerge', 'parentShas', 'truncatedFileCount'] as const;
  const commitCases: Array<[string, () => Record<string, unknown>]> = commitFields.map((field) => [
    `commits[].${field}`,
    () => ({
      projectId: 'p1',
      branches: [validBranch()],
      commits: [without(validCommit(), field)],
    }),
  ]);

  it.each([...branchCases, ...commitCases])(
    'rejects a payload missing %s and never reaches the backend',
    async (_label, buildArgs) => {
      const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
      const { client, close } = await connectClient();
      const result = await client.callTool({
        name: 'sync_git_history',
        arguments: buildArgs(),
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(
        /MCP error -32602: Input validation error: Invalid arguments for tool sync_git_history/,
      );
      expect(calls).toHaveLength(0);
      await close();
    },
  );
});
