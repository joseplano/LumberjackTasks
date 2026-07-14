import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import RegisterPage from '@/app/register/page';
import { api } from '@/lib/api';
import { getToken, clearToken } from '@/lib/auth';

async function fillForm() {
  await userEvent.type(screen.getByLabelText(/name/i), 'Ada Lovelace');
  await userEvent.type(screen.getByLabelText(/email/i), 'ada@test.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
  });

  it('registers, logs in, stores the token and navigates to /projects', async () => {
    vi.mocked(api).mockImplementation((path: string) =>
      path === '/auth/login'
        ? Promise.resolve({ token: 'jwt-9' })
        : Promise.resolve({ id: 'u1' }),
    );
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(api).toHaveBeenCalledWith('/auth/register', {
      method: 'POST',
      body: { name: 'Ada Lovelace', email: 'ada@test.com', password: 'secret123' },
    });
    expect(api).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ada@test.com', password: 'secret123' },
    });
    expect(getToken()).toBe('jwt-9');
    expect(push).toHaveBeenCalledWith('/projects');
  });

  it('shows the backend error message when registration fails', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Email already registered'));
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
    expect(getToken()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
