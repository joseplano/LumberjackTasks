import { ApiError } from '../middleware/errors';

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;

export function validateTicketData(data: {
  complexity: number;
  tokensConsumed: number;
  developmentTimeMinutes: number;
  llmName: string | null;
}): void {
  if (!FIBONACCI_COMPLEXITY.includes(data.complexity as (typeof FIBONACCI_COMPLEXITY)[number])) {
    throw new ApiError(
      400,
      'INVALID_COMPLEXITY',
      `complexity must be one of ${FIBONACCI_COMPLEXITY.join(', ')}`,
    );
  }
  if (data.tokensConsumed < 0) {
    throw new ApiError(400, 'NEGATIVE_TOKENS', 'tokensConsumed cannot be negative');
  }
  if (data.developmentTimeMinutes < 0) {
    throw new ApiError(400, 'NEGATIVE_TIME', 'developmentTimeMinutes cannot be negative');
  }
  if (data.tokensConsumed > 0 && !data.llmName?.trim()) {
    throw new ApiError(400, 'LLM_REQUIRED', 'llmName is required when tokens are consumed');
  }
}

// FR-011a: "completed / off the board" ranks strictly after every column, so
// a null position (a completed ticket or subticket) is always treated as
// greater than any real column position.
const RANK_OFF_BOARD = Number.POSITIVE_INFINITY;

export function validateParentMove(
  targetPosition: number,
  currentPosition: number | null,
  subticketPositions: (number | null)[],
): void {
  const currentRank = currentPosition ?? RANK_OFF_BOARD;
  if (targetPosition <= currentRank) return; // moving backwards or staying is always allowed
  const behind = subticketPositions.filter((p) => (p ?? RANK_OFF_BOARD) < targetPosition);
  if (behind.length > 0) {
    throw new ApiError(
      409,
      'PARENT_MOVE_BLOCKED',
      `Cannot move parent ticket forward: ${behind.length} subticket(s) are not yet in the target column or a later one`,
    );
  }
}

// FR-009: the closed set of things a reported branch value may not contain.
// This is a rejection list for values that cannot be a git reference, NOT a
// naming-convention or style check -- FR-025 explicitly forbids one, so no rule
// may be added here (a leading dot, a trailing dot, a leading dash and an empty
// path segment are all accepted on purpose).
const BRANCH_FORBIDDEN_CHARS = ['~', '^', ':', '?', '*', '[', '\\'] as const;
const BRANCH_FORBIDDEN_SEQUENCES = ['..', '@{'] as const;
const BRANCH_MAX_LENGTH = 255;
const BRANCH_WHITESPACE = /\s/;
// ASCII control characters are matched by code point rather than by a regular
// expression, so no control character has to be embedded in this source file.
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export type BranchSource = 'own' | 'inherited' | null;

export function normalizeBranch(branch: string | null): string | null;
export function normalizeBranch(branch: string | null | undefined): string | null | undefined;
export function normalizeBranch(branch: string | null | undefined): string | null | undefined {
  // FR-006: an absent field is not the same as null -- it leaves the stored
  // value untouched, so it is handed straight back and never validated.
  if (branch === undefined) return undefined;
  if (branch === null) return null;

  // FR-010: a REST caller can send any JSON value. A non-string must be a
  // validation failure that leaves the stored value alone, never a TypeError
  // from .trim() surfacing as a 500.
  if (typeof branch !== 'string') {
    throw new ApiError(
      400,
      'VALIDATION',
      'branch must be a string, null or absent',
    );
  }

  // The order trim -> empty-clears -> validate is load-bearing (FR-007, FR-008,
  // FR-009): validating first would reject " main " for containing whitespace,
  // and a clear must never be validated at all.
  const trimmed = branch.trim();
  if (trimmed === '') return null;

  const reject = (reason: string): never => {
    throw new ApiError(400, 'VALIDATION', `branch is not a valid git reference: ${reason}`);
  };

  if (BRANCH_WHITESPACE.test(trimmed)) reject('it contains whitespace');
  for (const char of BRANCH_FORBIDDEN_CHARS) {
    if (trimmed.includes(char)) reject(`it contains ${char}`);
  }
  for (const sequence of BRANCH_FORBIDDEN_SEQUENCES) {
    if (trimmed.includes(sequence)) reject(`it contains ${sequence}`);
  }
  if (hasControlCharacter(trimmed)) reject('it contains a control character');
  if (trimmed.startsWith('/')) reject('it begins with /');
  if (trimmed.endsWith('/')) reject('it ends with /');
  if (trimmed.endsWith('.lock')) reject('it ends with .lock');
  // Measured after trimming, so " <255 chars> " is accepted.
  if (trimmed.length > BRANCH_MAX_LENGTH) {
    reject(`it is longer than ${BRANCH_MAX_LENGTH} characters`);
  }

  return trimmed;
}

// Pure derivation -- no database access and no I/O. Nesting is one level only,
// so `parentBranch` undefined means "this ticket has no parent"; see the truth
// table in specs/002-ticket-git-branch-view/data-model.md. FR-026: the branch is
// never discovered by reading a repository or the filesystem.
export function deriveBranch(
  gitBranch: string | null,
  parentBranch: string | null | undefined,
): { effectiveBranch: string | null; branchSource: BranchSource } {
  if (gitBranch != null) return { effectiveBranch: gitBranch, branchSource: 'own' };
  if (parentBranch != null) return { effectiveBranch: parentBranch, branchSource: 'inherited' };
  return { effectiveBranch: null, branchSource: null };
}

export function aggregateTotals(
  own: { tokensConsumed: number; developmentTimeMinutes: number },
  subs: { tokensConsumed: number; developmentTimeMinutes: number }[],
): { totalTokens: number; totalTimeMinutes: number } {
  return {
    totalTokens: own.tokensConsumed + subs.reduce((sum, s) => sum + s.tokensConsumed, 0),
    totalTimeMinutes:
      own.developmentTimeMinutes + subs.reduce((sum, s) => sum + s.developmentTimeMinutes, 0),
  };
}
