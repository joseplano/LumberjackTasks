import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { resetDb, authHeader, prisma } from '../helpers';

// T027: force a mid-sweep failure by making the sweep module itself reject,
// once, while leaving every other call to go through to the real
// implementation. This proves that moves.ts's transaction really does wrap
// the sweep -- if the sweep throws, the triggering move (and its own history
// / audit rows) must roll back too, not just the sweep's own writes.
vi.mock('../../src/services/sweep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/sweep')>();
  return { ...actual, sweepIfComplete: vi.fn(actual.sweepIfComplete) };
});

import { createApp } from '../../src/app';
import { sweepIfComplete } from '../../src/services/sweep';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;
let cols: { id: string; name: string; position: number }[];

async function createTicket(body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/tickets`)
    .set(auth)
    .send(body);
  return res.body as { id: string };
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

describe('board sweep (US2): atomicity, concurrency, integrity and the delete race', () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(sweepIfComplete).mockClear();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
    const c = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
    cols = c.body;
    await setCompletion(cols[4].id, true); // 'Done'
  });

  // T027 (FR-014, FR-014a, SC-008)
  it('T027: a mid-sweep failure rolls back the triggering move too, and no partial sweep is ever observable', async () => {
    const t1 = await createTicket({ name: 'T1', complexity: 1 });

    vi.mocked(sweepIfComplete).mockRejectedValueOnce(new Error('forced mid-sweep failure'));

    const res = await move(t1.id, { targetColumnId: cols[4].id });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error).toBeDefined();

    // The board is exactly as it was before the attempt: the triggering move
    // itself must be rolled back, not just the sweep.
    const ticket = await prisma.ticket.findUnique({ where: { id: t1.id } });
    expect(ticket!.columnId).toBe(cols[0].id);

    const history = await prisma.ticketStatusHistory.count({ where: { ticketId: t1.id } });
    expect(history).toBe(0);

    const movedAudit = await prisma.auditLog.count({
      where: { entityId: t1.id, action: 'ticket.moved' },
    });
    expect(movedAudit).toBe(0);

    const sweptAudit = await prisma.auditLog.count({
      where: { entityId: projectId, action: 'board.swept' },
    });
    expect(sweptAudit).toBe(0);

    // No read of the project shows a partially swept board either: every
    // ticket is still fully on the board.
    const allTickets = await prisma.ticket.findMany({ where: { projectId } });
    expect(allTickets.every((t) => t.columnId !== null)).toBe(true);
  });

  // T028 (research.md R3, SC-002): the missed-sweep hazard is the dangerous
  // one -- under READ COMMITTED, two concurrent moves can each see the
  // other's ticket still in its old column and neither considers the board
  // complete. Assert exactly one sweep fires, never zero and never two.
  it('T028: concurrent moves into the completion column produce exactly one sweep', async () => {
    const t1 = await createTicket({ name: 'T1', complexity: 1 });
    const t2 = await createTicket({ name: 'T2', complexity: 1 });

    const [r1, r2] = await Promise.all([
      move(t1.id, { targetColumnId: cols[4].id }),
      move(t2.id, { targetColumnId: cols[4].id }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const sweptAudits = await prisma.auditLog.findMany({
      where: { entityId: projectId, action: 'board.swept' },
    });
    // Never zero (missed sweep) and never more than one (double sweep).
    expect(sweptAudits).toHaveLength(1);

    const dbT1 = await prisma.ticket.findUnique({ where: { id: t1.id } });
    const dbT2 = await prisma.ticket.findUnique({ where: { id: t2.id } });
    expect(dbT1!.columnId).toBeNull();
    expect(dbT2!.columnId).toBeNull();

    const detail = sweptAudits[0].detail as { ticketCount: number; ticketIds: string[] };
    expect(detail.ticketCount).toBe(2);
    expect(detail.ticketIds.sort()).toEqual([t1.id, t2.id].sort());
  });

  // T029 (FR-015, FR-016): nothing is deleted, and the project's columns are
  // untouched by the sweep.
  it('T029: nothing is deleted by the sweep, and the project columns are left exactly as they were', async () => {
    const parent = await createTicket({ name: 'P', complexity: 5 });
    const sub = await createTicket({ name: 'S', complexity: 1, parentTicketId: parent.id });
    const label = (
      await request(app).post(`/api/v1/projects/${projectId}/labels`).set(auth).send({ name: 'L' })
    ).body as { id: string };
    const phase = (
      await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Ph' })
    ).body as { id: string };
    await request(app)
      .patch(`/api/v1/tickets/${parent.id}`)
      .set(auth)
      .send({ labelId: label.id, phaseId: phase.id })
      .expect(200);

    await move(sub.id, { targetColumnId: cols[4].id, tokensDelta: 100, timeDelta: 10, llmName: 'claude' });
    const res = await move(parent.id, { targetColumnId: cols[4].id, tokensDelta: 50, timeDelta: 5, llmName: 'claude' });
    expect(res.body.sweep).not.toBeNull();
    expect(res.body.sweep.ticketCount).toBe(2);

    // Nothing deleted or detached: both tickets, their label/phase links,
    // every history row, and their token/time totals all still exist.
    const dbParent = await prisma.ticket.findUnique({ where: { id: parent.id } });
    const dbSub = await prisma.ticket.findUnique({ where: { id: sub.id } });
    expect(dbParent).not.toBeNull();
    expect(dbSub).not.toBeNull();
    expect(dbParent!.labelId).toBe(label.id);
    expect(dbParent!.phaseId).toBe(phase.id);
    expect(dbParent!.tokensConsumed).toBe(50);
    expect(dbSub!.tokensConsumed).toBe(100);
    expect(dbParent!.developmentTimeMinutes).toBe(5);
    expect(dbSub!.developmentTimeMinutes).toBe(10);

    const parentHistory = await prisma.ticketStatusHistory.findMany({ where: { ticketId: parent.id } });
    const subHistory = await prisma.ticketStatusHistory.findMany({ where: { ticketId: sub.id } });
    // one row for the move itself, one for the sweep's exit, each.
    expect(parentHistory).toHaveLength(2);
    expect(subHistory).toHaveLength(2);

    // The project's columns are untouched: same set, same names, same
    // order, and the same column still designated.
    const afterCols = (
      await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth)
    ).body as { id: string; name: string; position: number; isCompletionColumn: boolean }[];
    expect(afterCols.map((c) => ({ id: c.id, name: c.name, position: c.position }))).toEqual(
      cols.map((c) => ({ id: c.id, name: c.name, position: c.position })),
    );
    expect(afterCols.filter((c) => c.isCompletionColumn)).toHaveLength(1);
    expect(afterCols.find((c) => c.isCompletionColumn)!.id).toBe(cols[4].id);
  });

  // T029a (FR-010, SC-009): the guard against the silent failure mode -- a
  // sweep that (wrongly) counts already-completed tickets would simply stop
  // firing after the first batch, with no error anywhere. Three cycles in a
  // row prove it keeps firing.
  it('T029a: sweeps repeat -- three fill-and-sweep cycles in a row', async () => {
    for (let cycle = 1; cycle <= 3; cycle++) {
      const a = await createTicket({ name: `Cycle${cycle}-A`, complexity: 1 });
      const b = await createTicket({ name: `Cycle${cycle}-B`, complexity: 1 });

      const firstMove = await move(a.id, { targetColumnId: cols[4].id });
      expect(firstMove.body.sweep).toBeNull(); // b is still elsewhere

      const secondMove = await move(b.id, { targetColumnId: cols[4].id });
      expect(secondMove.status).toBe(200);
      expect(secondMove.body.sweep).not.toBeNull();
      // Only this cycle's two tickets were swept -- previously completed
      // tickets from earlier cycles neither block the condition nor get
      // reported as swept again.
      expect(secondMove.body.sweep.ticketCount).toBe(2);
      expect(secondMove.body.sweep.ticketIds.sort()).toEqual([a.id, b.id].sort());

      const dbA = await prisma.ticket.findUnique({ where: { id: a.id } });
      const dbB = await prisma.ticket.findUnique({ where: { id: b.id } });
      expect(dbA!.columnId).toBeNull();
      expect(dbB!.columnId).toBeNull();
    }

    const sweptAudits = await prisma.auditLog.findMany({
      where: { entityId: projectId, action: 'board.swept' },
    });
    expect(sweptAudits).toHaveLength(3);
  });

  // T029b (FR-021a, research.md R3): the sweep-vs-delete race. deleteTicket
  // runs in its own transaction and takes no project lock, so the interleave
  // is real. Both orders must be safe.
  describe('T029b: the sweep-vs-delete race', () => {
    it('a ticket deleted before the sweep runs is simply not swept', async () => {
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      const t2 = await createTicket({ name: 'T2', complexity: 1 });

      // t2 sits in the completion column already, but is deleted before the
      // move that would trigger the sweep.
      await move(t2.id, { targetColumnId: cols[4].id });
      await request(app).delete(`/api/v1/tickets/${t2.id}`).set(auth).expect(200);

      const res = await move(t1.id, { targetColumnId: cols[4].id });
      expect(res.status).toBe(200);
      expect(res.body.sweep).not.toBeNull();
      expect(res.body.sweep.ticketCount).toBe(1);
      expect(res.body.sweep.ticketIds).toEqual([t1.id]);

      const gone = await prisma.ticket.findUnique({ where: { id: t2.id } });
      expect(gone).toBeNull();
    });

    it('a ticket swept first still deletes cleanly afterwards', async () => {
      const t1 = await createTicket({ name: 'T1', complexity: 1 });

      const res = await move(t1.id, { targetColumnId: cols[4].id });
      expect(res.body.sweep).not.toBeNull();
      expect(res.body.sweep.ticketIds).toEqual([t1.id]);

      const del = await request(app).delete(`/api/v1/tickets/${t1.id}`).set(auth);
      expect(del.status).toBe(200);
      const gone = await prisma.ticket.findUnique({ where: { id: t1.id } });
      expect(gone).toBeNull();
    });

    it('a concurrent delete and a sweep-triggering move never corrupt the audit accounting', async () => {
      const t1 = await createTicket({ name: 'T1', complexity: 1 });
      const t2 = await createTicket({ name: 'T2', complexity: 1 }); // the racy one
      const t3 = await createTicket({ name: 'T3', complexity: 1 });

      // Put t1 and t2 in the completion column first; t3 stays elsewhere so
      // the board is not yet swept.
      await move(t1.id, { targetColumnId: cols[4].id });
      await move(t2.id, { targetColumnId: cols[4].id });

      // Race: delete t2 (already sitting in the completion column) against
      // the move of t3, which is the one that can trigger the sweep.
      const [delRes, moveRes] = await Promise.all([
        request(app).delete(`/api/v1/tickets/${t2.id}`).set(auth),
        move(t3.id, { targetColumnId: cols[4].id }),
      ]);
      expect(delRes.status).toBe(200);
      expect(moveRes.status).toBe(200);

      // Regardless of interleave order, t2 must be gone by the end, and t1
      // and t3 must always have been swept.
      const dbT1 = await prisma.ticket.findUnique({ where: { id: t1.id } });
      const dbT2 = await prisma.ticket.findUnique({ where: { id: t2.id } });
      const dbT3 = await prisma.ticket.findUnique({ where: { id: t3.id } });
      expect(dbT2).toBeNull();
      expect(dbT1!.columnId).toBeNull();
      expect(dbT3!.columnId).toBeNull();

      // Exactly one sweep occurred (only t3's move could ever trigger one),
      // and its recorded ticketIds describe tickets that were actually taken
      // off the board by the UPDATE -- either {t1, t3} (t2 deleted first) or
      // {t1, t2, t3} (t2 swept first, then deleted) -- never anything else,
      // and never a ticket id that doesn't correspond to a real outcome.
      const sweptAudits = await prisma.auditLog.findMany({
        where: { entityId: projectId, action: 'board.swept' },
      });
      expect(sweptAudits).toHaveLength(1);
      const detail = sweptAudits[0].detail as { ticketCount: number; ticketIds: string[] };
      const ids = [...detail.ticketIds].sort();
      const optionA = [t1.id, t3.id].sort();
      const optionB = [t1.id, t2.id, t3.id].sort();
      expect([JSON.stringify(optionA), JSON.stringify(optionB)]).toContain(JSON.stringify(ids));
      expect(detail.ticketCount).toBe(ids.length);
    });
  });
});
