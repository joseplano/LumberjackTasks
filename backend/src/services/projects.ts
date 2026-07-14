import { prisma } from '../db';
import { ApiError } from '../middleware/errors';
import { derivePrefix, formatProjectCode } from './projectCode';
import { logAudit } from './audit';
import { publishEvent } from './events';

export const DEFAULT_COLUMNS = [
  'TODO',
  'In development',
  'In testing',
  'In Human review',
  'Done',
  'Committed',
];

export async function createProject(
  userId: string,
  data: { name?: string; description?: string; gitRepoUrl?: string },
) {
  if (!data.name?.trim()) throw new ApiError(400, 'VALIDATION', 'name is required');
  const name = data.name.trim();
  const created = await prisma.$transaction(async (tx) => {
    const counter = await tx.projectCodeCounter.create({ data: {} });
    const code = formatProjectCode(derivePrefix(name), counter.id);
    const project = await tx.project.create({
      data: {
        code,
        name,
        description: data.description ?? '',
        gitRepoUrl: data.gitRepoUrl ?? '',
        columns: { create: DEFAULT_COLUMNS.map((n, i) => ({ name: n, position: i })) },
      },
    });
    await logAudit(tx, {
      userId,
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      detail: { code, name },
    });
    return project;
  });
  publishEvent({ type: 'project.created', projectId: created.id });
  return created;
}

export function listProjects(search?: string) {
  return prisma.project.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'asc' },
  });
}

export async function getProject(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      columns: { orderBy: { position: 'asc' } },
      labels: true,
      phases: { orderBy: { position: 'asc' } },
    },
  });
  if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
  return project;
}

export async function updateProject(
  userId: string,
  id: string,
  data: { name?: string; description?: string; gitRepoUrl?: string },
) {
  await getProject(id);
  if (data.name !== undefined && !data.name.trim()) {
    throw new ApiError(400, 'VALIDATION', 'name cannot be empty');
  }
  const project = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id },
      data: { name: data.name?.trim(), description: data.description, gitRepoUrl: data.gitRepoUrl },
    });
    await logAudit(tx, {
      userId,
      action: 'project.updated',
      entityType: 'project',
      entityId: id,
      detail: data as Record<string, unknown>,
    });
    return updated;
  });
  publishEvent({ type: 'project.updated', projectId: id });
  return project;
}

export async function deleteProject(userId: string, id: string) {
  await getProject(id);
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } });
    await logAudit(tx, {
      userId,
      action: 'project.deleted',
      entityType: 'project',
      entityId: id,
    });
  });
  publishEvent({ type: 'project.deleted', projectId: id });
}
