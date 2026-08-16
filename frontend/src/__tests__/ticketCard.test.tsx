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
  gitBranch: null,
  effectiveBranch: null,
  branchSource: null,
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

  // T043 [US3] — FR-022 / SC-008: the card carries a compact branch chip when and only when
  // the ticket has an effective branch, with no inheritance marker.
  it('renders the branch chip when the ticket has an effective branch', () => {
    render(
      <TicketCard
        ticket={{ ...baseTicket, gitBranch: 'feature/board-chip', effectiveBranch: 'feature/board-chip', branchSource: 'own' }}
        onClick={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('branch-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('feature/board-chip');
  });

  it('renders the chip for an inherited effective branch with no inheritance marker', () => {
    const { container } = render(
      <TicketCard
        ticket={{
          ...baseTicket,
          parentTicketId: 't0',
          gitBranch: null,
          effectiveBranch: 'feature/from-parent',
          branchSource: 'inherited',
        }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId('branch-chip')).toHaveTextContent('feature/from-parent');
    expect(screen.queryByText(/heredada/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/heredad/i);
    expect(container.textContent).not.toMatch(/inherit/i);
  });

  it('renders nothing at all when there is no effective branch — no placeholder, no dash, no empty chip', () => {
    const { container } = render(
      <TicketCard
        ticket={{ ...baseTicket, gitBranch: null, effectiveBranch: null, branchSource: null }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('branch-chip')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/rama/i);
    expect(container.textContent).not.toMatch(/branch/i);
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('–');
    expect(container.textContent).not.toContain('-');
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('truncates a long branch value visually and keeps the full value in the title attribute', () => {
    const longBranch =
      'feature/002-ticket-git-branch-view-with-an-extremely-long-descriptive-suffix';
    render(
      <TicketCard
        ticket={{ ...baseTicket, gitBranch: longBranch, effectiveBranch: longBranch, branchSource: 'own' }}
        onClick={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('branch-chip');
    // Truncation is visual only: the title must carry the full, exact, untruncated value.
    expect(chip).toHaveAttribute('title', longBranch);
    expect(chip.className).toContain('truncate');
    expect(chip.className).toMatch(/max-w-/);
  });
});
