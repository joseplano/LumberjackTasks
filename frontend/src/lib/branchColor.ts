export type BranchColor = 'blue' | 'grey' | 'yellow' | 'green';
export type BranchState = 'UNCOMMITTED' | 'ACTIVE' | 'MERGED';

/**
 * Decides a git branch's colour for the repo tree. Pure and total: no I/O, no
 * module-level state. `pushed` is deliberately not an input — being pushed is
 * not a state and must not reach this function (FR-013).
 *
 * Rules are applied in order, stopping at the first match (FR-010).
 */
export function branchColor(input: { isTrunk: boolean; state: BranchState }): BranchColor {
  // Rule 1 (FR-011): the trunk is blue whatever its reported state. Checked
  // before `state` so a defensive trunk-reported-MERGED input still returns
  // blue rather than falling through to rule 2.
  if (input.isTrunk) {
    return 'blue';
  }

  // Rule 2 (D5): merged outranks uncommitted — checked before rule 3.
  if (input.state === 'MERGED') {
    return 'grey';
  }

  // Rule 3: an uncommitted (dirty) branch.
  if (input.state === 'UNCOMMITTED') {
    return 'yellow';
  }

  // Rule 4: otherwise, ACTIVE.
  return 'green';
}
