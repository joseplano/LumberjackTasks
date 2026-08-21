import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RepoTree from '@/components/RepoTree';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';
import { buildRepoTree, type RepoTreeBranch, type RepoTreeCommit } from '@/lib/repoTree';

// Fix round 2 (Important 1). Every label renders at the constant
// `x={PADDING}` (RepoTree.tsx:134), so comparing a lane's `x1` against the
// label's OWN `x` attribute is comparing against a constant -- it can never
// fail for any positive gutter, no matter how the gutter is sized. These two
// constants mirror RepoTree.tsx's own `PADDING` (16px canvas edge) and its
// documented safe per-character advance width (RepoTree.tsx:24, currently
// `LABEL_CHAR_WIDTH = 7`). They are deliberately hard-coded here rather than
// imported from the component: importing the component's own
// `LABEL_CHAR_WIDTH` would make the assertion self-referential again (a
// regression to that constant would shrink both the computed gutter AND the
// test's threshold together, so the check would stay trivially true). By
// fixing the expected safe width independently, a regression to an
// undersized `LABEL_CHAR_WIDTH` in the component actually shrinks the
// rendered gutter below what this test still requires.
const PADDING = 16;
const ASSUMED_LABEL_CHAR_WIDTH = 7;

// Fix round 1 (FR-015, SC-005, spec.md:229-230 "with a lane AND a label").
//
// User Story 1 exists so someone can see WHICH BRANCHES EXIST. A colour and a
// screen-reader-only accessible name do not satisfy that on a visual feature:
// the branch name has to be drawn. These tests assert the drawn text, and that
// it stays inside the canvas the component sizes for itself.

const trunk: RepoTreeBranch = { id: 'b-main', name: 'main', isTrunk: true, state: 'ACTIVE' };
const feature: RepoTreeBranch = {
  id: 'b-feat',
  name: 'feature/a-rather-long-branch-name',
  isTrunk: false,
  state: 'MERGED',
};
// spec.md:229-230 edge case: a branch that exists with no commits of its own.
// buildRepoTree gives it startX === endX, so its label placement is the case
// most likely to be got wrong.
const orphan: RepoTreeBranch = { id: 'b-orphan', name: 'orphan', isTrunk: false, state: 'UNCOMMITTED' };

const commits: RepoTreeCommit[] = [
  { sha: 'm1', branchId: 'b-main', committedAt: '2024-01-01T00:00:00.000Z', parentShas: [] },
  { sha: 'f1', branchId: 'b-feat', committedAt: '2024-01-02T00:00:00.000Z', parentShas: ['m1'] },
  { sha: 'm2', branchId: 'b-main', committedAt: '2024-01-03T00:00:00.000Z', parentShas: ['m1', 'f1'] },
];

function labelFor(branchId: string): SVGTextElement {
  const found = screen
    .getAllByTestId('repo-lane-label')
    .find((el) => el.getAttribute('data-branch-id') === branchId);
  if (!found) throw new Error(`No rendered label for branch ${branchId}`);
  return found as unknown as SVGTextElement;
}

function num(el: Element, attr: string): number {
  const raw = el.getAttribute(attr);
  expect(raw, `${el.tagName} is missing a numeric ${attr}`).not.toBeNull();
  const value = Number(raw);
  expect(Number.isFinite(value), `${el.tagName}'s ${attr}="${raw}" is not a number`).toBe(true);
  return value;
}

