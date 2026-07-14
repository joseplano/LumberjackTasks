import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../src/config';
import { resetTokenCache } from '../src/apiClient';
import { createApp } from '../src/app';

let stubBackend: Server;
let mcpServer: Server;
let mcpUrl: URL;

beforeAll(() => {
  resetTokenCache();
  config.jwt = 'e2e-token';

  const backend = express();
  backend.use(express.json());
  backend.get('/api/v1/projects', (req, res) => {
    if (req.headers.authorization !== 'Bearer e2e-token') {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      return;
    }
    res.json([{ id: 'p1', code: 'DEMO-000001', name: 'Demo' }]);
  });
  stubBackend = backend.listen(0);
  config.backendUrl = `http://127.0.0.1:${(stubBackend.address() as AddressInfo).port}`;

  mcpServer = createApp().listen(0);
  mcpUrl = new URL(`http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  stubBackend.close();
  mcpServer.close();
});

describe('streamable HTTP endpoint', () => {
  it('serves initialize, tools/list and tools/call end to end', async () => {
    const client = new Client({ name: 'e2e-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(18);

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([{ id: 'p1', code: 'DEMO-000001', name: 'Demo' }]);

    await client.close();
  });

  it('answers 405 to GET /mcp (stateless mode, no SSE stream)', async () => {
    const res = await fetch(mcpUrl);
    expect(res.status).toBe(405);
  });

  it('answers 405 to PUT and DELETE /mcp', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const res = await fetch(mcpUrl, { method });
      expect(res.status).toBe(405);
      const body = (await res.json()) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32000);
      expect(body.error.message).toMatch(/Method not allowed/);
    }
  });
});
