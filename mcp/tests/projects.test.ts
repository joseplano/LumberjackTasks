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

describe('project tools', () => {
  it('registers the five project tools', async () => {
    const { client, close } = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of [
      'list_projects',
      'create_project',
      'get_project',
      'rename_project',
      'delete_project',
    ]) {
      expect(names).toContain(name);
    }
    await close();
  });

  it('list_projects forwards the search filter and returns backend JSON', async () => {
    const calls = stubBackendFetch(() => ({
      status: 200,
      body: [{ id: 'p1', code: 'DEMO-000001', name: 'Demo' }],
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({ name: 'list_projects', arguments: { search: 'demo' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([{ id: 'p1', code: 'DEMO-000001', name: 'Demo' }]);
    expect(calls[0].url.pathname).toBe('/api/v1/projects');
    expect(calls[0].url.searchParams.get('search')).toBe('demo');
    await close();
  });

  it('create_project POSTs the body', async () => {
    const calls = stubBackendFetch(() => ({
      status: 201,
      body: { id: 'p2', code: 'NEWP-000002', name: 'New Project' },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'New Project', description: 'desc' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'New Project',
      description: 'desc',
    });
    await close();
  });

  it('get_project GETs the project and returns its JSON', async () => {
    const calls = stubBackendFetch(() => ({
      status: 200,
      body: { id: 'p1', code: 'DEMO-000001', name: 'Demo', columns: [], labels: [] },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({ name: 'get_project', arguments: { projectId: 'p1' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      id: 'p1',
      code: 'DEMO-000001',
      name: 'Demo',
      columns: [],
      labels: [],
    });
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1');
    expect(calls[0].init.method ?? 'GET').toBe('GET');
    await close();
  });

  it('create_project and rename_project pass gitRepoUrl through', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 'p1' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'create_project',
      arguments: { name: 'Repo Project', gitRepoUrl: 'https://github.com/acme/repo.git' },
    });
    await client.callTool({
      name: 'rename_project',
      arguments: { projectId: 'p1', name: 'Renamed', gitRepoUrl: 'https://github.com/acme/other.git' },
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Repo Project',
      gitRepoUrl: 'https://github.com/acme/repo.git',
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      name: 'Renamed',
      gitRepoUrl: 'https://github.com/acme/other.git',
    });
    await close();
  });

  it('get_project returns backend business errors as MCP tool errors', async () => {
    stubBackendFetch(() => ({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Project not found' } },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({ name: 'get_project', arguments: { projectId: 'nope' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('NOT_FOUND (HTTP 404): Project not found');
    await close();
  });

  it('rename_project PATCHes and delete_project DELETEs the project', async () => {
    const calls = stubBackendFetch((url, init) => {
      if (init.method === 'PATCH') return { status: 200, body: { id: 'p1', name: 'Renamed' } };
      return { status: 200, body: { deleted: true } };
    });
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'rename_project',
      arguments: { projectId: 'p1', name: 'Renamed' },
    });
    await client.callTool({ name: 'delete_project', arguments: { projectId: 'p1' } });
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1');
    expect(calls[1].init.method).toBe('DELETE');
    expect(calls[1].url.pathname).toBe('/api/v1/projects/p1');
    await close();
  });
});
