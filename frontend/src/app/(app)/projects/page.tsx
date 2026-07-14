'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { useLiveEvents } from '@/lib/useLiveEvents';
import ProjectFormModal from '@/components/ProjectFormModal';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null);
      setModalOpen(true);
    }
  }, [searchParams]);

  const load = useCallback(async (q?: string) => {
    try {
      const path = q ? `/projects?search=${encodeURIComponent(q)}` : '/projects';
      const response = await api<Project[]>(path);
      setProjects(Array.isArray(response) ? response : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents(null, (event) => {
    if (event.type.startsWith('project.')) load(search || undefined);
  });

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/projects/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      setError(null);
      load(search || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">All projects</h1>
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="rounded-omarchy bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
        >
          New project
        </button>
      </div>
      {error && <p className="mb-3 rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(search || undefined);
        }}
        className="mb-4 flex gap-2"
      >
        <input
          placeholder="Search by name or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button type="submit" className="rounded-omarchy border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-accent">
          Search
        </button>
      </form>
      <table className="w-full border-collapse rounded-omarchy border border-border bg-surface text-sm">
        <thead>
          <tr className="border-b border-border text-left text-fg-muted">
            <th className="p-2">ID</th>
            <th className="p-2">Name</th>
            <th className="p-2">Description</th>
            <th className="p-2">Git repository</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b border-border hover:bg-surface-2">
              <td className="p-2 font-mono text-xs">{p.code}</td>
              <td className="p-2">{p.name}</td>
              <td className="p-2 text-fg-muted">{p.description}</td>
              <td className="p-2 text-fg-muted">{p.gitRepoUrl}</td>
              <td className="p-2">
                <button
                  onClick={() => {
                    setEditing(p);
                    setModalOpen(true);
                  }}
                  className="mr-2 text-accent hover:underline"
                >
                  Rename
                </button>
                <button onClick={() => setDeleting(p)} className="text-danger hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProjectFormModal
        open={modalOpen}
        project={editing}
        onSaved={() => load(search || undefined)}
        onClose={() => {
          setModalOpen(false);
          if (searchParams.get('new') === '1') router.replace('/projects');
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete project"
        message={`This will permanently delete "${deleting?.name}" and all its tickets.`}
        confirmLabel="Confirm"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
