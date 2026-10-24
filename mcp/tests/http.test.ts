import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { connect, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../src/config';
import { resetTokenCache } from '../src/apiClient';
import { createApp } from '../src/app';

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

// Hand-built HTTP/1.1 over a bare socket, read to EOF: the response bytes are seen exactly as sent.
function rawRequest(url: URL, method: string, payload: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    const chunks: Buffer[] = [];
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('error', reject);
    socket.on('end', () => {
      const raw = Buffer.concat(chunks);
      const split = raw.indexOf('\r\n\r\n');
      const [statusLine, ...lines] = raw.subarray(0, split).toString('latin1').split('\r\n');
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const i = line.indexOf(':');
        headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status: Number(statusLine.split(' ')[1]), headers, body: raw.subarray(split + 4) });
    });
    const body = Buffer.from(payload);
    socket.write(
      `${method} ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    );
    // No half-close: Node's server aborts an in-flight request on client FIN. "Connection: close" ends the stream.
    socket.write(body);
  });
}

function rawPost(url: URL, payload: string) {
  return rawRequest(url, 'POST', payload);
}

// Strict chunked decoder: every chunk must start with a hex size line, and the stream must end with a 0 chunk.
function decodeChunked(body: Buffer): string {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const eol = body.indexOf('\r\n', pos);
    if (eol < 0) throw new Error('chunked body truncated before a size line');
    const sizeLine = body.subarray(pos, eol).toString('latin1');
    if (!/^[0-9a-fA-F]+$/.test(sizeLine)) throw new Error(`invalid chunk size line: ${JSON.stringify(sizeLine)}`);
    const size = parseInt(sizeLine, 16);
    pos = eol + 2;
    if (size === 0) return Buffer.concat(out).toString('utf8');
    out.push(body.subarray(pos, pos + size));
    if (body.subarray(pos + size, pos + size + 2).toString('latin1') !== '\r\n') throw new Error('chunk not CRLF-terminated');
    pos += size + 2;
  }
}

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
    expect(tools).toHaveLength(19);

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([{ id: 'p1', code: 'DEMO-000001', name: 'Demo' }]);

    await client.close();
  });

  // Strict framing contract, checked on the raw socket so no lenient HTTP client can hide it.
  // An HTTP filter on the developer host (Avast 26.10 Web Shield) rewrites responses for paths
  // ending in /mcp: it replaces Content-Length with "Transfer-Encoding: chunked" but forwards the
  // body unframed, which Claude Code and curl reject. Responses that are already chunked pass
  // through intact, so /mcp must always answer chunked, never with Content-Length.
  it('frames every /mcp response as valid chunked transfer encoding, never Content-Length', async () => {
    const calls = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'strict', version: '0' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
    ];
    for (let round = 0; round < 20; round++) {
      for (const call of calls) {
        const { status, headers, body } = await rawPost(mcpUrl, JSON.stringify(call));
        expect(status).toBe(200);
        expect(headers['transfer-encoding']).toBe('chunked');
        expect(headers['content-length']).toBeUndefined();
        const message = JSON.parse(decodeChunked(body)) as { id: number; result: unknown };
        expect(message.id).toBe(call.id);
        expect(message.result).toBeDefined();
      }
    }
    const init = await rawPost(mcpUrl, JSON.stringify(calls[0]));
    expect(JSON.parse(decodeChunked(init.body)).result.serverInfo.name).toBe('lumberjack-tasks-mcp');
  });

  it('frames the 405 answer chunked too', async () => {
    const { status, headers } = await rawRequest(mcpUrl, 'PUT', '');
    expect(status).toBe(405);
    expect(headers['transfer-encoding']).toBe('chunked');
    expect(headers['content-length']).toBeUndefined();
  });

  it('accepts request bodies above the 100 KB body-parser default (large sync_git_history batches)', async () => {
    const call = {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: { padding: 'x'.repeat(1024 * 1024) } },
    };
    const { status } = await rawPost(mcpUrl, JSON.stringify(call));
    expect(status).not.toBe(413);
    expect(status).toBe(200);
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
