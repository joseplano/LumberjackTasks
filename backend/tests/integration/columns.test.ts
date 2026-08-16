import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

async function getColumns() {
  const res = await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth);
  return res.body as { id: string; name: string; position: number }[];
}

describe('kanban columns', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
  });

  it('lists default columns in order', async () => {
    const cols = await getColumns();
    expect(cols.map((c) => c.name)).toEqual([
      'TODO',
      'In development',
      'In testing',
      'In Human review',
      'Done',
      'Committed',
    ]);
  });

  it('creates a column at the end', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/columns`)
      .set(auth)
      .send({ name: 'Blocked' });
    expect(res.status).toBe(201);
    const cols = await getColumns();
    expect(cols[cols.length - 1].name).toBe('Blocked');
  });

  it('renames a column', async () => {
    const [first] = await getColumns();
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${first.id}`)
      .set(auth)
      .send({ name: 'Backlog' });
    expect(res.status).toBe(200);
    expect((await getColumns())[0].name).toBe('Backlog');
  });

  it('reorders columns', async () => {
    const cols = await getColumns();
    const reversed = [...cols].reverse().map((c) => c.id);
    const res = await request(app)
      .put(`/api/v1/projects/${projectId}/columns/order`)
      .set(auth)
      .send({ orderedIds: reversed });
    expect(res.status).toBe(200);
    expect((await getColumns()).map((c) => c.name)[0]).toBe('Committed');
  });

  it('rejects reorder with wrong id set', async () => {
    const res = await request(app)
      .put(`/api/v1/projects/${projectId}/columns/order`)
      .set(auth)
      .send({ orderedIds: ['bogus'] });
    expect(res.status).toBe(400);
  });

  it('rejects reorder when orderedIds is not an array', async () => {
    const res = await request(app)
      .put(`/api/v1/projects/${projectId}/columns/order`)
      .set(auth)
      .send({ orderedIds: 'abc' });
    expect(res.status).toBe(400);
  });

  it('deletes an empty column', async () => {
    const cols = await getColumns();
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[5].id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(await getColumns()).toHaveLength(5);
  });

  it('blocks deleting a column with tickets unless moveTo is given', async () => {
    const cols = await getColumns();
    await prisma.ticket.create({
      data: { projectId, number: 1, name: 'T', columnId: cols[0].id, complexity: 1 },
    });
    const blocked = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[0].id}`)
      .set(auth);
    expect(blocked.status).toBe(409);

    const moved = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[0].id}?moveTo=${cols[1].id}`)
      .set(auth);
    expect(moved.status).toBe(200);
    const ticket = await prisma.ticket.findFirst({ where: { projectId } });
    expect(ticket!.columnId).toBe(cols[1].id);
  });

  it('rejects an invalid moveTo even when the column is empty', async () => {
    const cols = await getColumns();
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[5].id}?moveTo=bogus-id`)
      .set(auth);
    expect(res.status).toBe(400);
    expect(await getColumns()).toHaveLength(6);
  });

  it('404s renaming or deleting a nonexistent column', async () => {
    const rename = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/no-such-id`)
      .set(auth)
      .send({ name: 'X' });
    expect(rename.status).toBe(404);
    const del = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/no-such-id`)
      .set(auth);
    expect(del.status).toBe(404);
  });

  it('rejects an empty name on create and rename', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/columns`)
      .set(auth)
      .send({ name: '   ' });
    expect(created.status).toBe(400);
    const [first] = await getColumns();
    const renamed = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${first.id}`)
      .set(auth)
      .send({ name: '' });
    expect(renamed.status).toBe(400);
  });

  it('rejects deleting a column with moveTo pointing at itself', async () => {
    const cols = await getColumns();
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[5].id}?moveTo=${cols[5].id}`)
      .set(auth);
    expect(res.status).toBe(400);
    expect(await getColumns()).toHaveLength(6);
  });

  // T016 (FR-001, FR-003, FR-004): set, clear, and always-present listing field.
  it('T016: designates and clears the completion column; isCompletionColumn is always present and boolean', async () => {
    const before = await getColumns();
    for (const c of before as unknown as { isCompletionColumn: boolean }[]) {
      expect(typeof c.isCompletionColumn).toBe('boolean');
    }

    const cols = before;
    const setRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(setRes.status).toBe(200);
    expect(setRes.body.isCompletionColumn).toBe(true);

    const afterSet = (await getColumns()) as unknown as { id: string; isCompletionColumn: boolean }[];
    expect(afterSet.find((c) => c.id === cols[4].id)!.isCompletionColumn).toBe(true);
    expect(afterSet.filter((c) => c.isCompletionColumn)).toHaveLength(1);
    for (const c of afterSet) {
      expect(typeof c.isCompletionColumn).toBe('boolean');
    }

    const clearRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: false });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.isCompletionColumn).toBe(false);

    const afterClear = (await getColumns()) as unknown as { isCompletionColumn: boolean }[];
    expect(afterClear.some((c) => c.isCompletionColumn)).toBe(false);
  });

  // T017 (FR-002): designating a second column clears the first, atomically, in one operation.
  it('T017: designating a second column clears the first, with exactly one designated afterward', async () => {
    const cols = await getColumns();
    const first = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[0].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[1].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(second.status).toBe(200);
    expect(second.body.isCompletionColumn).toBe(true);

    const after = (await getColumns()) as unknown as { id: string; isCompletionColumn: boolean }[];
    const designated = after.filter((c) => c.isCompletionColumn);
    expect(designated).toHaveLength(1);
    expect(designated[0].id).toBe(cols[1].id);
  });

  // T018 (research.md R2): the tripwire.
  //
  // This test guards the partial unique index
  // `kanban_columns_projectId_completion_key`, defined only in
  // backend/prisma/migrations/20260816_completion_column_sweep/migration.sql
  // (Prisma's schema language cannot express a filtered/partial unique index, so
  // it does not appear in schema.prisma). Under PostgreSQL READ COMMITTED, the
  // application-level "clear other designated columns, then set this one" inside
  // a single transaction is NOT sufficient by itself to prevent two concurrent
  // requests from each clearing-then-setting a *different* column and both
  // committing successfully -- that would leave two designated columns at once.
  // It is the database-level partial unique index that makes one of the two
  // transactions fail instead. If this test ever starts failing because more
  // than one column ends up designated, DO NOT edit this test to "fix" it: the
  // index `kanban_columns_projectId_completion_key` has almost certainly been
  // dropped or regenerated as non-partial (e.g. by a `prisma migrate dev` that
  // tried to express it as a plain @@unique). Restore the index instead.
  it('T018: two concurrent designations on the same project cannot both succeed', async () => {
    const cols = await getColumns();
    const results = await Promise.allSettled([
      request(app)
        .patch(`/api/v1/projects/${projectId}/columns/${cols[0].id}`)
        .set(auth)
        .send({ isCompletionColumn: true }),
      request(app)
        .patch(`/api/v1/projects/${projectId}/columns/${cols[1].id}`)
        .set(auth)
        .send({ isCompletionColumn: true }),
    ]);

    // Neither request should blow up with an unmapped 500 -- either it succeeds
    // (200) or it loses the race and is told to retry (409 COMPLETION_COLUMN_CONFLICT).
    let successCount = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        expect([200, 409]).toContain(r.value.status);
        if (r.value.status === 200) successCount++;
      }
    }
    // At least one of the two must have actually won the race and been designated --
    // otherwise a `designated.length === 1` check below could be satisfied by both
    // requests spuriously failing, which is not the property this test guards.
    expect(successCount).toBeGreaterThanOrEqual(1);

    const after = (await getColumns()) as unknown as { isCompletionColumn: boolean }[];
    const designated = after.filter((c) => c.isCompletionColumn);
    // Exactly one, not merely "at most one" -- zero would also (wrongly) satisfy a
    // <= 1 check if both requests spuriously failed instead of one losing the race.
    expect(designated).toHaveLength(1);
  });

  // Deterministic half of the T018 tripwire. The concurrency test above is
  // behavioral/probabilistic: its soundness depends on the two HTTP requests
  // actually achieving concurrent DB-level execution, which this test environment
  // does not guarantee. If PostgreSQL happened to fully serialize the two
  // transactions, the app-level clear-then-set alone would satisfy the assertion
  // above even with the partial unique index dropped, and the test would pass for
  // the wrong reason. This test instead queries the Postgres system catalog
  // directly and asserts the index `kanban_columns_projectId_completion_key`
  // exists and is still a *partial* unique index (not just any unique index) --
  // so both a full drop and a regeneration into a plain, non-partial unique index
  // (e.g. from a future `prisma migrate dev` expressing this as `@@unique` in
  // schema.prisma) fail this test unmistakably. Both halves must stay.
  it('T018b: the partial unique index kanban_columns_projectId_completion_key exists and is still partial', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'kanban_columns'
        AND indexname = 'kanban_columns_projectId_completion_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef).toMatch(/WHERE.*"isCompletionColumn"/);
  });

  // T019 (FR-005, FR-006): designation survives rename and reorder; dies with the column.
  it('T019: deleting the designated column clears the designation without transferring it', async () => {
    const cols = await getColumns();
    const designate = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[5].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(designate.status).toBe(200);

    const del = await request(app)
      .delete(`/api/v1/projects/${projectId}/columns/${cols[5].id}`)
      .set(auth);
    expect(del.status).toBe(200);

    const after = (await getColumns()) as unknown as { isCompletionColumn: boolean }[];
    expect(after.some((c) => c.isCompletionColumn)).toBe(false);
  });

  it('T019: renaming the designated column preserves isCompletionColumn: true', async () => {
    const cols = await getColumns();
    const designate = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(designate.status).toBe(200);

    const renamed = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ name: 'Finished' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Finished');
    expect(renamed.body.isCompletionColumn).toBe(true);
  });

  it('T019: reordering columns preserves the designation independent of position', async () => {
    const cols = await getColumns();
    const designate = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true });
    expect(designate.status).toBe(200);

    const reversed = [...cols].reverse().map((c) => c.id);
    const reorder = await request(app)
      .put(`/api/v1/projects/${projectId}/columns/order`)
      .set(auth)
      .send({ orderedIds: reversed });
    expect(reorder.status).toBe(200);

    const after = (await getColumns()) as unknown as { id: string; isCompletionColumn: boolean }[];
    const designated = after.filter((c) => c.isCompletionColumn);
    expect(designated).toHaveLength(1);
    expect(designated[0].id).toBe(cols[4].id);
  });

  // Additional PATCH validation required by contracts/http-api.md §2, not separately
  // task-numbered but covering "every behavior change ships with tests".
  it('PATCH rejects the request when neither name nor isCompletionColumn is present', async () => {
    const [first] = await getColumns();
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${first.id}`)
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toBe('name or isCompletionColumn is required');
  });

  it('PATCH rejects a non-boolean isCompletionColumn', async () => {
    const [first] = await getColumns();
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${first.id}`)
      .set(auth)
      .send({ isCompletionColumn: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('PATCH applies name and isCompletionColumn together in one call', async () => {
    const cols = await getColumns();
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[3].id}`)
      .set(auth)
      .send({ name: 'Review', isCompletionColumn: true });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Review');
    expect(res.body.isCompletionColumn).toBe(true);
  });
});
