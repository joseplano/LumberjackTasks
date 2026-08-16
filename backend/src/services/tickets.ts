import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { validateTicketData, aggregateTotals, normalizeBranch, deriveBranch } from './ticketRules';
import { asOptionalInt } from '../utils/params';

export interface TicketInput {
  name?: string;
  description?: string;
  columnId?: string;
  complexity?: number;
  labelId?: string | null;
  phaseId?: string | null;
  parentTicketId?: string | null;
  tokensConsumed?: number;
  llmName?: string | null;
  developmentTimeMinutes?: number;
  // T017 (FR-005, FR-006): the reported branch. Absent leaves the stored value
  // alone; null (or an empty/whitespace-only string) clears it.
  branch?: string | null;
}

// T018/T018a (FR-015, FR-015a): consume the loaded parent relation to derive
// the read-only pair, then drop it -- a `parent` object in the payload would be
// a fourth added field (contracts/rest-api.md). The remainder is spread so no
// pre-existing field can be lost (FR-016, SC-009).
function withDerivedBranch<
  T extends { gitBranch: string | null; parent?: { gitBranch: string | null } | null },
>(ticket: T) {
  const { parent, ...rest } = ticket;
  return { ...rest, ...deriveBranch(ticket.gitBranch, parent?.gitBranch) };
}

export async function getTicketOr404(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');
  return ticket;
}

async function validateRelations(
  projectId: string,
  data: TicketInput,
  effectiveParentTicketId?: string | null,
) {
  if (data.columnId) {
    const col = await prisma.kanbanColumn.findFirst({ where: { id: data.columnId, projectId } });
    if (!col) throw new ApiError(400, 'VALIDATION', 'columnId does not belong to this project');
  }
  if (data.labelId) {
    const label = await prisma.label.findFirst({ where: { id: data.labelId, projectId } });
    if (!label) throw new ApiError(400, 'VALIDATION', 'labelId does not belong to this project');
  }
  if (data.phaseId) {
    if (effectiveParentTicketId) {
      throw new ApiError(
        400,
        'SUBTASK_PHASE',
        'A subtask inherits its phase from its parent and cannot have one of its own',
      );
    }
    const phase = await prisma.phase.findFirst({ where: { id: data.phaseId, projectId } });
    if (!phase) throw new ApiError(400, 'VALIDATION', 'phaseId does not belong to this project');
  }
  if (data.parentTicketId) {
    const parent = await prisma.ticket.findFirst({
      where: { id: data.parentTicketId, projectId },
    });
    if (!parent) throw new ApiError(400, 'VALIDATION', 'parentTicketId not found in this project');
    if (parent.parentTicketId) {
      throw new ApiError(400, 'SUBTICKET_NESTING', 'A subticket cannot have its own subtickets');
    }
  }
}

export async function createTicket(userId: string, projectId: string, data: TicketInput) {
  await getProject(projectId);
  if (!data.name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');
  if (data.complexity === undefined) throw new ApiError(400, 'VALIDATION', 'complexity is required');
  data.complexity = asOptionalInt(data.complexity, 'complexity');
  data.tokensConsumed = asOptionalInt(data.tokensConsumed, 'tokensConsumed');
  data.developmentTimeMinutes = asOptionalInt(data.developmentTimeMinutes, 'developmentTimeMinutes');
  validateTicketData({
    complexity: data.complexity!,
    tokensConsumed: data.tokensConsumed ?? 0,
    developmentTimeMinutes: data.developmentTimeMinutes ?? 0,
    llmName: data.llmName ?? null,
  });
  // T017 (FR-010): validated before the write transaction is entered, so a
  // rejected branch can never have touched a row. On create an absent field is
  // simply stored as null.
  const gitBranch = normalizeBranch(data.branch ?? null);
  await validateRelations(projectId, data, data.parentTicketId ?? null);

  let columnId = data.columnId;
  if (!columnId) {
    const first = await prisma.kanbanColumn.findFirst({
      where: { projectId },
      orderBy: { position: 'asc' },
    });
    if (!first) throw new ApiError(409, 'NO_COLUMNS', 'Project has no kanban columns');
    columnId = first.id;
  }

  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.ticket.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const ticket = await tx.ticket.create({
      data: {
        projectId,
        number: (last?.number ?? 0) + 1,
        name: data.name!.trim(),
        description: data.description ?? '',
        columnId: columnId!,
        complexity: data.complexity!,
        labelId: data.labelId ?? null,
        phaseId: data.phaseId ?? null,
        parentTicketId: data.parentTicketId ?? null,
        tokensConsumed: data.tokensConsumed ?? 0,
        llmName: data.llmName ?? null,
        developmentTimeMinutes: data.developmentTimeMinutes ?? 0,
        gitBranch,
      },
    });
    await logAudit(tx, {
      userId,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticket.id,
      detail: { name: ticket.name, parentTicketId: ticket.parentTicketId },
    });
    return ticket;
  });
  publishEvent({ type: 'ticket.created', projectId, entityId: created.id });
  return created;
}

