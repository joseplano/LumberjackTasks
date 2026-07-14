import { prisma } from '../db';

export async function mostActiveReport() {
  const projects = await prisma.project.findMany({
    include: { tickets: { select: { tokensConsumed: true, developmentTimeMinutes: true } } },
  });
  const rows = projects.map((p) => ({
    projectId: p.id,
    code: p.code,
    name: p.name,
    totalTokens: p.tickets.reduce((s, t) => s + t.tokensConsumed, 0),
    totalTimeMinutes: p.tickets.reduce((s, t) => s + t.developmentTimeMinutes, 0),
  }));
  return {
    byTime: [...rows]
      .sort((a, b) => b.totalTimeMinutes - a.totalTimeMinutes)
      .map(({ totalTokens, ...r }) => r),
    byTokens: [...rows]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map(({ totalTimeMinutes, ...r }) => r),
  };
}

type TicketRow = { id: string; number: number; name: string };

function pick(rows: (TicketRow & { value: number })[], mode: 'max' | 'min') {
  if (rows.length === 0) return null;
  let pool = rows;
  if (mode === 'min') {
    const nonZero = rows.filter((r) => r.value > 0);
    if (nonZero.length > 0) pool = nonZero; // exclude zeros unless everything is zero
  }
  const sorted = [...pool].sort((a, b) => (mode === 'max' ? b.value - a.value : a.value - b.value));
  const best = sorted[0];
  return { ticketId: best.id, number: best.number, name: best.name, value: best.value };
}

export async function consumptionReport() {
  const projects = await prisma.project.findMany({
    include: {
      tickets: {
        select: { id: true, number: true, name: true, tokensConsumed: true, developmentTimeMinutes: true },
      },
    },
  });
  return projects.map((p) => {
    const byTokens = p.tickets.map((t) => ({ ...t, value: t.tokensConsumed }));
    const byTime = p.tickets.map((t) => ({ ...t, value: t.developmentTimeMinutes }));
    return {
      projectId: p.id,
      code: p.code,
      name: p.name,
      maxTokens: pick(byTokens, 'max'),
      minTokens: pick(byTokens, 'min'),
      maxTime: pick(byTime, 'max'),
      minTime: pick(byTime, 'min'),
    };
  });
}

export async function transitionsReport() {
  const tickets = await prisma.ticket.findMany({
    where: { history: { some: {} } },
    include: { history: { orderBy: { changedAt: 'asc' } } },
  });

  const mostChanges = tickets
    .map((t) => ({ ticketId: t.id, number: t.number, name: t.name, changes: t.history.length }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 10);

  const mostTokensInProcess = tickets
    .map((t) => ({
      ticketId: t.id,
      number: t.number,
      name: t.name,
      tokens: t.history.reduce((s, h) => s + (h.tokensDelta ?? 0), 0),
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  const longestTransition = tickets
    .flatMap((t) => {
      const gaps = [];
      const points = [t.createdAt, ...t.history.map((h) => h.changedAt)];
      for (let i = 1; i < points.length; i++) {
        gaps.push({
          ticketId: t.id,
          number: t.number,
          name: t.name,
          fromColumnName: t.history[i - 1].fromColumnName,
          toColumnName: t.history[i - 1].toColumnName,
          minutes: Math.round((points[i].getTime() - points[i - 1].getTime()) / 60000),
        });
      }
      return gaps;
    })
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10);

  return { mostChanges, mostTokensInProcess, longestTransition };
}
