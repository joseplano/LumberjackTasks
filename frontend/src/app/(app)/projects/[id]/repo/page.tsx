'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, getGitHistory } from '@/lib/api';
import type { GitHistoryResponse, ProjectDetail } from '@/lib/types';
import RepoTree from '@/components/RepoTree';
import CommitDetailModal from '@/components/CommitDetailModal';
import BranchDetailModal from '@/components/BranchDetailModal';

// Fix round 2 (Minor 3): a single discriminated selection, rather than two
// independent nullable ids, so a commit modal and a branch modal can never
// both be open at once -- selecting one always replaces the other, instead
// of merely leaving that outcome to be remembered at every call site.
type Selection = { kind: 'commit'; sha: string } | { kind: 'branch'; branchId: string } | null;

// T047 (FR-002, FR-003): a read-only view of the project's git history.
// GET-only -- it never creates, modifies or deletes any domain state
// (constitution Principle I, FR-003). T072 asserts that executably.
export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [history, setHistory] = useState<GitHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selection lives here, not in RepoTree: the tree stays presentational and
  // reports selections upward through its existing props (T053/T058).
  const [selection, setSelection] = useState<Selection>(null);

  // Fix wave (Minor 6): this used to be `.catch(() => setProject(null))`, which
  // dropped the project name out of the header on a transient failure and said
  // nothing about it. On a screen whose whole subject is that an absence must
  // never be presented as a fact (FR-029/FR-033), a swallowed error is exactly
  // the wrong default: the header would read "Repository" as if that were the
  // project's whole identity. The failure is now named and retryable. It stays
  // NON-fatal -- the history is what this screen is for, and it loads
  // independently -- so it degrades the header rather than replacing the page.
  const loadProject = useCallback(async () => {
    try {
      setProject(await api<ProjectDetail>(`/projects/${id}`));
      setProjectError(null);
    } catch (err) {
      setProject(null);
      setProjectError(err instanceof Error ? err.message : 'Failed to load the project');
    }
  }, [id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

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

  // Fix wave (Minor 6): the header is rendered by EVERY state, the failure
  // ones included. It previously returned before the "Back to board" link, so
  // a failed load left the user on a dead screen with no way out and no way to
  // retry -- the one state where navigation matters most.
  const header = (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-fg">
          Repository{project ? ` — ${project.name}` : ''}
        </h1>
        {/* The project fetch failing is reported, not hidden. It is a separate
            failure from the history fetch below and must not be conflated with
            it: the history may well have loaded fine. */}
        {projectError !== null && (
          <p data-testid="repo-project-error" className="mt-0.5 text-sm text-danger">
            The project name could not be loaded: {projectError}{' '}
            <button
              type="button"
              data-testid="repo-project-retry"
              onClick={loadProject}
              className="underline hover:no-underline"
            >
              Try again
            </button>
          </p>
        )}
        {/* FR-028/SC-008: shown whenever there is a real timestamp, and
            never invented when there is not. */}
        {history?.lastSyncedAt != null && (
          <p className="mt-0.5 text-sm text-fg-muted">
            Last synced{' '}
            <time data-testid="last-synced" dateTime={history.lastSyncedAt}>
              {new Date(history.lastSyncedAt).toLocaleString()}
            </time>
          </p>
        )}
      </div>
      <Link
        href={`/projects/${id}`}
        className="shrink-0 rounded-omarchy border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
      >
        Back to board
      </Link>
    </div>
  );

  // T063 (FR-033, SC-012): three states that must never be conflated.
  //
  // 1. FAILED. Named reason, from the ApiError the backend produced -- never a
  //    generic apology, and never rendered as an empty history.
  if (error) {
    return (
      <div>
        {header}
        <p
          data-testid="repo-error"
          className="rounded-omarchy border border-danger bg-surface p-3 text-danger"
        >
          {error}
        </p>
        {/* A retry, not a sync: this re-issues the same GET and remains
            read-only (constitution Principle I, FR-003). */}
        <button
          type="button"
          data-testid="repo-retry"
          onClick={load}
          className="mt-3 rounded-omarchy border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
        >
          Try again
        </button>
      </div>
    );
  }
  // 2. LOADING. The convention the other project sub-routes already use (see
  //    .../projects/[id]/page.tsx). Deliberately not the empty state: a fetch
  //    in flight is not an absence of history.
  if (!history) {
    return (
      <div>
        {header}
        <p data-testid="repo-loading" className="text-fg-muted">
          Loading…
        </p>
      </div>
    );
  }

  // 3. NEVER SYNCED. Reached only after a SUCCESSFUL load, and only for the
  //    exact shape contracts/http-api.md section 1 rule 2 defines: a 200 with
  //    a null lastSyncedAt and both arrays empty.
  const neverSynced =
    history.lastSyncedAt === null && history.branches.length === 0 && history.commits.length === 0;

  return (
    <div>
      {header}

      {neverSynced ? (
        // FR-029: explain how to sync. INSTRUCTIONS, never a control -- a
        // sync button here would make this screen a second write path, which
        // constitution Principle I forbids outright.
        <div
          data-testid="repo-never-synced"
          className="rounded-omarchy border border-border bg-surface p-6 text-sm text-fg-muted"
        >
          <h2 className="text-base font-semibold text-fg">
            This project&apos;s repository history has never been synced.
          </h2>
          <p className="mt-2">
            Nothing is drawn here because nothing has been recorded yet — not because the
            repository is empty. This screen only ever shows history that was reported to it.
          </p>
          <p className="mt-2">
            History is mirrored from the working repository by the agent, which is the only writer.
            This view is read-only and cannot sync anything itself.
          </p>
          <p className="mt-2">
            To populate it, ask the agent to sync this project&apos;s git history. It records the
            branches and commits through the <code className="font-mono text-fg">sync_git_history</code>{' '}
            tool, driven by the{' '}
            <code className="font-mono text-fg">lumberjack-tasks:ticket-sync</code> skill.
          </p>
        </div>
      ) : (
        /* FR-009: the container scrolls horizontally, so the SVG (sized from
           buildRepoTree's width/height) can be wider than its container and
           the scrollbar sits along the bottom of the tree. */
        <div className="overflow-x-auto rounded-omarchy border border-border bg-surface p-4">
          <RepoTree
            branches={history.branches}
            commits={history.commits}
            onCommitSelect={(sha) => setSelection({ kind: 'commit', sha })}
            onBranchSelect={(branchId) => setSelection({ kind: 'branch', branchId })}
          />
        </div>
      )}

      {selection?.kind === 'commit' && (
        <CommitDetailModal projectId={id} sha={selection.sha} onClose={() => setSelection(null)} />
      )}
      {selection?.kind === 'branch' && (
        <BranchDetailModal
          projectId={id}
          branchId={selection.branchId}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
