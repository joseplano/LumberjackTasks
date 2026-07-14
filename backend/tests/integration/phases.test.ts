import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader } from '../helpers';
import { subscribeEvents, type AppEvent } from '../../src/services/events';

const app = createApp();

describe('phases', () => {
  let auth: Record<string, string>;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Phased' });
    projectId = p.body.id;
  });

  it('creates phases appended at the end and lists them by position', async () => {
    const a = await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' });
    const b = await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Reports' });
    expect(a.status).toBe(201);
    expect(a.body.position).toBe(0);
    expect(b.body.position).toBe(1);

    const list = await request(app).get(`/api/v1/projects/${projectId}/phases`).set(auth);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Auth', 'Reports']);
  });

  it('appends a new phase after a gap left by a deleted phase (position, not count)', async () => {
    const a = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'A' })).body;
    const b = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'B' })).body;

    await request(app).delete(`/api/v1/projects/${projectId}/phases/${a.id}`).set(auth);

    const c = await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'C' });
    expect(c.status).toBe(201);
    expect(c.body.position).toBeGreaterThan(b.position);
    expect(c.body.position).toBe(2);

    const list = await request(app).get(`/api/v1/projects/${projectId}/phases`).set(auth);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['B', 'C']);
  });

  it('rejects an empty name on create and on update', async () => {
    const bad = await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: '  ' });
    expect(bad.status).toBe(400);

    const p = await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' });
    const upd = await request(app)
      .patch(`/api/v1/projects/${projectId}/phases/${p.body.id}`)
      .set(auth)
      .send({ name: '' });
    expect(upd.status).toBe(400);
  });

  it('404s on update and delete of an unknown phase', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await request(app).patch(`/api/v1/projects/${projectId}/phases/${missing}`).set(auth).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/projects/${projectId}/phases/${missing}`).set(auth)).status).toBe(404);
  });

  it('reorders phases and rejects a wrong id set', async () => {
    const a = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'A' })).body;
    const b = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'B' })).body;

    const ok = await request(app).put(`/api/v1/projects/${projectId}/phases/order`).set(auth).send({ orderedIds: [b.id, a.id] });
    expect(ok.status).toBe(200);
    expect(ok.body.map((p: { name: string }) => p.name)).toEqual(['B', 'A']);

    const bad = await request(app).put(`/api/v1/projects/${projectId}/phases/order`).set(auth).send({ orderedIds: [a.id] });
    expect(bad.status).toBe(400);
  });

  it('blocks deleting a phase with tickets unless forced, and force unassigns without deleting', async () => {
    const phase = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' })).body;
    const ticket = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/tickets`)
        .set(auth)
        .send({ name: 'Login', complexity: 3, phaseId: phase.id })
    ).body;

    const blocked = await request(app).delete(`/api/v1/projects/${projectId}/phases/${phase.id}`).set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PHASE_NOT_EMPTY');

    const forced = await request(app).delete(`/api/v1/projects/${projectId}/phases/${phase.id}?force=true`).set(auth);
    expect(forced.status).toBe(200);

    const survivor = await request(app).get(`/api/v1/tickets/${ticket.id}`).set(auth);
    expect(survivor.status).toBe(200);
    expect(survivor.body.phaseId).toBeNull();
  });

  it('deletes an empty phase without force', async () => {
    const phase = (await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Empty' })).body;
    expect((await request(app).delete(`/api/v1/projects/${projectId}/phases/${phase.id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/v1/projects/${projectId}/phases`).set(auth)).body).toHaveLength(0);
  });

  describe('events contract', () => {
    let events: AppEvent[];
    let unsubscribe: () => void;

    beforeEach(() => {
      events = [];
      unsubscribe = subscribeEvents((e) => events.push(e));
    });

    afterEach(() => {
      unsubscribe();
    });

    it('publishes phases.changed with the right projectId on create, update, reorder and delete', async () => {
      const a = await request(app)
        .post(`/api/v1/projects/${projectId}/phases`)
        .set(auth)
        .send({ name: 'A' })
        .expect(201);
      const b = await request(app)
        .post(`/api/v1/projects/${projectId}/phases`)
        .set(auth)
        .send({ name: 'B' })
        .expect(201);
      await request(app)
        .patch(`/api/v1/projects/${projectId}/phases/${a.body.id}`)
        .set(auth)
        .send({ name: 'A2' })
        .expect(200);
      await request(app)
        .put(`/api/v1/projects/${projectId}/phases/order`)
        .set(auth)
        .send({ orderedIds: [b.body.id, a.body.id] })
        .expect(200);
      await request(app)
        .delete(`/api/v1/projects/${projectId}/phases/${a.body.id}`)
        .set(auth)
        .expect(200);

      const changed = events.filter((e) => e.type === 'phases.changed');
      // create x2, update x1, reorder x1, delete x1
      expect(changed.length).toBe(5);
      for (const e of changed) {
        expect(e.projectId).toBe(projectId);
      }
    });

    it('publishes phases.changed and exactly N ticket.updated events on a forced delete of a phase with N tickets', async () => {
      const phase = (
        await request(app).post(`/api/v1/projects/${projectId}/phases`).set(auth).send({ name: 'Auth' })
      ).body as { id: string };
      const t1 = (
        await request(app)
          .post(`/api/v1/projects/${projectId}/tickets`)
          .set(auth)
          .send({ name: 'T1', complexity: 1, phaseId: phase.id })
      ).body as { id: string };
      const t2 = (
        await request(app)
          .post(`/api/v1/projects/${projectId}/tickets`)
          .set(auth)
          .send({ name: 'T2', complexity: 1, phaseId: phase.id })
      ).body as { id: string };

      events = []; // drop the create events from phase/ticket setup above

      await request(app)
        .delete(`/api/v1/projects/${projectId}/phases/${phase.id}?force=true`)
        .set(auth)
        .expect(200);

      const changed = events.filter((e) => e.type === 'phases.changed');
      expect(changed).toHaveLength(1);
      expect(changed[0].projectId).toBe(projectId);
      expect(changed[0].entityId).toBe(phase.id);

      const ticketUpdated = events.filter((e) => e.type === 'ticket.updated');
      expect(ticketUpdated).toHaveLength(2);
      const updatedIds = ticketUpdated.map((e) => e.entityId).sort();
      expect(updatedIds).toEqual([t1.id, t2.id].sort());
      for (const e of ticketUpdated) {
        expect(e.projectId).toBe(projectId);
      }
    });
  });
});
