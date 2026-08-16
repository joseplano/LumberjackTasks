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

  // T041 (FR-019b, SC-011): a sweep must not change any project-wide report
  // figure. most-active and consumption aggregate purely off ticket
  // tokensConsumed/developmentTimeMinutes, which the sweep never touches
  // (it only nullifies columnId) -- so these must read identically
  // immediately before and immediately after a sweep fires.
  it('T041: most-active and consumption report figures are unchanged by a sweep', async () => {
    const p = await makeProject('Sweeper');
    const cols = (await request(app).get(`/api/v1/projects/${p.id}/columns`).set(auth)).body as {
      id: string;
    }[];
    await request(app)
      .patch(`/api/v1/projects/${p.id}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true })
      .expect(200);
    const t1 = await makeTicket(p.id, {
      name: 'T1',
      complexity: 1,
      tokensConsumed: 100,
      llmName: 'claude',
      developmentTimeMinutes: 20,
    });
    const t2 = await makeTicket(p.id, {
      name: 'T2',
      complexity: 1,
      tokensConsumed: 50,
      llmName: 'claude',
      developmentTimeMinutes: 10,
    });

    const beforeActive = await request(app).get('/api/v1/reports/most-active').set(auth);
    const beforeConsumption = await request(app).get('/api/v1/reports/consumption').set(auth);
    expect(beforeActive.status).toBe(200);
    expect(beforeConsumption.status).toBe(200);

    // No tokensDelta/timeDelta on either move -- the sweep is the only thing
    // that changes about these tickets.
    await request(app)
      .post(`/api/v1/tickets/${t1.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id })
      .expect(200);
    const sweepMove = await request(app)
      .post(`/api/v1/tickets/${t2.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id })
      .expect(200);
    expect(sweepMove.body.sweep).not.toBeNull();

    const afterActive = await request(app).get('/api/v1/reports/most-active').set(auth);
    const afterConsumption = await request(app).get('/api/v1/reports/consumption').set(auth);

    expect(afterActive.body).toEqual(beforeActive.body);
    expect(afterConsumption.body).toEqual(beforeConsumption.body);
  });

  // T052 (FR-020, I-2): pins the controller's deliberate ruling that
  // transitionsReport() DOES legitimately change across a sweep -- FR-020
  // unconditionally adds one TicketStatusHistory row per swept ticket, and
  // this report counts history rows with no filtering. This must NOT later
  // be "fixed" by filtering toColumnName === 'Completed' out of the report:
  // that string is display text and can collide with a user-chosen column
  // name of the same text (see the comment in backend/src/services/backlog.ts).
  it('T052: a sweep increases mostChanges by exactly 1 per already-parked swept ticket, and leaves mostTokensInProcess exactly unchanged', async () => {
    const p = await makeProject('Pinned');
    const cols = (await request(app).get(`/api/v1/projects/${p.id}/columns`).set(auth)).body as {
      id: string;
    }[];
    await request(app)
      .patch(`/api/v1/projects/${p.id}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true })
      .expect(200);

    const t1 = await makeTicket(p.id, { name: 'T1', complexity: 1 });
    const t2 = await makeTicket(p.id, { name: 'T2', complexity: 1 });
    const t3 = await makeTicket(p.id, { name: 'T3', complexity: 1 });

    // Park t1 and t2 in the completion column ahead of time (t3 stays
    // elsewhere, so neither move sweeps). Each carries a token delta so
    // mostTokensInProcess has a real, non-zero baseline to hold steady.
    await request(app)
      .post(`/api/v1/tickets/${t1.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id, tokensDelta: 40, llmName: 'claude' })
      .expect(200);
    await request(app)
      .post(`/api/v1/tickets/${t2.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id, tokensDelta: 20, llmName: 'claude' })
      .expect(200);

    const before = (await request(app).get('/api/v1/reports/transitions').set(auth)).body as {
      mostChanges: { ticketId: string; changes: number }[];
      mostTokensInProcess: { ticketId: string; tokens: number }[];
    };
    const changesBefore = new Map(before.mostChanges.map((r) => [r.ticketId, r.changes]));
    const tokensBefore = new Map(before.mostTokensInProcess.map((r) => [r.ticketId, r.tokens]));

    // Moving t3 in empties every other column, so this move sweeps t1, t2
    // and t3 together. t1 and t2 make no move of their own this time, so
    // the only new history row for either of them is the sweep's own exit
    // row (FR-020) -- isolating exactly the sweep's contribution.
    const sweepMove = await request(app)
      .post(`/api/v1/tickets/${t3.id}/move`)
      .set(auth)
      .send({ targetColumnId: cols[4].id })
      .expect(200);
    expect(sweepMove.body.sweep).not.toBeNull();
    expect(sweepMove.body.sweep.ticketIds.sort()).toEqual([t1.id, t2.id, t3.id].sort());

    const after = (await request(app).get('/api/v1/reports/transitions').set(auth)).body as {
      mostChanges: { ticketId: string; changes: number }[];
      mostTokensInProcess: { ticketId: string; tokens: number }[];
    };
    const changesAfter = new Map(after.mostChanges.map((r) => [r.ticketId, r.changes]));
    const tokensAfter = new Map(after.mostTokensInProcess.map((r) => [r.ticketId, r.tokens]));

    for (const id of [t1.id, t2.id]) {
      expect(changesAfter.get(id)).toBe((changesBefore.get(id) ?? 0) + 1);
      expect(tokensAfter.get(id)).toBe(tokensBefore.get(id));
    }
  });
});
