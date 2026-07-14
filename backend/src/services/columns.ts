import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { asStringArray } from '../utils/params';

async function getColumnOr404(projectId: string, columnId: string) {
  const column = await prisma.kanbanColumn.findFirst({ where: { id: columnId, projectId } });
  if (!column) throw new ApiError(404, 'NOT_FOUND', 'Column not found');
  return column;
}

export async function listColumns(projectId: string) {
  await getProject(projectId);
  return prisma.kanbanColumn.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
}

export async function createColumn(userId: string, projectId: string, name?: string) {
  await getProject(projectId);
  if (!name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');
  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.kanbanColumn.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    const column = await tx.kanbanColumn.create({
      data: { projectId, name: name.trim(), position: (max._max.position ?? -1) + 1 },
    });
    await logAudit(tx, {
      userId,
      action: 'column.created',
      entityType: 'kanban_column',
      entityId: column.id,
      detail: { name: column.name },
    });
    return column;
  });
  publishEvent({ type: 'columns.changed', projectId, entityId: created.id });
  return created;
}

export async function renameColumn(
  userId: string,
  projectId: string,
  columnId: string,
  name?: string,
) {
  const column = await getColumnOr404(projectId, columnId);
  if (!name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');
  const renamed = await prisma.$transaction(async (tx) => {
    const updated = await tx.kanbanColumn.update({
      where: { id: columnId },
      data: { name: name.trim() },
    });
    await logAudit(tx, {
      userId,
      action: 'column.renamed',
      entityType: 'kanban_column',
      entityId: columnId,
      detail: { from: column.name, to: updated.name },
    });
    return updated;
  });
  publishEvent({ type: 'columns.changed', projectId, entityId: columnId });
  return renamed;
}

export async function reorderColumns(userId: string, projectId: string, orderedIds: string[]) {
  const ids = asStringArray(orderedIds ?? [], 'orderedIds');
  const columns = await listColumns(projectId);
  const currentIds = columns.map((c) => c.id).sort();
  const givenIds = [...ids].sort();
  if (JSON.stringify(currentIds) !== JSON.stringify(givenIds)) {
    throw new ApiError(400, 'VALIDATION', 'orderedIds must contain exactly the project column ids');
  }
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.kanbanColumn.update({ where: { id: ids[i] }, data: { position: i } });
    }
    await logAudit(tx, {
      userId,
      action: 'column.reordered',
      entityType: 'project',
      entityId: projectId,
      detail: { orderedIds: ids },
    });
  });
  publishEvent({ type: 'columns.changed', projectId });
  return listColumns(projectId);
}

export async function deleteColumn(
  userId: string,
  projectId: string,
  columnId: string,
  moveTo?: string,
) {
  const column = await getColumnOr404(projectId, columnId);
  const ticketCount = await prisma.ticket.count({ where: { columnId } });
  if (ticketCount > 0 && !moveTo) {
    throw new ApiError(
      409,
      'COLUMN_NOT_EMPTY',
      `Column has ${ticketCount} ticket(s); pass ?moveTo=<columnId> to relocate them`,
    );
  }
  await prisma.$transaction(async (tx) => {
    if (moveTo) {
      const target = await tx.kanbanColumn.findFirst({ where: { id: moveTo, projectId } });
      if (!target || target.id === columnId) {
        throw new ApiError(400, 'VALIDATION', 'moveTo must be another column of the same project');
      }
      if (ticketCount > 0) {
        await tx.ticket.updateMany({ where: { columnId }, data: { columnId: moveTo } });
      }
    }
    await tx.kanbanColumn.delete({ where: { id: columnId } });
    await logAudit(tx, {
      userId,
      action: 'column.deleted',
      entityType: 'kanban_column',
      entityId: columnId,
      detail: { name: column.name, movedTicketsTo: moveTo ?? null },
    });
  });
  publishEvent({ type: 'columns.changed', projectId, entityId: columnId });
}
