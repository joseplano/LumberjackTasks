import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { validateParentMove } from './ticketRules';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { asOptionalInt, asOptionalString } from '../utils/params';

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

    const [current, target] = await Promise.all([
      tx.kanbanColumn.findUnique({ where: { id: ticket.columnId } }),
      tx.kanbanColumn.findFirst({
        where: { id: input.targetColumnId, projectId: ticket.projectId },
      }),
    ]);
    if (!current) throw new ApiError(500, 'INTERNAL', 'Ticket column missing');
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
        current.position,
        subs.map((s) => s.column.position),
      );
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
    await tx.ticketStatusHistory.create({
      data: {
        ticketId,
        fromColumnName: current.name,
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
      detail: { from: current.name, to: target.name, tokensDelta, timeDelta },
    });
    return updated;
  });
  publishEvent({ type: 'ticket.moved', projectId: moved.projectId, entityId: ticketId });
  return moved;
}
