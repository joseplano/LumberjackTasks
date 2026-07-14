import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export async function logAudit(
  db: Db,
  entry: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    detail?: Record<string, unknown>;
  },
) {
  await db.auditLog.create({
    data: { ...entry, detail: (entry.detail ?? {}) as Prisma.InputJsonValue },
  });
}
