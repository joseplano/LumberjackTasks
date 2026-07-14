import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config.corsOrigin', () => {
  it('splits comma-separated origins from CORS_ORIGIN', async () => {
    vi.resetModules();
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:3000, https://kanban.example.com');
    const { config } = await import('../../src/config');
    expect(config.corsOrigin).toEqual(['http://localhost:3000', 'https://kanban.example.com']);
  });

  it('defaults to the frontend localhost origin when CORS_ORIGIN is unset', async () => {
    // Regression: the previous default reflected ANY origin (origin: true).
    vi.resetModules();
    vi.stubEnv('CORS_ORIGIN', '');
    const { config } = await import('../../src/config');
    expect(config.corsOrigin).toEqual(['http://localhost:3000']);
  });
});
