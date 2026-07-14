import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/projects',
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import Sidebar from '@/components/Sidebar';
import { api } from '@/lib/api';

describe('Sidebar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists projects fetched from the API and the fixed nav links', async () => {
    vi.mocked(api).mockResolvedValue([
      { id: 'p1', code: 'ANIM-000001', name: 'Anima Machina' },
      { id: 'p2', code: 'ZETA-000002', name: 'Zeta' },
    ]);
    render(<Sidebar />);
    expect(await screen.findByText('Anima Machina')).toBeInTheDocument();
    expect(screen.getByText('Zeta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all projects/i })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/projects');
  });

  it('links each project to its board', async () => {
    vi.mocked(api).mockResolvedValue([{ id: 'p1', code: 'ANIM-000001', name: 'Anima Machina' }]);
    render(<Sidebar />);
    const link = await screen.findByRole('link', { name: /anima machina/i });
    expect(link).toHaveAttribute('href', '/projects/p1');
  });
});
