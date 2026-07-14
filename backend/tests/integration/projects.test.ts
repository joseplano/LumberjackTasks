import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };

describe('projects', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
  });

  it('creates a project with generated code and default columns', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Anima Machina', description: 'demo', gitRepoUrl: 'https://git/x.git' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('ANIM-000001');
    const cols = await prisma.kanbanColumn.findMany({
      where: { projectId: res.body.id },
      orderBy: { position: 'asc' },
    });
    expect(cols.map((c) => c.name)).toEqual([
      'TODO',
      'In development',
      'In testing',
      'In Human review',
      'Done',
      'Committed',
    ]);
  });

  it('increments the global sequence across projects with same initials', async () => {
    const a = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Anima Machina' });
    const b = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Animal Farm' });
    expect(a.body.code).toBe('ANIM-000001');
    expect(b.body.code).toBe('ANIM-000002');
  });

  it('rejects a project without name', async () => {
    const res = await request(app).post('/api/v1/projects').set(auth).send({ description: 'x' });
    expect(res.status).toBe(400);
  });

  it('lists and searches projects by name and code', async () => {
    await request(app).post('/api/v1/projects').set(auth).send({ name: 'Anima Machina' });
    await request(app).post('/api/v1/projects').set(auth).send({ name: 'Zeta' });
    const byName = await request(app).get('/api/v1/projects?search=anima').set(auth);
    expect(byName.body).toHaveLength(1);
    const byCode = await request(app).get('/api/v1/projects?search=ZETA-').set(auth);
    expect(byCode.body).toHaveLength(1);
    expect(byCode.body[0].name).toBe('Zeta');
  });

  it('renames a project', async () => {
    const created = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Old' });
    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.id}`)
      .set(auth)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.code).toBe(created.body.code); // code never changes
  });

  it('deletes a project and writes audit entries', async () => {
    const created = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Doomed' });
    const res = await request(app).delete(`/api/v1/projects/${created.body.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(await prisma.project.findUnique({ where: { id: created.body.id } })).toBeNull();
    const audits = await prisma.auditLog.findMany();
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['project.created', 'project.deleted']),
    );
  });

  it('404s on unknown project', async () => {
    const res = await request(app).get('/api/v1/projects/no-such-id').set(auth);
    expect(res.status).toBe(404);
  });

  it('404s updating or deleting a nonexistent project', async () => {
    const updated = await request(app)
      .patch('/api/v1/projects/no-such-id')
      .set(auth)
      .send({ name: 'X' });
    expect(updated.status).toBe(404);
    const deleted = await request(app).delete('/api/v1/projects/no-such-id').set(auth);
    expect(deleted.status).toBe(404);
  });

  it('rejects an empty name on update', async () => {
    const created = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Keep' });
    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.id}`)
      .set(auth)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
