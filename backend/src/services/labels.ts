import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { getProject } from './projects';
import { logAudit } from './audit';
import { publishEvent } from './events';

async function getLabelOr404(projectId: string, labelId: string) {
  const label = await prisma.label.findFirst({ where: { id: labelId, projectId } });
  if (!label) throw new ApiError(404, 'NOT_FOUND', 'Label not found');
  return label;
}

export async function listLabels(projectId: string) {
  await getProject(projectId);
  return prisma.label.findMany({ where: { projectId }, orderBy: { name: 'asc' } });
}

export async function createLabel(
  userId: string,
  projectId: string,
  data: { name?: string; color?: string },
) {
  await getProject(projectId);
  if (!data.name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');

  const created = await prisma.$transaction(async (tx) => {
    const label = await tx.label.create({
      data: { projectId, name: data.name!.trim(), color: data.color ?? '#888888' },
    });
    await logAudit(tx, {
      userId,
      action: 'label.created',
      entityType: 'label',
      entityId: label.id,
      detail: { name: label.name },
    });
    return label;
  });
  publishEvent({ type: 'labels.changed', projectId, entityId: created.id });
  return created;
}

export async function updateLabel(
  userId: string,
  projectId: string,
  labelId: string,
  data: { name?: string; color?: string },
) {
  await getLabelOr404(projectId, labelId);
  if (data.name !== undefined && !data.name.trim()) {
    throw new ApiError(400, 'VALIDATION', 'name cannot be empty');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const label = await tx.label.update({
      where: { id: labelId },
      data: { name: data.name?.trim(), color: data.color },
    });
    await logAudit(tx, {
      userId,
      action: 'label.updated',
      entityType: 'label',
      entityId: labelId,
      detail: data as Record<string, unknown>,
    });
    return label;
  });
  publishEvent({ type: 'labels.changed', projectId, entityId: labelId });
  return updated;
}

export async function deleteLabel(
  userId: string,
  projectId: string,
  labelId: string,
  force: boolean,
) {
  const label = await getLabelOr404(projectId, labelId);
  const inUse = await prisma.ticket.count({ where: { labelId } });
  if (inUse > 0 && !force) {
    throw new ApiError(
      409,
      'LABEL_IN_USE',
      `Label is used by ${inUse} ticket(s); pass ?force=true to delete and clear it`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.label.delete({ where: { id: labelId } }); // FK is ON DELETE SET NULL
    await logAudit(tx, {
      userId,
      action: 'label.deleted',
      entityType: 'label',
      entityId: labelId,
      detail: { name: label.name, clearedFromTickets: inUse },
    });
  });
  publishEvent({ type: 'labels.changed', projectId, entityId: labelId });
}