const PLACEMENTS = ['board', 'completed', 'all'] as const;
type Placement = (typeof PLACEMENTS)[number];

// T044 (FR-019a, research.md R4): `placement` defaults to 'all' -- identical
// to today's unfiltered listing -- because silently changing that default
// would change the meaning of the published MCP tool `list_tickets`.
export async function listTickets(projectId: string, parent?: string, placement?: string) {
  await getProject(projectId);
  if (placement !== undefined && !PLACEMENTS.includes(placement as Placement)) {
    throw new ApiError(400, 'VALIDATION', `placement must be one of ${PLACEMENTS.join(', ')}`);
  }
  const tickets = await prisma.ticket.findMany({
    where: {
      projectId,
      ...(parent === 'none' ? { parentTicketId: null } : parent ? { parentTicketId: parent } : {}),
      ...(placement === 'board'
        ? { columnId: { not: null } }
        : placement === 'completed'
          ? { columnId: null }
          : {}),
    },
    // T018 (research.md R2): one batched relation load for the whole page, not
    // one query per row.
    include: { label: true, column: true, parent: { select: { gitBranch: true, number: true } } },
    orderBy: { number: 'asc' },
  });
  return tickets.map(withDerivedBranch);
}

export async function getTicketDetail(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      label: true,
      column: true,
      subtickets: { include: { label: true, column: true }, orderBy: { number: 'asc' } },
      history: { orderBy: { changedAt: 'asc' } },
      parent: { select: { gitBranch: true, number: true } },
    },
  });
  if (!ticket) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');
  return {
    ...withDerivedBranch(ticket),
    // T018a: a subticket nests one level only, so the enclosing ticket IS its
    // parent -- its `gitBranch` is the parent value, with no extra query.
    subtickets: ticket.subtickets.map((s) => ({
      ...s,
      ...deriveBranch(s.gitBranch, ticket.gitBranch),
    })),
    totals: aggregateTotals(ticket, ticket.subtickets),
  };
}

export async function updateTicket(userId: string, ticketId: string, data: TicketInput) {
  if (data.columnId !== undefined) {
    throw new ApiError(400, 'VALIDATION', 'columnId cannot be changed here; use POST /api/v1/tickets/:id/move');
  }
  if (data.parentTicketId !== undefined) {
    throw new ApiError(400, 'VALIDATION', 'parentTicketId cannot be changed after creation');
  }
  const current = await getTicketOr404(ticketId);
  if (data.name !== undefined && !data.name.trim()) {
    throw new ApiError(400, 'VALIDATION', 'name cannot be empty');
  }
  const merged = {
    complexity: asOptionalInt(data.complexity, 'complexity') ?? current.complexity,
    tokensConsumed: asOptionalInt(data.tokensConsumed, 'tokensConsumed') ?? current.tokensConsumed,
    developmentTimeMinutes:
      asOptionalInt(data.developmentTimeMinutes, 'developmentTimeMinutes') ??
      current.developmentTimeMinutes,
    llmName: data.llmName === undefined ? current.llmName : data.llmName,
  };
  validateTicketData(merged);
  // T017 (FR-006, FR-010): `undefined` in means the field was absent and the
  // stored value is left alone; `null` or an empty/whitespace-only string
  // clears it. Validation happens before the write transaction, so a rejected
  // branch leaves the previously stored value intact.
  const gitBranch = normalizeBranch(data.branch);
  await validateRelations(
    current.projectId,
    { labelId: data.labelId ?? undefined, phaseId: data.phaseId ?? undefined },
    current.parentTicketId,
  );

  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        name: data.name?.trim(),
        description: data.description,
        labelId: data.labelId === undefined ? undefined : data.labelId,
        phaseId: data.phaseId === undefined ? undefined : data.phaseId,
        ...merged,
        // After the spread on purpose: the validated branch must win over any
        // key `merged` might ever gain, rather than depending on key ordering.
        // `undefined` still means "absent", so Prisma skips the column.
        gitBranch,
      },
    });
    await logAudit(tx, {
      userId,
      action: 'ticket.updated',
      entityType: 'ticket',
      entityId: ticketId,
      detail: data as Record<string, unknown>,
    });
    return ticket;
  });
  publishEvent({ type: 'ticket.updated', projectId: current.projectId, entityId: ticketId });
  return updated;
}

export async function deleteTicket(userId: string, ticketId: string) {
  const ticket = await getTicketOr404(ticketId);
  await prisma.$transaction(async (tx) => {
    await tx.ticket.delete({ where: { id: ticketId } }); // subtickets cascade
    await logAudit(tx, {
      userId,
      action: 'ticket.deleted',
      entityType: 'ticket',
      entityId: ticketId,
      detail: { name: ticket.name },
    });
  });
  publishEvent({ type: 'ticket.deleted', projectId: ticket.projectId, entityId: ticketId });
}
