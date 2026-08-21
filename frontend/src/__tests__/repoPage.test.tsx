import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(), getGitHistory: vi.fn() }));

import RepoPage from '@/app/(app)/projects/[id]/repo/page';
import { api, getGitHistory } from '@/lib/api';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima Machina',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [],
  labels: [],
  phases: [],
};

// main (trunk, ACTIVE -> blue per branchColor rule 1): m1 -> m2 (merge, parents [m1, f1]).
// feature (non-trunk, MERGED -> grey per branchColor rule 2): f1, forked off m1.
const history = {
  lastSyncedAt: '2026-08-21T19:40:00.000Z',
  branches: [
    {
      id: 'b-main',
      name: 'main',
      isTrunk: true,
      forkedFromBranchName: null,
      state: 'ACTIVE',
      lastSyncedAt: '2026-08-21T19:40:00.000Z',
    },
    {
      id: 'b-feat',
      name: 'feature',
      isTrunk: false,
      forkedFromBranchName: 'main',
      state: 'MERGED',
      lastSyncedAt: '2026-08-21T19:40:00.000Z',
    },
  ],
  commits: [
    {
      sha: 'm1',
      branchId: 'b-main',
      message: 'Initial commit',
      authorName: 'juglarx',
      committedAt: '2024-01-01T00:00:00.000Z',
      pushed: true,
      isMerge: false,
      parentShas: [],
      fileCount: 1,
      truncatedFileCount: 0,
    },
    {
      sha: 'f1',
      branchId: 'b-feat',
      message: 'Feature work',
      authorName: 'juglarx',
      committedAt: '2024-01-02T00:00:00.000Z',
      pushed: true,
      isMerge: false,
      parentShas: ['m1'],
      fileCount: 2,
      truncatedFileCount: 0,
    },
    {
      sha: 'm2',
      branchId: 'b-main',
      message: "Merge branch 'feature'",
      authorName: 'juglarx',
      committedAt: '2024-01-03T00:00:00.000Z',
      pushed: true,
      isMerge: true,
      parentShas: ['m1', 'f1'],
      fileCount: 0,
      truncatedFileCount: 0,
    },
  ],
};

describe('RepoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T042 (FR-005, FR-008, FR-012): one lane per branch, one circle per
  // commit, coloured per branchColor -- not a hard-coded hex (SC-001a).
  it('renders one lane per branch and one commit circle per commit, coloured per branchColor', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects/p1') return Promise.resolve(project);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
    vi.mocked(getGitHistory).mockResolvedValue(history);

    render(<RepoPage />);

    const lanes = await screen.findAllByTestId('repo-lane');
    expect(lanes).toHaveLength(history.branches.length);
    const commits = screen.getAllByTestId('repo-commit');
    expect(commits).toHaveLength(history.commits.length);

    const laneFor = (branchId: string) => lanes.find((l) => l.getAttribute('data-branch-id') === branchId);
    const commitFor = (sha: string) => commits.find((c) => c.getAttribute('data-sha') === sha);

    // Trunk lane is blue regardless of its reported state (FR-011).
    expect(laneFor('b-main')).toHaveAttribute('data-color', 'blue');
    // MERGED non-trunk branch is grey (D5), and keeps its own lane rather
    // than folding into the trunk (D8).
    expect(laneFor('b-feat')).toHaveAttribute('data-color', 'grey');

    // Every commit is drawn in its branch's colour, never its own (FR-012).
    expect(commitFor('m1')).toHaveAttribute('data-color', 'blue');
    expect(commitFor('m2')).toHaveAttribute('data-color', 'blue');
    expect(commitFor('f1')).toHaveAttribute('data-color', 'grey');

    // Colours must resolve through the shared BRANCH_COLOR_TOKEN map to a
    // themeable CSS custom property, never a hard-coded hex (SC-001a) -- a
    // `data-color="blue"` assertion alone can't catch a `fill="#0000ff"`
    // regression, so assert the rendered `fill` directly too.
    expect(commitFor('m1')).toHaveAttribute('fill', BRANCH_COLOR_TOKEN.blue);
    expect(commitFor('f1')).toHaveAttribute('fill', BRANCH_COLOR_TOKEN.grey);
    expect(laneFor('b-main')).toHaveAttribute('stroke', BRANCH_COLOR_TOKEN.blue);
    expect(laneFor('b-feat')).toHaveAttribute('stroke', BRANCH_COLOR_TOKEN.grey);

    // T046: commit circles and branch lanes are reachable by keyboard with
    // an accessible name identifying which commit/branch.
    expect(screen.getByRole('button', { name: 'Commit m1 on main' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Branch feature' })).toHaveAttribute('tabindex', '0');
  });

  it('shows the error state when loading fails', async () => {
    vi.mocked(api).mockResolvedValue(project);
    vi.mocked(getGitHistory).mockRejectedValue(new Error('Repo history unavailable'));

    render(<RepoPage />);
    expect(await screen.findByText('Repo history unavailable')).toBeInTheDocument();
  });
});
