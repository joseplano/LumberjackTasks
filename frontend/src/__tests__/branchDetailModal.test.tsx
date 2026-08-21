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

import BranchDetailModal from '@/components/BranchDetailModal';
import CommitDetailModal from '@/components/CommitDetailModal';
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

// contracts/http-api.md section 3. `commitCount: 9` against 3 returned
// `commitMessages` is the capped case of rule 5.
const branch = {
  id: 'b-feat',
  name: 'feature',
  isTrunk: false,
  state: 'MERGED' as const,
  forkedFromBranchName: 'main',
  lastSyncedAt: '2026-08-21T19:40:00.000Z',
  commitCount: 9,
  commitMessages: [
    'chore(speckit): mark T016-T018 complete with gate evidence',
    'feat(frontend): discard query and fragment per FR-003e (T017)',
    'test(branchUrl): RED - query/fragment vectors for FR-003e (T016)',
  ],
  files: [
    { path: 'frontend/src/lib/branchUrl.ts', changeType: 'M' as const },
    { path: 'frontend/src/lib/repoTree.ts', changeType: 'A' as const },
  ],
  truncatedFileCount: 4,
  tickets: [
    { id: 't-1', number: 41, name: 'Discard query and fragment', source: 'reported' as const },
    { id: 't-2', number: 42, name: 'Guessed from the branch name', source: 'inferred' as const },
  ],
};

