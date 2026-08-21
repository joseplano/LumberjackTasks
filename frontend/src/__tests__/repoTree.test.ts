import { describe, it, expect } from 'vitest';
import { buildRepoTree, COLUMN_GAP, LANE_GAP } from '@/lib/repoTree';
import { branchColor } from '@/lib/branchColor';

// Fixture builders -----------------------------------------------------

function simpleFixture() {
  // main (trunk): m1 -> m2. feature (non-trunk): f1, forked off m1.
  // No merge here — kept deliberately simple for completeness/ordering/
  // colour/width-height tests, which don't need fork/merge edges.
  const branches = [
    { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const },
    { id: 'b-feat', name: 'feature', isTrunk: false, state: 'ACTIVE' as const },
  ];
  const commits = [
    { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
    { sha: 'f1', branchId: 'b-feat', committedAt: '2024-01-02T00:00:00Z', parentShas: ['m1'] },
    { sha: 'm2', branchId: 'b-main', committedAt: '2024-01-03T00:00:00Z', parentShas: ['m1'] },
  ];
  return { branches, commits };
}

// main (trunk): m1 -> m2 (merge commit, parents [m1, f1]).
// feature (non-trunk, MERGED): f1, forked off m1, merged into m2.
function forkMergeFixture() {
  const branches = [
    { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const },
    { id: 'b-feat', name: 'feature', isTrunk: false, state: 'MERGED' as const },
  ];
  const commits = [
    { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
    { sha: 'f1', branchId: 'b-feat', committedAt: '2024-01-02T00:00:00Z', parentShas: ['m1'] },
    { sha: 'm2', branchId: 'b-main', committedAt: '2024-01-03T00:00:00Z', parentShas: ['m1', 'f1'] },
  ];
  return { branches, commits };
}

describe('buildRepoTree', () => {
  // --- Totality: empty input (rule 6) ---

  it('returns empty arrays with zero width and height for empty input', () => {
    expect(buildRepoTree({ branches: [], commits: [] })).toEqual({
      lanes: [],
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    });
  });

  // --- Completeness (SC-002) vs the rule-6 drop, as two separate tests ---

  it('gives every input branch exactly one lane and every input commit exactly one node for well-formed input', () => {
    const { branches, commits } = simpleFixture();
    const result = buildRepoTree({ branches, commits });

    expect(result.lanes).toHaveLength(branches.length);
    expect(result.lanes.map((l) => l.branchId).sort()).toEqual(
      branches.map((b) => b.id).sort()
    );
    expect(result.nodes).toHaveLength(commits.length);
    expect(result.nodes.map((n) => n.sha).sort()).toEqual(commits.map((c) => c.sha).sort());
  });

  it('drops a commit whose branchId matches no known branch, without throwing', () => {
    const { branches, commits } = simpleFixture();
    const commitsWithGhost = [
      ...commits,
      { sha: 'x1', branchId: 'b-ghost', committedAt: '2024-01-04T00:00:00Z', parentShas: [] },
    ];

    let result;
    expect(() => {
      result = buildRepoTree({ branches, commits: commitsWithGhost });
    }).not.toThrow();

    expect(result!.nodes).toHaveLength(3);
    expect(result!.nodes.find((n) => n.sha === 'x1')).toBeUndefined();
    expect(result!.lanes).toHaveLength(2);
  });

  // --- Rule 1 (FR-004): column order ---

  it('orders commits into columns by committedAt ascending', () => {
    const branches = [{ id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const }];
    const commits = [
      { sha: 'c3', branchId: 'b-main', committedAt: '2024-01-03T00:00:00Z', parentShas: [] },
      { sha: 'c1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
      { sha: 'c2', branchId: 'b-main', committedAt: '2024-01-02T00:00:00Z', parentShas: [] },
    ];
    const result = buildRepoTree({ branches, commits });
    const xBySha = Object.fromEntries(result.nodes.map((n) => [n.sha, n.x]));

    expect(xBySha.c1).toBe(0 * COLUMN_GAP);
    expect(xBySha.c2).toBe(1 * COLUMN_GAP);
    expect(xBySha.c3).toBe(2 * COLUMN_GAP);
  });

  it('breaks a committedAt tie by sha ascending (genuine tie: identical timestamps)', () => {
    const branches = [{ id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const }];
    const commits = [
      { sha: 'zzz', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
      { sha: 'aaa', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
    ];
    const result = buildRepoTree({ branches, commits });
    const xBySha = Object.fromEntries(result.nodes.map((n) => [n.sha, n.x]));

    expect(xBySha.aaa).toBe(0);
    expect(xBySha.zzz).toBe(COLUMN_GAP);
  });

  // --- Rule 2 (FR-005): lane order ---

  it('assigns the trunk lane 0 even when it is not first in the input', () => {
    const branches = [
      { id: 'b-feat', name: 'feature', isTrunk: false, state: 'ACTIVE' as const },
      { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const },
    ];
    const commits = [
      { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
    ];
    const result = buildRepoTree({ branches, commits });

    const mainLane = result.lanes.find((l) => l.branchId === 'b-main');
    expect(mainLane?.laneIndex).toBe(0);
    expect(mainLane?.y).toBe(0);
  });

  it('breaks a lane-order tie by branch name ascending (genuine tie: identical earliest-commit timestamps)', () => {
    const branches = [
      { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const },
      { id: 'b-zebra', name: 'zebra', isTrunk: false, state: 'ACTIVE' as const },
      { id: 'b-alpha', name: 'alpha', isTrunk: false, state: 'ACTIVE' as const },
    ];
    const commits = [
      { sha: 'z1', branchId: 'b-zebra', committedAt: '2024-01-05T00:00:00Z', parentShas: [] },
      { sha: 'a1', branchId: 'b-alpha', committedAt: '2024-01-05T00:00:00Z', parentShas: [] },
    ];
    const result = buildRepoTree({ branches, commits });

    const alphaLane = result.lanes.find((l) => l.branchId === 'b-alpha')!;
    const zebraLane = result.lanes.find((l) => l.branchId === 'b-zebra')!;
    expect(alphaLane.laneIndex).toBeLessThan(zebraLane.laneIndex);
  });

  // --- Rule 3 (FR-012): colour ---

  it('colours every lane and node via branchColor of its own branch', () => {
    const { branches, commits } = simpleFixture();
    const result = buildRepoTree({ branches, commits });

    const mainLane = result.lanes.find((l) => l.branchId === 'b-main')!;
    const featLane = result.lanes.find((l) => l.branchId === 'b-feat')!;
    expect(mainLane.color).toBe(branchColor({ isTrunk: true, state: 'ACTIVE' }));
    expect(featLane.color).toBe(branchColor({ isTrunk: false, state: 'ACTIVE' }));

    const f1Node = result.nodes.find((n) => n.sha === 'f1')!;
    expect(f1Node.color).toBe(featLane.color);
    const m1Node = result.nodes.find((n) => n.sha === 'm1')!;
    expect(m1Node.color).toBe(mainLane.color);
  });

  // --- Rule 4 (FR-006): lane extent ---

  it('sets startX to the branch fork point (parent of the earliest commit) when one is recorded', () => {
    const { branches, commits } = forkMergeFixture();
    const result = buildRepoTree({ branches, commits });

    const featLane = result.lanes.find((l) => l.branchId === 'b-feat')!;
    const f1Node = result.nodes.find((n) => n.sha === 'f1')!;
    const m1Node = result.nodes.find((n) => n.sha === 'm1')!;

    // The fork point (m1's x) is used, not feature's own earliest commit x —
    // they must differ here to prove the fork point is actually driving it.
    expect(f1Node.x).not.toBe(m1Node.x);
    expect(featLane.startX).toBe(m1Node.x);
  });

  it('sets endX to the trunk merge commit x when it is greater than the branch own latest commit x', () => {
    const { branches, commits } = forkMergeFixture();
    const result = buildRepoTree({ branches, commits });

    const featLane = result.lanes.find((l) => l.branchId === 'b-feat')!;
    const f1Node = result.nodes.find((n) => n.sha === 'f1')!;
    const m2Node = result.nodes.find((n) => n.sha === 'm2')!;

    expect(m2Node.x).toBeGreaterThan(f1Node.x);
    expect(featLane.endX).toBe(m2Node.x);
  });

  it('gives a branch with no commits a lane with startX === endX (=== 0 by decision)', () => {
    const branches = [
      { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const },
      { id: 'b-empty', name: 'empty', isTrunk: false, state: 'ACTIVE' as const },
    ];
    const commits = [
      { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
    ];
    const result = buildRepoTree({ branches, commits });

    expect(result.lanes).toHaveLength(2);
    const emptyLane = result.lanes.find((l) => l.branchId === 'b-empty')!;
    expect(emptyLane.startX).toBe(emptyLane.endX);
    expect(emptyLane.startX).toBe(0);
  });

  // --- Rule 5 (FR-007): edges ---

  it('draws a fork edge when the child commit first parent is on a different lane', () => {
    const { branches, commits } = forkMergeFixture();
    const result = buildRepoTree({ branches, commits });

    expect(result.edges).toContainEqual({ fromSha: 'm1', toSha: 'f1', kind: 'fork' });
  });

  it('draws a merge edge from a second parent on a different lane, and a line edge from the first parent on the same lane', () => {
    const { branches, commits } = forkMergeFixture();
    const result = buildRepoTree({ branches, commits });

    expect(result.edges).toContainEqual({ fromSha: 'f1', toSha: 'm2', kind: 'merge' });
    expect(result.edges).toContainEqual({ fromSha: 'm1', toSha: 'm2', kind: 'line' });
  });

  it('keeps a merged branch on its own lane rather than folding it into the trunk (D8/FR-024)', () => {
    const { branches, commits } = forkMergeFixture();
    const result = buildRepoTree({ branches, commits });

    const mainLane = result.lanes.find((l) => l.branchId === 'b-main')!;
    const featLane = result.lanes.find((l) => l.branchId === 'b-feat')!;
    expect(featLane.laneIndex).not.toBe(mainLane.laneIndex);
    expect(featLane.y).not.toBe(mainLane.y);

    const f1Node = result.nodes.find((n) => n.sha === 'f1')!;
    expect(f1Node.y).toBe(featLane.y);
    expect(f1Node.y).not.toBe(mainLane.y);
  });

  it('produces no edge and does not throw for a dangling parent sha not present in commits', () => {
    const branches = [{ id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' as const }];
    const commits = [
      { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00Z', parentShas: [] },
      {
        sha: 'm2',
        branchId: 'b-main',
        committedAt: '2024-01-02T00:00:00Z',
        parentShas: ['ghost-sha'],
      },
    ];

    let result;
    expect(() => {
      result = buildRepoTree({ branches, commits });
    }).not.toThrow();

    expect(result!.edges).toEqual([]);
    expect(result!.nodes.map((n) => n.sha).sort()).toEqual(['m1', 'm2']);
  });

  // --- Rule 8 (FR-009): width/height for scrolling ---

  it('returns width and height derived from COLUMN_GAP/LANE_GAP and the number of columns/lanes', () => {
    const { branches, commits } = simpleFixture();
    const result = buildRepoTree({ branches, commits });

    expect(result.width).toBe(commits.length * COLUMN_GAP);
    expect(result.height).toBe(branches.length * LANE_GAP);
  });

  // --- Rule 7: purity/determinism ---

  it('returns identical output across two calls with the same input, and does not mutate the input', () => {
    const { branches, commits } = forkMergeFixture();
    const branchesSnapshot = JSON.parse(JSON.stringify(branches));
    const commitsSnapshot = JSON.parse(JSON.stringify(commits));

    const result1 = buildRepoTree({ branches, commits });
    const result2 = buildRepoTree({ branches, commits });

    expect(result2).toEqual(result1);
    expect(branches).toEqual(branchesSnapshot);
    expect(commits).toEqual(commitsSnapshot);
  });
});
