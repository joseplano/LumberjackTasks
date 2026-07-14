import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader } from '../helpers';
import { prisma } from '../../src/db';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;
let ids: Record<string, string>;
const topLevelCount = 4;

describe('backlog', () => {
  // This fixture is deliberately adversarial: it exists to prove that
  // `{ phase: { position: 'asc' } }` is load-bearing as the *primary* orderBy
  // key in getBacklog(). If that key were ever dropped (leaving only the
  // secondary `sort(order)` key), Alpha's two top-level tickets would no
  // longer be adjacent -- for every single sortable field (id/number, name,
  // description, status, label) a Beta-phase ticket ("Beta Straddle") has a
  // value that falls strictly between Alpha's two ticket values. That forces
  // the backlog's grouping loop to split Alpha into two separate group
  // entries, which breaks both the contiguity test and every per-field sort
  // test below.
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;

    const alpha = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/phases`)
        .set(auth)
        .send({ name: 'Alpha' })
    ).body as { id: string };
    const beta = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/phases`)
        .set(auth)
        .send({ name: 'Beta' })
    ).body as { id: string };

    const mkTicket = async (
      name: string,
      description: string,
      opts: { phaseId?: string; parentTicketId?: string } = {},
    ) =>
      (
        await request(app)
          .post(`/api/v1/projects/${projectId}/tickets`)
          .set(auth)
          .send({ name, description, complexity: 1, ...opts })
      ).body as { id: string };

    ids = {};

    // Phase Alpha (position 0), ticket #1: "Charlie Parent" -- lexically
    // and numerically the *smallest* of Alpha's two top-level tickets.
    // Carries 2 subtasks (for the nesting/total tests).
    const alphaParent = await mkTicket('Charlie Parent', 'zzz-has-subtasks-desc', {
      phaseId: alpha.id,
    });
    ids.alphaParent = alphaParent.id;

    // Phase Beta (position 1), ticket #2 -- created BEFORE Alpha's second
    // top-level ticket so ticket `number` (the default sortBy=id) does NOT
    // coincide with phase order. Its name ("Mike"), description ("mmm-..."),
    // and (once moved/labeled in the relevant tests) status and label all
    // sit strictly between Alpha's two tickets' values.
    const betaStraddle = await mkTicket('Mike Straddle', 'mmm-beta-desc', { phaseId: beta.id });
    ids.betaStraddle = betaStraddle.id;

    // Subtasks of Alpha Parent -- numbers 3 and 4.
    await mkTicket('Charlie Sub One', 'sub one', { parentTicketId: alphaParent.id });
    await mkTicket('Charlie Sub Two', 'sub two', { parentTicketId: alphaParent.id });

    // Phase Alpha, ticket #5: "Sierra Solo" -- Alpha's second top-level
    // ticket, no subtasks. Its name/description/id are all lexically greater
    // than Beta Straddle's, so Beta Straddle straddles the two Alpha values
    // on every field.
    const alphaSolo = await mkTicket('Sierra Solo', 'no subtasks', { phaseId: alpha.id });
    ids.alphaSolo = alphaSolo.id;

    // No phase, ticket #6.
    const unphased = await mkTicket('Whiskey Unphased', 'no phase');
    ids.unphased = unphased.id;
  });

  it('groups tickets by phase, ordering phases by position and No phase last', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/backlog`).set(auth);
    expect(res.status).toBe(200);
    const names = res.body.groups.map((g: { phase: { name: string } | null }) => g.phase?.name ?? null);
    expect(names).toEqual(['Alpha', 'Beta', null]); // Alpha position 0, Beta 1, unassigned last
  });

  it('nests subtasks under their parent and excludes them from total and pageSize', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?pageSize=1`)
      .set(auth);
    const [group] = res.body.groups;
    expect(group.tickets).toHaveLength(1);
    expect(group.tickets[0].subtasks.length).toBeGreaterThan(0);
    // total counts top-level tickets only
    expect(res.body.total).toBe(topLevelCount);
  });

  it('keeps groups contiguous when a secondary sort is applied', async () => {
    // Descending by name: Whiskey Unphased > Sierra Solo > Mike Straddle >
    // Charlie Parent. Without the primary phase key this order would
    // interleave Beta and null between Alpha's two tickets, splitting Alpha
    // into two separate groups and duplicating its phase id in `phaseIds`.
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?sortBy=name&order=desc`)
      .set(auth);
    const phaseIds = res.body.groups.map((g: { phase: { id: string } | null }) => g.phase?.id ?? null);
    expect(new Set(phaseIds).size).toBe(phaseIds.length); // no phase appears twice
  });

  it('still rejects an unknown sortBy and 404s an unknown project', async () => {
    expect(
      (await request(app).get(`/api/v1/projects/${projectId}/backlog?sortBy=bogus`).set(auth))
        .status,
    ).toBe(400);
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await request(app).get(`/api/v1/projects/${missing}/backlog`).set(auth)).status).toBe(
      404,
    );
  });

  it('clamps pageSize to 200 and page to at least 1', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?page=0&pageSize=999`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(200);
    expect(res.body.total).toBe(topLevelCount);
  });

  it('sorts by ticket number (id) by default', async () => {
    // Charlie Parent is ticket #1, Sierra Solo is ticket #5; Beta Straddle
    // (#2) and the subtasks (#3, #4) sit numerically between them, so this
    // only comes out contiguous because phase is the primary sort key.
    const res = await request(app).get(`/api/v1/projects/${projectId}/backlog`).set(auth);
    expect(res.status).toBe(200);
    const g = res.body.groups.find((gr: { phase: { name: string } | null }) => gr.phase?.name === 'Alpha');
    expect(g.tickets.map((t: { name: string }) => t.name)).toEqual(['Charlie Parent', 'Sierra Solo']);
  });

  it('sorts by description', async () => {
    // Sierra Solo's description ('no subtasks') sorts before Charlie
    // Parent's ('zzz-has-subtasks-desc') by default id order too, so swap
    // Sierra Solo's description to something that sorts first to prove
    // sortBy=description is actually being applied (and not just falling
    // back to id order). Beta Straddle's description ('mmm-beta-desc') sits
    // strictly between 'aaa-comes-first' and 'zzz-has-subtasks-desc'.
    await request(app)
      .patch(`/api/v1/tickets/${ids.alphaSolo}`)
      .set(auth)
      .send({ description: 'aaa-comes-first' })
      .expect(200);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?sortBy=description`)
      .set(auth);
    expect(res.status).toBe(200);
    const g = res.body.groups.find((gr: { phase: { name: string } | null }) => gr.phase?.name === 'Alpha');
    expect(g.tickets.map((t: { name: string }) => t.name)).toEqual(['Sierra Solo', 'Charlie Parent']);
  });

  it('sorts by status (column name)', async () => {
    const cols = (await request(app).get(`/api/v1/projects/${projectId}/columns`).set(auth)).body as {
      id: string;
      name: string;
    }[];
    // Sierra Solo has no subtasks, so it can freely move forward without
    // tripping the parent-move-blocked rule. Move it into "In development",
    // which sorts before "TODO" alphabetically. Move Beta Straddle into "In
    // testing", which sorts strictly between "In development" and "TODO" --
    // straddling Alpha's two statuses.
    await request(app)
      .post(`/api/v1/tickets/${ids.alphaSolo}/move`)
      .set(auth)
      .send({ targetColumnId: cols[1].id })
      .expect(200);
    await request(app)
      .post(`/api/v1/tickets/${ids.betaStraddle}/move`)
      .set(auth)
      .send({ targetColumnId: cols[2].id })
      .expect(200);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?sortBy=status`)
      .set(auth);
    expect(res.status).toBe(200);
    const g = res.body.groups.find((gr: { phase: { name: string } | null }) => gr.phase?.name === 'Alpha');
    expect(g.tickets[0]).toMatchObject({ name: 'Sierra Solo', status: 'In development' });
    expect(g.tickets[1]).toMatchObject({ name: 'Charlie Parent', status: 'TODO' });
  });

  it('sorts by label name, with nulls sorting last on ASC', async () => {
    const label = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/labels`)
        .set(auth)
        .send({ name: 'aaa' })
    ).body as { id: string };
    await request(app)
      .patch(`/api/v1/tickets/${ids.alphaSolo}`)
      .set(auth)
      .send({ labelId: label.id })
      .expect(200);
    // Give Beta Straddle a non-null label too ('bbb'). Non-null labels always
    // sort before null on ASC, so Beta Straddle ends up strictly between
    // Sierra Solo ('aaa') and Charlie Parent's null label in the unfiltered
    // sort order.
    const label2 = (
      await request(app)
        .post(`/api/v1/projects/${projectId}/labels`)
        .set(auth)
        .send({ name: 'bbb' })
    ).body as { id: string };
    await request(app)
      .patch(`/api/v1/tickets/${ids.betaStraddle}`)
      .set(auth)
      .send({ labelId: label2.id })
      .expect(200);
    // Charlie Parent keeps its null label.
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?sortBy=label`)
      .set(auth);
    expect(res.status).toBe(200);
    const g = res.body.groups.find((gr: { phase: { name: string } | null }) => gr.phase?.name === 'Alpha');
    expect(g.tickets.map((t: { name: string }) => t.name)).toEqual(['Sierra Solo', 'Charlie Parent']);
    expect(g.tickets[0].label).toBe('aaa');
    expect(g.tickets[1].label).toBeNull();
  });

  it('paginates', async () => {
    const page1 = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?page=1&pageSize=1`)
      .set(auth);
    const page2 = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?page=2&pageSize=1`)
      .set(auth);
    const namesOf = (res: typeof page1) =>
      res.body.groups.flatMap((gr: { tickets: { name: string }[] }) =>
        gr.tickets.map((t) => t.name),
      );
    const page1Names = namesOf(page1);
    const page2Names = namesOf(page2);
    expect(page1Names).toHaveLength(1);
    expect(page2Names).toHaveLength(1);
    expect(page1Names).not.toEqual(page2Names);
    expect(page1.body.page).toBe(1);
    expect(page2.body.page).toBe(2);
    // total counts top-level tickets only; subtasks must not inflate it.
    expect(page1.body.total).toBe(topLevelCount);
    expect(page2.body.total).toBe(topLevelCount);
  });

  it('merges a phase into one group even if two phases share a position', async () => {
    // Independent project so the phase positions here are fully controlled
    // and don't interact with the Alpha/Beta fixture above.
    const proj = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Collision' });
    const pid = proj.body.id;
    const a = (await request(app).post(`/api/v1/projects/${pid}/phases`).set(auth).send({ name: 'A' })).body as {
      id: string;
    };
    const b = (await request(app).post(`/api/v1/projects/${pid}/phases`).set(auth).send({ name: 'B' })).body as {
      id: string;
    };

    // Force a position collision, as two concurrent createPhase calls could
    // under READ COMMITTED (both read the same _max.position and insert
    // equal positions).
    await prisma.phase.update({ where: { id: b.id }, data: { position: 0 } });

    const mk = async (name: string, phaseId: string) =>
      (
        await request(app)
          .post(`/api/v1/projects/${pid}/tickets`)
          .set(auth)
          .send({ name, description: '', complexity: 1, phaseId })
          .expect(201)
      ).body as { id: string };

    // Ticket numbers are assigned in creation order, and with equal phase
    // positions the secondary sort key (ticket number, the default
    // sortBy=id) determines row order -- creating A, then B, then A again
    // forces the interleave A/B/A that a last-group-only comparison cannot
    // merge back together.
    const a1 = await mk('Ant One', a.id);
    const b1 = await mk('Bee One', b.id);
    const a2 = await mk('Ant Two', a.id);
    void b1;

    const res = await request(app).get(`/api/v1/projects/${pid}/backlog`).set(auth);
    expect(res.status).toBe(200);
    const groups = res.body.groups as { phase: { id: string } | null; tickets: { id: string }[] }[];
    const ids = groups.map((g) => g.phase?.id ?? null);
    expect(new Set(ids).size).toBe(ids.length);

    const groupA = groups.find((g) => g.phase?.id === a.id)!;
    expect(groupA.tickets.map((t) => t.id).sort()).toEqual([a1.id, a2.id].sort());
  });

  it('truncates a fractional page instead of erroring', async () => {
    // 1.9 truncates to 1 (not rounds to 2), proving Math.trunc semantics.
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/backlog?page=1.9&pageSize=1`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    const names = res.body.groups.flatMap((gr: { tickets: { name: string }[] }) =>
      gr.tickets.map((t) => t.name),
    );
    expect(names).toEqual(['Charlie Parent']);
  });
});
