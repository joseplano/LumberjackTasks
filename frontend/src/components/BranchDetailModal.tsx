'use client';

import { useCallback, useEffect, useState } from 'react';
import { getGitBranchDetail } from '@/lib/api';
import type { BranchState } from '@/lib/branchColor';
import type { GitBranchDetail } from '@/lib/types';
import { GitDetailSection, GitFileList, GitModalShell, GitTicketList } from './GitDetailParts';

const STATE_WORD: Record<BranchState, string> = {
  ACTIVE: 'active',
  MERGED: 'merged',
  UNCOMMITTED: 'uncommitted',
};

/**
 * FR-015 / contract section 3 rule 4: the branch description is composed
 * here, on the client, from data already recorded for the branch — its name,
 * its state and its commit messages. No authored description field exists,
 * in the API or in the database, and none may be added.
 */
export function composeBranchDescription(branch: GitBranchDetail): string {
  const state = STATE_WORD[branch.state] ?? branch.state.toLowerCase();
  const commits = `${branch.commitCount} commit${branch.commitCount === 1 ? '' : 's'} recorded`;
  if (branch.isTrunk) {
    return `Branch "${branch.name}" is this project's trunk and is currently ${state}, with ${commits}.`;
  }
  const origin = branch.forkedFromBranchName
    ? ` It was forked from ${branch.forkedFromBranchName}.`
    : '';
  return `Branch "${branch.name}" is currently ${state}, with ${commits}.${origin}`;
}

/**
 * T058 (FR-015): the branch modal. Opened from a branch lane in `RepoTree`
 * via its existing `onBranchSelect` prop; keyed on `branchId`, not name,
 * because branch names contain `/` (research R12).
 *
 * Read-only: its single call is `GET .../git-history/branches/:branchId`.
 */
export default function BranchDetailModal({
  projectId,
  branchId,
  onClose,
}: {
  projectId: string;
  branchId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<GitBranchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDetail(null);
    setError(null);
    try {
      setDetail(await getGitBranchDetail(projectId, branchId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branch');
    }
  }, [projectId, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Rule 5: `commitMessages` is capped at 50 while `commitCount` is the true
  // total. When it is shorter, say so -- a shortened list is never presented
  // as the whole (same principle as FR-017).
  const messagesAreSubset = detail !== null && detail.commitCount > detail.commitMessages.length;

  return (
    <GitModalShell
      label="Branch details"
      title={<span className="font-mono">{detail?.name ?? 'Branch'}</span>}
      subtitle={
        detail ? (
          <p className="mt-0.5 text-sm text-fg-muted">
            {detail.isTrunk ? 'Trunk · ' : ''}
            {STATE_WORD[detail.state] ?? detail.state}
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
          <div data-testid="branch-description" className="mt-3">
            <p className="text-sm text-fg">{composeBranchDescription(detail)}</p>
            {detail.commitMessages.length > 0 && (
              <ul data-testid="branch-commit-messages" className="mt-2 space-y-1 text-sm text-fg-muted">
                {detail.commitMessages.map((message, i) => (
                  <li key={`${i}-${message}`} data-testid="branch-commit-message" className="break-words">
                    {message}
                  </li>
                ))}
              </ul>
            )}
            {messagesAreSubset && (
              <p
                data-testid="commit-messages-subset"
                className="mt-2 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted"
              >
                Showing {detail.commitMessages.length} of {detail.commitCount} commit messages — a
                subset of this branch&apos;s history, not all of it.
              </p>
            )}
          </div>

          <GitDetailSection heading="Tickets">
            <GitTicketList tickets={detail.tickets} />
          </GitDetailSection>

          <GitDetailSection heading="Files changed across its commits">
            <GitFileList files={detail.files} truncatedFileCount={detail.truncatedFileCount} />
          </GitDetailSection>
        </>
      )}
    </GitModalShell>
  );
}
