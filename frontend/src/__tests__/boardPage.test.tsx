import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ticket } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

// The board page's move logic is what we test here, not dnd-kit. Replace Board
// with a stub that exposes each ticket's column and captures the onMove prop.
let capturedOnMove: ((ticketId: string, targetColumnId: string) => void) | undefined;
vi.mock('@/components/kanban/Board', () => ({
  default: (props: {
    tickets: Ticket[];
    onMove?: (ticketId: string, targetColumnId: string) => void;
  }) => {
    capturedOnMove = props.onMove;
    return (
      <div data-testid="board">
        {props.tickets.map((t) => (
          <div key={t.id} data-testid={`ticket-${t.id}`} data-column={t.columnId}>
            {t.name}
          </div>
        ))}
      </div>
    );
  },
}));

import ProjectBoardPage from '@/app/(app)/projects/[id]/page';
import { api } from '@/lib/api';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima Machina',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [
    { id: 'c1', projectId: 'p1', name: 'TODO', position: 0 },
    { id: 'c2', projectId: 'p1', name: 'Done', position: 1 },
  ],
  labels: [],
};

const tickets = [
  {
    id: 't1',
    projectId: 'p1',
    number: 1,
    parentTicketId: null,
    name: 'First ticket',
    description: '',
    columnId: 'c1',
    complexity: 3,
    labelId: null,
    tokensConsumed: 0,
    llmName: null,
    developmentTimeMinutes: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't2',
    projectId: 'p1',
    number: 2,
    parentTicketId: null,
    name: 'Second ticket',
    description: '',
    columnId: 'c1',
    complexity: 1,
    labelId: null,
    tokensConsumed: 0,
    llmName: null,
    developmentTimeMinutes: 0,
    createdAt: '',
    updatedAt: '',
  },
];

const metrics = { totalTokens: 500, totalTimeMinutes: 90 };

function mockLoadCalls(
  moveHandler?: (path: string) => Promise<unknown> | null,
) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (moveHandler && path.endsWith('/move')) {
      const result = moveHandler(path);
      if (result) return result;
    }
    if (path === '/projects/p1') return Promise.resolve(project);
    if (path === '/projects/p1/tickets') return Promise.resolve(tickets);
    if (path === '/projects/p1/metrics') return Promise.resolve(metrics);
    return Promise.reject(new Error(`Unexpected path ${path}`));
  });
}

describe('ProjectBoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnMove = undefined;
  });

  it('loads project name, tickets and metrics together', async () => {
    mockLoadCalls();
    render(<ProjectBoardPage />);
    expect(await screen.findByText('Anima Machina')).toBeInTheDocument();
    expect(screen.getByText('First ticket')).toBeInTheDocument();
    expect(screen.getByText('Second ticket')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/projects/p1');
    expect(api).toHaveBeenCalledWith('/projects/p1/tickets');
    expect(api).toHaveBeenCalledWith('/projects/p1/metrics');
  });

  it('shows the error state when loading fails', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Project not found'));
    render(<ProjectBoardPage />);
    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
  });

  it('applies the move optimistically before the API resolves', async () => {
    let resolveMove!: (v: unknown) => void;
    mockLoadCalls(
      () => new Promise((resolve) => {
        resolveMove = resolve;
      }),
    );
    render(<ProjectBoardPage />);
    await screen.findByTestId('ticket-t1');
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-column', 'c1');

    act(() => {
      capturedOnMove!('t1', 'c2');
    });
    // State updated before the API promise resolved:
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-column', 'c2');
    expect(api).toHaveBeenCalledWith('/tickets/t1/move', {
      method: 'POST',
      body: { targetColumnId: 'c2' },
    });

    await act(async () => {
      resolveMove({ moved: true });
    });
    // Successful move keeps the ticket in place and reloads from the server.
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-column', 'c1'); // reload returns fixture
    expect(vi.mocked(api).mock.calls.filter(([p]) => p === '/projects/p1').length).toBe(2);
  });

  it('rolls back only the failed ticket and shows a dismissible error banner', async () => {
    const pending: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = {};
    mockLoadCalls(
      (path) => new Promise((resolve, reject) => {
        pending[path] = { resolve, reject };
      }),
    );
    render(<ProjectBoardPage />);
    await screen.findByTestId('ticket-t1');

    act(() => {
      capturedOnMove!('t1', 'c2');
    });
    act(() => {
      capturedOnMove!('t2', 'c2');
    });
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-column', 'c2');
    expect(screen.getByTestId('ticket-t2')).toHaveAttribute('data-column', 'c2');

    await act(async () => {
      pending['/tickets/t1/move'].reject(new Error('Parent move blocked'));
    });
    // Only t1 is reverted; the other in-flight move is untouched.
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-column', 'c1');
    expect(screen.getByTestId('ticket-t2')).toHaveAttribute('data-column', 'c2');
    expect(screen.getByText('Parent move blocked')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText('Parent move blocked')).not.toBeInTheDocument();
  });
});