describe('RepoTree — branch labels are drawn (FR-015, SC-005)', () => {
  it('renders the branch name as visible text, for a branch with commits and for the trunk', () => {
    render(<RepoTree branches={[trunk, feature]} commits={commits} />);

    // Discoverable as ordinary rendered text, not only as an accessible name.
    expect(screen.getByText('main')).toBeVisible();
    expect(screen.getByText('feature/a-rather-long-branch-name')).toBeVisible();

    for (const branch of [trunk, feature]) {
      const label = labelFor(branch.id);
      expect(label.tagName.toLowerCase()).toBe('text');
      expect(label).toHaveTextContent(branch.name);
      // Not hidden from sight by any of the usual ways of "rendering" text
      // that nobody can see.
      expect(label).toBeVisible();
      expect(label).not.toHaveAttribute('aria-hidden', 'true');
      expect(label.getAttribute('visibility')).not.toBe('hidden');
      expect(num(label, 'font-size')).toBeGreaterThan(0);
    }
  });

  it('colours labels through BRANCH_COLOR_TOKEN, never a literal hex (SC-001a)', () => {
    render(<RepoTree branches={[trunk, feature]} commits={commits} />);

    expect(labelFor('b-main')).toHaveAttribute('fill', BRANCH_COLOR_TOKEN.blue);
    expect(labelFor('b-feat')).toHaveAttribute('fill', BRANCH_COLOR_TOKEN.grey);
    for (const label of screen.getAllByTestId('repo-lane-label')) {
      expect(label.getAttribute('fill')).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('draws a lane and a label but no circles for a branch with no commits of its own', () => {
    render(<RepoTree branches={[trunk, feature, orphan]} commits={commits} />);

    // A lane...
    const lane = screen
      .getAllByTestId('repo-lane')
      .find((l) => l.getAttribute('data-branch-id') === 'b-orphan');
    expect(lane).toBeDefined();
    // ...yellow (D5: UNCOMMITTED, and it is not the trunk)...
    expect(lane).toHaveAttribute('data-color', 'yellow');
    // ...and a label...
    expect(labelFor('b-orphan')).toHaveTextContent('orphan');
    expect(screen.getByText('orphan')).toBeVisible();

    // ...but no circles. Every drawn circle belongs to a branch that really
    // has commits, and the total is exactly the number of commits given.
    const circles = screen.getAllByTestId('repo-commit');
    expect(circles).toHaveLength(commits.length);
    expect(circles.filter((c) => c.getAttribute('data-branch-id') === 'b-orphan')).toHaveLength(0);
  });

  it('keeps every label inside the SVG it sizes for itself, including the commitless branch', () => {
    const branches = [trunk, feature, orphan];
    render(<RepoTree branches={branches} commits={commits} />);

    const svg = screen.getByRole('group', { name: 'Repository commit history' });
    const svgWidth = num(svg, 'width');
    const svgHeight = num(svg, 'height');

    for (const label of screen.getAllByTestId('repo-lane-label')) {
      const x = num(label, 'x');
      const y = num(label, 'y');
      // Labels are left-anchored, so `x` is the leftmost point of the drawn
      // text: inside the canvas means x >= 0 and x < width.
      expect(label).toHaveAttribute('text-anchor', 'start');
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(svgWidth);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(svgHeight);
    }

    // The gutter the labels live in is really reserved: every lane must start
    // to the right of the MODELLED EXTENT of its own label's text (the
    // anchor plus its estimated pixel width) -- not merely to the right of
    // the label's constant `x` anchor, which every label shares and which
    // therefore proves nothing about how wide the gutter actually is.
    // Including the commitless branch, whose startX === endX === 0.
    for (const lane of screen.getAllByTestId('repo-lane')) {
      const branchId = lane.getAttribute('data-branch-id');
      const name = branches.find((b) => b.id === branchId)?.name;
      if (name === undefined) throw new Error(`No known branch for lane ${branchId}`);
      const modelledTextRight = PADDING + name.length * ASSUMED_LABEL_CHAR_WIDTH;
      expect(num(lane, 'x1')).toBeGreaterThan(modelledTextRight);
      expect(num(lane, 'x2')).toBeLessThanOrEqual(svgWidth);
    }

    // The canvas itself is wide enough to hold the reserved gutter plus the
    // geometry `buildRepoTree` reports, plus the trailing padding on the
    // right -- derived from the real (trusted, separately-tested) geometry
    // function rather than re-implementing RepoTree's own gutter formula.
    const model = buildRepoTree({ branches, commits });
    const modelLaneByBranch = new Map(model.lanes.map((l) => [l.branchId, l]));
    let originX: number | undefined;
    for (const lane of screen.getAllByTestId('repo-lane')) {
      const branchId = lane.getAttribute('data-branch-id');
      const modelLane = branchId ? modelLaneByBranch.get(branchId) : undefined;
      if (!modelLane) throw new Error(`No model lane for ${branchId}`);
      const delta = num(lane, 'x1') - modelLane.startX;
      if (originX === undefined) originX = delta;
      else expect(delta).toBe(originX);
    }
    expect(originX).toBeDefined();
    expect(svgWidth).toBeGreaterThanOrEqual((originX as number) + model.width + PADDING);
  });

  it('exposes exactly one button per branch, so the lane and its label are one control', () => {
    render(<RepoTree branches={[trunk, feature, orphan]} commits={commits} onBranchSelect={() => {}} />);

    for (const branch of [trunk, feature, orphan]) {
      // getByRole throws on more than one match: this is the guard that keeps
      // T042's `getByRole('button', { name: 'Branch feature' })` unambiguous.
      const control = screen.getByRole('button', { name: `Branch ${branch.name}` });
      expect(control).toHaveAttribute('tabindex', '0');
      // The lane line and the label are both inside that one control.
      expect(control.querySelectorAll('[data-testid="repo-lane"]')).toHaveLength(1);
      expect(control.querySelectorAll('[data-testid="repo-lane-label"]')).toHaveLength(1);
    }
  });
});
