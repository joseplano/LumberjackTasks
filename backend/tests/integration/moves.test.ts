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

async function setCompletion(columnId: string, isCompletionColumn = true) {
  return request(app)
    .patch(`/api/v1/projects/${projectId}/columns/${columnId}`)
    .set(auth)
    .send({ isCompletionColumn });
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

  // --- US2: the automatic board sweep (T025, T026, T031) ---
  describe('board sweep on move into the completion column', () => {
    // T025 (FR-008, FR-009, FR-012, FR-013)
    it('T025: does not sweep while another column still holds a ticket', async () => {
      const setRes = await setCompletion(cols[4].id, true);
      expect(setRes.status).toBe(200);
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      await createTicket({ name: 'T2', complexity: 1 }); // stays in TODO

      const res = await move(t1.id, { targetColumnId: cols[4].id });
      expect(res.status).toBe(200);
      expect(res.body.sweep).toBeNull();
      expect(res.body.columnId).toBe(cols[4].id);
    });

    it('T025: sweeps on the move that empties the last other column', async () => {
      await setCompletion(cols[4].id, true);
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      const t2 = await createTicket({ name: 'T2', complexity: 1 });

      const first = await move(t1.id, { targetColumnId: cols[4].id });
      expect(first.body.sweep).toBeNull();

      const second = await move(t2.id, { targetColumnId: cols[4].id });
      expect(second.status).toBe(200);
      expect(second.body.sweep).not.toBeNull();
      expect(second.body.sweep.completionColumnId).toBe(cols[4].id);
      expect(second.body.sweep.completionColumnName).toBe('Done');
      expect(second.body.sweep.ticketCount).toBe(2);
      expect(second.body.sweep.ticketIds.sort()).toEqual([t1.id, t2.id].sort());
      expect(second.body.columnId).toBeNull(); // the just-moved ticket left the board too

      const dbT1 = await prisma.ticket.findUnique({ where: { id: t1.id } });
      const dbT2 = await prisma.ticket.findUnique({ where: { id: t2.id } });
      expect(dbT1!.columnId).toBeNull();
      expect(dbT2!.columnId).toBeNull();
    });

    it('T025: never sweeps at all when no column is designated', async () => {
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      const res = await move(t1.id, { targetColumnId: cols[4].id });
      expect(res.status).toBe(200);
      expect(res.body.sweep).toBeNull();
      expect(res.body.columnId).toBe(cols[4].id);

      const auditCount = await prisma.auditLog.count({
        where: { entityId: projectId, action: 'board.swept' },
      });
      expect(auditCount).toBe(0);
    });

    // T026 (FR-009, FR-011)
    it('T026: a single-ticket project sweeps', async () => {
      await setCompletion(cols[4].id, true);
      const t1 = await createTicket({ name: 'Solo', complexity: 1 });
      const res = await move(t1.id, { targetColumnId: cols[4].id });
      expect(res.status).toBe(200);
      expect(res.body.sweep).not.toBeNull();
      expect(res.body.sweep.ticketCount).toBe(1);
      expect(res.body.sweep.ticketIds).toEqual([t1.id]);
    });

    it('T026: an otherwise-empty project never spuriously reports a sweep', async () => {
      await setCompletion(cols[4].id, true);
      const auditCount = await prisma.auditLog.count({
        where: { entityId: projectId, action: 'board.swept' },
      });
      expect(auditCount).toBe(0);
    });

    it('T026: a subticket left in another column blocks the sweep, and sweeps with the rest once moved', async () => {
      await setCompletion(cols[4].id, true); // 'Done'
      const parent = await createTicket({ name: 'P', complexity: 5 });
      const sub = await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.id });

      // Move the subticket ahead of the completion column so the parent-move
      // rule (FR-011a) does not block the parent from advancing into it.
      const subMoved = await move(sub.id, { targetColumnId: cols[5].id }); // 'Committed'
      expect(subMoved.status).toBe(200);

      const parentMoved = await move(parent.id, { targetColumnId: cols[4].id });
      expect(parentMoved.status).toBe(200);
      // The subticket still occupies a non-completion column (FR-011): blocked.
      expect(parentMoved.body.sweep).toBeNull();

      const subBack = await move(sub.id, { targetColumnId: cols[4].id });
      expect(subBack.status).toBe(200);
      expect(subBack.body.sweep).not.toBeNull();
      expect(subBack.body.sweep.ticketCount).toBe(2);
      expect(subBack.body.sweep.ticketIds.sort()).toEqual([parent.id, sub.id].sort());
    });

    // T031 (FR-020, FR-021, FR-021a)
    it('T031: one board.swept audit entry (not one per ticket) attributed to the mover, plus one history row per swept ticket', async () => {
      await setCompletion(cols[4].id, true);
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      const t2 = await createTicket({ name: 'T2', complexity: 1 });
      const t3 = await createTicket({ name: 'T3', complexity: 1 });

      await move(t1.id, { targetColumnId: cols[4].id });
      await move(t2.id, { targetColumnId: cols[4].id });
      const last = await move(t3.id, { targetColumnId: cols[4].id });
      expect(last.body.sweep).not.toBeNull();
      expect(last.body.sweep.ticketCount).toBe(3);

      const sweepAudits = await prisma.auditLog.findMany({
        where: { entityId: projectId, action: 'board.swept' },
      });
      expect(sweepAudits).toHaveLength(1);
      const detail = sweepAudits[0].detail as {
        completionColumnId: string;
        completionColumnName: string;
        ticketCount: number;
        ticketIds: string[];
      };
      expect(detail.completionColumnId).toBe(cols[4].id);
      expect(detail.completionColumnName).toBe('Done');
      expect(detail.ticketCount).toBe(3);
      expect(detail.ticketIds.sort()).toEqual([t1.id, t2.id, t3.id].sort());

      const mover = await prisma.user.findFirst({ where: { email: 'test@test.com' } });
      expect(sweepAudits[0].userId).toBe(mover!.id);

      const sweepHistoryRows = await prisma.ticketStatusHistory.findMany({
        where: { toColumnName: 'Completed' },
      });
      expect(sweepHistoryRows).toHaveLength(3);
      for (const row of sweepHistoryRows) {
        expect(row.fromColumnName).toBe('Done');
        expect(row.changedByUserId).toBe(mover!.id);
        expect(row.tokensDelta).toBeNull();
        expect(row.timeDelta).toBeNull();
      }
      expect(sweepHistoryRows.map((r) => r.ticketId).sort()).toEqual([t1.id, t2.id, t3.id].sort());
    });
  });

  // --- US4: restoring a completed ticket (T050, T051) ---
  describe('restoring a completed ticket', () => {
    // T050 (FR-023, FR-024)
    it('T050: restores a completed ticket onto the board, it counts toward the sweep condition again, and the restore is recorded with fromColumnName "Completed"', async () => {
      await setCompletion(cols[4].id, true); // 'Done'
      const t1 = await createTicket({ name: 'T1', complexity: 1 });

      const swept = await move(t1.id, { targetColumnId: cols[4].id });
      expect(swept.body.sweep).not.toBeNull();
      const dbBefore = await prisma.ticket.findUnique({ where: { id: t1.id } });
      expect(dbBefore!.columnId).toBeNull();

      // Restore into an ordinary column: an ordinary, unremarkable move.
      const restore = await move(t1.id, { targetColumnId: cols[0].id });
      expect(restore.status).toBe(200);
      expect(restore.body.columnId).toBe(cols[0].id);
      expect(restore.body.sweep).toBeNull();

      const history = await prisma.ticketStatusHistory.findMany({
        where: { ticketId: t1.id },
        orderBy: { changedAt: 'asc' },
      });
      // [0] TODO -> Done (the move that triggered the sweep)
      // [1] Done -> Completed (the sweep's own exit row)
      // [2] Completed -> TODO (the restore)
      expect(history).toHaveLength(3);
      expect(history[2]).toMatchObject({ fromColumnName: 'Completed', toColumnName: 'TODO' });

      // It counts toward the sweep condition again: a second ticket entering
      // the completion column must NOT sweep while the restored t1 sits
      // elsewhere on the board.
      const t2 = await createTicket({ name: 'T2', complexity: 1 });
      const t2move = await move(t2.id, { targetColumnId: cols[4].id });
      expect(t2move.body.sweep).toBeNull();

      // Only once t1 also reaches the completion column does the board sweep.
      const t1move2 = await move(t1.id, { targetColumnId: cols[4].id });
      expect(t1move2.body.sweep).not.toBeNull();
      expect(t1move2.body.sweep.ticketIds.sort()).toEqual([t1.id, t2.id].sort());
    });

    // T051 (FR-011a)
    it('T051: restoring a parent while its subtickets remain completed is allowed -- completed ranks after every column', async () => {
      await setCompletion(cols[4].id, true); // 'Done'
      const parent = await createTicket({ name: 'P', complexity: 5 });
      const sub = await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.id });

      await move(sub.id, { targetColumnId: cols[4].id });
      const parentSweep = await move(parent.id, { targetColumnId: cols[4].id });
      expect(parentSweep.body.sweep).not.toBeNull();

      const dbParentBefore = await prisma.ticket.findUnique({ where: { id: parent.id } });
      const dbSubBefore = await prisma.ticket.findUnique({ where: { id: sub.id } });
      expect(dbParentBefore!.columnId).toBeNull();
      expect(dbSubBefore!.columnId).toBeNull();

      // Restore only the parent. The subticket stays completed (off-board,
      // ranked after every real column), so this is a backward move for the
      // parent relative to the subticket and must be allowed unconditionally.
      const restore = await move(parent.id, { targetColumnId: cols[0].id });
      expect(restore.status).toBe(200);
      expect(restore.body.columnId).toBe(cols[0].id);

      const dbSubAfter = await prisma.ticket.findUnique({ where: { id: sub.id } });
      expect(dbSubAfter!.columnId).toBeNull(); // subticket is untouched, still completed
    });
  });
});
