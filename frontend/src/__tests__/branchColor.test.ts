import { describe, it, expect } from 'vitest';
import { branchColor } from '@/lib/branchColor';

describe('branchColor', () => {
  // --- Rule 1 (FR-011): trunk is blue whatever its reported state, tested
  // individually against all three states, including the defensive
  // trunk-reported-MERGED case that should never be reachable but must not
  // fall through if it is. ---

  it('returns blue for the trunk with state UNCOMMITTED', () => {
    expect(branchColor({ isTrunk: true, state: 'UNCOMMITTED' })).toBe('blue');
  });

  it('returns blue for the trunk with state ACTIVE', () => {
    expect(branchColor({ isTrunk: true, state: 'ACTIVE' })).toBe('blue');
  });

  it('returns blue for the trunk even when state is reported MERGED', () => {
    expect(branchColor({ isTrunk: true, state: 'MERGED' })).toBe('blue');
  });

  // --- Rules 2-4: non-trunk branches, tested individually. ---

  it('returns grey for a non-trunk branch with state MERGED (D5: merged outranks uncommitted)', () => {
    expect(branchColor({ isTrunk: false, state: 'MERGED' })).toBe('grey');
  });

  it('returns yellow for a non-trunk branch with state UNCOMMITTED', () => {
    expect(branchColor({ isTrunk: false, state: 'UNCOMMITTED' })).toBe('yellow');
  });

  it('returns green for a non-trunk branch with state ACTIVE', () => {
    expect(branchColor({ isTrunk: false, state: 'ACTIVE' })).toBe('green');
  });
});
