import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { resetDb } from '../helpers';

const app = createApp();

describe('auth', () => {
  beforeEach(resetDb);

  it('registers a new user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Ada', email: 'ada@test.com' });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejects registration with missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'x@test.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects registration with a non-string password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects duplicate email', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 'secret123' });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada2', email: 'ada@test.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials and returns a JWT', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 'secret123' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@test.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.email).toBe('ada@test.com');
  });

  it('rejects login with wrong password', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@test.com', password: 'secret123' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@test.com', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects login with a nonexistent email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login with missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'ada@test.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects login with non-string fields', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 123, password: 'secret123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('protects routes: 401 without token', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
  });
});

describe('requireAuth middleware', () => {
  beforeEach(resetDb);

  const route = '/api/v1/projects';

  async function expect401(token?: string, rawHeader?: string) {
    const req = request(app).get(route);
    if (rawHeader !== undefined) req.set('Authorization', rawHeader);
    else if (token !== undefined) req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  }

  it('rejects a malformed Authorization header', async () => {
    await expect401(undefined, 'Basic xyz');
  });

  it('rejects a token with an invalid signature', async () => {
    const valid = jwt.sign({ sub: 'u1', email: 'a@test.com' }, 'test-secret');
    await expect401(`${valid.slice(0, -3)}xyz`);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ sub: 'u1', email: 'a@test.com' }, 'test-secret', {
      expiresIn: '-1s',
    });
    await expect401(expired);
  });

  it('rejects a token signed with a different secret', async () => {
    const wrong = jwt.sign({ sub: 'u1', email: 'a@test.com' }, 'not-the-secret');
    await expect401(wrong);
  });

  it('rejects a token whose payload has no sub', async () => {
    const noSub = jwt.sign({ email: 'a@test.com' }, 'test-secret');
    await expect401(noSub);
  });

  it('rejects a token with a non-string sub', async () => {
    const numericSub = jwt.sign({ sub: 123, email: 'a@test.com' }, 'test-secret');
    await expect401(numericSub);
  });

  it('rejects a token signed with alg none', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1' })}.`;
    await expect401(noneToken);
  });
});
