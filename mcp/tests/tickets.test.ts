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

  // T049a (contracts/mcp-tools.md "Asserting the absence of sweep logic"):
  // this layer must forward the backend response verbatim -- no branching on
  // `sweep`, no treating a null columnId as an error, nothing added,
  // removed or rewritten. Any of that would mean sweep logic leaked into
  // mcp/, violating Constitution Principle I.
  it('T049a: move_ticket response fidelity -- a non-null sweep and null columnId pass through unchanged', async () => {
    const backendResponse = {
      id: 't1',
      columnId: null,
      sweep: {
        completionColumnId: 'c9',
        completionColumnName: 'Done',
        ticketCount: 2,
        ticketIds: ['t1', 't2'],
      },
    };
    const calls = stubBackendFetch(() => ({ status: 200, body: backendResponse }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'move_ticket',
      arguments: { ticketId: 't1', targetColumnId: 'c9' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(JSON.stringify(backendResponse, null, 2));
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t1/move');
    await close();
  });

  it('T049a: move_subticket response fidelity -- a non-null sweep and null columnId pass through unchanged', async () => {
    const backendResponse = {
      id: 't2',
      columnId: null,
      sweep: {
        completionColumnId: 'c9',
        completionColumnName: 'Done',
        ticketCount: 1,
        ticketIds: ['t2'],
      },
    };
    const calls = stubBackendFetch(() => ({ status: 200, body: backendResponse }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'move_subticket',
      arguments: { subticketId: 't2', targetColumnId: 'c9' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(JSON.stringify(backendResponse, null, 2));
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t2/move');
    await close();
  });

  it('T049a: list_tickets forwards placement verbatim, and sends no placement at all when omitted', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: [] }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', placement: 'board' },
    });
    await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', placement: 'completed' },
    });
    await client.callTool({ name: 'list_tickets', arguments: { projectId: 'p1' } });
    expect(calls[0].url.searchParams.get('placement')).toBe('board');
    expect(calls[1].url.searchParams.get('placement')).toBe('completed');
    expect(calls[2].url.searchParams.has('placement')).toBe(false);
    await close();
  });

  // T032 (contracts/mcp-tools.md "Behavioural expectations"): the branch is a
  // pass-through. This layer forwards what the agent reported and relays what
  // the backend resolved -- it never generates, validates or inherits a branch
  // name. Doing any of that here would make mcp/ a second source of truth,
  // violating Constitution Principle I.
  it('T032: create_ticket forwards branch in the POST body', async () => {
    const calls = stubBackendFetch(() => ({ status: 201, body: { id: 't1', number: 1 } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'create_ticket',
      arguments: {
        projectId: 'p1',
        name: 'Do it',
        complexity: 3,
        branch: '002-ticket-git-branch-view',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].url.pathname).toBe('/api/v1/projects/p1/tickets');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Do it',
      complexity: 3,
      branch: '002-ticket-git-branch-view',
    });
    await close();
  });

  it('T032: update_ticket forwards branch in the PATCH body', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 't1', branch: 'feature/xyz' },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].url.pathname).toBe('/api/v1/tickets/t1');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ branch: 'feature/xyz' });
    await close();
  });

  it('T032: create_subticket and update_subticket forward branch too', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't2' } }));
    const { client, close } = await connectClient();
    const created = await client.callTool({
      name: 'create_subticket',
      arguments: {
        projectId: 'p1',
        parentTicketId: 't1',
        name: 'Sub',
        complexity: 1,
        branch: 'feature/xyz',
      },
    });
    const updated = await client.callTool({
      name: 'update_subticket',
      arguments: { subticketId: 't2', branch: 'feature/other' },
    });
    expect(created.isError).toBeFalsy();
    expect(updated.isError).toBeFalsy();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      parentTicketId: 't1',
      name: 'Sub',
      complexity: 1,
      branch: 'feature/xyz',
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ branch: 'feature/other' });
    await close();
  });

  it('T032: branch accepts null to clear, and omitting it sends no branch key at all', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't1' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 't1', branch: null },
    });
    await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 't1', name: 'Renamed' },
    });
    await client.callTool({
      name: 'update_subticket',
      arguments: { subticketId: 't2', name: 'Renamed sub' },
    });
    await client.callTool({
      name: 'create_ticket',
      arguments: { projectId: 'p1', name: 'No branch', complexity: 3 },
    });
    // null is an explicit "clear it"...
    const cleared = JSON.parse(String(calls[0].init.body));
    expect(cleared).toEqual({ branch: null });
    expect(Object.keys(cleared)).toContain('branch');
    // ...while absent must stay absent: the backend reads absent as "leave
    // alone" and null as "clear", so absent must never become null.
    for (const call of calls.slice(1)) {
      expect(Object.keys(JSON.parse(String(call.init.body)))).not.toContain('branch');
    }
    await close();
  });

  it('T032: a ticket read relays gitBranch, effectiveBranch and branchSource unmodified', async () => {
    const backendResponse = [
      {
        id: 't1',
        number: 1,
        gitBranch: '002-ticket-git-branch-view',
        effectiveBranch: '002-ticket-git-branch-view',
        branchSource: 'own',
      },
      {
        id: 't2',
        number: 2,
        gitBranch: null,
        effectiveBranch: '002-ticket-git-branch-view',
        branchSource: 'inherited',
      },
      { id: 't3', number: 3, gitBranch: null, effectiveBranch: null, branchSource: null },
    ];
    stubBackendFetch(() => ({ status: 200, body: backendResponse }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(JSON.stringify(backendResponse, null, 2));
    expect(JSON.parse(textOf(result))).toEqual(backendResponse);
    await close();
  });

  it('T032: a backend 400 VALIDATION for a malformed branch surfaces as a tool error', async () => {
    const calls = stubBackendFetch(() => ({
      status: 400,
      body: {
        error: { code: 'VALIDATION', message: 'branch is not a valid git ref name' },
      },
    }));
    const { client, close } = await connectClient();
    const result = await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 't1', branch: 'bad branch..name' },
    });
    // the malformed value reaches the backend -- mcp does not validate it here
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ branch: 'bad branch..name' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('VALIDATION (HTTP 400): branch is not a valid git ref name');
    await close();
  });

  it('T032: move_ticket and move_subticket reject branch -- reporting a branch is an update, not a move', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { id: 't1', columnId: 'c2' } }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'move_ticket',
      arguments: { ticketId: 't1', targetColumnId: 'c2', branch: 'feature/xyz' },
    });
    await client.callTool({
      name: 'move_subticket',
      arguments: { subticketId: 't2', targetColumnId: 'c2', branch: 'feature/xyz' },
    });
    expect(Object.keys(JSON.parse(String(calls[0].init.body)))).not.toContain('branch');
    expect(Object.keys(JSON.parse(String(calls[1].init.body)))).not.toContain('branch');
    await close();
  });

  it('T049a: list_tickets composes placement with parent, and rejects an invalid placement at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: [] }));
    const { client, close } = await connectClient();
    await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', parent: 'none', placement: 'all' },
    });
    expect(calls[0].url.searchParams.get('parent')).toBe('none');
    expect(calls[0].url.searchParams.get('placement')).toBe('all');

    const result = await client.callTool({
      name: 'list_tickets',
      arguments: { projectId: 'p1', placement: 'bogus' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool list_tickets/,
    );
    expect(calls).toHaveLength(1); // only the prior valid call went to the backend
    await close();
  });
});
