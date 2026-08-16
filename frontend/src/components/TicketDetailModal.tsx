'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildBranchUrl } from '@/lib/branchUrl';
import { formatMinutes } from '@/lib/format';
import type { ProjectDetail, TicketDetail } from '@/lib/types';
import TicketFormModal from './TicketFormModal';
import ConfirmDialog from './ConfirmDialog';

/**
 * FR-019 — the inherited-branch marker. The parent's number arrives through the modal's existing
 * auxiliary, failure-tolerant parent lookup, so it may legitimately be unknown: while that lookup
 * is still in flight, or after it failed. In that case the marker degrades to `(heredada)` rather
 * than rendering `#null`, `#undefined` or a blank number. The branch value itself is never
 * withheld for this reason (spec Edge Case "Parent number unavailable...", SC-003).
 *
 * The Spanish literals are deliberate and approved verbatim (spec A-001).
 */
function inheritedMarker(parentNumber: number | null): string {
  return typeof parentNumber === 'number' && Number.isFinite(parentNumber)
    ? `(heredada de #${parentNumber})`
    : '(heredada)';
}

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
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setDetail(null);
    setError(null);
    setParentNumber(null);
    setCopied(false);
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

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  function confirmCopied() {
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  /**
   * Non-secure-context fallback (FR-021): behind a plain-HTTP LAN reverse proxy
   * `navigator.clipboard` is undefined, so copy through a hidden textarea instead.
   */
  function copyWithTextarea(text: string) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  /**
   * Copies the payload the caller derived — the branch URL when one could be built, otherwise
   * the exact effective branch (no trimming, no decoration, no inheritance marker). This
   * function has no opinion on which one it is; that decision is made once by the caller.
   */
  async function copyBranch(branch: string) {
    let done = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(branch);
        done = true;
      }
    } catch {
      done = false;
    }
    if (!done) {
      try {
        done = copyWithTextarea(branch) !== false;
      } catch {
        done = false;
      }
    }
    if (done) confirmCopied();
  }

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

  const branchUrl = detail?.effectiveBranch
    ? buildBranchUrl(project.gitRepoUrl, detail.effectiveBranch)
    : null;
  const copyLabel = branchUrl ? 'Copy branch URL' : 'Copy branch name';

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
            {/* Reported git branch — read-only mirror of what the agent reported (FR-017). */}
            <div className="mt-3 flex items-center gap-2 rounded-omarchy border border-border bg-surface-2 px-3 py-2">
              {detail.effectiveBranch ? (
                <>
                  <svg
                    role="img"
                    aria-label="Git branch"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-fg-muted"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <title>Git branch</title>
                    <circle cx="6" cy="5" r="2.5" />
                    <circle cx="6" cy="19" r="2.5" />
                    <circle cx="18" cy="9" r="2.5" />
                    <path d="M6 7.5v9" />
                    <path d="M18 11.5c0 3-3 4.5-6 5" />
                  </svg>
                  <span className="min-w-0 flex-1 break-all font-mono text-sm text-fg">
                    {detail.effectiveBranch}
                  </span>
                  {detail.branchSource === 'inherited' && (
                    <span className="shrink-0 text-xs text-fg-muted">
                      {inheritedMarker(parentNumber)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => copyBranch(branchUrl ?? detail.effectiveBranch!)}
                    aria-label={copyLabel}
                    title={copyLabel}
                    className="shrink-0 rounded-omarchy border border-border bg-surface px-2 py-1 text-xs text-fg hover:border-accent"
                  >
                    Copy
                  </button>
                  {copied && (
                    <span role="status" className="shrink-0 text-xs text-fg-muted">
                      Copiado
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-fg-muted">Sin rama aún</span>
              )}
            </div>
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
