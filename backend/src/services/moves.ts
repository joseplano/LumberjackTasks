import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { validateParentMove } from './ticketRules';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { asOptionalInt, asOptionalString } from '../utils/params';
import { sweepIfComplete, type SweepSummary } from './sweep';

export async function moveTicket(
  userId: string,
  ticketId: string,
  input: { targetColumnId?: string; tokensDelta?: number; timeDelta?: number; llmName?: string },
) {
  if (!input.targetColumnId) throw new ApiError(400, 'VALIDATION', 'targetColumnId is required');
  const tokensDelta = asOptionalInt(input.tokensDelta, 'tokensDelta') ?? 0;
  const timeDelta = asOptionalInt(input.timeDelta, 'timeDelta') ?? 0;
  const llmNameInput = asOptionalString(input.llmName, 'llmName');
  if (tokensDelta < 0) throw new ApiError(400, 'NEGATIVE_TOKENS', 'tokensDelta cannot be negative');
  if (timeDelta < 0) throw new ApiError(400, 'NEGATIVE_TIME', 'timeDelta cannot be negative');

  const moved = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');

    const llmName = llmNameInput?.trim() ? llmNameInput : ticket.llmName;
    if (tokensDelta > 0 && !llmName?.trim()) {
      throw new ApiError(400, 'LLM_REQUIRED', 'llmName is required when tokens are consumed');
    }

    // ticket.columnId is null for a completed/off-board ticket (only the
    // sweep in sweep.ts ever produces that state). When it is null there is
    // no current column to look up; that is not an error -- it is the
    // restore path (contracts/http-api.md §4a, FR-023).
    const [current, target] = await Promise.all([
      ticket.columnId
        ? tx.kanbanColumn.findUnique({ where: { id: ticket.columnId } })
        : Promise.resolve(null),
      tx.kanbanColumn.findFirst({
        where: { id: input.targetColumnId, projectId: ticket.projectId },
      }),
    ]);
    if (ticket.columnId && !current) {
      throw new ApiError(500, 'INTERNAL', 'Ticket column missing');
    }
    if (!target) {
      throw new ApiError(400, 'VALIDATION', 'targetColumnId does not belong to this project');
    }

    if (!ticket.parentTicketId) {
      const subs = await tx.ticket.findMany({
        where: { parentTicketId: ticketId },
        include: { column: { select: { position: true } } },
      });
      validateParentMove(
        target.position,
        current?.position ?? null,
        subs.map((s) => s.column?.position ?? null),
      );
    }

    // T036 (research.md R3): serialize concurrent moves within one project,
    // but only when this move can possibly trigger a sweep -- projects that
    // have not opted in (no completion column) pay nothing, and even an
    // opted-in project only serializes on a move that targets it. Taken
    // before the ticket update below so it actually orders the concurrent
    // moves T028 exercises: under READ COMMITTED without this lock, two
    // concurrent moves into the completion column can each evaluate the
    // sweep condition against a snapshot that still shows the other's
    // ticket in its old column, and neither sweeps (the missed-sweep
    // hazard). This is a single project-row lock, held only for the rest of
    // this short transaction -- not a table lock, not Serializable
    // isolation (see research.md R3 for why both were rejected).
    if (target.isCompletionColumn) {
      await tx.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${ticket.projectId} FOR UPDATE`;
    }

    const updated = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        columnId: target.id,
        tokensConsumed: { increment: tokensDelta },
        developmentTimeMinutes: { increment: timeDelta },
        llmName,
      },
    });
    // current is null exactly when ticket.columnId was null going in -- i.e.
    // this move is a restore of a completed ticket (T053, FR-023). There is
    // no other path that leaves current null: a truthy ticket.columnId with
    // no matching column already threw ApiError above. Record the
    // human-readable 'Completed' as the origin rather than the empty string.
    const fromColumnName = current ? current.name : 'Completed';
    await tx.ticketStatusHistory.create({
      data: {
        ticketId,
        fromColumnName,
        toColumnName: target.name,
        changedByUserId: userId,
        tokensDelta: tokensDelta || null,
        timeDelta: timeDelta || null,
      },
    });
    await logAudit(tx, {
      userId,
      action: 'ticket.moved',
      entityType: 'ticket',
      entityId: ticketId,
      detail: { from: fromColumnName, to: target.name, tokensDelta, timeDelta },
    });

    // T035 (FR-008, FR-012, FR-014): evaluate/perform the sweep inside this
    // same transaction, after the move and its own history/audit rows, so
    // the sweep and the triggering move commit or roll back together. The
    // sweep rule itself lives entirely in sweep.ts (Principle I) -- this is
    // the only call site.
    let sweep: SweepSummary | null = null;
    if (target.isCompletionColumn) {
      sweep = await sweepIfComplete(
        tx,
        ticket.projectId,
        { id: target.id, name: target.name },
        userId,
      );
    }

    // T038: the ticket the caller just moved is always part of a sweep that
    // fires (it was just placed in the completion column), so its returned
    // columnId reflects the post-sweep state -- null, not the stale target
    // id from the update above. This is the intended outcome, not an error.
    return { ticket: sweep ? { ...updated, columnId: null } : updated, sweep };
  });

  publishEvent({ type: 'ticket.moved', projectId: moved.ticket.projectId, entityId: ticketId });
  if (moved.sweep) {
    // T037 (FR-022): once per sweep, after commit, following the existing
    // publish-after-commit pattern -- not once per swept ticket.
    publishEvent({ type: 'board.swept', projectId: moved.ticket.projectId });
  }
  return { ...moved.ticket, sweep: moved.sweep };
}
