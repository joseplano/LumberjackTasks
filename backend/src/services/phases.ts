import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';
import { logAudit } from './audit';
import { publishEvent } from './events';
import { asStringArray } from '../utils/params';

async function getPhaseOr404(projectId: string, phaseId: string) {
  const phase = await prisma.phase.findFirst({ where: { id: phaseId, projectId } });
  if (!phase) throw new ApiError(404, 'NOT_FOUND', 'Phase not found');
  return phase;
}

export async function listPhases(projectId: string) {
  await getProject(projectId);
  return prisma.phase.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
}

export async function createPhase(
  userId: string,
  projectId: string,
  data: { name?: string; description?: string },
) {
  await getProject(projectId);
  if (!data.name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');

  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.phase.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    const phase = await tx.phase.create({
      data: {
        projectId,
        name: data.name!.trim(),
        description: data.description ?? '',
        position: (max._max.position ?? -1) + 1,
      },
    });
    await logAudit(tx, {
      userId,
      action: 'phase.created',
      entityType: 'phase',
      entityId: phase.id,
      detail: { name: phase.name },
    });
    return phase;
  });
  publishEvent({ type: 'phases.changed', projectId, entityId: created.id });
  return created;
}

export async function updatePhase(
  userId: string,
  projectId: string,
  phaseId: string,
  data: { name?: string; description?: string },
) {
  await getPhaseOr404(projectId, phaseId);
  if (data.name !== undefined && !data.name.trim()) {
    throw new ApiError(400, 'VALIDATION', 'name cannot be empty');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const phase = await tx.phase.update({
      where: { id: phaseId },
      data: { name: data.name?.trim(), description: data.description },
    });
    await logAudit(tx, {
      userId,
      action: 'phase.updated',
      entityType: 'phase',
      entityId: phaseId,
      detail: data as Record<string, unknown>,
    });
    return phase;
  });
  publishEvent({ type: 'phases.changed', projectId, entityId: phaseId });
  return updated;
}

export async function reorderPhases(userId: string, projectId: string, orderedIds: string[]) {
  const ids = asStringArray(orderedIds ?? [], 'orderedIds');
  const phases = await listPhases(projectId);
  const currentIds = phases.map((p) => p.id).sort();
  const givenIds = [...ids].sort();
  if (JSON.stringify(currentIds) !== JSON.stringify(givenIds)) {
    throw new ApiError(400, 'VALIDATION', 'orderedIds must contain exactly the project phase ids');
  }
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.phase.update({ where: { id: ids[i] }, data: { position: i } });
    }
    await logAudit(tx, {
      userId,
      action: 'phase.reordered',
      entityType: 'project',
      entityId: projectId,
      detail: { orderedIds: ids },
    });
  });
  publishEvent({ type: 'phases.changed', projectId });
  return listPhases(projectId);
}

export async function deletePhase(
  userId: string,
  projectId: string,
  phaseId: string,
  force: boolean,
) {
  const phase = await getPhaseOr404(projectId, phaseId);

  // Read the affected ticket ids AND enforce the not-empty guard inside the
  // same transaction as the delete. Doing this as two separate steps (read,
  // guard, then a later transaction) leaves a window where a ticket can be
  // assigned to the phase after the guard passed but before the delete
  // commits: the FK's ON DELETE SET NULL would then silently unassign it
  // with no ticket.updated event, and an unforced delete could remove a
  // phase that just gained its first ticket. Throwing ApiError inside the
  // transaction callback rolls it back cleanly (same pattern as
  // deleteColumn's moveTo validation in columns.ts).
  const affected = await prisma.$transaction(async (tx) => {
    const affected = await tx.ticket.findMany({ where: { phaseId }, select: { id: true } });
    if (affected.length > 0 && !force) {
      throw new ApiError(
        409,
        'PHASE_NOT_EMPTY',
        `Phase has ${affected.length} ticket(s); pass ?force=true to delete it and unassign them`,
      );
    }
    await tx.phase.delete({ where: { id: phaseId } }); // FK is ON DELETE SET NULL
    await logAudit(tx, {
      userId,
      action: 'phase.deleted',
      entityType: 'phase',
      entityId: phaseId,
      detail: { name: phase.name, unassignedTickets: affected.length },
    });
    return affected;
  });
  publishEvent({ type: 'phases.changed', projectId, entityId: phaseId });
  // Those tickets genuinely changed; a board open in another tab must not go stale.
  // Published only after the transaction commits, never inside it.
  for (const t of affected) {
    publishEvent({ type: 'ticket.updated', projectId, entityId: t.id });
  }
}
