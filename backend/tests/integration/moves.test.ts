import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;
let cols: { id: string; name: string }[];

async function createTicket(body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/tickets`)
    .set(auth)
    .send(body);
  return res.body;
}

async function move(ticketId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/tickets/${ticketId}/move`).set(auth).send(body);
}

describe('ticket movement', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
    const c = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    cols = c.body;
  });

  it('moves a ticket and records history', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await move(t.id, { targetColumnId: cols[1].id });
    expect(res.status).toBe(200);
    expect(res.body.columnId).toBe(cols[1].id);
    const history = await prisma.ticketStatusHistory.findMany({ where: { ticketId: t.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromColumnName: 'TODO',
      toColumnName: 'In development',
      tokensDelta: null,
      timeDelta: null,
    });
  });

  it('applies token and time deltas on move', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await move(t.id, {
      targetColumnId: cols[1].id,
      tokensDelta: 500,
      timeDelta: 20,
      llmName: 'claude-fable-5',
    });
    expect(res.body.tokensConsumed).toBe(500);
    expect(res.body.developmentTimeMinutes).toBe(20);
    const history = await prisma.ticketStatusHistory.findFirst({ where: { ticketId: t.id } });
    expect(history!.tokensDelta).toBe(500);
    expect(history!.timeDelta).toBe(20);
  });

  it('rejects negative deltas and tokens without LLM', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    expect((await move(t.id, { targetColumnId: cols[1].id, tokensDelta: -1 })).status).toBe(400);
    expect((await move(t.id, { targetColumnId: cols[1].id, tokensDelta: 10 })).status).toBe(400);
  });

  it('blocks a parent from advancing past its subtickets', async () => {
    const parent = await createTicket({ name: 'P', complexity: 5 });
    await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.id });
    const res = await move(parent.id, { targetColumnId: cols[1].id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PARENT_MOVE_BLOCKED');
  });

  it('allows the parent to advance once subtickets are at or past the target', async () => {
    const parent = await createTicket({ name: 'P', complexity: 5 });
    const sub = await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.id });
    await move(sub.id, { targetColumnId: cols[2].id });
    const res = await move(parent.id, { targetColumnId: cols[1].id });
    expect(res.status).toBe(200);
  });

  it('lets a parent without subtickets move freely', async () => {
    const t = await createTicket({ name: 'Solo', complexity: 1 });
    const res = await move(t.id, { targetColumnId: cols[5].id });
    expect(res.status).toBe(200);
  });

  it('rejects a numeric-string tokensDelta without llmName and a fractional tokensDelta', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    // '5' as a string coerces to a valid integer but is still rejected because no llmName is supplied.
    const stringDelta = await move(t.id, { targetColumnId: cols[1].id, tokensDelta: '5' });
    expect(stringDelta.status).toBe(400);
    // 1.5 is rejected outright by the integer-coercion guard, regardless of llmName.
    const fractionalDelta = await move(t.id, {
      targetColumnId: cols[1].id,
      tokensDelta: 1.5,
      llmName: 'claude-fable-5',
    });
    expect(fractionalDelta.status).toBe(400);
  });

  it('rejects a move without targetColumnId', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await move(t.id, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('404s when moving a nonexistent ticket', async () => {
    const res = await move('no-such-id', { targetColumnId: cols[1].id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a negative timeDelta', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await move(t.id, { targetColumnId: cols[1].id, timeDelta: -10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NEGATIVE_TIME');
  });

  it('inherits llmName from the ticket when tokens are consumed without llmName', async () => {
    const t = await createTicket({
      name: 'T',
      complexity: 1,
      tokensConsumed: 10,
      llmName: 'claude',
    });
    const res = await move(t.id, { targetColumnId: cols[1].id, tokensDelta: 5 });
    expect(res.status).toBe(200);
    expect(res.body.llmName).toBe('claude');
    expect(res.body.tokensConsumed).toBe(15);
  });

  it('rejects a target column from another project', async () => {
    const other = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Other' });
    const otherCols = await request(app)
      .get(`/api/v1/projects/${other.body.id}/columns`)
      .set(auth);
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await move(t.id, { targetColumnId: otherCols.body[0].id });
    expect(res.status).toBe(400);
  });
});
