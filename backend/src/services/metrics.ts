import { prisma } from '../db';
import { getProject } from './projects';

export async function projectMetrics(projectId: string) {
  await getProject(projectId);
  const agg = await prisma.ticket.aggregate({
    where: { projectId },
    _sum: { tokensConsumed: true, developmentTimeMinutes: true },
    _count: true,
  });
  return {
    totalTokens: agg._sum.tokensConsumed ?? 0,
    totalTimeMinutes: agg._sum.developmentTimeMinutes ?? 0,
    ticketCount: agg._count,
  };
}
