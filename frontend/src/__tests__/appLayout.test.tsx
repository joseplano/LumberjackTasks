import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock('@/components/Sidebar', () => ({
  default: () => <div data-testid="sidebar" />,
}));

import AppLayout from '@/app/(app)/layout';
import { setToken, clearToken } from '@/lib/auth';

describe('AppLayout auth guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
  });

  it('redirects to /login and renders nothing without a token', () => {
    render(
      <AppLayout>
        <p>secret content</p>
      </AppLayout>,
    );
    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('renders the sidebar and children when a token exists', async () => {
    setToken('jwt-1');
    render(
      <AppLayout>
        <p>secret content</p>
      </AppLayout>,
    );
    expect(await screen.findByText('secret content')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
