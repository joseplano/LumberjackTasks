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

  // T042 (FR-019b): GET /projects/:id/metrics must return identical figures
  // across a sweep -- it aggregates by projectId with no column predicate,
  // and completed tickets keep counting.
  it('T042: totalTokens, totalTimeMinutes and ticketCount are identical across a sweep', async () => {
    const cols = (await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth)).body as {
      id: string;
    }[];
    await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true })
      .expect(200);
    const t1 = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({ name: 'T1', complexity: 1, tokensConsumed: 100, llmName: 'claude', developmentTimeMinutes: 20 });
    const t2 = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({ name: 'T2', complexity: 1, tokensConsumed: 50, llmName: 'claude', developmentTimeMinutes: 10 });

    const before = await request(app).get(`/api/v1/projects/${projectId}/metrics`).set(auth);
    expect(before.status).toBe(200);

    await request(app)
      .post(`/api/v1/tickets/${t1.body.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id })
      .expect(200);
    const sweepMove = await request(app)
      .post(`/api/v1/tickets/${t2.body.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id })
      .expect(200);
    expect(sweepMove.body.sweep).not.toBeNull();

    const after = await request(app).get(`/api/v1/projects/${projectId}/metrics`).set(auth);
    expect(after.body).toEqual(before.body);
  });
});
