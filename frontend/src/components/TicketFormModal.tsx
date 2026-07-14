'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FIBONACCI, type ProjectDetail, type Ticket } from '@/lib/types';

export default function TicketFormModal({
  open,
  project,
  ticket,
  parentTicketId,
  onSaved,
  onClose,
}: {
  open: boolean;
  project: ProjectDetail;
  ticket?: Ticket | null;
  parentTicketId?: string | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [complexity, setComplexity] = useState(1);
  const [labelId, setLabelId] = useState('');
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [tokens, setTokens] = useState('0');
  const [llmName, setLlmName] = useState('');
  const [minutes, setMinutes] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(ticket?.name ?? '');
    setDescription(ticket?.description ?? '');
    setComplexity(ticket?.complexity ?? 1);
    setLabelId(ticket?.labelId ?? '');
    setPhaseId(ticket?.phaseId ?? null);
    setTokens(String(ticket?.tokensConsumed ?? 0));
    setLlmName(ticket?.llmName ?? '');
    setMinutes(String(ticket?.developmentTimeMinutes ?? 0));
    setError(null);
  }, [ticket, open]);

  const isSubtask = Boolean(parentTicketId ?? ticket?.parentTicketId);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const tokensNum = Number(tokens) || 0;
    const minutesNum = Number(minutes) || 0;
    if (tokensNum > 0 && !llmName.trim()) {
      setError('LLM name is required when tokens are consumed');
      return;
    }
    setBusy(true);
    const base = {
      name,
      description,
      complexity,
      labelId: labelId || null,
      ...(isSubtask ? {} : { phaseId }),
      tokensConsumed: tokensNum,
      llmName: llmName.trim() || null,
      developmentTimeMinutes: minutesNum,
    };
    try {
      if (ticket) {
        await api(`/tickets/${ticket.id}`, { method: 'PATCH', body: base });
      } else {
        await api(`/projects/${project.id}/tickets`, {
          method: 'POST',
          body: { ...base, parentTicketId: parentTicketId ?? null },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form onSubmit={onSubmit} className="w-[30rem] space-y-3 rounded-omarchy border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-fg">
          {ticket ? `Edit ticket #${ticket.number}` : parentTicketId ? 'New subticket' : 'New ticket'}
        </h2>
        {error && <p className="rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
        <div>
          <label htmlFor="t-name" className="block text-sm font-medium text-fg">
            Name
          </label>
          <input
            id="t-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="t-desc" className="block text-sm font-medium text-fg">
            Description
          </label>
          <textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="t-complexity" className="block text-sm font-medium text-fg">
              Complexity
            </label>
            <select
              id="t-complexity"
              value={complexity}
              onChange={(e) => setComplexity(Number(e.target.value))}
              className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            >
              {FIBONACCI.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="t-label" className="block text-sm font-medium text-fg">
              Label
            </label>
            <select
              id="t-label"
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            >
              <option value="">— none —</option>
              {project.labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {!isSubtask && (
            <div className="col-span-2">
              <label htmlFor="t-phase" className="block text-sm font-medium text-fg">
                Phase
              </label>
              <select
                id="t-phase"
                value={phaseId ?? ''}
                onChange={(e) => setPhaseId(e.target.value || null)}
                className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
              >
                <option value="">No phase</option>
                {project.phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="t-tokens" className="block text-sm font-medium text-fg">
              Tokens consumed
            </label>
            <input
              id="t-tokens"
              type="number"
              min={0}
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
              className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="t-llm" className="block text-sm font-medium text-fg">
              LLM name
            </label>
            <input
              id="t-llm"
              value={llmName}
              onChange={(e) => setLlmName(e.target.value)}
              className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="t-minutes" className="block text-sm font-medium text-fg">
              Time (minutes)
            </label>
            <input
              id="t-minutes"
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-omarchy border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-accent">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-omarchy bg-accent px-3 py-1 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
