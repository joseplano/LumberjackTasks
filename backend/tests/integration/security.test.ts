import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb } from '../helpers';

const app = createApp();

describe('security headers (helmet)', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    // helmet defaults
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    // Express fingerprint must not leak
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('password policy', () => {
  beforeEach(resetDb);

  it('rejects registration with a password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('accepts a password of exactly 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada8@test.com', password: 'eightchr' });
    expect(res.status).toBe(201);
  });
});

describe('auth rate limiting', () => {
  const originalMax = process.env.AUTH_RATE_LIMIT_MAX;

  beforeEach(async () => {
    await resetDb();
    process.env.AUTH_RATE_LIMIT_MAX = '3';
  });

  afterEach(() => {
    process.env.AUTH_RATE_LIMIT_MAX = originalMax;
  });

  it('returns 429 once the login attempt cap is exceeded', async () => {
    // Fresh app so the limiter picks up the lowered cap.
    const limitedApp = createApp();
    const attempt = () =>
      request(limitedApp)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@test.com', password: 'whatever1' });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      statuses.push(res.status);
    }
    // The first 3 are processed (401 invalid creds), the rest are rate-limited.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
  });
});
