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

describe('manage_columns', () => {
  it('maps each action to the right endpoint', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { ok: true } }));
    const { client, close } = await connectClient();

    await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'list' },
    });
    await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'create', name: 'Blocked' },
    });
    await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'rename', columnId: 'c1', name: 'Doing' },
    });
    await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'reorder', orderedIds: ['c2', 'c1'] },
    });
    await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'delete', columnId: 'c1', moveTo: 'c2' },
    });

    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.pathname}${c.url.search}`)).toEqual([
      'GET /api/v1/projects/p1/columns',
      'POST /api/v1/projects/p1/columns',
      'PATCH /api/v1/projects/p1/columns/c1',
      'PUT /api/v1/projects/p1/columns/order',
      'DELETE /api/v1/projects/p1/columns/c1?moveTo=c2',
    ]);
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ orderedIds: ['c2', 'c1'] });
    await close();
  });

  it('rejects rename without columnId before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'rename', name: 'Doing' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('columnId is required for action "rename"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('rejects create without name before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'create' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('name is required for action "create"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('rejects rename without name before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'rename', columnId: 'c1' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('name is required for action "rename"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('rejects reorder without orderedIds before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'reorder' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('orderedIds is required for action "reorder"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('rejects delete without columnId before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'delete' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('columnId is required for action "delete"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('omits the moveTo query param when deleting without moveTo', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { deleted: true } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'delete', columnId: 'c1' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/columns/c1');
    expect(calls[0].url.search).toBe('');
    await close();
  });

  it('rejects an invalid action at the schema level without hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_columns',
      arguments: { projectId: 'p1', action: 'explode' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool manage_columns/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });
});

describe('manage_labels', () => {
  it('maps each action to the right endpoint', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { ok: true } }));
    const { client, close } = await connectClient();

    await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'list' },
    });
    await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'create', name: 'bug', color: '#ff0000' },
    });
    await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'update', labelId: 'l1', color: '#00ff00' },
    });
    await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'delete', labelId: 'l1', force: true },
    });

    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.pathname}${c.url.search}`)).toEqual([
      'GET /api/v1/projects/p1/labels',
      'POST /api/v1/projects/p1/labels',
      'PATCH /api/v1/projects/p1/labels/l1',
      'DELETE /api/v1/projects/p1/labels/l1?force=true',
    ]);
    await close();
  });

  it('rejects update without labelId before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'update', name: 'bug' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('labelId is required for action "update"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('rejects delete without labelId before hitting the backend', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'delete' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('labelId is required for action "delete"');
    expect(calls).toHaveLength(0);
    await close();
  });

  it('omits the force query param when deleting without force', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { deleted: true } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'delete', labelId: 'l1' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/labels/l1');
    expect(calls[0].url.search).toBe('');
    await close();
  });

  it('passes the label-in-use 409 through', async () => {
    stubBackendFetch(() => ({
      status: 409,
      body: { error: { code: 'LABEL_IN_USE', message: 'Label is in use; pass force=true' } },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_labels',
      arguments: { projectId: 'p1', action: 'delete', labelId: 'l1' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('LABEL_IN_USE (HTTP 409): Label is in use; pass force=true');
    await close();
  });
});

describe('manage_phases', () => {
  it('maps each action to its endpoint', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { ok: true } }));
    const { client, close } = await connectClient();

    await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'list' },
    });
    await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'create', name: 'Alpha', description: 'First phase' },
    });
    await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'update', phaseId: 'ph1', name: 'Beta', description: 'Renamed' },
    });
    await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'reorder', orderedIds: ['ph2', 'ph1'] },
    });
    await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'delete', phaseId: 'ph1', force: true },
    });

    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.pathname}${c.url.search}`)).toEqual([
      'GET /api/v1/projects/p1/phases',
      'POST /api/v1/projects/p1/phases',
      'PATCH /api/v1/projects/p1/phases/ph1',
      'PUT /api/v1/projects/p1/phases/order',
      'DELETE /api/v1/projects/p1/phases/ph1?force=true',
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ name: 'Alpha', description: 'First phase' });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ name: 'Beta', description: 'Renamed' });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ orderedIds: ['ph2', 'ph1'] });
    await close();
  });

  it('fails without calling the backend when a required id is missing', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();

    const updateResult = await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'update', name: 'Beta' },
    });
    expect(updateResult.isError).toBe(true);
    expect(textOf(updateResult)).toBe('phaseId is required for action "update"');

    const deleteResult = await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'delete' },
    });
    expect(deleteResult.isError).toBe(true);
    expect(textOf(deleteResult)).toBe('phaseId is required for action "delete"');

    const reorderResult = await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'reorder' },
    });
    expect(reorderResult.isError).toBe(true);
    expect(textOf(reorderResult)).toBe('orderedIds is required for action "reorder"');

    const createResult = await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'create' },
    });
    expect(createResult.isError).toBe(true);
    expect(textOf(createResult)).toBe('name is required for action "create"');

    expect(calls).toHaveLength(0);
    await close();
  });

  it('omits the force query when force is not set', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { deleted: true } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'manage_phases',
      arguments: { projectId: 'p1', action: 'delete', phaseId: 'ph1' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/phases/ph1');
    expect(calls[0].url.search).toBe('');
    await close();
  });
});
