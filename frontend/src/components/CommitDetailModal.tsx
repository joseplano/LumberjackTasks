'use client';

import { useEffect, useState } from 'react';
import { getGitCommitDetail } from '@/lib/api';
import type { GitCommitDetail } from '@/lib/types';
import { GitDetailSection, GitFileList, GitModalShell, GitTicketList } from './GitDetailParts';

/**
 * T053 (FR-014, FR-016, FR-017): the commit modal. Opened from a commit
 * circle in `RepoTree`; the selection state lives in the route
 * (`projects/[id]/repo/page.tsx`) so the tree stays presentational.
 *
 * Read-only: its single call is `GET .../git-history/commits/:sha` through
 * the shared api helper (FR-003, constitution Principle I).
 */
export default function CommitDetailModal({
  projectId,
  sha,
  onClose,
}: {
  projectId: string;
  sha: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guards against a stale-response race: the route reuses this component
    // instance across selections (only `sha` changes), so a slower response
    // to an earlier selection could otherwise land after a newer one and
    // paint the wrong commit's data with no error shown.
    let ignore = false;
    setDetail(null);
    setError(null);
    (async () => {
      try {
        const result = await getGitCommitDetail(projectId, sha);
        if (!ignore) setDetail(result);
      } catch (err) {
        // No silent failure (constitution): show the backend's reason.
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load commit');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [projectId, sha]);

  return (
    <GitModalShell
      label="Commit details"
      title={<span className="font-mono">{sha.slice(0, 7)}</span>}
      subtitle={
        detail ? (
          <p data-testid="commit-branch" className="mt-0.5 text-sm text-fg-muted">
            on <span className="font-mono text-fg">{detail.branchName}</span>
            {detail.isMerge ? ' · merge commit' : ''}
            {detail.pushed ? ' · pushed' : ' · not pushed'}
          </p>
        ) : undefined
      }
      onClose={onClose}
    >
      {error && (
        <p className="mt-2 rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>
      )}
      {!detail ? (
        !error && <p className="mt-2 text-fg-muted">Loading…</p>
      ) : (
        <>
          <p data-testid="commit-message" className="mt-3 whitespace-pre-wrap text-sm text-fg">
            {detail.message}
          </p>
          <p className="mt-2 text-xs text-fg-muted">
            {detail.authorName} ·{' '}
            <time data-testid="commit-date" dateTime={detail.committedAt}>
              {new Date(detail.committedAt).toLocaleString()}
            </time>
          </p>

          <GitDetailSection heading="Tickets">
            <GitTicketList tickets={detail.tickets} />
          </GitDetailSection>

          <GitDetailSection heading="Files changed">
            <GitFileList files={detail.files} truncatedFileCount={detail.truncatedFileCount} />
          </GitDetailSection>
        </>
      )}
    </GitModalShell>
  );
}
