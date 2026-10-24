import express, { type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server';

// sync_git_history batches carry full commit lists; the 100 KB body-parser default answered 413.
const JSON_BODY_LIMIT = '5mb';

// Some host HTTP filters (seen with Avast 26.10 Web Shield) rewrite responses on paths ending in
// /mcp: they swap Content-Length for "Transfer-Encoding: chunked" but forward the body unframed,
// so strict clients (Claude Code, curl) reject it. Already-chunked responses pass through intact,
// so /mcp never sends Content-Length and Node frames every response body as chunked.
function forceChunkedFraming(res: Response) {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    name.toLowerCase() === 'content-length' ? res : setHeader(name, value)) as Response['setHeader'];

  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => Response;
  res.writeHead = ((...args: unknown[]) => {
    const headers = args[args.length - 1];
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-length') delete (headers as Record<string, unknown>)[key];
      }
    }
    return writeHead(...args);
  }) as Response['writeHead'];

  // A one-shot end(body) makes Node compute Content-Length itself (res.send does this); writing the
  // body first keeps the response chunked.
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    const [chunk, encoding] = args;
    if (!res.headersSent && (typeof chunk === 'string' || chunk instanceof Uint8Array) && chunk.length > 0) {
      res.write(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
      return end(...args.slice(typeof encoding === 'string' ? 2 : 1));
    }
    return end(...args);
  }) as Response['end'];
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/mcp', (_req, res, next) => {
    forceChunkedFraming(res);
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/mcp', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.all('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST (stateless server).' },
      id: null,
    });
  });

  return app;
}
