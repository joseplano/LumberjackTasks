import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app';
import { resetDb, prisma, authHeader } from '../helpers';
import { publishEvent, subscribeEvents, type AppEvent } from '../../src/services/events';

const app = createApp();

describe('GET /api/v1/events', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('rejects a missing or invalid token', async () => {
    await request(app).get('/api/v1/events').expect(401);
    await request(app).get('/api/v1/events?token=not-a-jwt').expect(401);
  });

  it('rejects a valid JWT whose payload lacks sub', async () => {
    const token = jwt.sign({ email: 'nosub@test.com' }, 'test-secret');
    await request(app).get(`/api/v1/events?token=${encodeURIComponent(token)}`).expect(401);
  });

  it('streams published events to an authenticated subscriber', async () => {
    const auth = await authHeader(app);
    const token = auth.Authorization.slice('Bearer '.length);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/events?token=${encodeURIComponent(token)}&projectId=p1`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      publishEvent({ type: 'ticket.created', projectId: 'p1' });
      publishEvent({ type: 'ticket.created', projectId: 'other' }); // filtered out

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!buffer.includes('data:')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      expect(buffer).toContain('"type":"ticket.created"');
      expect(buffer).toContain('"projectId":"p1"');
      expect(buffer).not.toContain('"projectId":"other"');
      await reader.cancel();
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  it('broadcasts events from every project when no projectId filter is given', async () => {
    const auth = await authHeader(app);
    const token = auth.Authorization.slice('Bearer '.length);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/events?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      publishEvent({ type: 'ticket.created', projectId: 'proj-a' });
      publishEvent({ type: 'ticket.created', projectId: 'proj-b' });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!(buffer.includes('"projectId":"proj-a"') && buffer.includes('"projectId":"proj-b"'))) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      expect(buffer).toContain('"projectId":"proj-a"');
      expect(buffer).toContain('"projectId":"proj-b"');
      await reader.cancel();
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  it('publishes events when the API mutates data', async () => {
    const auth = await authHeader(app);
    const events: AppEvent[] = [];
    const unsubscribe = subscribeEvents((e) => events.push(e));
    try {
      const proj = await request(app)
        .post('/api/v1/projects')
        .set(auth)
        .send({ name: 'Realtime' })
        .expect(201);
      const detail = await request(app).get(`/api/v1/projects/${proj.body.id}`).set(auth);
      const ticket = await request(app)
        .post(`/api/v1/projects/${proj.body.id}/tickets`)
        .set(auth)
        .send({ name: 'T1', complexity: 3 })
        .expect(201);
      await request(app)
        .post(`/api/v1/tickets/${ticket.body.id}/move`)
        .set(auth)
        .send({ targetColumnId: detail.body.columns[1].id })
        .expect(200);
      await request(app).delete(`/api/v1/tickets/${ticket.body.id}`).set(auth).expect(200);
    } finally {
      unsubscribe();
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('project.created');
    expect(types).toContain('ticket.created');
    expect(types).toContain('ticket.moved');
    expect(types).toContain('ticket.deleted');
    const created = events.find((e) => e.type === 'ticket.created');
    expect(created?.projectId).toBeTruthy();
  });

  // T030 (FR-022): exactly one project-scoped board.swept event per sweep,
  // not one per swept ticket.
  it('emits exactly one board.swept event per sweep, not one per ticket', async () => {
    const auth = await authHeader(app);
    const proj = await request(app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'SweepEvents' })
      .expect(201);
    const projectId = proj.body.id;
    const cols = (
      await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth)
    ).body as { id: string; name: string }[];
    await request(app)
      .patch(`/api/v1/projects/${projectId}/columns/${cols[4].id}`)
      .set(auth)
      .send({ isCompletionColumn: true })
      .expect(200);

    const mkTicket = async (name: string) =>
      (
        await request(app)
          .post(`/api/v1/projects/${projectId}/tickets`)
          .set(auth)
          .send({ name, complexity: 1 })
          .expect(201)
      ).body as { id: string };
    const t1 = await mkTicket('T1');
    const t2 = await mkTicket('T2');
    const t3 = await mkTicket('T3');

    const events: AppEvent[] = [];
    const unsubscribe = subscribeEvents((e) => events.push(e));
    try {
      await request(app)
        .post(`/api/v1/tickets/${t1.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id })
        .expect(200);
      await request(app)
        .post(`/api/v1/tickets/${t2.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id })
        .expect(200);
      const last = await request(app)
        .post(`/api/v1/tickets/${t3.id}/move`)
        .set(auth)
        .send({ targetColumnId: cols[4].id })
        .expect(200);
      expect(last.body.sweep).not.toBeNull();
      expect(last.body.sweep.ticketCount).toBe(3);
    } finally {
      unsubscribe();
    }

    const sweptEvents = events.filter((e) => e.type === 'board.swept');
    expect(sweptEvents).toHaveLength(1);
    expect(sweptEvents[0].projectId).toBe(projectId);
  });
});
