import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import BacklogPage from '@/app/(app)/projects/[id]/backlog/page';
import { api } from '@/lib/api';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [
    { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false },
    { id: 'c2', projectId: 'p1', name: 'Done', position: 1, isCompletionColumn: true },
  ],
  labels: [],
  phases: [],
};

const backlog = {
  groups: [
    {
      phase: { id: 'ph1', name: 'Auth', position: 0 },
      tickets: [
        {
          id: 't1',
          number: 12,
          name: 'Login endpoint',
          description: '',
          complexity: 5,
          parentTicketId: null,
          status: 'In development',
          completed: false,
          label: 'feature',
          subtasks: [
            {
              id: 't2',
              number: 13,
              name: 'JWT middleware',
              description: '',
              complexity: 2,
              parentTicketId: 't1',
              status: 'Done',
              completed: false,
              label: null,
              subtasks: [],
            },
          ],
        },
      ],
    },
    {
      phase: null,
      tickets: [
        {
          id: 't9',
          number: 1,
          name: 'Setup CI',
          description: '',
          complexity: 3,
          parentTicketId: null,
          status: 'Completed',
          completed: true,
          label: null,
          subtasks: [],
        },
      ],
    },
  ],
  total: 2,
  page: 1,
  pageSize: 50,
};

const ticketDetail = {
  id: 't1',
  projectId: 'p1',
  number: 12,
  parentTicketId: null,
  name: 'Login endpoint',
  description: '',
  columnId: 'c1',
  complexity: 5,
  labelId: null,
  phaseId: 'ph1',
  tokensConsumed: 0,
  llmName: null,
  developmentTimeMinutes: 0,
  createdAt: '',
  updatedAt: '',
  column: { id: 'c1', projectId: 'p1', name: 'TODO', position: 0 },
  label: null,
  subtickets: [],
  history: [],
  totals: { totalTokens: 0, totalTimeMinutes: 0 },
};

