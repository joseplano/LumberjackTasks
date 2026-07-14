import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));
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

import LoginPage from '@/app/login/page';
import { api } from '@/lib/api';
import { getToken, clearToken } from '@/lib/auth';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
  });

  it('logs in, stores the token and navigates to /projects', async () => {
    vi.mocked(api).mockResolvedValue({ token: 'jwt-1', user: { id: 'u1' } });
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@test.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(api).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ada@test.com', password: 'secret123' },
    });
    expect(getToken()).toBe('jwt-1');
    expect(push).toHaveBeenCalledWith('/projects');
  });

  it('shows the backend error message on failure', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@test.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
