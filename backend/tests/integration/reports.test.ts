import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader } from '../helpers';

const app = createApp();
let auth: { Authorization: string };

async function makeProject(name: string) {
  const res = await request(app).post('/api/v1/projects').set(auth).send({ name });
  return res.body as { id: string; code: string };
}

async function makeTicket(projectId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/tickets`)
    .set(auth)
    .send(body);
  return res.body as { id: string };
}

describe('reports', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
  });

  it('ranks most active projects by time and by tokens', async () => {
    const a = await makeProject('Alpha');
    const b = await makeProject('Beta');
    await makeTicket(a.id, {
      name: 'T1',
      complexity: 1,
      tokensConsumed: 1000,
      llmName: 'claude',
      developmentTimeMinutes: 10,
    });
    await makeTicket(b.id, {
      name: 'T2',
      complexity: 1,
      tokensConsumed: 100,
      llmName: 'claude',
      developmentTimeMinutes: 60,
    });

    const res = await request(app).get('/api/v1/reports/most-active').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.byTokens[0].code).toBe(a.code);
    expect(res.body.byTime[0].code).toBe(b.code);
  });

  it('reports max/min token and time consumers per project, excluding zeros from min', async () => {
    const p = await makeProject('Gamma');
    await makeTicket(p.id, { name: 'Zero', complexity: 1 });
    await makeTicket(p.id, {
      name: 'Small',
      complexity: 1,
      tokensConsumed: 10,
      llmName: 'claude',
      developmentTimeMinutes: 5,
    });
    await makeTicket(p.id, {
      name: 'Big',
      complexity: 1,
      tokensConsumed: 900,
      llmName: 'claude',
      developmentTimeMinutes: 90,
    });

    const res = await request(app).get('/api/v1/reports/consumption').set(auth);
    const entry = res.body.find((r: { code: string }) => r.code === p.code);
    expect(entry.maxTokens.name).toBe('Big');
    expect(entry.minTokens.name).toBe('Small'); // zero-token ticket excluded
    expect(entry.maxTime.name).toBe('Big');
    expect(entry.minTime.name).toBe('Small');
  });

  it('reports transition stats from status history', async () => {
    const p = await makeProject('Delta');
    const cols = (await request(app).get(`/api/v1/projects/${p.id}/columns`).set(auth)).body;
    const t = await makeTicket(p.id, { name: 'Mover', complexity: 1 });
    await request(app)
      .post(`/api/v1/tickets/${t.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[1].id, tokensDelta: 40, llmName: 'claude' });
    await request(app)
      .post(`/api/v1/tickets/${t.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[2].id });

    const res = await request(app).get('/api/v1/reports/transitions').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.mostChanges[0]).toMatchObject({ name: 'Mover', changes: 2 });
    expect(res.body.mostTokensInProcess[0]).toMatchObject({ name: 'Mover', tokens: 40 });
    expect(res.body.longestTransition[0].name).toBe('Mover');
  });

  it('returns empty reports when there are no projects', async () => {
    const mostActive = await request(app).get('/api/v1/reports/most-active').set(auth);
    expect(mostActive.status).toBe(200);
    expect(mostActive.body).toEqual({ byTime: [], byTokens: [] });
    const consumption = await request(app).get('/api/v1/reports/consumption').set(auth);
    expect(consumption.status).toBe(200);
    expect(consumption.body).toEqual([]);
  });

  it('returns null consumption entries for a project with no tickets', async () => {
    const p = await makeProject('Empty');
    const res = await request(app).get('/api/v1/reports/consumption').set(auth);
    const entry = res.body.find((r: { code: string }) => r.code === p.code);
    expect(entry).toMatchObject({
      maxTokens: null,
      minTokens: null,
      maxTime: null,
      minTime: null,
    });
  });

  it('returns a zero-value ticket as min when every ticket has zero tokens', async () => {
    const p = await makeProject('AllZero');
    await makeTicket(p.id, { name: 'Z1', complexity: 1 });
    await makeTicket(p.id, { name: 'Z2', complexity: 1 });
    const res = await request(app).get('/api/v1/reports/consumption').set(auth);
    const entry = res.body.find((r: { code: string }) => r.code === p.code);
    expect(entry.minTokens).not.toBeNull();
    expect(entry.minTokens.value).toBe(0);
    expect(entry.minTime.value).toBe(0);
  });

  it('returns empty transition arrays when no ticket has history', async () => {
    const p = await makeProject('Static');
    await makeTicket(p.id, { name: 'Unmoved', complexity: 1 });
    const res = await request(app).get('/api/v1/reports/transitions').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mostChanges: [], mostTokensInProcess: [], longestTransition: [] });
  });
});
