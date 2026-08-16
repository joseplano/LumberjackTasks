import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Board from '@/components/kanban/Board';
import { formatMinutes } from '@/lib/format';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima Machina',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [
    { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false },
    { id: 'c2', projectId: 'p1', name: 'In development', position: 1, isCompletionColumn: false },
  ],
  labels: [],
  phases: [],
};

const tickets = [
  {
    id: 't1',
    projectId: 'p1',
    number: 1,
    parentTicketId: null,
    name: 'Parent ticket',
    description: '',
    columnId: 'c1',
    complexity: 5,
    labelId: null,
    phaseId: null,
    tokensConsumed: 100,
    llmName: 'claude',
    developmentTimeMinutes: 30,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't2',
    projectId: 'p1',
    number: 2,
    parentTicketId: 't1',
    name: 'Sub work',
    description: '',
    columnId: 'c2',
    complexity: 2,
    labelId: null,
    phaseId: null,
    tokensConsumed: 0,
    llmName: null,
    developmentTimeMinutes: 0,
    createdAt: '',
    updatedAt: '',
  },
];

describe('formatMinutes', () => {
  it('formats minutes into h/m', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(60)).toBe('1h 0m');
    expect(formatMinutes(0)).toBe('0m');
  });
});

describe('Board', () => {
  it('renders columns in position order with their tickets', () => {
    render(<Board project={project} tickets={tickets} onTicketClick={vi.fn()} />);
    const cols = screen.getAllByTestId('kanban-column');
    expect(within(cols[0]).getByText('TODO')).toBeInTheDocument();
    expect(within(cols[0]).getByText('Parent ticket')).toBeInTheDocument();
    expect(within(cols[1]).getByText('In development')).toBeInTheDocument();
    expect(within(cols[1]).getByText(/Sub work/)).toBeInTheDocument();
  });

  it('shows complexity and marks subtickets', () => {
    render(<Board project={project} tickets={tickets} onTicketClick={vi.fn()} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/↳/)).toBeInTheDocument();
  });

  it('calls onTicketClick with the clicked ticket id', async () => {
    const onTicketClick = vi.fn();
    render(<Board project={project} tickets={tickets} onTicketClick={onTicketClick} />);
    screen.getByText('Parent ticket').click();
    expect(onTicketClick).toHaveBeenCalledWith('t1');
  });
});
