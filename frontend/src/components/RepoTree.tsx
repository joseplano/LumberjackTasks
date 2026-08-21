import { buildRepoTree, type RepoTreeBranch, type RepoTreeCommit } from '@/lib/repoTree';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';

// Padding so lane lines and commit circles at x=0/y=0 aren't clipped at the
// SVG's edge, and so circle strokes have room to render.
const PADDING = 16;
const NODE_RADIUS = 6;

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
 * output directly: this component owns no layout math of its own.
 *
 * Commit circles and branch lanes are real focusable elements with
 * accessible names (T046) so the commit/branch modals built in later tasks
 * (US3/US4) can be reached from the keyboard as well as the pointer.
 */
export default function RepoTree({ branches, commits, onCommitSelect, onBranchSelect }: RepoTreeProps) {
  const { lanes, nodes, edges, width, height } = buildRepoTree({ branches, commits });

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const nodeBySha = new Map(nodes.map((n) => [n.sha, n]));

  const svgWidth = width + PADDING * 2;
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
      role="img"
      aria-label="Repository commit history"
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
    >
      {/* FR-004/FR-005: one horizontal lane line per branch, trunk included. */}
      {lanes.map((lane) => {
        const name = branchNameById.get(lane.branchId) ?? lane.branchId;
        const y = lane.y + PADDING;
        return (
          <line
            key={lane.branchId}
            data-testid="repo-lane"
            data-branch-id={lane.branchId}
            data-color={lane.color}
            role="button"
            tabIndex={0}
            aria-label={`Branch ${name}`}
            x1={lane.startX + PADDING}
            y1={y}
            x2={lane.endX + PADDING}
            y2={y}
            stroke={BRANCH_COLOR_TOKEN[lane.color]}
            strokeWidth={3}
            strokeLinecap="round"
            {...activationProps(onBranchSelect ? () => onBranchSelect(lane.branchId) : undefined)}
          >
            <title>{`Branch ${name}`}</title>
          </line>
        );
      })}

      {/* FR-007: fork/merge connections derived from buildRepoTree's edges. */}
      {edges.map((edge) => {
        const from = nodeBySha.get(edge.fromSha);
        const to = nodeBySha.get(edge.toSha);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.fromSha}-${edge.toSha}`}
            data-testid="repo-edge"
            data-kind={edge.kind}
            x1={from.x + PADDING}
            y1={from.y + PADDING}
            x2={to.x + PADDING}
            y2={to.y + PADDING}
            stroke={BRANCH_COLOR_TOKEN[to.color]}
            strokeWidth={1.5}
          />
        );
      })}

      {/* FR-008/FR-012: one circle per commit, in its branch's colour. */}
      {nodes.map((node) => {
        const name = branchNameById.get(node.branchId) ?? node.branchId;
        const label = `Commit ${shortSha(node.sha)} on ${name}`;
        return (
          <circle
            key={node.sha}
            data-testid="repo-commit"
            data-sha={node.sha}
            data-color={node.color}
            role="button"
            tabIndex={0}
            aria-label={label}
            cx={node.x + PADDING}
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
