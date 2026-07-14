'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Phase } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function PhasesManager({ projectId }: { projectId: string }) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [editing, setEditing] = useState<Phase | null>(null);
  const [forceDelete, setForceDelete] = useState<Phase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPhases(await api<Phase[]>(`/projects/${projectId}/phases`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load phases');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPhase(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api(`/projects/${projectId}/phases`, {
        method: 'POST',
        body: { name: newName, description: newDescription },
      });
      setNewName('');
      setNewDescription('');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api(`/projects/${projectId}/phases/${editing.id}`, {
        method: 'PATCH',
        body: { name: editing.name, description: editing.description },
      });
      setEditing(null);
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= phases.length) return;
    const ids = phases.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api(`/projects/${projectId}/phases/order`, {
        method: 'PUT',
        body: { orderedIds: ids },
      });
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorder failed');
    }
  }

  async function remove(phase: Phase, force = false) {
    try {
      await api(`/projects/${projectId}/phases/${phase.id}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      setForceDelete(null);
      setError(null);
      setPhases(phases.filter((p) => p.id !== phase.id));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PHASE_NOT_EMPTY') {
        setForceDelete(phase);
      } else {
        setError(err instanceof Error ? err.message : 'Delete failed');
        setForceDelete(null);
      }
    }
  }

  return (
    <section className="rounded-omarchy border border-border bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg">Phases</h2>
      {error && <p className="mb-2 rounded p-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-1">
        {phases.map((phase, i) => (
          <li key={phase.id} className="flex items-center gap-2 rounded-omarchy border border-border bg-surface p-2 text-sm transition-colors hover:border-accent">
            {editing?.id === phase.id ? (
              <>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-0.5 text-fg focus:border-accent focus:outline-none"
                />
                <input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Description"
                  className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-0.5 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
                />
                <button onClick={saveEdit} className="text-accent hover:underline">
                  Save
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-fg">{phase.name}</span>
                <button
                  aria-label="Move up"
                  onClick={() => move(i, -1)}
                  className="rounded border border-border px-1 text-fg transition-colors hover:border-accent"
                >
                  ↑
                </button>
                <button
                  aria-label="Move down"
                  onClick={() => move(i, 1)}
                  className="rounded border border-border px-1 text-fg transition-colors hover:border-accent"
                >
                  ↓
                </button>
                <button
                  onClick={() => setEditing(phase)}
                  className="text-accent hover:underline"
                >
                  Rename
                </button>
                <button onClick={() => remove(phase)} className="text-danger hover:underline">
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={addPhase} className="mt-3 flex items-center gap-2">
        <input
          placeholder="New phase name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <input
          placeholder="Description"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-omarchy bg-accent px-3 py-1 text-sm font-medium text-bg hover:opacity-90"
        >
          Add phase
        </button>
      </form>
      <ConfirmDialog
        open={forceDelete !== null}
        title="Phase has tickets"
        message={`"${forceDelete?.name}" has tickets assigned to it. Forcing delete will unassign its tickets from this phase; the tickets themselves will not be deleted. Delete anyway?`}
        onConfirm={() => forceDelete && remove(forceDelete, true)}
        onCancel={() => setForceDelete(null)}
      />
    </section>
  );
}
