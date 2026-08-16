import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import ColumnsManager from '@/components/settings/ColumnsManager';
import LabelsManager from '@/components/settings/LabelsManager';
import PhasesManager from '@/components/settings/PhasesManager';
import SettingsPage from '@/app/(app)/settings/page';
import { api, ApiError } from '@/lib/api';

const columns = [
  { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false },
  { id: 'c2', projectId: 'p1', name: 'Done', position: 1, isCompletionColumn: false },
];

describe('ColumnsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue(columns);
  });

  it('lists columns and reorders with the down button', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    await userEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/order', {
      method: 'PUT',
      body: { orderedIds: ['c2', 'c1'] },
    });
  });

  it('asks for a destination when deleting a column with tickets', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(409, 'COLUMN_NOT_EMPTY', 'Column has 2 ticket(s)'),
    );
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(await screen.findByText(/move its tickets to/i)).toBeInTheDocument();
    vi.mocked(api).mockResolvedValue({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /move & delete/i }));
    expect(api).toHaveBeenLastCalledWith('/projects/p1/columns/c1?moveTo=c2', {
      method: 'DELETE',
    });
  });

  it('creates a new column through the add form', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    await userEvent.type(screen.getByPlaceholderText(/new column name/i), 'Review');
    await userEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/columns', {
      method: 'POST',
      body: { name: 'Review' },
    });
  });

  it('renames a column via PATCH', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    await userEvent.click(screen.getAllByRole('button', { name: /^rename$/i })[0]);
    const input = screen.getByDisplayValue('TODO');
    await userEvent.clear(input);
    await userEvent.type(input, 'Backlog');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/c1', {
      method: 'PATCH',
      body: { name: 'Backlog' },
    });
  });

  it('moves a column up with the up button', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    await userEvent.click(screen.getAllByRole('button', { name: /move up/i })[1]);
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/order', {
      method: 'PUT',
      body: { orderedIds: ['c2', 'c1'] },
    });
  });

  it('ignores moving the first column up and the last column down', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    expect(api).toHaveBeenCalledTimes(1); // initial load only
    await userEvent.click(screen.getAllByRole('button', { name: /move up/i })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: /move down/i })[1]);
    expect(api).toHaveBeenCalledTimes(1); // no reorder calls issued
  });

  it('deletes an empty column immediately', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    vi.mocked(api).mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(api).toHaveBeenLastCalledWith('/projects/p1/columns/c1', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByText('TODO')).not.toBeInTheDocument());
    expect(screen.queryByText(/move its tickets to/i)).not.toBeInTheDocument();
  });

  it('designates a column as the completion column via PATCH', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    vi.mocked(api).mockResolvedValueOnce({ id: 'c1', isCompletionColumn: true });
    await userEvent.click(screen.getByRole('checkbox', { name: /completion column: todo/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/c1', {
      method: 'PATCH',
      body: { isCompletionColumn: true },
    });
  });

  it('clears the completion column via PATCH with isCompletionColumn: false', async () => {
    vi.mocked(api).mockResolvedValueOnce([
      { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: true },
      { id: 'c2', projectId: 'p1', name: 'Done', position: 1, isCompletionColumn: false },
    ]);
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    vi.mocked(api).mockResolvedValueOnce({ id: 'c1', isCompletionColumn: false });
    await userEvent.click(screen.getByRole('checkbox', { name: /completion column: todo/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/c1', {
      method: 'PATCH',
      body: { isCompletionColumn: false },
    });
  });

  it('marks at most one column as the completion column after designating a second one', async () => {
    vi.mocked(api).mockResolvedValueOnce([
      { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: true },
      { id: 'c2', projectId: 'p1', name: 'Done', position: 1, isCompletionColumn: false },
    ]);
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    expect(screen.getByRole('checkbox', { name: /completion column: todo/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /completion column: done/i })).not.toBeChecked();

    // PATCH response, then the re-fetched list after load() — backend already cleared the old one atomically.
    vi.mocked(api).mockResolvedValueOnce({ id: 'c2', isCompletionColumn: true });
    vi.mocked(api).mockResolvedValueOnce([
      { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false },
      { id: 'c2', projectId: 'p1', name: 'Done', position: 1, isCompletionColumn: true },
    ]);

    await userEvent.click(screen.getByRole('checkbox', { name: /completion column: done/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);
    });
    expect(screen.getByRole('checkbox', { name: /completion column: done/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /completion column: todo/i })).not.toBeChecked();
    // Only the designating PATCH was issued — no client-side clearing request for the old column.
    expect(api).toHaveBeenCalledWith('/projects/p1/columns/c2', {
      method: 'PATCH',
      body: { isCompletionColumn: true },
    });
    expect(api).not.toHaveBeenCalledWith(
      '/projects/p1/columns/c1',
      expect.objectContaining({ method: 'PATCH', body: { isCompletionColumn: false } }),
    );
  });

  it('surfaces a 409 COMPLETION_COLUMN_CONFLICT error', async () => {
    render(<ColumnsManager projectId="p1" />);
    await screen.findByText('TODO');
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(409, 'COMPLETION_COLUMN_CONFLICT', 'Another column was just designated'),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /completion column: todo/i }));
    expect(await screen.findByText(/another column was just designated/i)).toBeInTheDocument();
  });
});

