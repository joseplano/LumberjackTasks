import { describe, it, expect, vi, afterEach } from 'vitest';

describe('config JWT secret guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.JWT_SECRET = originalJwtSecret;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('throws in production when JWT_SECRET is a known-weak value', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';
    await expect(import('../../src/config')).rejects.toThrow(
      /JWT_SECRET must be set to a strong value/,
    );
  });

  it('throws in production when JWT_SECRET is too short', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short-secret';
    await expect(import('../../src/config')).rejects.toThrow(
      /JWT_SECRET must be set to a strong value/,
    );
  });

  it('throws in production when JWT_SECRET is missing entirely', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    await expect(import('../../src/config')).rejects.toThrow(
      /JWT_SECRET must be set to a strong value/,
    );
  });

  it('uses a strong JWT_SECRET verbatim in production', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    const { config } = await import('../../src/config');
    expect(config.jwtSecret).toBe('a'.repeat(32));
  });

  it('never falls back to the published placeholder secret outside production', async () => {
    // Regression: a hard-coded default secret would let anyone reading the repo forge tokens.
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-secret-change-me';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = await import('../../src/config');
    expect(config.jwtSecret).not.toBe('dev-secret-change-me');
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(warn).toHaveBeenCalled();
  });

  it('generates a random secret when none is provided outside production', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const { config } = await import('../../src/config');
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('honors a strong custom JWT_SECRET outside production', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'b'.repeat(40);
    const { config } = await import('../../src/config');
    expect(config.jwtSecret).toBe('b'.repeat(40));
  });
});
