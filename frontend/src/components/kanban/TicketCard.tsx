'use client';

import type { Label, Ticket } from '@/lib/types';
import { formatMinutes } from '@/lib/format';

export default function TicketCard({
  ticket,
  label,
  subticketCount = 0,
  onClick,
}: {
  ticket: Ticket;
  label?: Label | null;
  subticketCount?: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-omarchy border border-border bg-surface p-2 text-sm transition-colors hover:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-fg">
          {ticket.parentTicketId ? '↳ ' : ''}
          {ticket.name}
        </span>
        <span className="rounded bg-surface-2 px-1.5 text-xs font-semibold text-accent">{ticket.complexity}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span>#{ticket.number}</span>
        {label && (
          <span
            className="rounded px-1.5 text-white"
            style={{ backgroundColor: label.color || '#888888' }}
          >
            {label.name}
          </span>
        )}
        {ticket.tokensConsumed > 0 && <span>{ticket.tokensConsumed.toLocaleString()} tok</span>}
        {ticket.developmentTimeMinutes > 0 && <span>{formatMinutes(ticket.developmentTimeMinutes)}</span>}
        {subticketCount > 0 && <span>{subticketCount} subtickets</span>}
        {ticket.effectiveBranch && (
          <span
            data-testid="branch-chip"
            title={ticket.effectiveBranch}
            className="max-w-[10rem] truncate rounded bg-surface-2 px-1.5 font-mono text-fg-muted"
          >
            {ticket.effectiveBranch}
          </span>
        )}
      </div>
    </div>
  );
}
