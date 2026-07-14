'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';

export default function ProjectFormModal({
  open,
  project,
  onSaved,
  onClose,
}: {
  open: boolean;
  project?: Project | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setGitRepoUrl(project?.gitRepoUrl ?? '');
    setError(null);
  }, [project, open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (project) {
        await api(`/projects/${project.id}`, {
          method: 'PATCH',
          body: { name, description, gitRepoUrl },
        });
      } else {
        await api('/projects', { method: 'POST', body: { name, description, gitRepoUrl } });
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
      <form onSubmit={onSubmit} className="w-[28rem] space-y-3 rounded-omarchy border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-fg">{project ? 'Edit project' : 'New project'}</h2>
        {error && <p className="rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
        <div>
          <label htmlFor="proj-name" className="block text-sm font-medium text-fg">
            Name
          </label>
          <input
            id="proj-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="proj-desc" className="block text-sm font-medium text-fg">
            Description
          </label>
          <textarea
            id="proj-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="proj-git" className="block text-sm font-medium text-fg">
            Git repository URL
          </label>
          <input
            id="proj-git"
            value={gitRepoUrl}
            onChange={(e) => setGitRepoUrl(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
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
