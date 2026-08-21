import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BRANCH_COLOR_TOKEN } from '@/lib/branchColorToken';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
}));
vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  getGitHistory: vi.fn(),
  getGitCommitDetail: vi.fn(),
  getGitBranchDetail: vi.fn(),
}));

import RepoPage from '@/app/(app)/projects/[id]/repo/page';
import { api, getGitBranchDetail, getGitCommitDetail, getGitHistory } from '@/lib/api';

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

// The never-synced shape from contracts/http-api.md section 1 rule 2: a 200
// with `lastSyncedAt: null` and both arrays empty. This is NOT a failure and
// NOT a 404 -- it means the agent has never reported this project's history.
const neverSynced = { lastSyncedAt: null, branches: [], commits: [] };

// T061 (FR-029, FR-033, SC-007, SC-012): the three states must be
// distinguishable and must never be conflated.
describe('RepoPage — the three states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects/p1') return Promise.resolve(project);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  it('while history is loading, shows a loading indication and not the empty state', async () => {
    // A fetch still in flight: never resolves for the duration of the test.
    vi.mocked(getGitHistory).mockReturnValue(new Promise(() => {}));

    render(<RepoPage />);

    expect(await screen.findByTestId('repo-loading')).toBeInTheDocument();
    // Loading is not emptiness (FR-033).
    expect(screen.queryByTestId('repo-never-synced')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-error')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('repo-commit')).toHaveLength(0);
  });

  it('when the fetch fails, names the reason and does not show the empty state', async () => {
    vi.mocked(getGitHistory).mockRejectedValue(new Error('Database is unreachable'));

    render(<RepoPage />);

    const err = await screen.findByTestId('repo-error');
    // The backend's own reason, not a generic "Something went wrong".
    expect(err).toHaveTextContent('Database is unreachable');
    // A failure to load MUST NOT be presented as an empty history (FR-033).
    expect(screen.queryByTestId('repo-never-synced')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-loading')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('repo-lane')).toHaveLength(0);
    expect(screen.queryAllByTestId('repo-commit')).toHaveLength(0);
  });

  it('when the project has never been synced, explains how to sync and fabricates nothing', async () => {
    vi.mocked(getGitHistory).mockResolvedValue(neverSynced);

    render(<RepoPage />);

    const empty = await screen.findByTestId('repo-never-synced');
    // FR-029: an empty state that EXPLAINS how to sync -- naming the agent
    // tool and the skill that drives it, not a blank canvas.
    expect(empty).toHaveTextContent(/never been synced/i);
    expect(empty).toHaveTextContent(/sync_git_history/);
    expect(empty).toHaveTextContent(/lumberjack-tasks:ticket-sync/);

    // It is not an error and not a loading state.
    expect(screen.queryByTestId('repo-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-loading')).not.toBeInTheDocument();

    // No fabricated history: no lanes, no commits, no invented timestamp.
    expect(screen.queryAllByTestId('repo-lane')).toHaveLength(0);
    expect(screen.queryAllByTestId('repo-commit')).toHaveLength(0);
    expect(screen.queryByTestId('last-synced')).not.toBeInTheDocument();

    // Constitution Principle I: the empty state offers instructions, never a
    // second write path. There is no sync control on this screen.
    expect(screen.queryByRole('button', { name: /sync/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sync/i })).not.toBeInTheDocument();
  });
});

// T062 (FR-028, SC-008): show when the history was last synced -- and only
// when there is a real timestamp to show.
describe('RepoPage — last synced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects/p1') return Promise.resolve(project);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  it('renders the last-synced timestamp when lastSyncedAt is non-null', async () => {
    vi.mocked(getGitHistory).mockResolvedValue(history);

    render(<RepoPage />);

    const stamp = await screen.findByTestId('last-synced');
    expect(stamp).toHaveAttribute('datetime', history.lastSyncedAt);
    expect(stamp).toHaveTextContent(new Date(history.lastSyncedAt).toLocaleString());
  });

  it('renders no last-synced timestamp when lastSyncedAt is null', async () => {
    vi.mocked(getGitHistory).mockResolvedValue(neverSynced);

    render(<RepoPage />);

    expect(await screen.findByTestId('repo-never-synced')).toBeInTheDocument();
    expect(screen.queryByTestId('last-synced')).not.toBeInTheDocument();
  });
});
