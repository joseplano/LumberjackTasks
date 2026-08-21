import { Router } from 'express';
import type { GitBranchState, GitFileChange } from '@prisma/client';

/**
 * Response types for the four repository-history endpoints of feature
 * 004-view-repo-git-tree, transcribed from
 * `specs/004-view-repo-git-tree/contracts/http-api.md`.
 *
 * Dates are ISO 8601 strings: these describe what goes over the wire after
 * `res.json()`, not the Prisma row shapes.
 *
 * The router is deliberately empty for now. It exists so the module has a valid
 * default export to mount; mounting it in `src/app.ts` is T028.
 */

/** A ticket association. `source` is ALWAYS present: contracts rule 4 of
 * endpoint 2 makes this the machine-readable half of D9 -- an inference is never
 * presented as reported data (FR-025). */
export type GitTicketLinkSource = 'reported' | 'inferred';

export interface GitTicketRef {
  id: string;
  number: number;
  name: string;
  source: GitTicketLinkSource;
}

export interface GitFileRef {
  path: string;
  changeType: GitFileChange;
}

/** A branch as it appears in the tree payload. */
export interface GitBranchSummary {
  id: string;
  name: string;
  isTrunk: boolean;
  forkedFromBranchName: string | null;
  state: GitBranchState;
  lastSyncedAt: string;
}

/** A commit as it appears in the tree payload. File lists are excluded on
 * purpose (research R12): the tree needs every commit but no file paths. */
export interface GitCommitSummary {
  sha: string;
  branchId: string;
  message: string;
  authorName: string;
  committedAt: string;
  pushed: boolean;
  isMerge: boolean;
  parentShas: string[];
  /** Number of STORED file rows. `fileCount + truncatedFileCount` is the real total. */
  fileCount: number;
  truncatedFileCount: number;
}

/** `GET /api/v1/projects/:projectId/git-history`
 *
 * `lastSyncedAt: null` with both arrays empty means NEVER SYNCED (FR-029), which
 * the client must distinguish from a transport failure (FR-033). Commits are
 * ordered by `committedAt` ascending, ties broken by `sha` ascending. */
export interface GitHistoryTreeResponse {
  lastSyncedAt: string | null;
  branches: GitBranchSummary[];
  commits: GitCommitSummary[];
}

/** `GET /api/v1/projects/:projectId/git-history/commits/:sha` */
export interface GitCommitDetailResponse {
  sha: string;
  branchId: string;
  branchName: string;
  message: string;
  authorName: string;
  committedAt: string;
  pushed: boolean;
  isMerge: boolean;
  parentShas: string[];
  /** At most 500 entries (FR-023), ordered by `path` ascending. */
  files: GitFileRef[];
  /** `> 0` means `files` is incomplete and the client must say how many more
   * exist rather than present the list as complete (FR-017). */
  truncatedFileCount: number;
  tickets: GitTicketRef[];
}

/** `GET /api/v1/projects/:projectId/git-history/branches/:branchId`
 *
 * Keyed on id, not name: branch names contain `/`, which cannot travel in a
 * single path segment without double-encoding that proxies mangle (research R12). */
export interface GitBranchDetailResponse {
  id: string;
  name: string;
  isTrunk: boolean;
  state: GitBranchState;
  forkedFromBranchName: string | null;
  lastSyncedAt: string;
  /** The true total, which may exceed `commitMessages.length`. */
  commitCount: number;
  /** Newest first, capped at 50 entries (FR-015). */
  commitMessages: string[];
  /** The distinct union of the paths the branch's commits changed, ordered by
   * `path` ascending; the type from the most recent commit wins. */
  files: GitFileRef[];
  /** Summed across the branch's commits. */
  truncatedFileCount: number;
  tickets: GitTicketRef[];
}

/** `POST /api/v1/projects/:projectId/git-history/sync` -- the only write path.
 * Idempotent (FR-026) and additive (FR-032): re-sending a batch changes no count
 * and nothing is ever deleted. */
export interface GitHistorySyncResponse {
  branchesUpserted: number;
  commitsUpserted: number;
  filesUpserted: number;
  ticketLinksUpserted: number;
  lastSyncedAt: string;
}

const router = Router();

export default router;
