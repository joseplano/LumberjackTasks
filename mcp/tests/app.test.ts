import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

vi.mock('../src/server', () => ({
  buildServer: () => ({
    connect: async () => {
      throw new Error('boom');
    },
    close: () => {},
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /mcp when the MCP server fails to connect', () => {
  it('responds 500 with a jsonrpc internal error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = createApp().listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
      expect(errorSpy).toHaveBeenCalledWith('MCP request failed:', expect.any(Error));
    } finally {
      server.close();
    }
  });
});