const commit = {
  sha: 'f1',
  branchId: 'b-feat',
  branchName: 'feature',
  message: 'Feature work',
  authorName: 'juglarx',
  committedAt: '2026-08-20T10:15:00.000Z',
  pushed: true,
  isMerge: false,
  parentShas: ['m1'],
  files: [],
  truncatedFileCount: 0,
  tickets: [{ id: 't-2', number: 42, name: 'Guessed from the branch name', source: 'inferred' as const }],
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

describe('BranchDetailModal (T057 / FR-015, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the branch's tickets, its files, and a description composed from name, state and commit messages", async () => {
    vi.mocked(getGitBranchDetail).mockResolvedValue(branch);

    render(<BranchDetailModal projectId="p1" branchId="b-feat" onClose={vi.fn()} />);

    // The description is composed client-side (contract section 3 rule 4):
    // there is no authored description field anywhere in the system.
    const description = await screen.findByTestId('branch-description');
    expect(description).toHaveTextContent('feature');
    expect(description).toHaveTextContent(/merged/i);
    for (const message of branch.commitMessages) {
      expect(description).toHaveTextContent(message);
    }

    // Tickets.
    const tickets = screen.getAllByTestId('git-ticket');
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toHaveTextContent('#41');

    // Files changed across its commits, with the FR-017 honesty notice.
    expect(screen.getAllByTestId('git-file')).toHaveLength(2);
    expect(screen.getByTestId('files-truncated')).toHaveTextContent(/4 more/);
    expect(screen.getByTestId('files-truncated')).toHaveTextContent(/Showing 2 of 6 files/);
  });

  // SC-005 / rule 5: when commitCount exceeds the messages returned, the modal
  // must say the messages shown are a subset rather than imply completeness.
  it('states that the commit messages shown are a subset when commitCount exceeds them', async () => {
    vi.mocked(getGitBranchDetail).mockResolvedValue(branch);

    render(<BranchDetailModal projectId="p1" branchId="b-feat" onClose={vi.fn()} />);

    const subset = await screen.findByTestId('commit-messages-subset');
    expect(subset).toHaveTextContent(/Showing 3 of 9 commit messages/);
    expect(subset).toHaveTextContent(/subset/i);
  });

  it('does not claim a subset when every commit message was returned', async () => {
    vi.mocked(getGitBranchDetail).mockResolvedValue({ ...branch, commitCount: 3 });

    render(<BranchDetailModal projectId="p1" branchId="b-feat" onClose={vi.fn()} />);

    expect(await screen.findByTestId('branch-description')).toBeInTheDocument();
    expect(screen.queryByTestId('commit-messages-subset')).not.toBeInTheDocument();
  });

  // FR-016: "labelled exactly as in the commit modal" -- compare the rendered
  // text of both, so a divergence in wording fails rather than passing twice.
  it('labels inferred tickets with exactly the same text the commit modal uses', async () => {
    vi.mocked(getGitBranchDetail).mockResolvedValue(branch);
    vi.mocked(getGitCommitDetail).mockResolvedValue(commit);

    const branchView = render(<BranchDetailModal projectId="p1" branchId="b-feat" onClose={vi.fn()} />);
    const inBranch = await screen.findByTestId('git-ticket-inferred');
    const branchLabel = inBranch.textContent;
    expect(branchLabel).toMatch(/inferred by branch/i);
    // A reported ticket must NOT carry the label.
    const reported = screen
      .getAllByTestId('git-ticket')
      .find((t) => t.getAttribute('data-source') === 'reported')!;
    expect(reported).not.toHaveTextContent(/inferred/i);
    branchView.unmount();

    render(<CommitDetailModal projectId="p1" sha="f1" onClose={vi.fn()} />);
    const inCommit = await screen.findByTestId('git-ticket-inferred');
    expect(inCommit.textContent).toBe(branchLabel);
  });

  // SC-005 names this case explicitly: "including a branch with no commits".
  // Fix round 2 (Minor 4): nothing previously opened the branch modal for a
  // commitless branch -- the empty-files/empty-tickets rendering, and the
  // absence of a spurious "subset" notice when there is nothing to be a
  // subset of, were unasserted.
  it('opens for a branch with no commits, no files and no tickets, without a false subset notice', async () => {
    vi.mocked(getGitBranchDetail).mockResolvedValue({
      id: 'b-orphan',
      name: 'orphan',
      isTrunk: false,
      state: 'UNCOMMITTED' as const,
      forkedFromBranchName: 'main',
      lastSyncedAt: '2026-08-21T19:40:00.000Z',
      commitCount: 0,
      commitMessages: [],
      files: [],
      truncatedFileCount: 0,
      tickets: [],
    });

    render(<BranchDetailModal projectId="p1" branchId="b-orphan" onClose={vi.fn()} />);

    const description = await screen.findByTestId('branch-description');
    expect(description).toHaveTextContent('orphan');
    expect(description).toHaveTextContent(/uncommitted/i);
    expect(description).toHaveTextContent(/0 commits recorded/);

    expect(screen.getByTestId('git-files-empty')).toHaveTextContent('No files recorded.');
    expect(screen.getByTestId('git-tickets-empty')).toHaveTextContent('No tickets are associated with this.');
    // Nothing was shown, and nothing was truncated -- 0 of 0 is not a
    // shortened list, so neither honesty notice may appear.
    expect(screen.queryByTestId('files-truncated')).not.toBeInTheDocument();
    expect(screen.queryByTestId('commit-messages-subset')).not.toBeInTheDocument();
    expect(screen.queryByTestId('branch-commit-messages')).not.toBeInTheDocument();
  });

  it('surfaces the reason when the branch detail fails to load', async () => {
    vi.mocked(getGitBranchDetail).mockRejectedValue(new Error('Branch not found'));

    render(<BranchDetailModal projectId="p1" branchId="b-feat" onClose={vi.fn()} />);

    expect(await screen.findByText('Branch not found')).toBeInTheDocument();
  });

  // T058: opened from the branch lane in the tree, and dismissing leaves the
  // tree unchanged.
  it('opens from the branch lane and dismisses back to the unchanged tree', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/projects/p1') return Promise.resolve(project);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
    vi.mocked(getGitHistory).mockResolvedValue(history);
    vi.mocked(getGitBranchDetail).mockResolvedValue(branch);

    const user = userEvent.setup();
    render(<RepoPage />);

    const lanesBefore = (await screen.findAllByTestId('repo-lane')).map((l) =>
      l.getAttribute('data-branch-id'),
    );

    await user.click(screen.getByRole('button', { name: 'Branch feature' }));

    expect(await screen.findByTestId('branch-description')).toBeInTheDocument();
    expect(vi.mocked(getGitBranchDetail)).toHaveBeenCalledWith('p1', 'b-feat');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByTestId('branch-description')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('repo-lane').map((l) => l.getAttribute('data-branch-id'))).toEqual(
      lanesBefore,
    );
    expect(screen.getAllByTestId('repo-commit')).toHaveLength(history.commits.length);
  });
});
