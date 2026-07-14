import { ApiError } from '../middleware/errors';

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;

export function validateTicketData(data: {
  complexity: number;
  tokensConsumed: number;
  developmentTimeMinutes: number;
  llmName: string | null;
}): void {
  if (!FIBONACCI_COMPLEXITY.includes(data.complexity as (typeof FIBONACCI_COMPLEXITY)[number])) {
    throw new ApiError(
      400,
      'INVALID_COMPLEXITY',
      `complexity must be one of ${FIBONACCI_COMPLEXITY.join(', ')}`,
    );
  }
  if (data.tokensConsumed < 0) {
    throw new ApiError(400, 'NEGATIVE_TOKENS', 'tokensConsumed cannot be negative');
  }
  if (data.developmentTimeMinutes < 0) {
    throw new ApiError(400, 'NEGATIVE_TIME', 'developmentTimeMinutes cannot be negative');
  }
  if (data.tokensConsumed > 0 && !data.llmName?.trim()) {
    throw new ApiError(400, 'LLM_REQUIRED', 'llmName is required when tokens are consumed');
  }
}

export function validateParentMove(
  targetPosition: number,
  currentPosition: number,
  subticketPositions: number[],
): void {
  if (targetPosition <= currentPosition) return; // moving backwards or staying is always allowed
  const behind = subticketPositions.filter((p) => p < targetPosition);
  if (behind.length > 0) {
    throw new ApiError(
      409,
      'PARENT_MOVE_BLOCKED',
      `Cannot move parent ticket forward: ${behind.length} subticket(s) are not yet in the target column or a later one`,
    );
  }
}

export function aggregateTotals(
  own: { tokensConsumed: number; developmentTimeMinutes: number },
  subs: { tokensConsumed: number; developmentTimeMinutes: number }[],
): { totalTokens: number; totalTimeMinutes: number } {
  return {
    totalTokens: own.tokensConsumed + subs.reduce((sum, s) => sum + s.tokensConsumed, 0),
    totalTimeMinutes:
      own.developmentTimeMinutes + subs.reduce((sum, s) => sum + s.developmentTimeMinutes, 0),
  };
}
