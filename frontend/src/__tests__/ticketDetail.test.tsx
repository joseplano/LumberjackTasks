import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import TicketDetailModal from '@/components/TicketDetailModal';
import { api } from '@/lib/api';

const project = {
  id: 'p1',
  code: 'ANIM-000001',
  name: 'Anima',
  description: '',
  gitRepoUrl: '',
  createdAt: '',
  updatedAt: '',
  columns: [{ id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false }],
  labels: [],
  phases: [],
};

const BRANCH = 'feature/002-ticket-git-branch-view';

const detail = {
  id: 't1',
  projectId: 'p1',
  number: 7,
  parentTicketId: null,
  name: 'Big feature',
  description: 'Do the thing',
  columnId: 'c1',
  complexity: 8,
  labelId: null,
  tokensConsumed: 100,
  llmName: 'claude-fable-5',
  developmentTimeMinutes: 30,
  gitBranch: BRANCH,
  effectiveBranch: BRANCH,
  branchSource: 'own',
  createdAt: '',
  updatedAt: '',
  column: { id: 'c1', projectId: 'p1', name: 'TODO', position: 0, isCompletionColumn: false },
  label: null,
  subtickets: [
    {
      id: 't2',
      projectId: 'p1',
      number: 8,
      parentTicketId: 't1',
      name: 'Sub one',
      description: '',
      columnId: 'c1',
      complexity: 2,
      labelId: null,
      tokensConsumed: 50,
      llmName: 'gpt',
      developmentTimeMinutes: 15,
      gitBranch: null,
      effectiveBranch: BRANCH,
      branchSource: 'inherited',
      createdAt: '',
      updatedAt: '',
    },
  ],
  history: [
    {
      id: 'h1',
      ticketId: 't1',
      fromColumnName: 'TODO',
      toColumnName: 'In development',
      changedAt: '2026-07-02T10:00:00Z',
      tokensDelta: 100,
      timeDelta: 30,
    },
  ],
  totals: { totalTokens: 150, totalTimeMinutes: 45 },
};

