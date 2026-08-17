import { describe, it, expect } from 'vitest';
import {
  validateTicketData,
  validateParentMove,
  aggregateTotals,
  normalizeBranch,
  deriveBranch,
} from '../../src/services/ticketRules';
import { ApiError } from '../../src/middleware/errors';

function expectApiError(fn: () => void, status: number, code: string) {
  try {
    fn();
    expect.unreachable('expected ApiError to be thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(status);
    expect((e as ApiError).code).toBe(code);
  }
}

const base = { complexity: 3, tokensConsumed: 0, developmentTimeMinutes: 0, llmName: null };

describe('validateTicketData', () => {
  it.each([1, 2, 3, 5, 8, 13, 21])('accepts Fibonacci complexity %i', (complexity) => {
    expect(() => validateTicketData({ ...base, complexity })).not.toThrow();
  });

  it.each([0, 4, 6, 7, 22, -1, 1.5])('rejects complexity %s', (complexity) => {
    expect(() => validateTicketData({ ...base, complexity: complexity as number })).toThrow(
      ApiError,
    );
  });

  it('rejects negative tokens', () => {
    expect(() => validateTicketData({ ...base, tokensConsumed: -1, llmName: 'gpt' })).toThrow(
      /tokens/i,
    );
  });

  it('rejects negative development time', () => {
    expect(() => validateTicketData({ ...base, developmentTimeMinutes: -5 })).toThrow(/time/i);
  });

  it('requires an LLM name when tokens > 0', () => {
    expect(() => validateTicketData({ ...base, tokensConsumed: 100 })).toThrow(/llm/i);
    expect(() =>
      validateTicketData({ ...base, tokensConsumed: 100, llmName: 'claude-fable-5' }),
    ).not.toThrow();
  });

  it('rejects invalid complexity with 400 INVALID_COMPLEXITY', () => {
    expectApiError(() => validateTicketData({ ...base, complexity: 4 }), 400, 'INVALID_COMPLEXITY');
  });

  it('rejects negative tokens with 400 NEGATIVE_TOKENS', () => {
    expectApiError(
      () => validateTicketData({ ...base, tokensConsumed: -1, llmName: 'gpt' }),
      400,
      'NEGATIVE_TOKENS',
    );
  });

  it('rejects negative time with 400 NEGATIVE_TIME', () => {
    expectApiError(
      () => validateTicketData({ ...base, developmentTimeMinutes: -5 }),
      400,
      'NEGATIVE_TIME',
    );
  });

  it('rejects missing LLM with 400 LLM_REQUIRED, including whitespace-only names', () => {
    expectApiError(() => validateTicketData({ ...base, tokensConsumed: 100 }), 400, 'LLM_REQUIRED');
    expectApiError(
      () => validateTicketData({ ...base, tokensConsumed: 100, llmName: '   ' }),
      400,
      'LLM_REQUIRED',
    );
  });
});

describe('validateParentMove', () => {
  it('allows forward move when all subtickets are at or past the target', () => {
    expect(() => validateParentMove(2, 1, [2, 3, 5])).not.toThrow();
  });

  it('blocks forward move when any subticket is behind the target', () => {
    expect(() => validateParentMove(2, 1, [1, 3])).toThrow(ApiError);
    try {
      validateParentMove(2, 1, [1, 3]);
    } catch (e) {
      expect((e as ApiError).status).toBe(409);
      expect((e as ApiError).code).toBe('PARENT_MOVE_BLOCKED');
    }
  });

  it('always allows moving backwards or staying', () => {
    expect(() => validateParentMove(0, 3, [0, 1])).not.toThrow();
    expect(() => validateParentMove(3, 3, [0])).not.toThrow();
  });

  it('allows any move for a parent without subtickets', () => {
    expect(() => validateParentMove(5, 0, [])).not.toThrow();
  });

  it('never blocks a parent on a completed (null-position) subticket', () => {
    // FR-011a: completed / off the board ranks strictly after every column,
    // so a null subticket position can never be "behind" the target and can
    // never join the blocking set.
    expect(() => validateParentMove(2, 1, [null, 3])).not.toThrow();
    expect(() => validateParentMove(5, 0, [null])).not.toThrow();
  });

  it('still blocks a forward move when an on-board subticket is behind, alongside a completed one', () => {
    // Regression: a null-position (completed) subticket must not mask a real
    // on-board subticket that IS behind the target.
    expect(() => validateParentMove(2, 1, [1, null])).toThrow(ApiError);
    try {
      validateParentMove(2, 1, [1, null]);
    } catch (e) {
      expect((e as ApiError).status).toBe(409);
      expect((e as ApiError).code).toBe('PARENT_MOVE_BLOCKED');
    }
  });

  it('allows a completed ticket (null currentPosition) to move to any column', () => {
    // FR-011a: a completed ticket's own position ranks after every column,
    // so restoring it to any column is always a backward move.
    // These cases are non-vacuous: targetPosition > 0 and a subticket
    // strictly behind it means the pre-fix comparison (`targetPosition <=
    // currentPosition` with no `?? RANK_OFF_BOARD`, i.e. `5 <= null` ->
    // `5 <= 0` -> false) would fall through and throw PARENT_MOVE_BLOCKED,
    // while the fix (`currentRank = currentPosition ?? RANK_OFF_BOARD` ->
    // Infinity) short-circuits on the backward-move check and never throws.
    expect(() => validateParentMove(5, null, [1])).not.toThrow();
    expect(() => validateParentMove(3, null, [2])).not.toThrow();
  });
});

describe('aggregateTotals', () => {
  it('sums own consumption plus all subtickets', () => {
    const result = aggregateTotals({ tokensConsumed: 100, developmentTimeMinutes: 30 }, [
      { tokensConsumed: 50, developmentTimeMinutes: 10 },
      { tokensConsumed: 25, developmentTimeMinutes: 5 },
    ]);
    expect(result).toEqual({ totalTokens: 175, totalTimeMinutes: 45 });
  });

  it('returns own values when there are no subtickets', () => {
    expect(aggregateTotals({ tokensConsumed: 7, developmentTimeMinutes: 2 }, [])).toEqual({
      totalTokens: 7,
      totalTimeMinutes: 2,
    });
  });
});

// T010 — FR-007..FR-011: branch normalization and validation.
describe('normalizeBranch', () => {
  describe('normalization (FR-007, FR-008)', () => {
    it.each([
      [' main ', 'main'],
      ['\tfeature/x-y\n', 'feature/x-y'],
      ['\r\n 002-ticket-git-branch-view \r\n', '002-ticket-git-branch-view'],
    ])('trims surrounding whitespace: %j -> %j', (input, expected) => {
      expect(normalizeBranch(input)).toBe(expected);
    });

    it.each([[''], ['   '], ['\t'], ['\n'], [' \t\r\n ']])(
      'clears to null when empty after trimming: %j',
      (input) => {
        expect(normalizeBranch(input)).toBeNull();
      },
    );

    it('treats an explicit null as a clear', () => {
      expect(normalizeBranch(null)).toBeNull();
    });

    it('applies no validation to a clear', () => {
      // FR-008: a clear is never rejected, even though the raw input is all
      // whitespace, which FR-009 would reject if it survived trimming.
      expect(() => normalizeBranch('   ')).not.toThrow();
    });

    it('reports an absent field as absent, so the caller can leave the stored value untouched', () => {
      // FR-006: absent is not the same as null. Trim -> empty-clears -> validate
      // never runs for a field that was not sent at all.
      expect(normalizeBranch(undefined)).toBeUndefined();
    });

    it('trims before validating, so a padded but legal name is accepted', () => {
      // The order is load-bearing: validating first would reject " main "
      // for containing whitespace.
      expect(normalizeBranch(' main ')).toBe('main');
    });
  });

  describe('rejection rules (FR-009) — one case per rule', () => {
    it.each([
      ['whitespace inside the value', 'my branch'],
      ['a tilde', 'feature~1'],
      ['a caret', 'feature^'],
      ['a colon', 'origin:main'],
      ['a question mark', 'feature?'],
      ['an asterisk', 'feature*'],
      ['an opening bracket', 'feature[1'],
      ['a backslash', 'feature\\x'],
      ['the sequence ..', 'feature..x'],
      ['the sequence @{', 'feature@{1}'],
      ['an ASCII control character', `feat${String.fromCharCode(1)}ure`],
      ['a leading slash', '/main'],
      ['a trailing slash', 'main/'],
      ['a .lock suffix', 'main.lock'],
      ['a length greater than 255', 'a'.repeat(256)],
    ])('rejects %s with 400 VALIDATION', (_rule, value) => {
      expectApiError(() => normalizeBranch(value), 400, 'VALIDATION');
    });

    it('rejects the DEL control character too', () => {
      expectApiError(() => normalizeBranch(`feat${String.fromCharCode(127)}ure`), 400, 'VALIDATION');
    });
  });

  // FR-010: the REST endpoint forwards req.body unfiltered, so a value that is
  // neither absent, null nor a string must be reported as a validation failure
  // and must never reach .trim() and surface as a 500.
  describe('non-string values (FR-010)', () => {
    it.each<[string, unknown]>([
      ['a number', 42],
      ['a boolean', true],
      ['an object', { branch: 'main' }],
      ['an array', ['main']],
    ])('rejects %s with 400 VALIDATION', (_label, value) => {
      expectApiError(() => normalizeBranch(value as string), 400, 'VALIDATION');
    });

    it.each<[string, unknown]>([
      ['a number', 42],
      ['a boolean', true],
      ['an object', { branch: 'main' }],
      ['an array', ['main']],
    ])('throws no TypeError for %s, so the caller cannot turn it into a 500', (_label, value) => {
      expect(() => normalizeBranch(value as string)).not.toThrow(TypeError);
    });
  });

  describe('acceptance of ordinary names', () => {
    it.each([['main'], ['feature/x-y'], ['002-ticket-git-branch-view']])(
      'accepts %j unchanged',
      (value) => {
        expect(normalizeBranch(value)).toBe(value);
      },
    );

    it('accepts exactly 255 characters and rejects 256', () => {
      const at255 = 'a'.repeat(255);
      expect(normalizeBranch(at255)).toBe(at255);
      expectApiError(() => normalizeBranch('a'.repeat(256)), 400, 'VALIDATION');
    });

    it('measures the length after trimming', () => {
      const at255 = 'a'.repeat(255);
      expect(normalizeBranch(`  ${at255}  `)).toBe(at255);
    });

    it.each([['.hidden'], ['trailing.'], ['-leading-dash'], ['a//b'], ['UPPER_case'], ['x.locked']])(
      'does not enforce any naming convention, so it accepts %j (FR-025)',
      (value) => {
        // FR-025: this is a rejection list for values that cannot be a git
        // reference, not a style or naming-convention validator. Nothing beyond
        // the FR-009 list may be rejected.
        expect(normalizeBranch(value)).toBe(value);
      },
    );
  });
});

// T011 — data-model.md: derived effectiveBranch / branchSource.
describe('deriveBranch', () => {
  const NO_PARENT = undefined;

  it.each([
    ['own value, no parent', 'a', NO_PARENT, 'a', 'own'],
    ['no value, no parent', null, NO_PARENT, null, null],
    ['own value wins over the parent', 'a', 'b', 'a', 'own'],
    ['own value with an empty parent', 'a', null, 'a', 'own'],
    ['no value, parent has one', null, 'b', 'b', 'inherited'],
    ['no value, parent has none', null, null, null, null],
  ])(
    'truth table: %s',
    (_row, own, parentBranch, expectedBranch, expectedSource) => {
      expect(deriveBranch(own, parentBranch)).toEqual({
        effectiveBranch: expectedBranch,
        branchSource: expectedSource,
      });
    },
  );

  const ALL_ROWS: (readonly [string | null, string | null | undefined])[] = [
    ['a', NO_PARENT],
    [null, NO_PARENT],
    ['a', 'b'],
    ['a', null],
    [null, 'b'],
    [null, null],
  ];

  it('holds the invariant: branchSource === null iff effectiveBranch === null', () => {
    for (const [own, parentBranch] of ALL_ROWS) {
      const { effectiveBranch, branchSource } = deriveBranch(own, parentBranch);
      expect(branchSource === null).toBe(effectiveBranch === null);
    }
  });

  it("holds the invariant: branchSource === 'own' iff gitBranch !== null", () => {
    for (const [own, parentBranch] of ALL_ROWS) {
      const { branchSource } = deriveBranch(own, parentBranch);
      expect(branchSource === 'own').toBe(own !== null);
    }
  });

  it('never reports inherited for a ticket without a parent', () => {
    // A parent ticket has nothing above it, so 'inherited' is unreachable.
    expect(deriveBranch('a', NO_PARENT).branchSource).not.toBe('inherited');
    expect(deriveBranch(null, NO_PARENT).branchSource).not.toBe('inherited');
  });

  it('is pure: repeated calls with the same input give the same result', () => {
    expect(deriveBranch(null, 'b')).toEqual(deriveBranch(null, 'b'));
  });
});
