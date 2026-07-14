import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { validateTicketData, aggregateTotals } from './ticketRules';
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

export async function listTickets(projectId: string, parent?: string) {
  await getProject(projectId);
  return prisma.ticket.findMany({
    where: {
      projectId,
      ...(parent === 'none' ? { parentTicketId: null } : parent ? { parentTicketId: parent } : {}),
    },
    include: { label: true, column: true },
    orderBy: { number: 'asc' },
  });
}

export async function getTicketDetail(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      label: true,
      column: true,
      subtickets: { include: { label: true, column: true }, orderBy: { number: 'asc' } },
      history: { orderBy: { changedAt: 'asc' } },
    },
  });
  if (!ticket) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');
  return { ...ticket, totals: aggregateTotals(ticket, ticket.subtickets) };
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
