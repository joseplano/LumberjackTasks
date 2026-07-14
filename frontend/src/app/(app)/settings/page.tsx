'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import ColumnsManager from '@/components/settings/ColumnsManager';
import LabelsManager from '@/components/settings/LabelsManager';
import PhasesManager from '@/components/settings/PhasesManager';
import ThemeSwitcher from '@/components/ThemeSwitcher';

export default function SettingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>('/projects')
      .then((list) => {
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects'));
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-fg">Settings</h1>
      <ThemeSwitcher />
      {error && <p className="mb-3 rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
      <label htmlFor="settings-project" className="mr-2 text-sm font-medium text-fg">
        Project
      </label>
      <select
        id="settings-project"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.code})
          </option>
        ))}
      </select>
      {projectId && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <PhasesManager key={`p-${projectId}`} projectId={projectId} />
          <ColumnsManager key={`c-${projectId}`} projectId={projectId} />
          <LabelsManager key={`l-${projectId}`} projectId={projectId} />
        </div>
      )}
    </div>
  );
}
