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

describe('ticket tools', () => {
  it('registers the seven ticket tools', async () => {
    const { client, close } = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      'list_tickets',
      'create_ticket',
      'update_ticket',
      'move_ticket',
      'create_subticket',
      'update_subticket',
      'move_subticket',
    ]) {
      expect(names).toContain(name);
    }
    await close();
  });

  it('list_tickets forwards the parent filter', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: [] }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', parent: 'none' },
    });
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/tickets');
    expect(calls[0].url.searchParams.get('parent')).toBe('none');
    await close();
  });

  it('create_ticket POSTs to the project tickets endpoint', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1', number: 1 } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'create_ticket',
      arguments: { projectId: 'p1', name: 'Do it', complexity: 3, tokensConsumed: 100, llmName: 'claude' },
    });
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/tickets');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Do it',
      complexity: 3,
      tokensConsumed: 100,
      llmName: 'claude',
    });
    await close();
  });

  it('create_subticket includes parentTicketId in the body', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't2' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'create_subticket',
      arguments: { projectId: 'p1', parentTicketId: 't1', name: 'Sub', complexity: 1 },
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      parentTicketId: 't1',
      name: 'Sub',
      complexity: 1,
    });
    await close();
  });

  it('update_ticket and update_subticket PATCH /tickets/:id', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 't1', name: 'Renamed' },
    });
    await client.callTool({
      name: 'update_subticket',
      arguments: { subticketId: 't2', tokensConsumed: 500, llmName: 'claude' },
    });
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t1');
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[1].url.pathname).toBe('/api/v1/tickets/t2');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      tokensConsumed: 500,
      llmName: 'claude',
    });
    await close();
  });

  it('move_ticket POSTs the move body and passes 409 business errors through', async () => {
    stubBackendFetch(() => ({
      status: 409,
      body: {
        error: {
          code: 'PARENT_MOVE',
          message: 'All subtickets must be in the target column or later',
        },
      },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'move_ticket',
      arguments: { ticketId: 't1', targetColumnId: 'c2', tokensDelta: 50, llmName: 'claude' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'PARENT_MOVE (HTTP 409): All subtickets must be in the target column or later',
    );
    await close();
  });

  it('list_tickets passes a parent ticket id through and omits parent when absent', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: [] }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', parent: 't1' },
    });
    await client.callTool({ name: 'list_tickets', arguments: { projectId: 'p1' } });
    expect(calls[0].url.searchParams.get('parent')).toBe('t1');
    expect(calls[1].url.pathname).toBe('/api/v1/projects/p1/tickets');
    expect(calls[1].url.searchParams.has('parent')).toBe(false);
    await close();
  });

  it('rejects a non-Fibonacci complexity at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'create_ticket',
      arguments: { projectId: 'p1', name: 'Bad', complexity: 4 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool create_ticket/,
    );
    expect(textOf(result)).toContain(
      'complexity must be one of the Fibonacci values 1, 2, 3, 5, 8, 13 or 21',
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('accepts a Fibonacci complexity of 5', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'create_ticket',
      arguments: { projectId: 'p1', name: 'Good', complexity: 5 },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Good', complexity: 5 });
    await close();
  });

  it('rejects create_ticket without projectId at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'create_ticket',
      arguments: { name: 'No project', complexity: 3 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool create_ticket/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('move_ticket POSTs the full transition body on success', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't1', columnId: 'c2' } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'move_ticket',
      arguments: {
        ticketId: 't1',
        targetColumnId: 'c2',
        tokensDelta: 50,
        timeDelta: 15,
        llmName: 'claude',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t1/move');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      targetColumnId: 'c2',
      tokensDelta: 50,
      timeDelta: 15,
      llmName: 'claude',
    });
    await close();
  });

  it('turns a generic (non-Backend) error into a fail result with the error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:4000');
      }),
    );
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('connect ECONNREFUSED 127.0.0.1:4000');
    await close();
  });

  it('forwards phaseId in create_ticket', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1', number: 1 } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'create_ticket',
      arguments: { projectId: 'p1', name: 'Do it', complexity: 3, phaseId: 'ph1' },
    });
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/tickets');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Do it',
      complexity: 3,
      phaseId: 'ph1',
    });
    await close();
  });

  it('move_subticket POSTs /tickets/:id/move', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't2', columnId: 'c2' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'move_subticket',
      arguments: { subticketId: 't2', targetColumnId: 'c2', timeDelta: 30 },
    });
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t2/move');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ targetColumnId: 'c2', timeDelta: 30 });
    await close();
  });
});
