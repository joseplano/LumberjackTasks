import { branchColor, type BranchColor, type BranchState } from './branchColor';

/**
 * Pixel spacing between adjacent commit columns. Exported so tests assert
 * relationships in terms of it rather than hard-coded pixel values.
 */
export const COLUMN_GAP = 80;

/** Pixel spacing between adjacent branch lanes. See COLUMN_GAP. */
export const LANE_GAP = 60;

export interface RepoTreeBranch {
  id: string;
  name: string;
  isTrunk: boolean;
  state: BranchState;
}

export interface RepoTreeCommit {
  sha: string;
  branchId: string;
  committedAt: string;
  parentShas: string[];
}

export interface RepoTreeInput {
  branches: RepoTreeBranch[];
  commits: RepoTreeCommit[];
}

export interface RepoTreeLane {
  branchId: string;
  laneIndex: number;
  y: number;
  color: BranchColor;
  startX: number;
  endX: number;
}

export interface RepoTreeNode {
  sha: string;
  branchId: string;
  x: number;
  y: number;
  color: BranchColor;
}

export interface RepoTreeEdge {
  fromSha: string;
  toSha: string;
  kind: 'line' | 'fork' | 'merge';
}

export interface RepoTreeResult {
  lanes: RepoTreeLane[];
  nodes: RepoTreeNode[];
  edges: RepoTreeEdge[];
  width: number;
  height: number;
}

