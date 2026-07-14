import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';

const SORTS: Record<string, (order: 'asc' | 'desc') => Prisma.TicketOrderByWithRelationInput> = {
  id: (order) => ({ number: order }),
  name: (order) => ({ name: order }),
  description: (order) => ({ description: order }),
  status: (order) => ({ column: { name: order } }),
  label: (order) => ({ label: { name: order } }),
};

type TicketRow = Prisma.TicketGetPayload<{ include: { column: true; label: true } }>;

interface BacklogItem {
  id: string;
  number: number;
  name: string;
  description: string;
  complexity: number;
  parentTicketId: string | null;
  status: string;
  label: string | null;
  subtasks: BacklogItem[];
}

function toItem(t: TicketRow, subtasks: BacklogItem[] = []): BacklogItem {
  return {
    id: t.id,
    number: t.number,
    name: t.name,
    description: t.description,
    complexity: t.complexity,
    parentTicketId: t.parentTicketId,
    status: t.column.name,
    label: t.label?.name ?? null,
    subtasks,
  };
}

export async function getBacklog(
  projectId: string,
  opts: { sortBy?: string; order?: string; page?: string; pageSize?: string },
) {
  await getProject(projectId);
  const sortBy = opts.sortBy ?? 'id';
  const order: 'asc' | 'desc' = opts.order === 'desc' ? 'desc' : 'asc';
  const sort = SORTS[sortBy];
  if (!sort) {
    throw new ApiError(400, 'VALIDATION', `sortBy must be one of ${Object.keys(SORTS).join(', ')}`);
  }
  const page = Math.max(1, Math.trunc(Number(opts.page ?? 1) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(opts.pageSize ?? 50) || 50)));

  // Only top-level tickets paginate. Phase is the primary sort key so that a
  // group is never split across two pages; Postgres puts NULLs last on ASC,
  // which is exactly where the "No phase" group belongs.
  const where = { projectId, parentTicketId: null };
  const [parents, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { column: true, label: true, phase: true },
      orderBy: [{ phase: { position: 'asc' } }, sort(order)],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  const subtasks = await prisma.ticket.findMany({
    where: { parentTicketId: { in: parents.map((p) => p.id) } },
    include: { column: true, label: true },
    orderBy: { number: 'asc' },
  });
  const byParent = new Map<string, TicketRow[]>();
  for (const s of subtasks) {
    const list = byParent.get(s.parentTicketId!) ?? [];
    list.push(s);
    byParent.set(s.parentTicketId!, list);
  }

  // Keyed by phaseId (null included) rather than compared against only the
  // last-seen group: two phases can share a position (e.g. a READ COMMITTED
  // race between two concurrent createPhase calls both reading the same
  // _max.position), which lets their tickets interleave in the query result.
  // A Map preserves first-appearance insertion order, so groups still come
  // out in the same order as before in the normal (no collision) case.
  type Group = {
    phase: { id: string; name: string; position: number } | null;
    tickets: BacklogItem[];
  };
  const byPhase = new Map<string | null, Group>();
  for (const t of parents) {
    const key = t.phaseId ?? null;
    let group = byPhase.get(key);
    if (!group) {
      group = {
        phase: t.phase ? { id: t.phase.id, name: t.phase.name, position: t.phase.position } : null,
        tickets: [],
      };
      byPhase.set(key, group);
    }
    group.tickets.push(toItem(t, (byParent.get(t.id) ?? []).map((s) => toItem(s))));
  }
  const groups = [...byPhase.values()];

  return { groups, total, page, pageSize };
}