describe('BacklogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/projects/p1/backlog')) return Promise.resolve(backlog);
      if (path.startsWith('/tickets/')) return Promise.resolve(ticketDetail);
      return Promise.resolve(project);
    });
  });

  it('renders a group header per phase with its ticket count, and lists its tickets', async () => {
    render(<BacklogPage />);
    await screen.findByText('Login endpoint');

    const authHeader = screen.getByRole('button', { name: /Auth/ });
    expect(authHeader).toHaveTextContent('(1)');
    expect(screen.getByText('Login endpoint')).toBeInTheDocument();

    const noPhaseHeader = screen.getByRole('button', { name: /No phase/ });
    expect(noPhaseHeader).toHaveTextContent('(1)');
    expect(screen.getByText('Setup CI')).toBeInTheDocument();
  });

  it('renders a completed (swept) ticket distinguishably, keyed off the completed flag (T046)', async () => {
    render(<BacklogPage />);
    await screen.findByText('Setup CI');

    // Setup CI is completed: true with status 'Completed'. It must render
    // wrapped in a distinguishing marker (not plain text like the on-board
    // rows), proving the page branches on `completed` rather than just
    // printing `status`.
    const completedLabel = screen.getByText('Completed');
    expect(completedLabel.tagName).not.toBe('TD');

    // An on-board ticket with the same-looking status text is rendered as
    // plain text, not wrapped in the completed marker.
    const onBoardLabel = screen.getByText('In development');
    expect(onBoardLabel.tagName).toBe('TD');
  });

  it('renders the "No phase" group last', async () => {
    const { container } = render(<BacklogPage />);
    await screen.findByText('Login endpoint');
    await screen.findByText('Setup CI');

    const html = container.innerHTML;
    const authIndex = html.indexOf('Auth');
    const noPhaseIndex = html.indexOf('No phase');
    expect(authIndex).toBeGreaterThan(-1);
    expect(noPhaseIndex).toBeGreaterThan(authIndex);
  });

  it('renders subtasks nested under their parent, marked with ↳, without counting them as top-level rows', async () => {
    render(<BacklogPage />);
    await screen.findByText('Login endpoint');

    // Subtask is rendered, nested, with the marker.
    expect(await screen.findByText('JWT middleware')).toBeInTheDocument();
    expect(screen.getByText('↳ #13')).toBeInTheDocument();

    // Its parent group's header count reflects only the top-level ticket.
    const authHeader = screen.getByRole('button', { name: /Auth/ });
    expect(authHeader).toHaveTextContent('(1)');
  });

  it('opens the detail modal when a top-level row is clicked', async () => {
    render(<BacklogPage />);
    await userEvent.click(await screen.findByText('Login endpoint'));
    expect(api).toHaveBeenCalledWith('/tickets/t1');
  });

  it('opens the detail modal when a subtask row is clicked', async () => {
    render(<BacklogPage />);
    await screen.findByText('Login endpoint');
    await userEvent.click(screen.getByText('JWT middleware'));
    expect(api).toHaveBeenCalledWith('/tickets/t2');
  });

  it('sorts by a column when its header is clicked, toggling direction', async () => {
    render(<BacklogPage />);
    await screen.findByText('Login endpoint');
    await userEvent.click(screen.getByRole('button', { name: /^name$/i }));
    expect(api).toHaveBeenLastCalledWith(
      '/projects/p1/backlog?sortBy=name&order=asc&page=1&pageSize=50',
    );
    await userEvent.click(screen.getByRole('button', { name: /^name$/i }));
    expect(api).toHaveBeenLastCalledWith(
      '/projects/p1/backlog?sortBy=name&order=desc&page=1&pageSize=50',
    );
  });

  it('keeps Prev and Next disabled when everything fits on one page', async () => {
    render(<BacklogPage />);
    await screen.findByText('Page 1 of 1 · 2 items');
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('paginates with Prev/Next and disables the buttons at the bounds', async () => {
    // 120 top-level tickets at pageSize 50 -> 3 pages.
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/projects/p1/backlog')) {
        return Promise.resolve({ ...backlog, total: 120 });
      }
      return Promise.resolve(project);
    });
    render(<BacklogPage />);
    await screen.findByText('Page 1 of 3 · 120 items');
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(api).toHaveBeenLastCalledWith(
      '/projects/p1/backlog?sortBy=id&order=asc&page=2&pageSize=50',
    );
    await screen.findByText('Page 2 of 3 · 120 items');
    expect(screen.getByRole('button', { name: /prev/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText('Page 3 of 3 · 120 items');
    expect(api).toHaveBeenLastCalledWith(
      '/projects/p1/backlog?sortBy=id&order=asc&page=3&pageSize=50',
    );
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /prev/i }));
    await screen.findByText('Page 2 of 3 · 120 items');
    expect(api).toHaveBeenLastCalledWith(
      '/projects/p1/backlog?sortBy=id&order=asc&page=2&pageSize=50',
    );
  });

  it('T055: shows a restore affordance only for a completed ticket, and restoring reuses the move endpoint', async () => {
    render(<BacklogPage />);
    await screen.findByText('Setup CI');

    // Only the completed ticket (Setup CI) gets a Restore affordance; the
    // on-board ticket (Login endpoint) and its subtask do not.
    const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
    expect(restoreButtons).toHaveLength(1);

    await userEvent.click(restoreButtons[0]);

    // Reuses the existing move endpoint -- no new endpoint -- targeting the
    // project's first column.
    expect(api).toHaveBeenCalledWith('/tickets/t9/move', {
      method: 'POST',
      body: { targetColumnId: 'c1' },
    });

    // Clicking Restore must not also open the ticket detail modal.
    expect(api).not.toHaveBeenCalledWith('/tickets/t9');
  });

  it('collapses a group to hide its tickets, and restores them when expanded again', async () => {
    render(<BacklogPage />);
    await screen.findByText('Login endpoint');
    expect(screen.getByText('JWT middleware')).toBeInTheDocument();

    const authHeader = screen.getByRole('button', { name: /Auth/ });
    expect(authHeader).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(authHeader);

    expect(screen.queryByText('Login endpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('JWT middleware')).not.toBeInTheDocument();
    expect(authHeader).toHaveAttribute('aria-expanded', 'false');
    // The unrelated "No phase" group is unaffected.
    expect(screen.getByText('Setup CI')).toBeInTheDocument();

    await userEvent.click(authHeader);

    expect(screen.getByText('Login endpoint')).toBeInTheDocument();
    expect(screen.getByText('JWT middleware')).toBeInTheDocument();
    expect(authHeader).toHaveAttribute('aria-expanded', 'true');
  });
});
