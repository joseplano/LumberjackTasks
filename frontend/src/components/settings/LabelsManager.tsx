'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Label } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function LabelsManager({ projectId }: { projectId: string }) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editing, setEditing] = useState<Label | null>(null);
  const [forceDelete, setForceDelete] = useState<Label | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLabels(await api<Label[]>(`/projects/${projectId}/labels`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load labels');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addLabel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api(`/projects/${projectId}/labels`, {
        method: 'POST',
        body: { name: newName, color: newColor },
      });
      setNewName('');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api(`/projects/${projectId}/labels/${editing.id}`, {
        method: 'PATCH',
        body: { name: editing.name, color: editing.color },
      });
      setEditing(null);
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function remove(label: Label, force = false) {
    try {
      await api(`/projects/${projectId}/labels/${label.id}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      setForceDelete(null);
      setError(null);
      setLabels(labels.filter((l) => l.id !== label.id));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LABEL_IN_USE') {
        setForceDelete(label);
      } else {
        setError(err instanceof Error ? err.message : 'Delete failed');
        setForceDelete(null);
      }
    }
  }

  return (
    <section className="rounded-omarchy border border-border bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg">Labels</h2>
      {error && <p className="mb-2 rounded p-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-1">
        {labels.map((label) => (
          <li key={label.id} className="flex items-center gap-2 rounded-omarchy border border-border bg-surface p-2 text-sm transition-colors hover:border-accent">
            {editing?.id === label.id ? (
              <>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-0.5 text-fg focus:border-accent focus:outline-none"
                />
                <input
                  type="color"
                  value={editing.color}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  className="rounded-omarchy border border-border"
                />
                <button onClick={saveEdit} className="text-accent hover:underline">
                  Save
                </button>
              </>
            ) : (
              <>
                <span
                  className="inline-block h-4 w-4 rounded"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-fg">{label.name}</span>
                <button
                  onClick={() => setEditing(label)}
                  className="text-accent hover:underline"
                >
                  Edit
                </button>
                <button onClick={() => remove(label)} className="text-danger hover:underline">
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={addLabel} className="mt-3 flex items-center gap-2">
        <input
          placeholder="New label name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="rounded-omarchy border border-border"
        />
        <button
          type="submit"
          className="rounded-omarchy bg-accent px-3 py-1 text-sm font-medium text-bg hover:opacity-90"
        >
          Add label
        </button>
      </form>
      <ConfirmDialog
        open={forceDelete !== null}
        title="Label in use"
        message={`"${forceDelete?.name}" is assigned to existing tickets. Those tickets will lose this label. Delete anyway?`}
        onConfirm={() => forceDelete && remove(forceDelete, true)}
        onCancel={() => setForceDelete(null)}
      />
    </section>
  );
}
