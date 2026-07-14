import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import TicketDetailModal from '@/components/TicketDetailModal';
import { api } from '@/lib/api';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [{ id: 'c1', projectId: 'p1', name: 'TODO', position: 0 }],
  labels: [],
  phases: [],
};

const detail = {
  id: 't1',
  projectId: 'p1',
  number: 7,
  parentTicketId: null,
  name: 'Big feature',
  description: 'Do the thing',
  columnId: 'c1',
  complexity: 8,
  labelId: null,
  tokensConsumed: 100,
  llmName: 'claude-fable-5',
  developmentTimeMinutes: 30,
  createdAt: '',
  updatedAt: '',
  column: { id: 'c1', projectId: 'p1', name: 'TODO', position: 0 },
  label: null,
  subtickets: [
    {
      id: 't2',
      projectId: 'p1',
      number: 8,
      parentTicketId: 't1',
      name: 'Sub one',
      description: '',
      columnId: 'c1',
      complexity: 2,
      labelId: null,
      tokensConsumed: 50,
      llmName: 'gpt',
      developmentTimeMinutes: 15,
      createdAt: '',
      updatedAt: '',
    },
  ],
  history: [
    {
      id: 'h1',
      ticketId: 't1',
      fromColumnName: 'TODO',
      toColumnName: 'In development',
      changedAt: '2026-07-02T10:00:00Z',
      tokensDelta: 100,
      timeDelta: 30,
    },
  ],
  totals: { totalTokens: 150, totalTimeMinutes: 45 },
};

describe('TicketDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue(detail);
  });

  it('shows core fields, aggregated totals and history', async () => {
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument(); // total tokens
    expect(screen.getByText(/45m/)).toBeInTheDocument(); // total time
    expect(screen.getByText(/todo → in development/i)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/tickets/t1');
  });

  it('lists subtickets and offers Add subticket for a parent', async () => {
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByText(/sub one/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add subticket/i })).toBeInTheDocument();
  });

  it('hides Add subticket when the ticket is itself a subticket', async () => {
    vi.mocked(api).mockResolvedValue({
      ...detail,
      id: 't2',
      parentTicketId: 't1',
      subtickets: [],
    });
    render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(/big feature/i);
    expect(screen.queryByRole('button', { name: /add subticket/i })).not.toBeInTheDocument();
    expect(screen.getByText(/parent: #7/i)).toBeInTheDocument();
  });

  it('edits the ticket: opens the form, PATCHes and refreshes', async () => {
    const onChanged = vi.fn();
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={onChanged} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByText(/edit ticket #7/i)).toBeInTheDocument();

    vi.mocked(api).mockClear();
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/tickets/t1', {
      method: 'PATCH',
      body: expect.objectContaining({ name: 'Big feature', complexity: 8 }),
    });
    expect(onChanged).toHaveBeenCalled();
    // onSaved triggers a reload of the detail:
    expect(api).toHaveBeenCalledWith('/tickets/t1');
    // and the form modal is closed again:
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/edit ticket #7/i)).not.toBeInTheDocument();
  });

  it('deletes the ticket after confirmation and closes', async () => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={onClose} onChanged={onChanged} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Delete ticket')).toBeInTheDocument();
    expect(screen.getByText(/and its 1 subticket/i)).toBeInTheDocument();

    vi.mocked(api).mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(api).toHaveBeenCalledWith('/tickets/t1', { method: 'DELETE' });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates into a subticket and back to the parent', async () => {
    const subDetail = {
      ...detail,
      id: 't2',
      number: 8,
      name: 'Sub one',
      parentTicketId: 't1',
      subtickets: [],
      history: [],
    };
    vi.mocked(api).mockImplementation((path: string) =>
      Promise.resolve(path === '/tickets/t2' ? subDetail : detail),
    );
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /#8 sub one/i }));

    // Subticket loaded, with a link back to its parent:
    const parentButton = await screen.findByRole('button', { name: /parent: #7 \(view\)/i });
    expect(api).toHaveBeenCalledWith('/tickets/t2');
    expect(screen.getByText('#8')).toBeInTheDocument();
    expect(screen.queryByText(/big feature/i)).not.toBeInTheDocument();

    await userEvent.click(parentButton);
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parent:/i })).not.toBeInTheDocument();
  });
});