describe('LabelsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue([{ id: 'l1', projectId: 'p1', name: 'bug', color: '#f00' }]);
  });

  it('lists labels and creates a new one', async () => {
    render(<LabelsManager projectId="p1" />);
    await screen.findByText('bug');
    await userEvent.type(screen.getByPlaceholderText(/new label name/i), 'feat');
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/labels') && typeof path === 'string') {
        return [{ id: 'l1', projectId: 'p1', name: 'bug', color: '#f00' }, { id: 'l2', projectId: 'p1', name: 'feat', color: '#3b82f6' }];
      }
      return { id: 'l2' };
    });
    await userEvent.click(screen.getByRole('button', { name: /add label/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/labels', {
      method: 'POST',
      body: expect.objectContaining({ name: 'feat' }),
    });
  });

  it('confirms before force-deleting a used label', async () => {
    render(<LabelsManager projectId="p1" />);
    await screen.findByText('bug');
    vi.mocked(api).mockRejectedValueOnce(new ApiError(409, 'LABEL_IN_USE', 'Label is used'));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText(/tickets will lose this label/i)).toBeInTheDocument();
    vi.mocked(api).mockResolvedValue({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(api).toHaveBeenLastCalledWith('/projects/p1/labels/l1?force=true', {
      method: 'DELETE',
    });
  });

  it('edits a label name and color via PATCH', async () => {
    render(<LabelsManager projectId="p1" />);
    await screen.findByText('bug');
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const nameInput = screen.getByDisplayValue('bug');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'defect');
    const colorInputs = document.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[0], { target: { value: '#00ff00' } });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/labels/l1', {
      method: 'PATCH',
      body: { name: 'defect', color: '#00ff00' },
    });
  });

  it('deletes an unused label without confirmation', async () => {
    render(<LabelsManager projectId="p1" />);
    await screen.findByText('bug');
    vi.mocked(api).mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(api).toHaveBeenLastCalledWith('/projects/p1/labels/l1', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByText('bug')).not.toBeInTheDocument());
    expect(screen.queryByText(/lose this label/i)).not.toBeInTheDocument();
  });
});

