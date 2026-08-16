'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { KanbanColumn } from '@/lib/types';

export default function ColumnsManager({ projectId }: { projectId: string }) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KanbanColumn | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setColumns(await api<KanbanColumn[]>(`/projects/${projectId}/columns`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load columns');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addColumn(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api(`/projects/${projectId}/columns`, { method: 'POST', body: { name: newName } });
      setNewName('');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function saveRename() {
    if (!renaming) return;
    try {
      await api(`/projects/${projectId}/columns/${renaming.id}`, {
        method: 'PATCH',
        body: { name: renaming.name },
      });
      setRenaming(null);
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    }
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const ids = columns.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api(`/projects/${projectId}/columns/order`, {
        method: 'PUT',
        body: { orderedIds: ids },
      });
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorder failed');
    }
  }

  async function remove(col: KanbanColumn, destination?: string) {
    const suffix = destination ? `?moveTo=${destination}` : '';
    try {
      await api(`/projects/${projectId}/columns/${col.id}${suffix}`, { method: 'DELETE' });
      setPendingDelete(null);
      setError(null);
      setColumns(columns.filter((c) => c.id !== col.id));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COLUMN_NOT_EMPTY') {
        setPendingDelete(col);
        const firstOther = columns.find((c) => c.id !== col.id);
        setMoveTo(firstOther?.id ?? '');
      } else {
        setError(err instanceof Error ? err.message : 'Delete failed');
        setPendingDelete(null);
      }
    }
  }

  async function setCompletion(col: KanbanColumn, isCompletionColumn: boolean) {
    try {
      await api(`/projects/${projectId}/columns/${col.id}`, {
        method: 'PATCH',
        body: { isCompletionColumn },
      });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update completion column');
    }
  }

  return (
    <section className="rounded-omarchy border border-border bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg">Kanban columns</h2>
      {error && <p className="mb-2 rounded p-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-1">
        {columns.map((col, i) => (
          <li key={col.id} className="flex items-center gap-2 rounded-omarchy border border-border bg-surface p-2 text-sm transition-colors hover:border-accent">
            {renaming?.id === col.id ? (
              <>
                <input
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: col.id, name: e.target.value })}
                  className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-0.5 text-fg focus:border-accent focus:outline-none"
                />
                <button onClick={saveRename} className="text-accent hover:underline">
                  Save
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-fg">{col.name}</span>
                <label className="flex items-center gap-1 text-xs text-fg-faint">
                  <input
                    type="checkbox"
                    aria-label={`Completion column: ${col.name}`}
                    checked={col.isCompletionColumn}
                    onChange={() => setCompletion(col, !col.isCompletionColumn)}
                    className="rounded border-border text-accent focus:outline-none"
                  />
                  Completion
                </label>
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
                  onClick={() => setRenaming({ id: col.id, name: col.name })}
                  className="text-accent hover:underline"
                >
                  Rename
                </button>
                <button onClick={() => remove(col)} className="text-danger hover:underline">
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {pendingDelete && (
        <div className="mt-3 rounded-omarchy border border-border bg-surface-2 p-3 text-sm text-fg">
          <p>
            &quot;{pendingDelete.name}&quot; contains tickets. Move its tickets to:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg focus:border-accent focus:outline-none"
            >
              {columns
                .filter((c) => c.id !== pendingDelete.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button
              onClick={() => remove(pendingDelete, moveTo)}
              className="rounded-omarchy bg-danger px-3 py-1 text-bg"
            >
              Move &amp; delete
            </button>
            <button
              onClick={() => setPendingDelete(null)}
              className="rounded-omarchy border border-border bg-surface px-3 py-1 text-fg transition-colors hover:border-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <form onSubmit={addColumn} className="mt-3 flex gap-2">
        <input
          placeholder="New column name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-omarchy bg-accent px-3 py-1 text-sm font-medium text-bg hover:opacity-90"
        >
          Add column
        </button>
      </form>
    </section>
  );
}
