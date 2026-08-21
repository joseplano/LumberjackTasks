# Contract: pure rendering functions

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

Two pure functions in `frontend/src/lib/`, tested without rendering anything. They follow the
precedent of `frontend/src/lib/branchUrl.ts` (feature 003): pure, total, no I/O, no module-level
state, and the contract rule that justifies a line is named in the comment beside it (D10, R11).

---

## A. `branchColor` — `frontend/src/lib/branchColor.ts`

```ts
export type BranchColor = 'blue' | 'grey' | 'yellow' | 'green';
export type BranchState = 'UNCOMMITTED' | 'ACTIVE' | 'MERGED';

export function branchColor(input: { isTrunk: boolean; state: BranchState }): BranchColor;
```

**Rules, applied in this order, stopping at the first match** (FR-010):

| # | Condition | Result |
|---|---|---|
| 1 | `isTrunk` | `blue` |
| 2 | `state === 'MERGED'` | `grey` |
| 3 | `state === 'UNCOMMITTED'` | `yellow` |
| 4 | otherwise (`ACTIVE`) | `green` |

**Why the order matters and must be tested, not assumed**

- Rule 1 before rule 2 is FR-011: the trunk is blue whatever its reported state. `{ isTrunk: true,
  state: 'MERGED' }` must return `blue`. It should not be reachable, but the function is total and
  must not fall through if it ever is.
- Rule 2 before rule 3 is D5's precedence: merged outranks uncommitted. The agent is supposed to
  report a merged-and-dirty branch as `MERGED` (contract `mcp-tool.md`), so this rule is the second
  line of defence, and it is the one that is cheap to test.
- `pushed` is not an input. Being pushed is not a state and must not reach this function
  (FR-013).

**Required tests**: all six combinations of `isTrunk × state`, asserted individually. Not a table
test that iterates the same mapping the implementation uses — that proves nothing.

---

## B. `buildRepoTree` — `frontend/src/lib/repoTree.ts`

```ts
export function buildRepoTree(input: {
  branches: Array<{ id: string; name: string; isTrunk: boolean; state: BranchState }>;
  commits: Array<{ sha: string; branchId: string; committedAt: string; parentShas: string[] }>;
}): {
  lanes: Array<{ branchId: string; laneIndex: number; y: number; color: BranchColor; startX: number; endX: number }>;
  nodes: Array<{ sha: string; branchId: string; x: number; y: number; color: BranchColor }>;
  edges: Array<{ fromSha: string; toSha: string; kind: 'line' | 'fork' | 'merge' }>;
  width: number;
  height: number;
};
```

**Rules**

1. **Column order (FR-004)**: commits are ordered by `committedAt` ascending, ties broken by `sha`
   ascending. Each distinct position gets the next integer column index; `x = columnIndex * COLUMN_GAP`.
   The tie-break exists so the output is assertable (R11) — without it, two commits sharing a second
   would swap between runs.
2. **Lane order (FR-005)**: the trunk takes `laneIndex` 0. Other branches take 1, 2, … ordered by
   their earliest commit's column, ties broken by branch name ascending. `y = laneIndex * LANE_GAP`.
3. **Colour (FR-012)**: every lane and every node takes `branchColor(branch)`. A node is drawn in
   its branch's colour, never in its own.
4. **Lane extent (FR-006)**: `startX` is the x of the branch's fork point when one is recorded —
   the position of the commit whose sha is `parentShas[0]` of the branch's earliest commit — and
   otherwise the x of its own earliest commit (the spec's "fork point not recorded" edge case).
   `endX` is the x of its latest commit, or of the trunk merge commit that names one of its commits
   as a non-first parent, whichever is greater.
5. **Edges (FR-007)**, all derived from `parentShas`, never from ordering:
   - `line` — parent and child are on the same lane;
   - `fork` — the child's `parentShas[0]` is on a different lane; drawn from the parent to the
     child, crossing lanes;
   - `merge` — a parent at index ≥ 1 is on a different lane; drawn from that parent up to the merge
     commit.
   A parent sha that is not present in `commits` produces **no edge**. It must not produce an edge
   to a fabricated coordinate, and must not throw.
6. **Totality**: empty `branches` and empty `commits` return empty arrays with `width: 0`,
   `height: 0`. A branch with no commits still gets a lane, with `startX === endX` (the spec's
   "branch with no commits of its own" edge case, drawn yellow via rule 3). A `branchId` on a commit
   that matches no branch is dropped rather than throwing.
7. **Purity**: no `Date.now()`, no randomness, no reading anything outside the argument. Called
   twice with the same input it returns the same numbers.
8. **Horizontal scroll (FR-009)**: the function returns `width` and `height` so the component can
   size the SVG larger than its container and let a container with `overflow-x: auto` provide the
   scrollbar. The function itself knows nothing about the viewport.

**Required tests** (unit, no rendering): column ordering with a date tie; lane assignment with the
trunk not first in the input; fork edge across lanes; merge edge from a second parent; a merged
branch keeping its own lane (D8/FR-024) rather than being folded into the trunk; a dangling parent
sha producing no edge; a branch with no commits; empty input; and determinism across two calls.