// Compares timestamps lexicographically rather than via Date.parse. For
// well-formed ISO-8601 UTC timestamps (the expected input) this sorts
// identically to chronological order. Unlike Date.parse (implementation-
// and timezone-dependent on non-ISO input, and NaN on unparseable input,
// which makes every comparison return 0 and breaks transitivity — a
// garbage timestamp would tie with two commits that don't tie with each
// other), string comparison is always transitive and total, so malformed
// input can't make the result depend on input array order.
function compareDates(a: string, b: string): number {
  return compareStrings(a, b);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Computes the geometry of a repository's git history as a left-to-right
 * lane diagram: one lane per branch, one node per commit, and the edges
 * between them. Pure and total — no I/O, no module-level state, no
 * `Date.now()`/randomness (rule 7). Called twice with the same input it
 * returns the same numbers.
 *
 * Follows `frontend/src/lib/branchUrl.ts`'s precedent: contract rules are
 * cited in the comment beside the line that implements them
 * (contracts/tree-geometry.md §B).
 */
export function buildRepoTree(input: RepoTreeInput): RepoTreeResult {
  const branchesById = new Map(input.branches.map((b) => [b.id, b]));

  // Rule 6: a commit whose branchId matches no known branch is dropped
  // rather than throwing. (This governs malformed input; SC-002's
  // completeness guarantee — every recorded branch/commit is drawn —
  // governs well-formed input and is a separate concern.)
  const validCommits = input.commits.filter((c) => branchesById.has(c.branchId));

  // Rule 1 (FR-004): a single global ordering of all commits by committedAt
  // ascending, ties broken by sha ascending. Every commit's position in this
  // sequence is therefore distinct, and each distinct position gets the next
  // integer column index — so x is fully determined for every commit (R11).
  const sortedCommits = [...validCommits].sort((a, b) => {
    const byDate = compareDates(a.committedAt, b.committedAt);
    if (byDate !== 0) return byDate;
    return compareStrings(a.sha, b.sha);
  });

  const columnBySha = new Map<string, number>();
  sortedCommits.forEach((c, index) => columnBySha.set(c.sha, index));
  // Call-site-guaranteed: every sha passed to xOf below comes from
  // sortedCommits (or commitBySha, which is built from sortedCommits), so
  // columnBySha always has an entry. No `?? 0` fallback — a missing column
  // would silently fabricate x = 0, exactly what rule 5 forbids elsewhere.
  const xOf = (sha: string): number => columnBySha.get(sha)! * COLUMN_GAP;

  const commitBySha = new Map(sortedCommits.map((c) => [c.sha, c]));

  // Commits grouped by branch, preserving the rank order from sortedCommits
  // above (so index 0 of each group is that branch's chronologically
  // earliest own commit, and the last index is its latest).
  const commitsByBranch = new Map<string, RepoTreeCommit[]>();
  for (const c of sortedCommits) {
    const list = commitsByBranch.get(c.branchId);
    if (list) {
      list.push(c);
    } else {
      commitsByBranch.set(c.branchId, [c]);
    }
  }

  // Rule 2 (FR-005): the trunk takes lane 0. Other branches take 1, 2, …
  // ordered by their earliest commit's column, ties broken by branch name
  // ascending.
  //
  // Keyed on the earliest own commit's already-assigned column (not its raw
  // committedAt): rule 1 defines column as a unique integer derived from the
  // same total order, so ordering by column is already deterministic and
  // agrees with committedAt on distinct timestamps. The two views diverge
  // only when two branches' earliest commits tie on committedAt but differ
  // in sha — column keeps them ordered by that sha (first-appearance
  // order), while committedAt would fall through to the name tie-break and
  // could contradict left-to-right first-appearance order, which is exactly
  // the property this rule exists to produce. The name tie-break below
  // still fires for branches with no commits of their own, which the
  // `aHas !== bHas` grouping puts together and column can't distinguish.
  const trunkBranches = [...input.branches.filter((b) => b.isTrunk)].sort((a, b) =>
    compareStrings(a.name, b.name)
  );
  const otherBranches = input.branches.filter((b) => !b.isTrunk);
  const trunkId: string | undefined = trunkBranches[0]?.id;

  const orderedOthers = [...otherBranches].sort((a, b) => {
    const ownA = commitsByBranch.get(a.id);
    const ownB = commitsByBranch.get(b.id);
    const aHas = !!ownA && ownA.length > 0;
    const bHas = !!ownB && ownB.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && ownA && ownB) {
      const byColumn = columnBySha.get(ownA[0].sha)! - columnBySha.get(ownB[0].sha)!;
      if (byColumn !== 0) return byColumn;
    }
    return compareStrings(a.name, b.name);
  });

  const orderedBranches = [...trunkBranches, ...orderedOthers];
  const laneIndexByBranchId = new Map<string, number>();
  orderedBranches.forEach((b, index) => laneIndexByBranchId.set(b.id, index));

  // Rule 4 (FR-006): lane extent.
  const lanes: RepoTreeLane[] = orderedBranches.map((b) => {
    const laneIndex = laneIndexByBranchId.get(b.id)!;
    const y = laneIndex * LANE_GAP;
    const color = branchColor({ isTrunk: b.isTrunk, state: b.state });
    const own = commitsByBranch.get(b.id) ?? [];

    if (own.length === 0) {
      // Decision: a branch with no commits and no recorded fork point gets
      // startX === endX === 0.
      return { branchId: b.id, laneIndex, y, color, startX: 0, endX: 0 };
    }

    const earliestOwn = own[0];
    const latestOwn = own[own.length - 1];

    // startX: the fork point (the position of the commit named by the
    // earliest own commit's first parent) when one is recorded and
    // resolvable; otherwise the branch's own earliest commit x.
    const forkParentSha = earliestOwn.parentShas[0];
    const forkCommit = forkParentSha !== undefined ? commitBySha.get(forkParentSha) : undefined;
    const startX = forkCommit ? xOf(forkCommit.sha) : xOf(earliestOwn.sha);

    // endX: the greater of the branch's own latest commit x and the x of a
    // trunk merge commit naming one of this branch's own commits as a
    // non-first parent (D8/FR-024: a merged branch keeps its own lane, but
    // the lane visually extends to where the merge happened).
    const ownShas = new Set(own.map((c) => c.sha));
    let mergeX = -Infinity;
    if (trunkId !== undefined) {
      for (const c of commitsByBranch.get(trunkId) ?? []) {
        for (let i = 1; i < c.parentShas.length; i++) {
          if (ownShas.has(c.parentShas[i])) {
            mergeX = Math.max(mergeX, xOf(c.sha));
          }
        }
      }
    }
    const endX = Math.max(xOf(latestOwn.sha), mergeX);

    return { branchId: b.id, laneIndex, y, color, startX, endX };
  });

  // Nodes: rule 3 (FR-012) — a node is drawn in its branch's colour.
  const nodes: RepoTreeNode[] = sortedCommits.map((c) => {
    const branch = branchesById.get(c.branchId)!;
    const laneIndex = laneIndexByBranchId.get(c.branchId)!;
    return {
      sha: c.sha,
      branchId: c.branchId,
      x: xOf(c.sha),
      y: laneIndex * LANE_GAP,
      color: branchColor({ isTrunk: branch.isTrunk, state: branch.state }),
    };
  });

  // Rule 5 (FR-007): edges derived only from parentShas, never from ordering.
  const edges: RepoTreeEdge[] = [];
  for (const c of sortedCommits) {
    const childLane = laneIndexByBranchId.get(c.branchId)!;
    c.parentShas.forEach((parentSha, i) => {
      const parent = commitBySha.get(parentSha);
      if (!parent) {
        // A parent sha not present in commits produces no edge, no
        // fabricated coordinate, and must not throw.
        return;
      }
      const parentLane = laneIndexByBranchId.get(parent.branchId)!;
      let kind: RepoTreeEdge['kind'];
      if (i === 0) {
        kind = parentLane === childLane ? 'line' : 'fork';
      } else {
        kind = parentLane === childLane ? 'line' : 'merge';
      }
      edges.push({ fromSha: parent.sha, toSha: c.sha, kind });
    });
  }

  // Rule 8 (FR-009): width/height so the component can size the SVG larger
  // than its container and let overflow-x provide the scrollbar.
  const width = sortedCommits.length > 0 ? sortedCommits.length * COLUMN_GAP : 0;
  const height = lanes.length > 0 ? lanes.length * LANE_GAP : 0;

  return { lanes, nodes, edges, width, height };
}
