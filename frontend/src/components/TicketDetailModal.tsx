'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMinutes } from '@/lib/format';
import type { ProjectDetail, TicketDetail } from '@/lib/types';
import TicketFormModal from './TicketFormModal';
import ConfirmDialog from './ConfirmDialog';

export default function TicketDetailModal({
  ticketId,
  project,
  onClose,
  onChanged,
}: {
  ticketId: string;
  project: ProjectDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentId, setCurrentId] = useState(ticketId);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [parentNumber, setParentNumber] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDetail(null);
    setError(null);
    setParentNumber(null);
    try {
      const d = await api<TicketDetail>(`/tickets/${currentId}`);
      setDetail(d);
      if (d.parentTicketId) {
        // Parent lookup is auxiliary — its failure must not hide the loaded ticket.
        try {
          const parent = await api<TicketDetail>(`/tickets/${d.parentTicketId}`);
          setParentNumber(parent.number);
        } catch {
          setParentNumber(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    }
  }, [currentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    if (!detail) return;
    try {
      await api(`/tickets/${detail.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteOpen(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="max-h-[85vh] w-[36rem] overflow-y-auto rounded-omarchy border border-border bg-surface p-4">
        {error && <p className="mb-2 rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
        {!detail ? (
          <p className="text-fg-muted">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-fg">
                <span className="mr-2 text-fg-faint">#{detail.number}</span>
                {detail.name}
              </h2>
              <button onClick={onClose} className="text-xl font-bold text-fg-faint">
                ×
              </button>
            </div>
            {detail.parentTicketId && (
              <button
                onClick={() => setCurrentId(detail.parentTicketId!)}
                className="mt-1 text-sm text-accent hover:underline"
              >
                Parent: #{parentNumber ?? '…'} (view)
              </button>
            )}
            <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{detail.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-muted">Status</dt>
              <dd className="text-fg">{detail.column?.name ?? '—'}</dd>
              <dt className="text-fg-muted">Label</dt>
              <dd className="text-fg">{detail.label?.name ?? '—'}</dd>
              <dt className="text-fg-muted">Complexity</dt>
              <dd className="text-fg">{detail.complexity}</dd>
              <dt className="text-fg-muted">LLM used</dt>
              <dd className="text-fg">{detail.llmName ?? '—'}</dd>
              <dt className="text-fg-muted">Own tokens / time</dt>
              <dd className="text-fg">
                {detail.tokensConsumed.toLocaleString()} tok · {formatMinutes(detail.developmentTimeMinutes)}
              </dd>
              <dt className="text-fg-muted">Total (with subtickets)</dt>
              <dd className="text-fg">
                <strong>{detail.totals.totalTokens}</strong> tok · {formatMinutes(detail.totals.totalTimeMinutes)}
              </dd>
            </dl>

            {detail.subtickets.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-fg">Subtickets</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {detail.subtickets.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setCurrentId(s.id)}
                        className="text-accent hover:underline"
                      >
                        #{s.number} {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.history.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-fg">Status history</h3>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {detail.history.map((h) => (
                      <tr key={h.id} className="border-b border-border">
                        <td className="py-1 text-fg">
                          {h.fromColumnName} → {h.toColumnName}
                        </td>
                        <td className="py-1 text-fg-muted">
                          {new Date(h.changedAt).toLocaleString()}
                        </td>
                        <td className="py-1 text-right text-fg-muted">
                          {h.tokensDelta ? `+${h.tokensDelta} tok` : ''}{' '}
                          {h.timeDelta ? `+${formatMinutes(h.timeDelta)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-3">
              {!detail.parentTicketId && (
                <button
                  onClick={() => setSubOpen(true)}
                  className="rounded-omarchy border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-accent"
                >
                  Add subticket
                </button>
              )}
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-omarchy border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-accent"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="rounded-omarchy bg-danger px-3 py-1 text-sm text-bg hover:opacity-90"
              >
                Delete
              </button>
            </div>

            <TicketFormModal
              open={editOpen}
              project={project}
              ticket={detail}
              onSaved={() => {
                load();
                onChanged();
              }}
              onClose={() => setEditOpen(false)}
            />
            <TicketFormModal
              open={subOpen}
              project={project}
              parentTicketId={detail.id}
              onSaved={() => {
                load();
                onChanged();
              }}
              onClose={() => setSubOpen(false)}
            />
            <ConfirmDialog
              open={deleteOpen}
              title="Delete ticket"
              message={`Delete #${detail.number} "${detail.name}"${
                detail.subtickets.length > 0 ? ` and its ${detail.subtickets.length} subticket(s)` : ''
              }?`}
              onConfirm={confirmDelete}
              onCancel={() => setDeleteOpen(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
