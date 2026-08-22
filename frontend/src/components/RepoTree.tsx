import { useMemo } from 'react';
import { buildRepoTree, type RepoTreeBranch, type RepoTreeCommit } from '@/lib/repoTree';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';

// Padding so lane lines and commit circles at x=0/y=0 aren't clipped at the
// SVG's edge, and so circle strokes have room to render.
const PADDING = 16;
const NODE_RADIUS = 6;

// Branch label typography and the gutter it lives in.
//
// `buildRepoTree` sizes the canvas from geometry alone and knows nothing about
// text (its geometry tests are exact and it must not learn about text), so the
// room the labels need is reserved HERE, in the component's own padding: every
// lane, node and edge is shifted right by `gutter`, and `gutter` is added to
// the SVG's width. Nothing is ever drawn left of x = PADDING.
const LABEL_FONT_SIZE = 11;
// A deliberate over-estimate of one character's advance width at
// LABEL_FONT_SIZE for the sans-serif stack this app ships. Over-estimating
// costs a few pixels of empty gutter; under-estimating would let a long branch
// name run under its own lane line, so the error is taken in the safe
// direction. jsdom cannot measure text, so this cannot be measured at runtime
// in the tests either.
const LABEL_CHAR_WIDTH = 7;
// Clear space between the end of the longest label and where the lanes start.
const LABEL_GAP = 12;

export interface RepoTreeProps {
  branches: RepoTreeBranch[];
  commits: RepoTreeCommit[];
  onCommitSelect?: (sha: string) => void;
  onBranchSelect?: (branchId: string) => void;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Hand-rolled inline SVG rendering of a repository's git history (D10 -- no
 * graph/chart/git-graph library). Consumes `buildRepoTree`'s pure geometry
 * output directly: this component owns no layout math of its own beyond the
 * padding and label gutter it needs to draw text the geometry doesn't model.
 *
 * Commit circles and branch lanes are real focusable elements with
 * accessible names (T046) so the commit/branch modals (US3/US4) can be
 * reached from the keyboard as well as the pointer.
 *
 * FR-015 / SC-005 / spec.md:229-230: each branch is drawn as a lane AND a
 * label. The two are wrapped in a single `<g role="button">` rather than being
 * two separately focusable controls, so that "clicking a branch lane or its
 * label" hits one handler, and so each branch contributes exactly one node
 * with the accessible name `Branch <name>`.
 */
export default function RepoTree({ branches, commits, onCommitSelect, onBranchSelect }: RepoTreeProps) {
  const { lanes, nodes, edges, width, height } = useMemo(
    () => buildRepoTree({ branches, commits }),
    [branches, commits],
  );

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const nodeBySha = new Map(nodes.map((n) => [n.sha, n]));
  const nameOf = (branchId: string) => branchNameById.get(branchId) ?? branchId;

  // Reserve exactly as much left gutter as the longest label needs. With no
  // lanes there is nothing to label and no gutter.
  const gutter =
    lanes.length > 0
      ? Math.max(...lanes.map((lane) => nameOf(lane.branchId).length * LABEL_CHAR_WIDTH)) + LABEL_GAP
      : 0;

  // Where buildRepoTree's x = 0 lands on screen.
  const originX = PADDING + gutter;
  const svgWidth = width + gutter + PADDING * 2;
  const svgHeight = height + PADDING * 2;

  function activationProps(handler: (() => void) | undefined) {
    if (!handler) return {};
    return {
      onClick: handler,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      },
    };
  }

  return (
    <svg
      role="group"
      aria-label="Repository commit history"
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
    >
      {/* FR-004/FR-005/FR-015: one horizontal lane line per branch, trunk
          included, each with its name drawn beside it. */}
      {lanes.map((lane) => {
        const name = nameOf(lane.branchId);
        const y = lane.y + PADDING;
        const color = BRANCH_COLOR_TOKEN[lane.color];
        return (
          <g
            key={lane.branchId}
            role="button"
            tabIndex={0}
            aria-label={`Branch ${name}`}
            {...activationProps(onBranchSelect ? () => onBranchSelect(lane.branchId) : undefined)}
          >
            <title>{`Branch ${name}`}</title>
            <line
              data-testid="repo-lane"
              data-branch-id={lane.branchId}
              data-color={lane.color}
              x1={lane.startX + originX}
              y1={y}
              x2={lane.endX + originX}
              y2={y}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
            />
            {/* Anchored in the left gutter rather than at the lane's own
                startX: a branch with no commits has startX === endX, and a
                branch that forks late starts far to the right, so anchoring to
                the geometry would put labels over other branches' commits or
                off-canvas. The gutter gives every branch -- commitless ones
                included -- the same readable, in-bounds place for its name. */}
            <text
              data-testid="repo-lane-label"
              data-branch-id={lane.branchId}
              x={PADDING}
              y={y}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={LABEL_FONT_SIZE}
              fill={color}
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* FR-007: fork/merge connections derived from buildRepoTree's edges. */}
      {edges.map((edge, i) => {
        const from = nodeBySha.get(edge.fromSha);
        const to = nodeBySha.get(edge.toSha);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.kind}-${edge.fromSha}-${edge.toSha}-${i}`}
            data-testid="repo-edge"
            data-kind={edge.kind}
            x1={from.x + originX}
            y1={from.y + PADDING}
            x2={to.x + originX}
            y2={to.y + PADDING}
            stroke={BRANCH_COLOR_TOKEN[to.color]}
            strokeWidth={1.5}
          />
        );
      })}

      {/* FR-008/FR-012: one circle per commit, in its branch's colour. */}
      {nodes.map((node) => {
        const name = nameOf(node.branchId);
        const label = `Commit ${shortSha(node.sha)} on ${name}`;
        return (
          <circle
            key={node.sha}
            data-testid="repo-commit"
            data-sha={node.sha}
            data-branch-id={node.branchId}
            data-color={node.color}
            role="button"
            tabIndex={0}
            aria-label={label}
            cx={node.x + originX}
            cy={node.y + PADDING}
            r={NODE_RADIUS}
            fill={BRANCH_COLOR_TOKEN[node.color]}
            {...activationProps(onCommitSelect ? () => onCommitSelect(node.sha) : undefined)}
          >
            <title>{label}</title>
          </circle>
        );
      })}
    </svg>
  );
}
