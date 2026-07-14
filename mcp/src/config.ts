import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 5000),
  // Bind to loopback by default: the MCP endpoint has no authentication of its own and acts on
  // the backend with the bot's credentials, so it must never be exposed to an untrusted network.
  // Override with MCP_HOST=0.0.0.0 only behind an authenticated proxy (e.g. inside Docker).
  host: process.env.MCP_HOST ?? '127.0.0.1',
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:4000',
  jwt: process.env.MCP_JWT || undefined,
  email: process.env.MCP_EMAIL || undefined,
  password: process.env.MCP_PASSWORD || undefined,
};
