import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import ReportsPage from '@/app/(app)/reports/page';
import { api } from '@/lib/api';

const mostActive = {
  byTime: [{ projectId: 'p1', code: 'ANIM-000001', name: 'Anima', totalTimeMinutes: 90 }],
  byTokens: [{ projectId: 'p1', code: 'ANIM-000001', name: 'Anima', totalTokens: 1500 }],
};
const consumption = [
  {
    projectId: 'p1',
    code: 'ANIM-000001',
    name: 'Anima',
    maxTokens: { ticketId: 't1', number: 1, name: 'Big', value: 900 },
    minTokens: { ticketId: 't2', number: 2, name: 'Small', value: 10 },
    maxTime: { ticketId: 't1', number: 1, name: 'Big', value: 90 },
    minTime: null,
  },
];
const transitions = {
  mostChanges: [{ ticketId: 't1', number: 1, name: 'Mover', changes: 5 }],
  mostTokensInProcess: [{ ticketId: 't1', number: 1, name: 'Mover', tokens: 400 }],
  longestTransition: [
    {
      ticketId: 't1',
      number: 1,
      name: 'Mover',
      fromColumnName: 'TODO',
      toColumnName: 'Done',
      minutes: 120,
    },
  ],
};

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/reports/most-active') return Promise.resolve(mostActive);
      if (path === '/reports/consumption') return Promise.resolve(consumption);
      return Promise.resolve(transitions);
    });
  });

  it('renders the three report sections with data', async () => {
    render(<ReportsPage />);
    expect(await screen.findByText(/most active projects/i)).toBeInTheDocument();
    expect(screen.getAllByText(/anima/i).length).toBeGreaterThan(0);
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // byTime 90 min
    expect(screen.getByText(/1,500|1500/)).toBeInTheDocument();
    expect((await screen.findAllByText(/#1 Big/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/TODO → Done/)).toBeInTheDocument();
    expect(screen.getByText('2h 0m')).toBeInTheDocument(); // longest transition 120 min
  });

  it('renders a dash for null consumption entries', async () => {
    render(<ReportsPage />);
    expect((await screen.findAllByText('—')).length).toBeGreaterThan(0);
  });

  it('shows the error state when the reports fail to load', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Reports unavailable'));
    render(<ReportsPage />);
    expect(await screen.findByText('Reports unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/most active projects/i)).not.toBeInTheDocument();
  });
});
