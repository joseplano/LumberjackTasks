'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, getGitHistory } from '@/lib/api';
import type { GitHistoryResponse, ProjectDetail } from '@/lib/types';
import RepoTree from '@/components/RepoTree';

// T047 (FR-002, FR-003): a read-only view of the project's git history.
// GET-only -- it never creates, modifies or deletes any domain state
// (constitution Principle I, FR-003).
export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [history, setHistory] = useState<GitHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProjectDetail>(`/projects/${id}`).then(setProject).catch(() => setProject(null));
  }, [id]);

  const load = useCallback(async () => {
    try {
      setHistory(await getGitHistory(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository history');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Loading/error convention shared with the other project sub-routes (see
  // .../projects/[id]/page.tsx). The full three-state (loading / failed /
  // never-synced) honesty behaviour is a later task (T061-T063); this is
  // deliberately just the first two states so that work layers on cleanly.
  if (error) return <p className="rounded-omarchy border border-danger bg-surface p-3 text-danger">{error}</p>;
  if (!history) return <p className="text-fg-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Repository{project ? ` — ${project.name}` : ''}</h1>
        <Link
          href={`/projects/${id}`}
          className="rounded-omarchy border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
        >
          Back to board
        </Link>
      </div>
      {/* FR-009: the container scrolls horizontally, so the SVG (sized from
          buildRepoTree's width/height) can be wider than its container and
          the scrollbar sits along the bottom of the tree. */}
      <div className="overflow-x-auto rounded-omarchy border border-border bg-surface p-4">
        <RepoTree branches={history.branches} commits={history.commits} />
      </div>
    </div>
  );
}