describe('TicketDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue(detail);
  });

  it('shows core fields, aggregated totals and history', async () => {
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument(); // total tokens
    expect(screen.getByText(/45m/)).toBeInTheDocument(); // total time
    expect(screen.getByText(/todo → in development/i)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/tickets/t1');
  });

  it('lists subtickets and offers Add subticket for a parent', async () => {
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByText(/sub one/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add subticket/i })).toBeInTheDocument();
  });

  it('hides Add subticket when the ticket is itself a subticket', async () => {
    vi.mocked(api).mockResolvedValue({
      ...detail,
      id: 't2',
      parentTicketId: 't1',
      subtickets: [],
    });
    render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(/big feature/i);
    expect(screen.queryByRole('button', { name: /add subticket/i })).not.toBeInTheDocument();
    expect(screen.getByText(/parent: #7/i)).toBeInTheDocument();
  });

  it('edits the ticket: opens the form, PATCHes and refreshes', async () => {
    const onChanged = vi.fn();
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={onChanged} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByText(/edit ticket #7/i)).toBeInTheDocument();

    vi.mocked(api).mockClear();
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api).toHaveBeenCalledWith('/tickets/t1', {
      method: 'PATCH',
      body: expect.objectContaining({ name: 'Big feature', complexity: 8 }),
    });
    expect(onChanged).toHaveBeenCalled();
    // onSaved triggers a reload of the detail:
    expect(api).toHaveBeenCalledWith('/tickets/t1');
    // and the form modal is closed again:
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/edit ticket #7/i)).not.toBeInTheDocument();
  });

  it('deletes the ticket after confirmation and closes', async () => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={onClose} onChanged={onChanged} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Delete ticket')).toBeInTheDocument();
    expect(screen.getByText(/and its 1 subticket/i)).toBeInTheDocument();

    vi.mocked(api).mockResolvedValueOnce({ deleted: true });
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(api).toHaveBeenCalledWith('/tickets/t1', { method: 'DELETE' });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates into a subticket and back to the parent', async () => {
    const subDetail = {
      ...detail,
      id: 't2',
      number: 8,
      name: 'Sub one',
      parentTicketId: 't1',
      subtickets: [],
      history: [],
    };
    vi.mocked(api).mockImplementation((path: string) =>
      Promise.resolve(path === '/tickets/t2' ? subDetail : detail),
    );
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(/big feature/i);
    await userEvent.click(screen.getByRole('button', { name: /#8 sub one/i }));

    // Subticket loaded, with a link back to its parent:
    const parentButton = await screen.findByRole('button', { name: /parent: #7 \(view\)/i });
    expect(api).toHaveBeenCalledWith('/tickets/t2');
    expect(screen.getByText('#8')).toBeInTheDocument();
    expect(screen.queryByText(/big feature/i)).not.toBeInTheDocument();

    await userEvent.click(parentButton);
    expect(await screen.findByText(/big feature/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parent:/i })).not.toBeInTheDocument();
  });
});

/**
 * T023 / T024 / T025 — the reported git branch block (US1, FR-017, FR-018, FR-020, FR-021,
 * FR-022a, FR-025, SC-002).
 *
 * The Spanish literals `Sin rama aún` and `Copiado` are deliberate (spec assumption A-001) and
 * are asserted verbatim.
 */
describe('TicketDetailModal — reported branch', () => {
  /** Strings that would betray a generated, derived, suggested or example branch name. */
  const BRANCH_LIKE_PATTERNS = [
    /(?:feature|feat|fix|hotfix|bugfix|chore|refactor|release|task|ticket)[/_-]\S/i,
    /\b(?:main|master|develop|origin)\b/i,
    /\bbig[-_]feature\b/i,
    /\b7[-_][a-z]/i,
    /\S+\/\S+-\S+/,
  ];

  function setNavigatorClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
  }

  function clearNavigatorClipboard() {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue(detail);
  });

  afterEach(() => {
    clearNavigatorClipboard();
  });

  // T023 — own-branch state
  it('shows the reported branch after the title and before the description, monospaced, with a copy control', async () => {
    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    const value = await screen.findByText(BRANCH);
    expect(value.className).toMatch(/font-mono/);

    const title = screen.getByRole('heading', { name: /big feature/i });
    const description = screen.getByText('Do the thing');
    expect(title.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      value.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // T028 — the copy control and the icon carry a text alternative (FR-022a).
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /branch/i })).toBeInTheDocument();
  });

  // T024 — empty state
  it('shows a muted `Sin rama aún`, no copy control and no branch-like string when nothing was reported', async () => {
    vi.mocked(api).mockResolvedValue({
      ...detail,
      gitBranch: null,
      effectiveBranch: null,
      branchSource: null,
    });
    const { container } = render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    const empty = await screen.findByText('Sin rama aún');
    expect(empty.className).toMatch(/text-fg-muted/);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();

    // SC-002: no placeholder, suggestion, example or value derived from the ticket anywhere.
    const rendered = container.textContent ?? '';
    for (const pattern of BRANCH_LIKE_PATTERNS) {
      expect(rendered).not.toMatch(pattern);
    }
  });

  // T025 — copying, primary path
  it('copies the exact branch text with navigator.clipboard and confirms with `Copiado`', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText });

    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(BRANCH);
    expect(screen.queryByText('Copiado')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(BRANCH);
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  // T025 — copying, non-secure-context fallback (FR-021)
  it('falls back to a textarea and document.execCommand when navigator.clipboard is undefined, and still confirms', async () => {
    setNavigatorClipboard(undefined);
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const copiedText: string[] = [];
    const execCommand = vi.fn((command: string) => {
      const textarea = document.querySelector('textarea');
      if (command === 'copy' && textarea) copiedText.push((textarea as HTMLTextAreaElement).value);
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
      writable: true,
    });

    try {
      render(
        <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
      );
      await screen.findByText(BRANCH);

      await userEvent.click(screen.getByRole('button', { name: /copy/i }));

      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(copiedText).toEqual([BRANCH]);
      expect(await screen.findByText('Copiado')).toBeInTheDocument();
      // The helper textarea must not linger in the document.
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as Record<string, unknown>).execCommand;
      }
    }
  });

  // T007 — copying, primary path with a configured gitRepoUrl (FR-001, FR-004, FR-006, SC-004)
  it('copies the branch URL and names/titles the control "Copy branch URL" when gitRepoUrl is configured', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText });
    const configuredProject = { ...project, gitRepoUrl: 'https://github.com/owner/repo' };

    render(
      <TicketDetailModal
        ticketId="t1"
        project={configuredProject}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText(BRANCH);
    expect(screen.queryByText('Copiado')).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Copy branch URL' });
    expect(button.getAttribute('title')).toBe('Copy branch URL');

    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`https://github.com/owner/repo/tree/${BRANCH}`);
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  // T007 — mirror case: gitRepoUrl is empty, control still names/titles itself "Copy branch name"
  // (FR-004, FR-006, SC-004)
  it('copies the exact branch text and names/titles the control "Copy branch name" when gitRepoUrl is empty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText });

    render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findByText(BRANCH);

    const button = screen.getByRole('button', { name: 'Copy branch name' });
    expect(button.getAttribute('title')).toBe('Copy branch name');

    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(BRANCH);
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  // T008 — non-secure-context fallback with a configured gitRepoUrl copies the branch URL
  // (FR-007, SC-007)
  it('falls back to a textarea carrying the branch URL when navigator.clipboard is undefined and gitRepoUrl is configured', async () => {
    setNavigatorClipboard(undefined);
    const configuredProject = { ...project, gitRepoUrl: 'https://github.com/owner/repo' };
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const copiedText: string[] = [];
    const execCommand = vi.fn((command: string) => {
      const textarea = document.querySelector('textarea');
      if (command === 'copy' && textarea) copiedText.push((textarea as HTMLTextAreaElement).value);
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
      writable: true,
    });

    try {
      render(
        <TicketDetailModal
          ticketId="t1"
          project={configuredProject}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
      await screen.findByText(BRANCH);

      const button = screen.getByRole('button', { name: 'Copy branch URL' });
      await userEvent.click(button);

      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(copiedText).toEqual([`https://github.com/owner/repo/tree/${BRANCH}`]);
      expect(await screen.findByText('Copiado')).toBeInTheDocument();
      // The helper textarea must not linger in the document.
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as Record<string, unknown>).execCommand;
      }
    }
  });
});

