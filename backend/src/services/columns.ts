import { Prisma } from '@prisma/client';
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

export async function updateColumn(
  userId: string,
  projectId: string,
  columnId: string,
  input: { name?: string; isCompletionColumn?: boolean },
) {
  const { name, isCompletionColumn } = input;
  if (name === undefined && isCompletionColumn === undefined) {
    throw new ApiError(400, 'VALIDATION', 'name or isCompletionColumn is required');
  }
  const column = await getColumnOr404(projectId, columnId);
  if (name !== undefined && !name.trim()) {
    throw new ApiError(400, 'VALIDATION', 'name is required');
  }

  const updated = await prisma.$transaction(async (tx) => {
    let result = column;

    if (name !== undefined) {
      result = await tx.kanbanColumn.update({
        where: { id: columnId },
        data: { name: name.trim() },
      });
      await logAudit(tx, {
        userId,
        action: 'column.renamed',
        entityType: 'kanban_column',
        entityId: columnId,
        detail: { from: column.name, to: result.name },
      });
    }

    if (isCompletionColumn !== undefined) {
      if (isCompletionColumn) {
        // Mechanism: clear any other designated column of this project first,
        // then set this one, inside the same transaction as the rename (if any).
        // Guarantee: the partial unique index
        // `kanban_columns_projectId_completion_key` (see
        // backend/prisma/migrations/20260816_completion_column_sweep/migration.sql
        // and research.md R2) is what actually prevents two designated columns
        // from ever being visible at once under concurrent requests -- this
        // clear-then-set alone is not sufficient under READ COMMITTED. Both are
        // required; do not drop either. See the T018 tripwire test.
        //
        // The try/catch below is scoped tightly to exactly these two statements
        // (not the rename above, not the clear-only branch below) because they
        // are the only statements that can ever hit the partial unique index --
        // an `updateMany` that only clears the flag, and an `update` on the
        // primary key that sets it. We also check `err.meta?.target` names the
        // completion index specifically, so a P2002 from some other unique
        // constraint added to KanbanColumn in the future is never silently
        // mislabeled as a completion-column conflict.
        try {
          await tx.kanbanColumn.updateMany({
            where: { projectId, isCompletionColumn: true, id: { not: columnId } },
            data: { isCompletionColumn: false },
          });
          result = await tx.kanbanColumn.update({
            where: { id: columnId },
            data: { isCompletionColumn: true },
          });
        } catch (err) {
          if (isCompletionIndexConflict(err)) {
            throw new ApiError(
              409,
              'COMPLETION_COLUMN_CONFLICT',
              'Another completion-column designation is in progress for this project; retry',
            );
          }
          throw err;
        }
        await logAudit(tx, {
          userId,
          action: 'column.completion_set',
          entityType: 'kanban_column',
          entityId: columnId,
          detail: { name: result.name },
        });
      } else {
        result = await tx.kanbanColumn.update({
          where: { id: columnId },
          data: { isCompletionColumn: false },
        });
        await logAudit(tx, {
          userId,
          action: 'column.completion_cleared',
          entityType: 'kanban_column',
          entityId: columnId,
          detail: { name: result.name },
        });
      }
    }

    return result;
  });

  publishEvent({ type: 'columns.changed', projectId, entityId: columnId });
  return updated;
}

// True only for a P2002 raised specifically by the partial unique index
// `kanban_columns_projectId_completion_key`. Postgres reports the violated
// index/constraint name via `err.meta.target`, as either a string or a string
// array depending on Prisma/engine version, so both shapes are checked. If the
// shape is ever something else entirely, we still fall back to true -- the
// caller only ever invokes this from inside the two statements that are
// capable of violating that specific index, so any P2002 reaching it is, by
// construction, this conflict.
function isCompletionIndexConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const indexName = 'kanban_columns_projectId_completion_key';
  if (typeof target === 'string') return target.includes(indexName);
  if (Array.isArray(target)) return target.includes(indexName);
  return true;
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
