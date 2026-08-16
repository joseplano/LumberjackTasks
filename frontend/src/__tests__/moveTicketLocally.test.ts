import { describe, it, expect } from 'vitest';
import { moveTicketLocally } from '@/lib/moveTicketLocally';
import type { Ticket } from '@/lib/types';

const ticket = (id: string, columnId: string): Ticket => ({
  id,
  projectId: 'p1',
  number: 1,
  parentTicketId: null,
  name: id,
  description: '',
  columnId,
  complexity: 1,
  labelId: null,
  phaseId: null,
  tokensConsumed: 0,
  llmName: null,
  developmentTimeMinutes: 0,
  gitBranch: null,
  effectiveBranch: null,
  branchSource: null,
  createdAt: '',
  updatedAt: '',
});

describe('moveTicketLocally', () => {
  it('moves only the target ticket to the new column', () => {
    const tickets = [ticket('a', 'c1'), ticket('b', 'c1')];
    const result = moveTicketLocally(tickets, 'a', 'c2');
    expect(result.find((t) => t.id === 'a')!.columnId).toBe('c2');
    expect(result.find((t) => t.id === 'b')!.columnId).toBe('c1');
  });

  it('does not mutate the original array', () => {
    const tickets = [ticket('a', 'c1')];
    moveTicketLocally(tickets, 'a', 'c2');
    expect(tickets[0].columnId).toBe('c1');
  });

  it('returns an equivalent list when the ticket is unknown', () => {
    const tickets = [ticket('a', 'c1')];
    expect(moveTicketLocally(tickets, 'zz', 'c2')).toEqual(tickets);
  });
});
