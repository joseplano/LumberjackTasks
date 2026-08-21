import type { BranchState } from './branchColor';

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string;
  gitRepoUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  projectId: string;
  name: string;
  position: number;
  isCompletionColumn: boolean;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  description: string;
  position: number;
}

export interface ProjectDetail extends Project {
  columns: KanbanColumn[];
  labels: Label[];
  phases: Phase[];
}

export interface Ticket {
  id: string;
  projectId: string;
  number: number;
  parentTicketId: string | null;
  name: string;
  description: string;
  columnId: string | null;
  complexity: number;
  labelId: string | null;
  phaseId: string | null;
  tokensConsumed: number;
  llmName: string | null;
  developmentTimeMinutes: number;
  gitBranch: string | null;
  effectiveBranch: string | null;
  branchSource: 'own' | 'inherited' | null;
  createdAt: string;
  updatedAt: string;
  label?: Label | null;
  column?: KanbanColumn | null;
}

export interface StatusChange {
  id: string;
  ticketId: string;
  fromColumnName: string;
  toColumnName: string;
  changedAt: string;
  tokensDelta: number | null;
  timeDelta: number | null;
}

export interface TicketDetail extends Ticket {
  subtickets: Ticket[];
  history: StatusChange[];
  totals: { totalTokens: number; totalTimeMinutes: number };
}

export interface BacklogItem {
  id: string;
  number: number;
  name: string;
  description: string;
  complexity: number;
  parentTicketId: string | null;
  status: string;
  // Authoritative, machine-readable flag for a swept (off-board) ticket.
  // Branch on this, not on `status` -- `status` is display text and can
  // collide with a user-chosen column name of the same text.
  completed: boolean;
  label: string | null;
  subtasks: BacklogItem[];
}

export interface BacklogGroup {
  phase: Pick<Phase, 'id' | 'name' | 'position'> | null;
  tickets: BacklogItem[];
}

export interface BacklogPage {
  groups: BacklogGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectMetrics {
  totalTokens: number;
  totalTimeMinutes: number;
  ticketCount: number;
}

export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

// Feature 004: GET /projects/:projectId/git-history response shape
// (contracts/http-api.md section 1). Deliberately excludes file lists
// (research R12) -- those are fetched per-commit later, by the commit modal.
export interface GitHistoryBranch {
  id: string;
  name: string;
  isTrunk: boolean;
  forkedFromBranchName: string | null;
  state: BranchState;
  lastSyncedAt: string;
}

export interface GitHistoryCommit {
  sha: string;
  branchId: string;
  message: string;
  authorName: string;
  committedAt: string;
  pushed: boolean;
  isMerge: boolean;
  parentShas: string[];
  fileCount: number;
  truncatedFileCount: number;
}

export interface GitHistoryResponse {
  // Rule 1: the max lastSyncedAt across the project's branches, or null when
  // the project has no branches (rule 2: never-synced).
  lastSyncedAt: string | null;
  branches: GitHistoryBranch[];
  commits: GitHistoryCommit[];
}

// Feature 004: the two detail payloads (contracts/http-api.md sections 2 and 3).
// `BranchState` is reused from branchColor.ts rather than redeclared, so the
// colour rules and the modals can never drift apart.

/** A changed file. The change kinds mirror the backend's `GitFileChange`
 * enum: Added, Modified, Deleted, Renamed. */
export type GitFileChangeType = 'A' | 'M' | 'D' | 'R';

export interface GitFileRef {
  path: string;
  changeType: GitFileChangeType;
}

/**
 * A ticket association. `source` is ALWAYS present (contract section 2 rule 4):
 * it is the machine-readable half of D9 -- an inference is never presented as
 * reported data (FR-016/FR-025). The UI half is `GitTicketList`.
 */
export type GitTicketSource = 'reported' | 'inferred';

export interface GitTicketRef {
  id: string;
  number: number;
  name: string;
  source: GitTicketSource;
}

/** `GET /projects/:projectId/git-history/commits/:sha` (section 2). */
export interface GitCommitDetail {
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
  /** `> 0` means `files` is incomplete: the client MUST say how many more
   * files exist rather than present the list as complete (FR-017). */
  truncatedFileCount: number;
  tickets: GitTicketRef[];
}

/** `GET /projects/:projectId/git-history/branches/:branchId` (section 3).
 * There is deliberately no authored `description` field: the modal composes
 * one client-side from `name`, `state` and `commitMessages` (rule 4). */
export interface GitBranchDetail {
  id: string;
  name: string;
  isTrunk: boolean;
  state: BranchState;
  forkedFromBranchName: string | null;
  lastSyncedAt: string;
  /** The true total, which may exceed `commitMessages.length` (rule 5). */
  commitCount: number;
  /** Newest first, capped at 50 entries. */
  commitMessages: string[];
  files: GitFileRef[];
  truncatedFileCount: number;
  tickets: GitTicketRef[];
}
