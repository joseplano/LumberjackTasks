'use client';

import type { GitFileRef, GitTicketRef } from '@/lib/types';

/**
 * The pieces the commit modal (FR-014) and the branch modal (FR-015) must
 * present *identically*. T057 requires inferred tickets to be labelled
 * "exactly as in the commit modal", so the wording lives here once rather
 * than being written twice and drifting.
 */

/**
 * FR-016 / D9 / SC-006: an inference is never presented as reported fact.
 * Real, user-visible text -- deliberately not just a `data-` attribute, which
 * a reader would never see.
 */
export const INFERRED_TICKET_LABEL = 'Inferred by branch';

const CHANGE_TYPE_LABEL: Record<GitFileRef['changeType'], string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
};

export function GitTicketList({ tickets }: { tickets: GitTicketRef[] }) {
  if (tickets.length === 0) {
    return (
      <p data-testid="git-tickets-empty" className="mt-1 text-sm text-fg-muted">
        No tickets are associated with this.
      </p>
    );
  }
  return (
    <ul data-testid="git-tickets" className="mt-1 space-y-1 text-sm">
      {tickets.map((t) => (
        <li key={t.id} data-testid="git-ticket" data-source={t.source} className="text-fg">
          <span className="mr-1 text-fg-faint">#{t.number}</span>
          {t.name}
          {t.source === 'inferred' && (
            <span
              data-testid="git-ticket-inferred"
              className="ml-2 rounded-omarchy border border-border px-1.5 py-0.5 text-xs text-fg-muted"
            >
              {INFERRED_TICKET_LABEL}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * FR-017 (and contract section 3 rule 2): when the stored list was truncated,
 * say how many further files exist. A shortened list is never presented as
 * the whole.
 */
export function GitFileList({
  files,
  truncatedFileCount,
}: {
  files: GitFileRef[];
  truncatedFileCount: number;
}) {
  const total = files.length + truncatedFileCount;
  return (
    <>
      {files.length === 0 ? (
        <p data-testid="git-files-empty" className="mt-1 text-sm text-fg-muted">
          No files recorded.
        </p>
      ) : (
        <ul data-testid="git-files" className="mt-1 space-y-0.5 font-mono text-xs">
          {files.map((f) => (
            <li key={f.path} data-testid="git-file" data-change-type={f.changeType} className="text-fg">
              <span className="mr-2 text-fg-muted">[{CHANGE_TYPE_LABEL[f.changeType] ?? f.changeType}]</span>
              <span className="break-all">{f.path}</span>
            </li>
          ))}
        </ul>
      )}
      {truncatedFileCount > 0 && (
        <p
          data-testid="files-truncated"
          className="mt-2 rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted"
        >
          Showing {files.length} of {total} files — {truncatedFileCount} more changed files were
          not stored, so this list is incomplete.
        </p>
      )}
    </>
  );
}

/**
 * The modal shell both detail modals share, matching `TicketDetailModal`'s
 * structure, styling and dismiss behaviour rather than inventing a second
 * modal idiom.
 */
export function GitModalShell({
  label,
  title,
  subtitle,
  onClose,
  children,
}: {
  label: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="max-h-[85vh] w-[36rem] overflow-y-auto rounded-omarchy border border-border bg-surface p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-all text-lg font-semibold text-fg">{title}</h2>
            {subtitle}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl font-bold text-fg-faint">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GitDetailSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-fg">{heading}</h3>
      {children}
    </div>
  );
}
