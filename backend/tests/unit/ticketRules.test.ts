import { describe, it, expect } from 'vitest';
import {
  validateTicketData,
  validateParentMove,
  aggregateTotals,
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
    expect(() => validateParentMove(0, null, [0, 1])).not.toThrow();
    expect(() => validateParentMove(3, null, [])).not.toThrow();
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