describe('PhasesManager', () => {
  const phases = [
    { id: 'ph1', projectId: 'p1', name: 'Auth', description: 'Login & signup', position: 0 },
    { id: 'ph2', projectId: 'p1', name: 'Billing', description: '', position: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue([phases[0]]);
  });

  it('lists phases and creates one', async () => {
    render(<PhasesManager projectId="p1" />);
    await screen.findByText('Auth');
    await userEvent.type(screen.getByPlaceholderText(/new phase name/i), 'Reports');
    vi.mocked(api).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('/phases') && !path.includes('/order')) {
        return [phases[0], { id: 'ph3', projectId: 'p1', name: 'Reports', description: '', position: 1 }];
      }
      return { id: 'ph3' };
    });
    await userEvent.click(screen.getByRole('button', { name: /add phase/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/phases', {
      method: 'POST',
      body: { name: 'Reports', description: '' },
    });
  });

  it('renames a phase', async () => {
    render(<PhasesManager projectId="p1" />);
    await screen.findByText('Auth');
    await userEvent.click(screen.getByRole('button', { name: /^rename$/i }));
    const input = screen.getByDisplayValue('Auth');
    await userEvent.clear(input);
    await userEvent.type(input, 'Auth v2');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/projects/p1/phases/ph1', {
      method: 'PATCH',
      body: { name: 'Auth v2', description: 'Login & signup' },
    });
  });

  it('moves a phase down and no-ops at the boundary', async () => {
    vi.mocked(api).mockResolvedValue(phases);
    render(<PhasesManager projectId="p1" />);
    await screen.findByText('Auth');
    await screen.findByText('Billing');
    await userEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
    expect(api).toHaveBeenCalledWith('/projects/p1/phases/order', {
      method: 'PUT',
      body: { orderedIds: ['ph2', 'ph1'] },
    });
    const callsAfterFirstMove = vi.mocked(api).mock.calls.length;
    await userEvent.click(screen.getAllByRole('button', { name: /move down/i })[1]);
    expect(vi.mocked(api).mock.calls.length).toBe(callsAfterFirstMove);
    await userEvent.click(screen.getAllByRole('button', { name: /move up/i })[0]);
    expect(vi.mocked(api).mock.calls.length).toBe(callsAfterFirstMove);
  });

  it('blocks deleting a non-empty phase and offers force', async () => {
    render(<PhasesManager projectId="p1" />);
    await screen.findByText('Auth');
    vi.mocked(api).mockRejectedValueOnce(new ApiError(409, 'PHASE_NOT_EMPTY', 'Phase has tickets'));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText(/unassign/i)).toBeInTheDocument();
    vi.mocked(api).mockResolvedValue({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(api).toHaveBeenLastCalledWith('/projects/p1/phases/ph1?force=true', {
      method: 'DELETE',
    });
  });
});

describe('SettingsPage', () => {
  const projects = [
    { id: 'p1', code: 'ANIM-000001', name: 'Anima', description: '', gitRepoUrl: '' },
    { id: 'p2', code: 'ZETA-000002', name: 'Zeta', description: '', gitRepoUrl: '' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(projects);
      if (path.endsWith('/columns')) return Promise.resolve(columns);
      if (path.endsWith('/labels')) {
        return Promise.resolve([{ id: 'l1', projectId: 'p1', name: 'bug', color: '#f00' }]);
      }
      if (path.endsWith('/phases')) {
        return Promise.resolve([{ id: 'ph1', projectId: 'p1', name: 'Auth', description: '', position: 0 }]);
      }
      return Promise.resolve([]);
    });
  });

  it('loads projects, selects the first and renders both managers', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('Anima (ANIM-000001)')).toBeInTheDocument();
    expect((screen.getByLabelText(/project/i) as HTMLSelectElement).value).toBe('p1');
    expect(await screen.findByText('Kanban columns')).toBeInTheDocument();
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('Phases')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/projects/p1/columns');
    expect(api).toHaveBeenCalledWith('/projects/p1/labels');
    expect(api).toHaveBeenCalledWith('/projects/p1/phases');
  });

  it('switches the managers to the newly selected project', async () => {
    render(<SettingsPage />);
    await screen.findByText('Anima (ANIM-000001)');
    await userEvent.selectOptions(screen.getByLabelText(/project/i), 'p2');
    expect((screen.getByLabelText(/project/i) as HTMLSelectElement).value).toBe('p2');
    expect(api).toHaveBeenCalledWith('/projects/p2/columns');
    expect(api).toHaveBeenCalledWith('/projects/p2/labels');
    expect(api).toHaveBeenCalledWith('/projects/p2/phases');
  });
});
