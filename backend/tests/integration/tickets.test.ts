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

  // T054 (FR-025): a project's previous sweeps must have no effect on newly
  // created tickets -- creation always places a new ticket on the board,
  // however many times the project has been swept before.
  it('T054: creation still places new tickets on the board after the project has already been swept', async () => {
    const colsRes = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    const cols = colsRes.body as { id: string; name: string }[];
    await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true })
      .expect(200);

    // Sweep the board twice in a row, via the real move endpoint -- not a
    // direct DB write -- so the project genuinely carries sweep history.
    for (let cycle = 0; cycle < 2; cycle++) {
      const t = await createTicket({ name: `Cycle${cycle}`, complexity: 1 });
      const moved = await request(app)
        .post(`/api/v1/tickets/${t.body.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id });
      expect(moved.body.sweep).not.toBeNull();
    }

    const created = await createTicket({ name: 'AfterSweeps', complexity: 1 });
    expect(created.status).toBe(201);
    expect(created.body.columnId).not.toBeNull();
    expect(created.body.columnId).toBe(cols[0].id);

    const db = await prisma.ticket.findUnique({ where: { id: created.body.id } });
    expect(db!.columnId).toBe(cols[0].id);
  });

  // T015 (FR-005 .. FR-010, contracts/rest-api.md): the write path for the
  // optional `branch` field on POST /projects/:id/tickets and
  // PATCH /tickets/:id.
  describe('branch write path (T015)', () => {
    it('creates a ticket with a branch and stores the trimmed value', async () => {
      const res = await createTicket({
        name: 'WithBranch',
        complexity: 3,
        branch: '  002-ticket-git-branch-view  ',
      });
      expect(res.status).toBe(201);
      expect(res.body.gitBranch).toBe('002-ticket-git-branch-view');
      const db = await prisma.ticket.findUnique({ where: { id: res.body.id } });
      expect(db!.gitBranch).toBe('002-ticket-git-branch-view');
    });

    it('creates a ticket without a branch, leaving it null', async () => {
      const res = await createTicket({ name: 'NoBranch', complexity: 3 });
      expect(res.status).toBe(201);
      expect(res.body.gitBranch).toBeNull();
    });

    it('updates a ticket with a branch', async () => {
      const t = await createTicket({ name: 'T', complexity: 3 });
      const res = await request(app)
        .patch(`/api/v1/tickets/${t.body.id}`)
        .set(auth)
        .send({ branch: 'feature/login' });
      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBe('feature/login');
      const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
      expect(db!.gitBranch).toBe('feature/login');
    });

    it('leaves the stored branch unchanged when `branch` is omitted (absent is not null)', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'keep/me' });
      expect(t.body.gitBranch).toBe('keep/me');
      const res = await request(app)
        .patch(`/api/v1/tickets/${t.body.id}`)
        .set(auth)
        .send({ description: 'unrelated edit' });
      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBe('keep/me');
      const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
      expect(db!.gitBranch).toBe('keep/me');
    });

    it('clears the stored branch when `branch` is an empty string', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'clear/me' });
      const res = await request(app)
        .patch(`/api/v1/tickets/${t.body.id}`)
        .set(auth)
        .send({ branch: '' });
      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBeNull();
      const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
      expect(db!.gitBranch).toBeNull();
    });

    it('clears the stored branch when `branch` is whitespace-only', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'clear/me' });
      const res = await request(app)
        .patch(`/api/v1/tickets/${t.body.id}`)
        .set(auth)
        .send({ branch: '   ' });
      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBeNull();
      const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
      expect(db!.gitBranch).toBeNull();
    });

    it('clears the stored branch when `branch` is null', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'clear/me' });
      const res = await request(app)
        .patch(`/api/v1/tickets/${t.body.id}`)
        .set(auth)
        .send({ branch: null });
      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBeNull();
      const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
      expect(db!.gitBranch).toBeNull();
    });

    it('rejects a malformed branch on create with 400 VALIDATION and stores nothing', async () => {
      const res = await createTicket({ name: 'Bad', complexity: 3, branch: 'has spaces' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      const rows = await prisma.ticket.findMany({ where: { projectId, name: 'Bad' } });
      expect(rows).toHaveLength(0);
    });

    // FR-010: a rejected write leaves any previously stored value intact --
    // asserted on the stored value, not merely on the status code.
    it('rejects a malformed branch on update and leaves the previously stored value intact', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'good/branch' });
      for (const bad of ['has spaces', 'ba~d', 'ba^d', 'ba:d', 'ba?d', 'ba*d', 'ba[d', 'ba\\d', 'a..b', 'a@{b', '/leading', 'trailing/', 'x'.repeat(256), 'thing.lock']) {
        const res = await request(app)
          .patch(`/api/v1/tickets/${t.body.id}`)
          .set(auth)
          .send({ branch: bad });
        expect(res.status, `branch ${JSON.stringify(bad)} should be rejected`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
        expect(db!.gitBranch, `branch ${JSON.stringify(bad)} must not have touched the row`).toBe(
          'good/branch',
        );
      }
    });

    // FR-010: the REST endpoint is reachable directly and forwards req.body
    // unfiltered, so a non-string branch must come back as 400 VALIDATION --
    // not a 500 -- and must leave the previously stored value intact.
    it('rejects a non-string branch over HTTP with 400 VALIDATION and leaves the previously stored value intact', async () => {
      const t = await createTicket({ name: 'T', complexity: 3, branch: 'good/branch' });
      for (const bad of [42, true, { branch: 'main' }, ['main']]) {
        const res = await request(app)
          .patch(`/api/v1/tickets/${t.body.id}`)
          .set(auth)
          .send({ branch: bad });
        expect(res.status, `branch ${JSON.stringify(bad)} should be rejected`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        // Re-read the stored value: the status code alone would not prove the
        // previous value survived.
        const db = await prisma.ticket.findUnique({ where: { id: t.body.id } });
        expect(db!.gitBranch, `branch ${JSON.stringify(bad)} must not have touched the row`).toBe(
          'good/branch',
        );
        const read = await request(app).get(`/api/v1/tickets/${t.body.id}`).set(auth);
        expect(read.status).toBe(200);
        expect(read.body.gitBranch).toBe('good/branch');
      }
    });
  });

  // T016 (FR-015, contracts/rest-api.md): both read endpoints carry
  // gitBranch/effectiveBranch/branchSource on every ticket object.
  describe('branch read shape (T016)', () => {
    it('returns the three fields on the detail endpoint and on every subticket', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      const own = await createTicket({
        name: 'SubOwn',
        complexity: 1,
        parentTicketId: parent.body.id,
        branch: 'feature/own',
      });
      const inherited = await createTicket({
        name: 'SubInherited',
        complexity: 1,
        parentTicketId: parent.body.id,
      });

      const detail = await request(app).get(`/api/v1/tickets/${parent.body.id}`).set(auth);
      expect(detail.status).toBe(200);
      expect(detail.body.gitBranch).toBe('feature/parent');
      expect(detail.body.effectiveBranch).toBe('feature/parent');
      expect(detail.body.branchSource).toBe('own');

      expect(detail.body.subtickets).toHaveLength(2);
      for (const sub of detail.body.subtickets as Record<string, unknown>[]) {
        expect(sub).toHaveProperty('gitBranch');
        expect(sub).toHaveProperty('effectiveBranch');
        expect(sub).toHaveProperty('branchSource');
      }
      const ownSub = (detail.body.subtickets as { id: string }[]).find((s) => s.id === own.body.id)!;
      expect(ownSub).toMatchObject({
        gitBranch: 'feature/own',
        effectiveBranch: 'feature/own',
        branchSource: 'own',
      });
      const inheritedSub = (detail.body.subtickets as { id: string }[]).find(
        (s) => s.id === inherited.body.id,
      )!;
      expect(inheritedSub).toMatchObject({
        gitBranch: null,
        effectiveBranch: 'feature/parent',
        branchSource: 'inherited',
      });
    });

    it('returns null/null/null on the detail endpoint when no branch exists anywhere', async () => {
      const parent = await createTicket({ name: 'P', complexity: 3 });
      await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.body.id });
      const detail = await request(app).get(`/api/v1/tickets/${parent.body.id}`).set(auth);
      expect(detail.body).toMatchObject({
        gitBranch: null,
        effectiveBranch: null,
        branchSource: null,
      });
      expect(detail.body.subtickets[0]).toMatchObject({
        gitBranch: null,
        effectiveBranch: null,
        branchSource: null,
      });
    });

    it('returns the three fields on every element of the list endpoint', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      const inherited = await createTicket({
        name: 'SubInherited',
        complexity: 1,
        parentTicketId: parent.body.id,
      });
      const own = await createTicket({
        name: 'SubOwn',
        complexity: 1,
        parentTicketId: parent.body.id,
        branch: 'feature/own',
      });
      const bare = await createTicket({ name: 'Bare', complexity: 1 });

      const list = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(4);
      for (const t of list.body as Record<string, unknown>[]) {
        expect(t).toHaveProperty('gitBranch');
        expect(t).toHaveProperty('effectiveBranch');
        expect(t).toHaveProperty('branchSource');
      }
      const byId = Object.fromEntries(
        (list.body as { id: string }[]).map((t) => [t.id, t as Record<string, unknown>]),
      );
      expect(byId[parent.body.id]).toMatchObject({
        gitBranch: 'feature/parent',
        effectiveBranch: 'feature/parent',
        branchSource: 'own',
      });
      expect(byId[inherited.body.id]).toMatchObject({
        gitBranch: null,
        effectiveBranch: 'feature/parent',
        branchSource: 'inherited',
      });
      expect(byId[own.body.id]).toMatchObject({
        gitBranch: 'feature/own',
        effectiveBranch: 'feature/own',
        branchSource: 'own',
      });
      expect(byId[bare.body.id]).toMatchObject({
        gitBranch: null,
        effectiveBranch: null,
        branchSource: null,
      });
    });

    // The parent row itself is absent when parent=<id> narrows the list, but
    // the derived pair is still correct because the parent is resolved
    // through the relation, not through the response.
    it('still derives inheritance when the parent filter excludes the parent row', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.body.id });
      const subs = await request(app)
        .get(`/api/v1/projects/${projectId}/tickets?parent=${parent.body.id}`)
        .set(auth);
      expect(subs.status).toBe(200);
      expect(subs.body).toHaveLength(1);
      expect(subs.body[0]).toMatchObject({
        gitBranch: null,
        effectiveBranch: 'feature/parent',
        branchSource: 'inherited',
      });
    });
  });

  // T039 (US2, FR-013, FR-014, SC-003, SC-004): the full inheritance matrix
  // exercised over HTTP. T016 proved the three fields are *present*; this
  // block value-asserts the derivation itself, and specifically on a
  // SUBTICKET'S OWN detail endpoint `GET /api/v1/tickets/:subticketId` -- the
  // surface the detail modal actually loads when a person opens a subticket.
  // Inheritance is a single hop (spec A-003): one level of nesting is already
  // enforced, so there is no recursion, no cycle and no depth to test.
  describe('branch inheritance matrix (T039)', () => {
    it('parent with a branch → subticket without one inherits it on its OWN detail endpoint', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      const sub = await createTicket({
        name: 'S',
        complexity: 1,
        parentTicketId: parent.body.id,
      });

      const subDetail = await request(app).get(`/api/v1/tickets/${sub.body.id}`).set(auth);
      expect(subDetail.status).toBe(200);
      expect(subDetail.body.id).toBe(sub.body.id);
      expect(subDetail.body.parentTicketId).toBe(parent.body.id);
      expect(subDetail.body.gitBranch).toBeNull();
      expect(subDetail.body.effectiveBranch).toBe('feature/parent');
      expect(subDetail.body.branchSource).toBe('inherited');
    });

    it("subticket with its own branch returns its own value, never the parent's (SC-004)", async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      const sub = await createTicket({
        name: 'S',
        complexity: 1,
        parentTicketId: parent.body.id,
        branch: 'feature/own',
      });

      const subDetail = await request(app).get(`/api/v1/tickets/${sub.body.id}`).set(auth);
      expect(subDetail.status).toBe(200);
      expect(subDetail.body.gitBranch).toBe('feature/own');
      expect(subDetail.body.effectiveBranch).toBe('feature/own');
      expect(subDetail.body.branchSource).toBe('own');
      // SC-004 is a negative claim, so assert it as one.
      expect(subDetail.body.effectiveBranch).not.toBe('feature/parent');
      expect(subDetail.body.branchSource).not.toBe('inherited');
    });

    it('parent without a branch → subticket returns all three fields null on its own detail endpoint', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8 });
      const sub = await createTicket({
        name: 'S',
        complexity: 1,
        parentTicketId: parent.body.id,
      });

      const subDetail = await request(app).get(`/api/v1/tickets/${sub.body.id}`).set(auth);
      expect(subDetail.status).toBe(200);
      expect(subDetail.body).toMatchObject({
        gitBranch: null,
        effectiveBranch: null,
        branchSource: null,
      });
    });

    it("a parent ticket never returns 'inherited' -- with a branch, without one, on detail or list", async () => {
      const withBranch = await createTicket({ name: 'WithBranch', complexity: 3, branch: 'main' });
      const withoutBranch = await createTicket({ name: 'WithoutBranch', complexity: 3 });
      // Give each one a subticket, so a parent that is genuinely above a
      // branch-carrying child cannot accidentally read its child's value.
      await createTicket({
        name: 'ChildOfWith',
        complexity: 1,
        parentTicketId: withBranch.body.id,
      });
      await createTicket({
        name: 'ChildOfWithout',
        complexity: 1,
        parentTicketId: withoutBranch.body.id,
        branch: 'feature/child',
      });

      const withDetail = await request(app).get(`/api/v1/tickets/${withBranch.body.id}`).set(auth);
      expect(withDetail.status).toBe(200);
      expect(withDetail.body).toMatchObject({
        gitBranch: 'main',
        effectiveBranch: 'main',
        branchSource: 'own',
      });

      const withoutDetail = await request(app)
        .get(`/api/v1/tickets/${withoutBranch.body.id}`)
        .set(auth);
      expect(withoutDetail.status).toBe(200);
      // A child's branch must never travel upwards.
      expect(withoutDetail.body).toMatchObject({
        gitBranch: null,
        effectiveBranch: null,
        branchSource: null,
      });

      const list = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
      expect(list.status).toBe(200);
      const topLevel = (list.body as { parentTicketId: string | null; branchSource: unknown }[])
        .filter((t) => t.parentTicketId === null);
      expect(topLevel).toHaveLength(2);
      for (const t of topLevel) {
        expect(t.branchSource).not.toBe('inherited');
      }
    });
  });

  // T016a (FR-015a, contracts/rest-api.md): the parent relation is loaded to
  // compute the derived pair and must be dropped, not serialized. A `parent`
  // object in the response would be a fourth added field.
  describe('branch read shape drops the parent relation (T016a)', () => {
    it('never exposes a `parent` key on either read response', async () => {
      const parent = await createTicket({ name: 'P', complexity: 8, branch: 'feature/parent' });
      await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.body.id });

      const list = await request(app).get(`/api/v1/projects/${projectId}/tickets`).set(auth);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      for (const t of list.body as Record<string, unknown>[]) {
        expect(t).not.toHaveProperty('parent');
      }

      for (const id of [parent.body.id, (list.body as { id: string }[])[1].id]) {
        const detail = await request(app).get(`/api/v1/tickets/${id}`).set(auth);
        expect(detail.status).toBe(200);
        expect(detail.body).not.toHaveProperty('parent');
        for (const sub of (detail.body.subtickets ?? []) as Record<string, unknown>[]) {
          expect(sub).not.toHaveProperty('parent');
        }
      }
    });
  });
  // T010 (research R7/R9, data-model.md "GitCommitTicket"): the ONLY proof that
  // GitCommitTicket -> Ticket is onDelete: Cascade and not Prisma's default for a
  // required relation, Restrict. `prisma validate` and `prisma migrate diff` both
  // pass with either action, so nothing but this test catches the regression --
  // and the regression is that deleting a ticket, which works today, would start
  // failing with a foreign-key error the moment the commit link table exists.
  describe('deleting a ticket that has commit links (T010)', () => {
    it('succeeds and removes only the links, leaving the commit and branch intact', async () => {
      const ticket = await createTicket({ name: 'Linked', complexity: 3 });
      expect(ticket.status).toBe(201);
      const other = await createTicket({ name: 'Untouched', complexity: 1 });
      expect(other.status).toBe(201);

      const branch = await prisma.gitBranch.create({
        data: {
          projectId,
          name: '004-view-repo-git-tree',
          isTrunk: false,
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
      const commit = await prisma.gitCommit.create({
        data: {
          projectId,
          branchId: branch.id,
          sha: 'a'.repeat(40),
          message: 'feat: something',
          authorName: 'juglarx',
          committedAt: new Date(),
          parentShas: ['b'.repeat(40)],
        },
      });
      await prisma.gitCommitFile.create({
        data: { commitId: commit.id, path: 'backend/prisma/schema.prisma', changeType: 'M' },
      });
      await prisma.gitCommitTicket.createMany({
        data: [
          { commitId: commit.id, ticketId: ticket.body.id },
          { commitId: commit.id, ticketId: other.body.id },
        ],
      });
      expect(await prisma.gitCommitTicket.count()).toBe(2);

      const del = await request(app).delete(`/api/v1/tickets/${ticket.body.id}`).set(auth);
      expect(del.status).toBe(200);
      expect(del.body).toEqual({ deleted: true });

      // Only the deleted ticket's link is gone.
      expect(await prisma.gitCommitTicket.findMany({ select: { ticketId: true } })).toEqual([
        { ticketId: other.body.id },
      ]);
      // The commit, its files and its branch are untouched: a ticket delete is
      // not allowed to erase recorded history (FR-032).
      expect(await prisma.gitCommit.count()).toBe(1);
      expect(await prisma.gitCommitFile.count()).toBe(1);
      expect(await prisma.gitBranch.count()).toBe(1);
      expect(await prisma.ticket.count()).toBe(1);
    });
  });
});
