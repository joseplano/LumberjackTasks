import type { Ticket } from './types';

export function moveTicketLocally(
  tickets: Ticket[],
  ticketId: string,
  targetColumnId: string,
): Ticket[] {
  return tickets.map((t) => (t.id === ticketId ? { ...t, columnId: targetColumnId } : t));
}
