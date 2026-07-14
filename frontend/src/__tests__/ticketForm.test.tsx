import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import TicketFormModal from '@/components/TicketFormModal';
import { api } from '@/lib/api';
import { FIBONACCI } from '@/lib/types';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [],
  labels: [{ id: 'l1', projectId: 'p1', name: 'bug', color: '#f00' }],
  phases: [],
};

const projectWithPhases = {
  ...project,
  phases: [
    { id: 'ph1', projectId: 'p1', name: 'Auth', description: '', position: 0 },
    { id: 'ph2', projectId: 'p1', name: 'Billing', description: '', position: 1 },
  ],
};

describe('TicketFormModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers exactly the Fibonacci complexity options', () => {
    render(
      <TicketFormModal open project={project} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    const options = screen
      .getAllByRole('option')
      .map((o) => o.textContent)
      .filter((t) => t && /^\d+$/.test(t));
    expect(options).toEqual(FIBONACCI.map(String));
  });

  it('blocks submit when tokens > 0 and no LLM name', async () => {
    render(
      <TicketFormModal open project={project} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'T');
    await userEvent.clear(screen.getByLabelText(/tokens/i));
    await userEvent.type(screen.getByLabelText(/tokens/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/llm name is required/i)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('creates a subticket with parentTicketId', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't9' });
    render(
      <TicketFormModal
        open
        project={project}
        parentTicketId="t1"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Sub');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/tickets', {
      method: 'POST',
      body: expect.objectContaining({ name: 'Sub', parentTicketId: 't1', complexity: 1 }),
    });
  });

  it('POSTs a top-level ticket with all fields filled in', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api).mockResolvedValue({ id: 't1' });
    render(
      <TicketFormModal open project={project} onSaved={onSaved} onClose={onClose} />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Full ticket');
    await userEvent.type(screen.getByLabelText(/description/i), 'All the fields');
    await userEvent.selectOptions(screen.getByLabelText(/complexity/i), '5');
    await userEvent.selectOptions(screen.getByLabelText(/^label$/i), 'l1');
    await userEvent.clear(screen.getByLabelText(/tokens/i));
    await userEvent.type(screen.getByLabelText(/tokens/i), '100');
    await userEvent.type(screen.getByLabelText(/llm name/i), 'claude');
    await userEvent.clear(screen.getByLabelText(/time \(minutes\)/i));
    await userEvent.type(screen.getByLabelText(/time \(minutes\)/i), '30');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(api).toHaveBeenCalledWith('/projects/p1/tickets', {
      method: 'POST',
      body: {
        name: 'Full ticket',
        description: 'All the fields',
        complexity: 5,
        labelId: 'l1',
        phaseId: null,
        tokensConsumed: 100,
        llmName: 'claude',
        developmentTimeMinutes: 30,
        parentTicketId: null,
      },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the save error and stays open when the API rejects', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Ticket name too long'));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <TicketFormModal open project={project} onSaved={onSaved} onClose={onClose} />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'X');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText('Ticket name too long')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('PATCHes an existing ticket without columnId or parentTicketId', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't1' });
    const ticket = {
      id: 't1',
      projectId: 'p1',
      number: 1,
      parentTicketId: null,
      name: 'Old',
      description: 'd',
      columnId: 'c1',
      complexity: 5,
      labelId: 'l1',
      phaseId: null,
      tokensConsumed: 10,
      llmName: 'claude',
      developmentTimeMinutes: 5,
      createdAt: '',
      updatedAt: '',
    };
    render(
      <TicketFormModal open project={project} ticket={ticket} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const [path, opts] = vi.mocked(api).mock.calls[0]!;
    expect(path).toBe('/tickets/t1');
    expect(opts?.method).toBe('PATCH');
    expect(opts?.body).not.toHaveProperty('columnId');
    expect(opts?.body).not.toHaveProperty('parentTicketId');
  });

  it('offers a phase select for a top-level ticket and sends phaseId', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't1' });
    render(
      <TicketFormModal open project={projectWithPhases} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'With phase');
    await userEvent.selectOptions(screen.getByLabelText(/phase/i), 'Auth');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(api).toHaveBeenCalledWith('/projects/p1/tickets', {
      method: 'POST',
      body: expect.objectContaining({ name: 'With phase', phaseId: 'ph1' }),
    });
  });

  it('submits phaseId: null when "No phase" is selected', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't1' });
    render(
      <TicketFormModal open project={projectWithPhases} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), 'No phase ticket');
    await userEvent.selectOptions(screen.getByLabelText(/phase/i), 'No phase');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(api).toHaveBeenCalledWith('/projects/p1/tickets', {
      method: 'POST',
      body: expect.objectContaining({ name: 'No phase ticket', phaseId: null }),
    });
  });

  it('pre-selects the current phase when editing an existing ticket', () => {
    const ticket = {
      id: 't1',
      projectId: 'p1',
      number: 1,
      parentTicketId: null,
      name: 'Old',
      description: 'd',
      columnId: 'c1',
      complexity: 5,
      labelId: 'l1',
      phaseId: 'ph1',
      tokensConsumed: 10,
      llmName: 'claude',
      developmentTimeMinutes: 5,
      createdAt: '',
      updatedAt: '',
    };
    render(
      <TicketFormModal open project={projectWithPhases} ticket={ticket} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText(/phase/i)).toHaveValue('ph1');
  });

  it('hides the phase select when creating a subticket and omits phaseId from the body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't9' });
    render(
      <TicketFormModal
        open
        project={projectWithPhases}
        parentTicketId="t1"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/phase/i)).toBeNull();

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Sub');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(api).toHaveBeenCalledWith('/projects/p1/tickets', {
      method: 'POST',
      body: expect.objectContaining({ name: 'Sub', parentTicketId: 't1' }),
    });
    const [, opts] = vi.mocked(api).mock.calls[0]!;
    expect(opts?.body).not.toHaveProperty('phaseId');
  });

  it('hides the phase select when editing an existing subtask and omits phaseId from the body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't1' });
    const subtask = {
      id: 't1',
      projectId: 'p1',
      number: 1,
      parentTicketId: 't0',
      name: 'Sub',
      description: '',
      columnId: 'c1',
      complexity: 1,
      labelId: null,
      phaseId: null,
      tokensConsumed: 0,
      llmName: null,
      developmentTimeMinutes: 0,
      createdAt: '',
      updatedAt: '',
    };
    render(
      <TicketFormModal open project={projectWithPhases} ticket={subtask} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/phase/i)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const [, opts] = vi.mocked(api).mock.calls[0]!;
    expect(opts?.body).not.toHaveProperty('phaseId');
  });
});
