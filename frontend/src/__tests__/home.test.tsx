import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

import Home from '@/app/page';

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('redirects to /projects when a token exists', () => {
    window.localStorage.setItem('token', 'jwt-1');
    render(<Home />);
    expect(replace).toHaveBeenCalledWith('/projects');
  });

  it('redirects to /login without a token', () => {
    render(<Home />);
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
