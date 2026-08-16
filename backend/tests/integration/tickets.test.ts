import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

async function createTicket(body: Record<string, unknown>) {
  return request(app).post(`/api/v1/projects/${projectId}/tickets`).set(auth).send(body);
}

describe('tickets', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
  });

  it('creates a ticket with sequential per-project number in the first column', async () => {
    const a = await createTicket({ name: 'First', complexity: 3 });
    const b = await createTicket({ name: 'Second', complexity: 5 });
    expect(a.status).toBe(201);
    expect(a.body.number).toBe(1);
    expect(b.body.number).toBe(2);
    const cols = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    expect(a.body.columnId).toBe(cols.body[0].id);
  });

  it('never leaves a ticket with a null columnId on ordinary create or update paths', async () => {
    // data-model.md central invariant: no ordinary create or update path can
    // leave a ticket with a null columnId. The sweep (a later phase) is the
    // only thing allowed to null it out.
    const created = await createTicket({ name: 'Invariant', complexity: 3 });
    expect(created.status).toBe(201);
    expect(created.body.columnId).not.toBeNull();
    expect(typeof created.body.columnId).toBe('string');

    const updateAttempt = await request(app)
      .patch(`/api/v1/tickets/${created.body.id}`)
      .set(auth)
      .send({ columnId: null });
    expect(updateAttempt.status).toBe(400);
    expect(updateAttempt.body.error.code).toBe('VALIDATION');
  });

  it('rejects invalid complexity', async () => {
    const res = await createTicket({ name: 'Bad', complexity: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_COMPLEXITY');
  });

  it('rejects negative tokens and missing LLM', async () => {
    expect((await createTicket({ name: 'T', complexity: 1, tokensConsumed: -5 })).status).toBe(400);
    expect((await createTicket({ name: 'T', complexity: 1, tokensConsumed: 10 })).status).toBe(400);
    expect(
      (await createTicket({ name: 'T', complexity: 1, tokensConsumed: 10, llmName: 'claude' }))
        .status,
    ).toBe(201);
  });

  it('creates a subticket linked to its parent', async () => {
    const parent = await createTicket({ name: 'Parent', complexity: 8 });
    const sub = await createTicket({
      name: 'Sub',
      complexity: 2,
      parentTicketId: parent.body.id,
    });
    expect(sub.status).toBe(201);
    expect(sub.body.parentTicketId).toBe(parent.body.id);
  });

  it('rejects a subticket of a subticket', async () => {
    const parent = await createTicket({ name: 'P', complexity: 1 });
    const sub = await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.body.id });
    const subsub = await createTicket({ name: 'SS', complexity: 1, parentTicketId: sub.body.id });
    expect(subsub.status).toBe(400);
    expect(subsub.body.error.code).toBe('SUBTICKET_NESTING');
  });

  it('returns detail with aggregated totals (own + subtickets)', async () => {
    const parent = await createTicket({
      name: 'P',
      complexity: 8,
      tokensConsumed: 100,
      llmName: 'claude',
      developmentTimeMinutes: 30,
    });
    await createTicket({
      name: 'S1',
      complexity: 2,
      parentTicketId: parent.body.id,
      tokensConsumed: 50,
      llmName: 'gpt',
      developmentTimeMinutes: 10,
    });
    const detail = await request(app).get(`/api/v1/tickets/${parent.body.id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.totals).toEqual({ totalTokens: 150, totalTimeMinutes: 40 });
    expect(detail.body.subtickets).toHaveLength(1);
  });

  it('updates a ticket and re-validates', async () => {
    const t = await createTicket({ name: 'T', complexity: 3 });
    const ok = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ complexity: 13, description: 'updated' });
    expect(ok.status).toBe(200);
    expect(ok.body.complexity).toBe(13);
    const bad = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ complexity: 9 });
    expect(bad.status).toBe(400);
  });

  it('rejects columnId and parentTicketId changes via PATCH', async () => {
    const t = await createTicket({ name: 'T', complexity: 3 });
    const cols = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    const byColumn = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ columnId: cols.body[1].id });
    expect(byColumn.status).toBe(400);
    const byParent = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ parentTicketId: null });
    expect(byParent.status).toBe(400);
  });

  it('filters by parent', async () => {
    const p = await createTicket({ name: 'P', complexity: 1 });
    await createTicket({ name: 'S', complexity: 1, parentTicketId: p.body.id });
    const top = await request(app)
      .get(`/api/v1/projects/${projectId}/tickets?parent=none`)
      .set(auth);
    expect(top.body).toHaveLength(1);
    const subs = await request(app)
      .get(`/api/v1/projects/${projectId}/tickets?parent=${p.body.id}`)
      .set(auth);
    expect(subs.body).toHaveLength(1);
    expect(subs.body[0].name).toBe('S');
  });

  it('deletes a ticket with its subtickets', async () => {
    const p = await createTicket({ name: 'P', complexity: 1 });
    await createTicket({ name: 'S', complexity: 1, parentTicketId: p.body.id });
    const res = await request(app).delete(`/api/v1/tickets/${p.body.id}`).set(auth);
    expect(res.status).toBe(200);
    const all = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
    expect(all.body).toHaveLength(0);
  });

  it('rejects create without name and without complexity', async () => {
    const noName = await createTicket({ complexity: 3 });
    expect(noName.status).toBe(400);
    expect(noName.body.error.code).toBe('VALIDATION');
    const noComplexity = await createTicket({ name: 'T' });
    expect(noComplexity.status).toBe(400);
    expect(noComplexity.body.error.code).toBe('VALIDATION');
  });

  it('creates a ticket in an explicit non-default column', async () => {
    const cols = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    const res = await createTicket({ name: 'T', complexity: 3, columnId: cols.body[2].id });
    expect(res.status).toBe(201);
    expect(res.body.columnId).toBe(cols.body[2].id);
  });

  it('rejects a columnId from another project', async () => {
    const other = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Other' });
    const otherCols = await request(app)
      .get(`/api/v1/projects/${other.body.id}/columns`)
      .set(auth);
    const res = await createTicket({ name: 'T', complexity: 1, columnId: otherCols.body[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects a labelId from another project', async () => {
    const other = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Other' });
    const otherLabel = await request(app)
      .post(`/api/v1/projects/${other.body.id}/labels`)
      .set(auth)
      .send({ name: 'foreign' });
    const res = await createTicket({ name: 'T', complexity: 1, labelId: otherLabel.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects a parentTicketId from another project or nonexistent', async () => {
    const other = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Other' });
    const foreignParent = await request(app)
      .post(`/api/v1/projects/${other.body.id}/tickets`)
      .set(auth)
      .send({ name: 'FP', complexity: 1 });
    const crossProject = await createTicket({
      name: 'T',
      complexity: 1,
      parentTicketId: foreignParent.body.id,
    });
    expect(crossProject.status).toBe(400);
    expect(crossProject.body.error.code).toBe('VALIDATION');
    const ghost = await createTicket({ name: 'T', complexity: 1, parentTicketId: 'no-such-id' });
    expect(ghost.status).toBe(400);
  });

  it('409s with NO_COLUMNS when all project columns were deleted', async () => {
    const cols = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    for (const col of cols.body) {
      await request(app)
        .delete(`/api/v1/projects/${projectId}/columns/${col.id}`)
        .set(auth)
        .expect(200);
    }
    const res = await createTicket({ name: 'Orphan', complexity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_COLUMNS');
  });

  it('404s on detail, update and delete of a nonexistent ticket', async () => {
    expect((await request(app).get('/api/v1/tickets/no-such-id').set(auth)).status).toBe(404);
    expect(
      (await request(app).patch('/api/v1/tickets/no-such-id').set(auth).send({ name: 'X' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete('/api/v1/tickets/no-such-id').set(auth)).status).toBe(404);
  });

  it('rejects an empty name on update', async () => {
    const t = await createTicket({ name: 'T', complexity: 1 });
    const res = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('sets and clears labelId on update', async () => {
    const label = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ name: 'bug' });
    const t = await createTicket({ name: 'T', complexity: 1 });
    const set = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ labelId: label.body.id });
    expect(set.status).toBe(200);
    expect(set.body.labelId).toBe(label.body.id);
    const cleared = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ labelId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.labelId).toBeNull();
  });

  it('changes llmName on update and revalidates when clearing it', async () => {
    const t = await createTicket({
      name: 'T',
      complexity: 1,
      tokensConsumed: 10,
      llmName: 'claude',
    });
    const changed = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ llmName: 'gpt' });
    expect(changed.status).toBe(200);
    expect(changed.body.llmName).toBe('gpt');
    // clearing llmName while tokensConsumed > 0 fails revalidation
    const cleared = await request(app)
      .patch(`/api/v1/tickets/${t.body.id}`)
      .set(auth)
      .send({ llmName: null });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.code).toBe('LLM_REQUIRED');
  });

  it('creates a top-level ticket in a phase and rejects a phase from another project', async () => {
    const phase = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' })).body;
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({ name: 'Login', complexity: 3, phaseId: phase.id });
    expect(created.status).toBe(201);
    expect(created.body.phaseId).toBe(phase.id);

    const other = (await request(app).post('/api/v1/projects').set(auth).send({ name: 'Other' })).body;
    const otherPhase = (await request(app).post(`/api/v1/projects/${other.id}/phases`).set(auth).send({ name: 'Nope' })).body;
    const bad = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({ name: 'Cross', complexity: 3, phaseId: otherPhase.id });
    expect(bad.status).toBe(400);
  });

  it('rejects a phaseId on a subtask, on create and on update', async () => {
    const phase = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' })).body;
    const parent = (
      await request(app).post(`/api/v1/projects/${projectId}/tickets`).set(auth).send({ name: 'Parent', complexity: 3 })
    ).body;

    const badCreate = await request(app)
      .post(`/api/v1/projects/${projectId}/tickets`)
      .set(auth)
      .send({ name: 'Sub', complexity: 1, parentTicketId: parent.id, phaseId: phase.id });
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.error.code).toBe('SUBTASK_PHASE');

    const sub = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/tickets`)
        .set(auth)
        .send({ name: 'Sub', complexity: 1, parentTicketId: parent.id })
    ).body;
    const badUpdate = await request(app).patch(`/api/v1/tickets/${sub.id}`).set(auth).send({ phaseId: phase.id });
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.error.code).toBe('SUBTASK_PHASE');
  });

  it('assigns and clears the phase of a top-level ticket on update', async () => {
    const phase = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' })).body;
    const ticket = (
      await request(app).post(`/api/v1/projects/${projectId}/tickets`).set(auth).send({ name: 'T', complexity: 3 })
    ).body;

    const assigned = await request(app).patch(`/api/v1/tickets/${ticket.id}`).set(auth).send({ phaseId: phase.id });
    expect(assigned.body.phaseId).toBe(phase.id);

    const cleared = await request(app).patch(`/api/v1/tickets/${ticket.id}`).set(auth).send({ phaseId: null });
    expect(cleared.body.phaseId).toBeNull();
  });

  // T040 (FR-019a, research.md R4): the `placement` filter on
  // GET /projects/:id/tickets.
  describe('placement filter (T040)', () => {
    it('returns everything when placement is omitted, exactly as before', async () => {
      const p = await createTicket({ name: 'P', complexity: 1 });
      await createTicket({ name: 'S', complexity: 1, parentTicketId: p.body.id });
      const res = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('placement=all returns exactly what omitting it returns', async () => {
      const p = await createTicket({ name: 'P', complexity: 1 });
      await createTicket({ name: 'S', complexity: 1, parentTicketId: p.body.id });
      const omitted = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
      const all = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=all`)
        .set(auth);
      expect(all.status).toBe(200);
      expect(all.body).toEqual(omitted.body);
    });

    it('placement=board excludes swept tickets; placement=completed returns only them', async () => {
      const cols = (await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth)).body as {
        id: string;
      }[];
      await request(app)
        .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
        .set(auth)
        .send({ isCompletionColumn: true })
        .expect(200);
      const onBoard = await createTicket({ name: 'OnBoard', complexity: 1 });
      const willSweep = await createTicket({ name: 'WillSweep', complexity: 1 });

      // Sweeping requires every ticket on the board to land in the
      // completion column, so move OnBoard there too, then move it right
      // back out -- leaving WillSweep as the only ticket actually swept.
      await request(app)
        .post(`/api/v1/tickets/${onBoard.body.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id })
        .expect(200);
      const sweepMove = await request(app)
        .post(`/api/v1/tickets/${willSweep.body.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id })
        .expect(200);
      expect(sweepMove.body.sweep).not.toBeNull();
      // OnBoard was swept along with WillSweep (whole-board sweep); restore
      // it to the board so this test actually has one ticket on the board
      // and one completed.
      await request(app)
        .post(`/api/v1/tickets/${onBoard.body.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[0].id })
        .expect(200);

      const board = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=board`)
        .set(auth);
      expect(board.status).toBe(200);
      expect(board.body.map((t: { id: string }) => t.id)).toEqual([onBoard.body.id]);

      const completed = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=completed`)
        .set(auth);
      expect(completed.status).toBe(200);
      expect(completed.body.map((t: { id: string }) => t.id)).toEqual([willSweep.body.id]);
    });

    it('rejects an invalid placement value with 400 VALIDATION', async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=bogus`)
        .set(auth);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('composes correctly with the parent filter', async () => {
      const p = await createTicket({ name: 'P', complexity: 1 });
      const s1 = await createTicket({ name: 'S1', complexity: 1, parentTicketId: p.body.id });
      const s2 = await createTicket({ name: 'S2', complexity: 1, parentTicketId: p.body.id });
      // Mark s1 completed directly -- the sweep mechanism itself is covered
      // elsewhere; this test is only about how placement composes with
      // parent in the query.
      await prisma.ticket.update({ where: { id: s1.body.id }, data: { columnId: null } });

      const boardSubs = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=board&parent=${p.body.id}`)
        .set(auth);
      expect(boardSubs.body.map((t: { id: string }) => t.id)).toEqual([s2.body.id]);

      const completedSubs = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?placement=completed&parent=${p.body.id}`)
        .set(auth);
      expect(completedSubs.body.map((t: { id: string }) => t.id)).toEqual([s1.body.id]);
    });
  });
});
