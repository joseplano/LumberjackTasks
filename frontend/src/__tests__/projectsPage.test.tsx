import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let params = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  usePathname: () => '/projects',
  useSearchParams: () => params,
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import ProjectsPage from '@/app/(app)/projects/page';
import { api } from '@/lib/api';

const projects = [
  {
    id: 'p1',
    code: 'ANIM-000001',
    name: 'Anima Machina',
    description: 'demo',
    gitRepoUrl: 'https://git/x.git',
  },
  { id: 'p2', code: 'ZETA-000002', name: 'Zeta', description: '', gitRepoUrl: '' },
];

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params = new URLSearchParams();
    vi.mocked(api).mockResolvedValue(projects);
  });

  it('renders the project list with code, name, description and repo URL', async () => {
    render(<ProjectsPage />);
    expect(await screen.findByText('ANIM-000001')).toBeInTheDocument();
    expect(screen.getByText('Anima Machina')).toBeInTheDocument();
    expect(screen.getByText('https://git/x.git')).toBeInTheDocument();
  });

  it('searches through the API when typing in the search box', async () => {
    render(<ProjectsPage />);
    await screen.findByText('Zeta');
    vi.mocked(api).mockResolvedValue([projects[1]]);
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'zeta');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(api).toHaveBeenLastCalledWith('/projects?search=zeta');
  });

  it('asks for confirmation before deleting a project', async () => {
    render(<ProjectsPage />);
    const row = (await screen.findByText('Zeta')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /delete/i }));
    expect(await screen.findByText(/delete project/i)).toBeInTheDocument();
    vi.mocked(api).mockResolvedValue({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(api).toHaveBeenCalledWith('/projects/p2', { method: 'DELETE' });
  });

  it('opens the create modal and POSTs the new project', async () => {
    render(<ProjectsPage />);
    await screen.findByText('Zeta');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Fresh');
    vi.mocked(api).mockResolvedValue({ id: 'p3', code: 'FRES-000003', name: 'Fresh' });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/projects', {
      method: 'POST',
      body: { name: 'Fresh', description: '', gitRepoUrl: '' },
    });
  });

  it('opens the create modal when ?new=1 is in the URL', async () => {
    params = new URLSearchParams('new=1');
    render(<ProjectsPage />);
    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument();
  });

  it('opens the edit modal prefilled with the project and PATCHes on save', async () => {
    render(<ProjectsPage />);
    const row = (await screen.findByText('Zeta')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /rename/i }));

    expect(screen.getByText('Edit project')).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Zeta');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Zeta Prime');
    vi.mocked(api).mockResolvedValue({ id: 'p2', code: 'ZETA-000002', name: 'Zeta Prime' });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(api).toHaveBeenCalledWith('/projects/p2', {
      method: 'PATCH',
      body: { name: 'Zeta Prime', description: '', gitRepoUrl: '' },
    });
  });

  it('shows an error banner when the delete fails', async () => {
    render(<ProjectsPage />);
    const row = (await screen.findByText('Zeta')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /delete/i }));
    vi.mocked(api).mockRejectedValueOnce(new Error('Project delete failed'));
    await userEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    expect(await screen.findByText('Project delete failed')).toBeInTheDocument();
    // Dialog is dismissed even on failure:
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });
});
