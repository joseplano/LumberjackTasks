import type { BranchColor } from './branchColor';

/**
 * Maps `branchColor`'s four semantic results onto the app's themeable CSS
 * custom properties (see `frontend/src/app/globals.css`'s `@theme inline`
 * block), never onto a literal `#hex`. This app ships seven themes in both
 * light and dark polarities; a hard-coded hex would look wrong on six of
 * the seven themes and break the light ones outright.
 *
 * Kept in this one exported place so a test can assert the mapping and so
 * later work (the commit/branch modals) can reuse it rather than
 * reimplementing it.
 */
export const BRANCH_COLOR_TOKEN: Record<BranchColor, string> = {
  blue: 'var(--color-accent)',
  green: 'var(--color-success)',
  yellow: 'var(--color-warning)',
  grey: 'var(--color-fg-muted)',
};
