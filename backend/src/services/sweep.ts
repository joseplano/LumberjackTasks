import type { Prisma } from '@prisma/client';
import { logAudit } from './audit';

// The single home for the sweep rule (Constitution Principle I). Nothing in
// mcp/, the frontend, or moves.ts may re-implement any part of this -- see
// specs/001-terminal-column-sweep/research.md R3.

export interface SweepSummary {
  completionColumnId: string;
  completionColumnName: string;
  ticketCount: number;
  ticketIds: string[];
}

/**
 * Evaluates the sweep condition (FR-009) for a project against its
 * designated completion column and, if met, performs the sweep (FR-013).
 *
 * Must be called from inside the same transaction as the move that may have
 * triggered it, after that move's own writes, and only when the move's
 * target column is the project's completion column (see moves.ts, which
 * also takes the per-project serialization lock required for correctness
 * under concurrent moves -- research.md R3).
 *
 * Returns the sweep summary when a sweep actually fired, or null when the
 * condition was not met (FR-012 is enforced by the caller only invoking
 * this when a completion column exists) or when a concurrent delete emptied
 * the completion column between the condition check and the UPDATE below.
 */
export async function sweepIfComplete(
  tx: Prisma.TransactionClient,
  projectId: string,
  completionColumn: { id: string; name: string },
  userId: string,
): Promise<SweepSummary | null> {
  // FR-009 / FR-010: every ticket of the project that is currently on the
  // board (columnId not null) must sit in the completion column, and at
  // least one such ticket must exist. Already-completed tickets (columnId
  // null) are excluded by construction -- this scoping is the whole of
  // FR-010 and is what makes a project sweepable repeatedly.
  const [elsewhere, inCompletion] = await Promise.all([
    tx.ticket.count({
      where: {
        projectId,
        columnId: { not: null },
        NOT: { columnId: completionColumn.id },
      },
    }),
    tx.ticket.count({ where: { projectId, columnId: completionColumn.id } }),
  ]);
  if (elsewhere > 0 || inCompletion === 0) return null;

  // Perform the sweep as a single conditional UPDATE, and derive the swept
  // ids from the rows it actually affected -- not from the counts above.
  // A ticket deleted between the check and this statement (deleteTicket
  // takes no project lock, so the race is real -- research.md R3, FR-021a)
  // must not be reported as swept. A findMany-then-updateMany pair would
  // reintroduce exactly that race, so this must stay a single RETURNING
  // statement.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "tickets" SET "columnId" = NULL, "updatedAt" = NOW()
    WHERE "columnId" = ${completionColumn.id} AND "projectId" = ${projectId}
    RETURNING "id"
  `;
  if (rows.length === 0) return null;

  const ticketIds = rows.map((r) => r.id);

  // T033 (research.md R6): one history row per swept ticket, recording its
  // exit from the completion column. tokensDelta/timeDelta stay null -- a
  // sweep consumes nothing.
  await tx.ticketStatusHistory.createMany({
    data: ticketIds.map((id) => ({
      ticketId: id,
      fromColumnName: completionColumn.name,
      toColumnName: 'Completed',
      changedByUserId: userId,
      tokensDelta: null,
      timeDelta: null,
    })),
  });

  // T034 (FR-021, FR-021a, research.md R7): one audit entry for the whole
  // sweep, not one per ticket, attributed to the actor of the triggering
  // move. ticketCount/ticketIds come from the UPDATE's own result.
  await logAudit(tx, {
    userId,
    action: 'board.swept',
    entityType: 'project',
    entityId: projectId,
    detail: {
      completionColumnId: completionColumn.id,
      completionColumnName: completionColumn.name,
      ticketCount: ticketIds.length,
      ticketIds,
    },
  });

  return {
    completionColumnId: completionColumn.id,
    completionColumnName: completionColumn.name,
    ticketCount: ticketIds.length,
    ticketIds,
  };
}
