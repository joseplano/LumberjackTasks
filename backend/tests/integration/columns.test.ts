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
});
