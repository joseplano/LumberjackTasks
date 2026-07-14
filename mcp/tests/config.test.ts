import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['PORT', 'BACKEND_URL', 'MCP_JWT', 'MCP_EMAIL', 'MCP_PASSWORD', 'MCP_HOST'] as const;
const saved: Record<string, string | undefined> = {};

async function loadConfig() {
  vi.resetModules();
  const { config } = await import('../src/config');
  return config;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

describe('config', () => {
  it('applies defaults when no environment variables are set', async () => {
    const config = await loadConfig();
    expect(config.port).toBe(5000);
    expect(config.backendUrl).toBe('http://localhost:4000');
    expect(config.jwt).toBeUndefined();
    expect(config.email).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it('binds to loopback by default (never exposes the unauthenticated MCP)', async () => {
    // Regression: listening on 0.0.0.0 would expose the credential-bearing MCP to the network.
    const config = await loadConfig();
    expect(config.host).toBe('127.0.0.1');
  });

  it('allows overriding the bind host via MCP_HOST', async () => {
    process.env.MCP_HOST = '0.0.0.0';
    const config = await loadConfig();
    expect(config.host).toBe('0.0.0.0');
  });

  it('reads PORT, BACKEND_URL and credentials from the environment', async () => {
    process.env.PORT = '8123';
    process.env.BACKEND_URL = 'http://backend.internal:9000';
    process.env.MCP_JWT = 'jwt-token';
    process.env.MCP_EMAIL = 'bot@example.com';
    process.env.MCP_PASSWORD = 'secret';
    const config = await loadConfig();
    expect(config.port).toBe(8123);
    expect(config.backendUrl).toBe('http://backend.internal:9000');
    expect(config.jwt).toBe('jwt-token');
    expect(config.email).toBe('bot@example.com');
    expect(config.password).toBe('secret');
  });

  it('normalizes empty credential strings to undefined', async () => {
    process.env.MCP_JWT = '';
    process.env.MCP_EMAIL = '';
    process.env.MCP_PASSWORD = '';
    const config = await loadConfig();
    expect(config.jwt).toBeUndefined();
    expect(config.email).toBeUndefined();
    expect(config.password).toBeUndefined();
  });
});
