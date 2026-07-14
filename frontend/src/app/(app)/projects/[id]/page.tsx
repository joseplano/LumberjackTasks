'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatMinutes } from '@/lib/format';
import { moveTicketLocally } from '@/lib/moveTicketLocally';
import { useLiveEvents } from '@/lib/useLiveEvents';
import type { ProjectDetail, ProjectMetrics, Ticket } from '@/lib/types';
import Board from '@/components/kanban/Board';
import TicketFormModal from '@/components/TicketFormModal';
import TicketDetailModal from '@/components/TicketDetailModal';

export default function ProjectBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, t, m] = await Promise.all([
        api<ProjectDetail>(`/projects/${id}`),
        api<Ticket[]>(`/projects/${id}/tickets`),
        api<ProjectMetrics>(`/projects/${id}/metrics`),
      ]);
      setProject(p);
      setTickets(t);
      setMetrics(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents(id, load);

  async function handleMove(ticketId: string, targetColumnId: string) {
    const previousColumnId = tickets.find((t) => t.id === ticketId)?.columnId;
    setMoveError(null);
    setTickets((current) => moveTicketLocally(current, ticketId, targetColumnId));
    try {
      await api(`/tickets/${ticketId}/move`, { method: 'POST', body: { targetColumnId } });
      load();
    } catch (err) {
      // Revert only this ticket so concurrent in-flight moves are not wiped out.
      if (previousColumnId) {
        setTickets((current) => moveTicketLocally(current, ticketId, previousColumnId));
      }
      setMoveError(err instanceof Error ? err.message : 'Move failed');
    }
  }

  if (error) return <p className="rounded-omarchy border border-danger bg-surface p-3 text-danger">{error}</p>;
  if (!project) return <p className="text-fg-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{project.name}</h1>
          {metrics && (
            <p className="text-sm text-fg-muted">
              Total tokens: <strong>{metrics.totalTokens.toLocaleString()}</strong> · Total time:{' '}
              <strong>{formatMinutes(metrics.totalTimeMinutes)}</strong>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${id}/backlog`}
            className="rounded-omarchy border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
          >
            View backlog
          </Link>
          <button
            onClick={() => setTicketModalOpen(true)}
            className="rounded-omarchy bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            Add ticket
          </button>
        </div>
      </div>
      {moveError && (
        <div className="mb-3 flex items-center justify-between rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">
          <span>{moveError}</span>
          <button onClick={() => setMoveError(null)} className="font-bold">
            ×
          </button>
        </div>
      )}
      <Board project={project} tickets={tickets} onTicketClick={(tid) => setOpenTicketId(tid)} onMove={handleMove} />
      <TicketFormModal
        open={ticketModalOpen}
        project={project}
        onSaved={load}
        onClose={() => setTicketModalOpen(false)}
      />
      {openTicketId && (
        <TicketDetailModal
          ticketId={openTicketId}
          project={project}
          onClose={() => setOpenTicketId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
