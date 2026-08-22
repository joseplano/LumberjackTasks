import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

import CommitDetailModal from '@/components/CommitDetailModal';
import RepoPage from '@/app/(app)/projects/[id]/repo/page';
import { api, getGitHistory, getGitCommitDetail } from '@/lib/api';

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

// contracts/http-api.md section 2. `truncatedFileCount: 3` with two stored
// files means the commit really changed five (FR-017), and the two tickets
// exercise both `source` values so the inferred marker is discriminating.
const commit = {
  sha: 'b0c1841ffffffffffffffffffffffffffffffffff',
  branchId: 'b-feat',
  branchName: 'feature',
  message: 'feat(frontend): discard query and fragment per FR-003e (T017)',
  authorName: 'juglarx',
  committedAt: '2026-08-20T10:15:00.000Z',
  pushed: true,
  isMerge: false,
  parentShas: ['74ecdc2'],
  files: [
    { path: 'frontend/src/lib/branchUrl.ts', changeType: 'M' as const },
    { path: 'frontend/src/lib/repoTree.ts', changeType: 'A' as const },
  ],
  truncatedFileCount: 3,
  tickets: [
    { id: 't-1', number: 41, name: 'Discard query and fragment', source: 'reported' as const },
    { id: 't-2', number: 42, name: 'Guessed from the branch name', source: 'inferred' as const },
  ],
};

const history = {
  lastSyncedAt: '2026-08-21T19:40:00.000Z',
  branches: [
    {
      id: 'b-main',
      name: 'main',
      isTrunk: true,
      forkedFromBranchName: null,
      state: 'ACTIVE' as const,
      lastSyncedAt: '2026-08-21T19:40:00.000Z',
    },
    {
      id: 'b-feat',
      name: 'feature',
      isTrunk: false,
      forkedFromBranchName: 'main',
      state: 'MERGED' as const,
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
  ],
};

describe('CommitDetailModal (T052 / FR-014, FR-016, FR-017, SC-004, SC-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the commit message, its date, the files it changed and its tickets', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue(commit);

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    // FR-014: description...
    expect(await screen.findByTestId('commit-message')).toHaveTextContent(commit.message);
    // ...date...
    expect(screen.getByTestId('commit-date')).toHaveAttribute('datetime', commit.committedAt);
    expect(screen.getByTestId('commit-date')).toHaveTextContent(
      new Date(commit.committedAt).toLocaleString(),
    );
    // ...files it changed...
    const files = screen.getAllByTestId('git-file');
    expect(files.map((f) => f.textContent)).toEqual([
      expect.stringContaining('frontend/src/lib/branchUrl.ts'),
      expect.stringContaining('frontend/src/lib/repoTree.ts'),
    ]);
    // ...and the tickets associated with it.
    const tickets = screen.getAllByTestId('git-ticket');
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toHaveTextContent('#41');
    expect(tickets[0]).toHaveTextContent('Discard query and fragment');

    // The commit is identified by the branch it belongs to (FR-024/D8).
    expect(screen.getByTestId('commit-branch')).toHaveTextContent('feature');
  });

  // FR-016 / SC-006 / D9: an inference is NEVER presented as reported fact.
  it('labels an inferred ticket as inferred by branch, and does not label a reported one', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue(commit);

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    const tickets = await screen.findAllByTestId('git-ticket');
    const reported = tickets.find((t) => t.getAttribute('data-source') === 'reported')!;
    const inferred = tickets.find((t) => t.getAttribute('data-source') === 'inferred')!;

    // Real, user-visible text -- not merely a data- attribute.
    expect(inferred).toHaveTextContent(/inferred by branch/i);
    expect(reported).not.toHaveTextContent(/inferred/i);

    // The label must be visible text in the document, reachable without
    // inspecting attributes at all.
    expect(screen.getByText(/inferred by branch/i)).toBeInTheDocument();
  });

  // FR-017: a shortened list is never presented as the whole.
  it('states how many further files exist when the stored list was truncated', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue(commit);

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    const notice = await screen.findByTestId('files-truncated');
    // 2 stored + 3 truncated = 5 real files.
    expect(notice).toHaveTextContent(/3 more/);
    expect(notice).toHaveTextContent(/Showing 2 of 5 files/);
  });

  it('does not claim truncation when the stored file list is complete', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue({ ...commit, truncatedFileCount: 0 });

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    expect(await screen.findAllByTestId('git-file')).toHaveLength(2);
    expect(screen.queryByTestId('files-truncated')).not.toBeInTheDocument();
  });

  // SC-004/FR-014, Fix round 2 (Minor 4): GitDetailParts.tsx's "no files"
  // branch renders correctly-looking text, but nothing opened a modal for a
  // zero-file commit -- so a regression that rendered nothing (or crashed on
  // an empty array) would have shipped unasserted.
  it('shows the empty-files message for a commit with no files', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue({ ...commit, files: [], truncatedFileCount: 0 });

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    expect(await screen.findByTestId('git-files-empty')).toHaveTextContent('No files recorded.');
    expect(screen.queryAllByTestId('git-file')).toHaveLength(0);
    expect(screen.queryByTestId('files-truncated')).not.toBeInTheDocument();
  });

  // Same defect, the other empty case: GitDetailParts.tsx's "no tickets"
  // branch was likewise never exercised by a real modal render.
  it('shows the empty-tickets message for a commit with no tickets', async () => {
    vi.mocked(getGitCommitDetail).mockResolvedValue({ ...commit, tickets: [] });

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    expect(await screen.findByTestId('git-tickets-empty')).toHaveTextContent(
      'No tickets are associated with this.',
    );
    expect(screen.queryAllByTestId('git-ticket')).toHaveLength(0);
  });

  // FR-029/no silent failure: a failed detail load says why.
  it('surfaces the reason when the commit detail fails to load', async () => {
    vi.mocked(getGitCommitDetail).mockRejectedValue(new Error('Commit not found'));

    render(<CommitDetailModal projectId="p1" sha={commit.sha} onClose={vi.fn()} />);

    expect(await screen.findByText('Commit not found')).toBeInTheDocument();
  });

  // SC-004: opening a commit from the tree and dismissing returns to the
  // unchanged tree -- same lanes, same circles, same colours.
  it('opens from a commit circle and, once dismissed, leaves the tree unchanged', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects/p1') return Promise.resolve(project);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
    vi.mocked(getGitHistory).mockResolvedValue(history);
    vi.mocked(getGitCommitDetail).mockResolvedValue(commit);

    const user = userEvent.setup();
    render(<RepoPage />);

    const before = (await screen.findAllByTestId('repo-commit')).map(
      (c) => `${c.getAttribute('data-sha')}:${c.getAttribute('data-color')}`,
    );
    const lanesBefore = screen.getAllByTestId('repo-lane').map((l) => l.getAttribute('data-branch-id'));

    await user.click(screen.getByRole('button', { name: 'Commit f1 on feature' }));

    expect(await screen.findByTestId('commit-message')).toHaveTextContent(commit.message);
    expect(vi.mocked(getGitCommitDetail)).toHaveBeenCalledWith('p1', 'f1');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByTestId('commit-message')).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId('repo-commit').map(
        (c) => `${c.getAttribute('data-sha')}:${c.getAttribute('data-color')}`,
      ),
    ).toEqual(before);
    expect(screen.getAllByTestId('repo-lane').map((l) => l.getAttribute('data-branch-id'))).toEqual(
      lanesBefore,
    );
  });
});
