import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

describe('labels', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
  });

  it('creates, updates and lists labels', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ name: 'bug', color: '#ff0000' });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch(`/api/v1/projects/${projectId}/labels/${created.body.id}`)
      .set(auth)
      .send({ name: 'defect' });
    expect(updated.body.name).toBe('defect');

    const list = await request(app).get(`/api/v1/projects/${projectId}/labels`).set(auth);
    expect(list.body).toHaveLength(1);
  });

  it('rejects a label without name', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ color: '#fff' });
    expect(res.status).toBe(400);
  });

  it('deletes an unused label directly', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ name: 'tmp' });
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/${created.body.id}`)
      .set(auth);
    expect(res.status).toBe(200);
  });

  it('requires force to delete a used label, then clears it from tickets', async () => {
    const label = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ name: 'used' });
    const col = await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId } });
    const ticket = await prisma.ticket.create({
      data: {
        projectId,
        number: 1,
        name: 'T',
        columnId: col.id,
        complexity: 1,
        labelId: label.body.id,
      },
    });

    const blocked = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/${label.body.id}`)
      .set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LABEL_IN_USE');

    const forced = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/${label.body.id}?force=true`)
      .set(auth);
    expect(forced.status).toBe(200);
    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(after!.labelId).toBeNull();
  });

  it('404s updating or deleting a nonexistent label', async () => {
    const updated = await request(app)
      .patch(`/api/v1/projects/${projectId}/labels/no-such-id`)
      .set(auth)
      .send({ name: 'X' });
    expect(updated.status).toBe(404);
    const deleted = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/no-such-id`)
      .set(auth);
    expect(deleted.status).toBe(404);
  });

  it('rejects an empty name on update', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set(auth)
      .send({ name: 'keep' });
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/labels/${created.body.id}`)
      .set(auth)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
