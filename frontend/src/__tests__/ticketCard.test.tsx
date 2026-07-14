import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketCard from '@/components/kanban/TicketCard';

const baseTicket = {
  id: 't1',
  projectId: 'p1',
  number: 4,
  parentTicketId: null,
  name: 'Card ticket',
  description: '',
  columnId: 'c1',
  complexity: 5,
  labelId: 'l1',
  phaseId: null,
  tokensConsumed: 1200,
  llmName: 'claude',
  developmentTimeMinutes: 75,
  createdAt: '',
  updatedAt: '',
};

describe('TicketCard', () => {
  it('renders the label chip with its color', () => {
    render(
      <TicketCard
        ticket={baseTicket}
        label={{ id: 'l1', projectId: 'p1', name: 'bug', color: '#ff0000' }}
        onClick={vi.fn()}
      />,
    );
    const chip = screen.getByText('bug');
    expect(chip).toHaveStyle({ backgroundColor: '#ff0000' });
  });

  it('shows tokens, time and subticket count when positive', () => {
    render(<TicketCard ticket={baseTicket} subticketCount={3} onClick={vi.fn()} />);
    expect(screen.getByText('1,200 tok')).toBeInTheDocument();
    expect(screen.getByText('1h 15m')).toBeInTheDocument();
    expect(screen.getByText('3 subtickets')).toBeInTheDocument();
  });

  it('hides tokens, time and subticket count when zero', () => {
    render(
      <TicketCard
        ticket={{ ...baseTicket, tokensConsumed: 0, developmentTimeMinutes: 0 }}
        subticketCount={0}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\dm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/subtickets/)).not.toBeInTheDocument();
  });

  it('marks subtickets with an arrow and fires onClick', async () => {
    const onClick = vi.fn();
    render(
      <TicketCard ticket={{ ...baseTicket, parentTicketId: 't0' }} onClick={onClick} />,
    );
    expect(screen.getByText(/↳/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Card ticket/));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
