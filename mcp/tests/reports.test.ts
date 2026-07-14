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

describe('report tools', () => {
  it('completes the 18-tool inventory', async () => {
    const { client, close } = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(18);
    for (const name of ['get_reports', 'get_token_usage', 'get_time_totals']) {
      expect(names).toContain(name);
    }
    await close();
  });

  it('get_reports maps the report enum to endpoints', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: { report: true } }));
    const { client, close } = await connectClient();
    await client.callTool({ name: 'get_reports', arguments: { report: 'most-active' } });
    await client.callTool({ name: 'get_reports', arguments: { report: 'consumption' } });
    await client.callTool({ name: 'get_reports', arguments: { report: 'transitions' } });
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/api/v1/reports/most-active',
      '/api/v1/reports/consumption',
      '/api/v1/reports/transitions',
    ]);
    await close();
  });

  it('rejects an unknown report at the schema level', async () => {
    const calls = stubBackendFetch(() => ({ status: 200, body: {} }));
    const { client, close } = await connectClient();
    const result = await client.callTool({ name: 'get_reports', arguments: { report: 'bogus' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /MCP error -32602: Input validation error: Invalid arguments for tool get_reports/,
    );
    expect(calls).toHaveLength(0);
    await close();
  });

  it('get_token_usage and get_time_totals project the metrics response', async () => {
    stubBackendFetch(() => ({
      status: 200,
      body: { totalTokens: 1200, totalTimeMinutes: 340, ticketCount: 7 },
    }));
    const { client, close } = await connectClient();

    const tokens = await client.callTool({
      name: 'get_token_usage',
      arguments: { projectId: 'p1' },
    });
    expect(JSON.parse(textOf(tokens))).toEqual({ totalTokens: 1200, ticketCount: 7 });

    const time = await client.callTool({
      name: 'get_time_totals',
      arguments: { projectId: 'p1' },
    });
    expect(JSON.parse(textOf(time))).toEqual({ totalTimeMinutes: 340, ticketCount: 7 });
    await close();
  });
});