/**
 * T040 — the inherited marker on a subticket (US2, FR-019, SC-003, SC-004, and the spec Edge Case
 * "Parent number unavailable while showing an inherited branch").
 *
 * The Spanish literals `(heredada de #<n>)` and `(heredada)` are deliberate (spec assumption
 * A-001) and are asserted verbatim.
 *
 * The parent's number reaches the view through the modal's existing auxiliary, failure-tolerant
 * parent fetch. Two genuinely distinct moments leave it unknown — the fetch has not resolved yet,
 * and the fetch failed — and both must degrade to `(heredada)` while STILL showing the branch.
 */
describe('TicketDetailModal — inherited branch marker', () => {
  const PARENT_BRANCH = 'feature/parent-work';

  /** A subticket whose effective branch is inherited from parent `t1` (#7). */
  const inheritedSub = {
    ...detail,
    id: 't2',
    number: 8,
    name: 'Sub one',
    parentTicketId: 't1',
    gitBranch: null,
    effectiveBranch: PARENT_BRANCH,
    branchSource: 'inherited',
    subtickets: [],
    history: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a muted `(heredada de #7)` marker beside the inherited branch when the parent number is known', async () => {
    vi.mocked(api).mockImplementation((path: string) =>
      Promise.resolve(path === '/tickets/t2' ? inheritedSub : detail),
    );

    const { container } = render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    // The branch value itself is shown...
    expect(await screen.findByText(PARENT_BRANCH)).toBeInTheDocument();
    // ...marked as inherited, with the parent's number, in muted styling.
    const marker = await screen.findByText('(heredada de #7)');
    expect(marker.className).toMatch(/text-fg-muted/);

    const rendered = container.textContent ?? '';
    expect(rendered).not.toMatch(/#null/);
    expect(rendered).not.toMatch(/#undefined/);
    expect(rendered).not.toMatch(/\(heredada de #\s*\)/);
    expect(rendered).not.toMatch(/\(heredada de #(?!\d)/);
  });

  it('degrades to `(heredada)` while the auxiliary parent fetch has not resolved yet, still showing the branch', async () => {
    vi.mocked(api).mockImplementation((path: string) =>
      path === '/tickets/t2'
        ? Promise.resolve(inheritedSub)
        : // The parent lookup never settles — the branch must not wait on it.
          new Promise(() => {}),
    );

    const { container } = render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    // The branch value is never withheld for this reason (spec Edge Case, SC-003).
    expect(await screen.findByText(PARENT_BRANCH)).toBeInTheDocument();
    expect(await screen.findByText('(heredada)')).toBeInTheDocument();
    expect(screen.queryByText(/\(heredada de/)).not.toBeInTheDocument();

    const rendered = container.textContent ?? '';
    expect(rendered).not.toMatch(/#null/);
    expect(rendered).not.toMatch(/#undefined/);
    expect(rendered).not.toMatch(/heredada de/);
    expect(rendered).not.toMatch(/\(heredada\s+#/);
  });

  it('degrades to `(heredada)` when the auxiliary parent fetch fails, still showing the branch', async () => {
    vi.mocked(api).mockImplementation((path: string) =>
      path === '/tickets/t2'
        ? Promise.resolve(inheritedSub)
        : Promise.reject(new Error('parent lookup failed')),
    );

    const { container } = render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    expect(await screen.findByText(PARENT_BRANCH)).toBeInTheDocument();
    const marker = await screen.findByText('(heredada)');
    expect(marker.className).toMatch(/text-fg-muted/);
    // A failed lookup must not hide the ticket either.
    expect(screen.queryByText(/parent lookup failed/i)).not.toBeInTheDocument();

    const rendered = container.textContent ?? '';
    expect(rendered).not.toMatch(/#null/);
    expect(rendered).not.toMatch(/#undefined/);
    expect(rendered).not.toMatch(/heredada de/);
  });

  it('shows no inheritance marker when the subticket has its own branch (SC-004)', async () => {
    const ownSub = {
      ...inheritedSub,
      gitBranch: 'feature/own-work',
      effectiveBranch: 'feature/own-work',
      branchSource: 'own',
    };
    vi.mocked(api).mockImplementation((path: string) =>
      Promise.resolve(path === '/tickets/t2' ? ownSub : detail),
    );

    const { container } = render(
      <TicketDetailModal ticketId="t2" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    expect(await screen.findByText('feature/own-work')).toBeInTheDocument();
    await screen.findByRole('button', { name: /parent: #7 \(view\)/i });
    expect(container.textContent ?? '').not.toMatch(/heredada/);
  });

  it('shows no inheritance marker on a parent ticket, nor in the empty state', async () => {
    vi.mocked(api).mockResolvedValue({
      ...detail,
      gitBranch: null,
      effectiveBranch: null,
      branchSource: null,
      subtickets: [],
    });
    const { container } = render(
      <TicketDetailModal ticketId="t1" project={project} onClose={vi.fn()} onChanged={vi.fn()} />,
    );

    await screen.findByText('Sin rama aún');
    expect(container.textContent ?? '').not.toMatch(/heredada/);
  });
});
