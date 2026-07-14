import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

describe('project metrics', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
  });

  it('returns zeros for an empty project', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/metrics`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalTokens: 0, totalTimeMinutes: 0, ticketCount: 0 });
  });

  it('sums tokens and time across all tickets and subtickets', async () => {
    const parent = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({
        name: 'P',
        complexity: 5,
        tokensConsumed: 100,
        llmName: 'claude',
        developmentTimeMinutes: 30,
      });
    await request(app).post(`/api/v1/projects/${projectId}/tickets`).set(auth).send({
      name: 'S',
      complexity: 1,
      parentTicketId: parent.body.id,
      tokensConsumed: 50,
      llmName: 'gpt',
      developmentTimeMinutes: 15,
    });
    const res = await request(app).get(`/api/v1/projects/${projectId}/metrics`).set(auth);
    expect(res.body).toEqual({ totalTokens: 150, totalTimeMinutes: 45, ticketCount: 2 });
  });
});
