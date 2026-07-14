'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMinutes } from '@/lib/format';

interface ActiveRow {
  projectId: string;
  code: string;
  name: string;
  totalTimeMinutes?: number;
  totalTokens?: number;
}
interface ConsumptionEntry {
  ticketId: string;
  number: number;
  name: string;
  value: number;
}
interface ConsumptionRow {
  projectId: string;
  code: string;
  name: string;
  maxTokens: ConsumptionEntry | null;
  minTokens: ConsumptionEntry | null;
  maxTime: ConsumptionEntry | null;
  minTime: ConsumptionEntry | null;
}
interface Transitions {
  mostChanges: { ticketId: string; number: number; name: string; changes: number }[];
  mostTokensInProcess: { ticketId: string; number: number; name: string; tokens: number }[];
  longestTransition: {
    ticketId: string;
    number: number;
    name: string;
    fromColumnName: string;
    toColumnName: string;
    minutes: number;
  }[];
}

function entry(e: ConsumptionEntry | null, unit: 'tok' | 'time') {
  if (!e) return '—';
  const value = unit === 'time' ? formatMinutes(e.value) : `${e.value.toLocaleString()} tok`;
  return `#${e.number} ${e.name} (${value})`;
}

export default function ReportsPage() {
  const [mostActive, setMostActive] = useState<{ byTime: ActiveRow[]; byTokens: ActiveRow[] } | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  const [transitions, setTransitions] = useState<Transitions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ byTime: ActiveRow[]; byTokens: ActiveRow[] }>('/reports/most-active'),
      api<ConsumptionRow[]>('/reports/consumption'),
      api<Transitions>('/reports/transitions'),
    ])
      .then(([a, c, t]) => {
        setMostActive(a);
        setConsumption(c);
        setTransitions(t);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reports'));
  }, []);

  if (error) return <p className="rounded-omarchy border border-danger bg-surface p-3 text-danger">{error}</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-fg">Reports</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-fg">Most active projects</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-omarchy border border-border bg-surface p-4">
            <h3 className="mb-1 text-sm font-semibold text-fg-muted">By development time</h3>
            <ol className="list-decimal pl-5 text-sm">
              {mostActive?.byTime.map((r) => (
                <li key={r.projectId}>
                  {r.name} <span className="text-fg-faint">{r.code}</span> —{' '}
                  <strong>{formatMinutes(r.totalTimeMinutes ?? 0)}</strong>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-omarchy border border-border bg-surface p-4">
            <h3 className="mb-1 text-sm font-semibold text-fg-muted">By tokens consumed</h3>
            <ol className="list-decimal pl-5 text-sm">
              {mostActive?.byTokens.map((r) => (
                <li key={r.projectId}>
                  {r.name} <span className="text-fg-faint">{r.code}</span> —{' '}
                  <strong>{(r.totalTokens ?? 0).toLocaleString()}</strong> tok
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-fg">Consumption per project</h2>
        <table className="w-full border-collapse rounded-omarchy border border-border bg-surface text-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-2">Project</th>
              <th className="p-2">Most tokens</th>
              <th className="p-2">Fewest tokens</th>
              <th className="p-2">Most time</th>
              <th className="p-2">Least time</th>
            </tr>
          </thead>
          <tbody>
            {consumption.map((row) => (
              <tr key={row.projectId} className="border-b border-border">
                <td className="p-2">
                  {row.name} <span className="text-fg-faint">{row.code}</span>
                </td>
                <td className="p-2">{entry(row.maxTokens, 'tok')}</td>
                <td className="p-2">{entry(row.minTokens, 'tok')}</td>
                <td className="p-2">{entry(row.maxTime, 'time')}</td>
                <td className="p-2">{entry(row.minTime, 'time')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-fg">State transitions</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-omarchy border border-border bg-surface p-4">
            <h3 className="mb-1 text-sm font-semibold text-fg-muted">Most status changes</h3>
            <ol className="list-decimal pl-5 text-sm">
              {transitions?.mostChanges.map((t) => (
                <li key={t.ticketId}>
                  #{t.number} {t.name} — <strong>{t.changes}</strong> changes
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-omarchy border border-border bg-surface p-4">
            <h3 className="mb-1 text-sm font-semibold text-fg-muted">Most tokens in process</h3>
            <ol className="list-decimal pl-5 text-sm">
              {transitions?.mostTokensInProcess.map((t) => (
                <li key={t.ticketId}>
                  #{t.number} {t.name} — <strong>{t.tokens.toLocaleString()}</strong> tok
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-omarchy border border-border bg-surface p-4">
            <h3 className="mb-1 text-sm font-semibold text-fg-muted">Longest transitions</h3>
            <ol className="list-decimal pl-5 text-sm">
              {transitions?.longestTransition.map((t, i) => (
                <li key={`${t.ticketId}-${i}`}>
                  #{t.number} {t.name}: {t.fromColumnName} → {t.toColumnName} —{' '}
                  <strong>{formatMinutes(t.minutes)}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
