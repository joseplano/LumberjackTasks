import { describe, it, expect } from 'vitest';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';

// Closes the gap the review flagged: nothing previously asserted this map's
// values directly, so a regression to a hard-coded `#hex` (which would look
// wrong on six of the app's seven themes and break both light themes) could
// slip in while `data-color="blue"`-style assertions elsewhere kept passing.
describe('BRANCH_COLOR_TOKEN', () => {
  it('maps every branchColor result to a themeable CSS custom property, never a literal hex', () => {
    expect(BRANCH_COLOR_TOKEN).toEqual({
      blue: 'var(--color-accent)',
      green: 'var(--color-success)',
      yellow: 'var(--color-warning)',
      grey: 'var(--color-fg-muted)',
    });

    for (const value of Object.values(BRANCH_COLOR_TOKEN)) {
      expect(value).toMatch(/^var\(--color-[a-z-]+\)$/);
      expect(value).not.toMatch(/^#/);
    }
  });
});
