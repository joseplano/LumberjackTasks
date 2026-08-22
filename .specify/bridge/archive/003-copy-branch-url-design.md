# Approved Design — Copy the branch URL, not just the branch name

Status: APPROVED by human partner
Bridge version: 3.1.0
Classification: bounded (a scoped change to a flow that already exists in this repo)

## Original feature idea

> en los tickets, en el nombre del branch del repo en la opcion de copiar, que al
> portapaleles te copie toda la url include el brabch asi podemos ir directamente
> al branch al repo

Restated: the copy control in the ticket's branch block should put the full URL to
that branch in the repository on the clipboard, so pasting it in a browser goes
straight to the branch.

## Branch topology decision (approved)

Feature `002-ticket-git-branch-view` is committed (`18ff05a`) and pushed, but NOT
merged into `main`. This feature depends on the copy control that 002 introduced.
The user chose to **stack**: cut the new feature branch from
`002-ticket-git-branch-view`, not from `main`. Two chained branches will need to be
merged in order.

## Decisions explicitly approved by the user

1. **Scope is frontend-only.** No database, backend, or MCP change. `ProjectDetail`
   extends `Project`, which already carries `gitRepoUrl`, and `TicketDetailModal`
   already receives `project` as a prop, so the data is available without new
   plumbing.
2. **Empty-state behaviour** — when the project has no repository URL configured,
   or a URL cannot be built from it, the button copies the branch name, exactly as
   it does today. The control never becomes useless and never copies a broken URL.
3. **Forge coverage** — GitHub, GitLab, Bitbucket and Azure DevOps are all
   supported, each with its own branch-URL shape. An unrecognised host falls back
   to the GitHub pattern.
4. **The label always states what will be copied**, so pasting never surprises:
   *Copy branch URL* when a URL will be copied, *Copy branch name* otherwise.

## Rejected alternatives and trade-offs

- **Disabled button with a "configure the repository URL" notice** — rejected: it
  removes a control that works today in order to explain a missing setting.
- **Two buttons, one for the name and one for the URL** — rejected: the branch
  block already holds an icon, the branch name, and an inheritance marker; a second
  control crowds it.
- **GitHub only** — rejected by the user in favour of full forge coverage, even
  though the current repository is on GitHub.
- **Cutting the branch from `main`** — rejected: `main` has neither the copy
  control nor the branch field, so there would be nothing to modify.

## Functional behaviour

### New helper: `frontend/src/lib/branchUrl.ts`

A pure function `buildBranchUrl(gitRepoUrl: string, branch: string): string | null`.

**Normalisation of the stored project URL:**

- Trim surrounding whitespace.
- Convert the SSH form `git@host:owner/repo.git` to `https://host/owner/repo`.
- Strip a trailing `.git` suffix.
- Strip a trailing `/`.
- If the result is not an `http` or `https` URL, return `null`.

**Branch URL shape, selected by host:**

| Forge | Pattern |
|---|---|
| GitHub | `<repo>/tree/<branch>` |
| GitLab | `<repo>/-/tree/<branch>` |
| Bitbucket | `<repo>/src/<branch>` |
| Azure DevOps | `<repo>?version=GB<branch>` |
| Unrecognised host | the GitHub pattern, as the most widespread |

**Branch encoding:** slashes in a branch such as `feature/x` stay literal in the
path segment, because that is what the forges expect. For Azure DevOps the branch
travels in a query parameter and is therefore fully URL-encoded.

### Copy control behaviour

The copy mechanism is unchanged: `navigator.clipboard` with the hidden-textarea
fallback for non-secure contexts, and the existing `Copiado` confirmation. Only the
copied string changes.

- `gitRepoUrl` configured and a URL can be built → copy the full branch URL; button
  label and `title` read *Copy branch URL*.
- Otherwise → copy the branch name, as today; label reads *Copy branch name*.

The `aria-label` tracks the same text so the accessible name always matches what
the control will copy.

## Edge cases discussed

- `gitRepoUrl` empty (the current state of this very project) → branch name copied.
- `gitRepoUrl` in SSH form → normalised to an https URL.
- `gitRepoUrl` with a `.git` suffix or a trailing slash → both stripped.
- `gitRepoUrl` holding something that is not a URL → `null`, branch name copied.
- Branch containing slashes → slashes preserved in the path.
- Azure DevOps → branch encoded, because it sits in a query parameter.
- Unrecognised host → GitHub pattern rather than refusing to build a URL.
- A ticket with no effective branch → the block already renders no copy control, so
  nothing changes.

## Architecture constraints agreed

- Frontend-only change; the backend remains the single source of truth for data and
  gains no new responsibility here.
- The helper is a pure function in its own module so it can be tested without
  rendering a component.
- Follow the existing repository patterns for module layout and testing.
- Plugin test suite, if touched, must run as `node --test plugin/tests/*.test.mjs`
  on Windows.

## Success / acceptance criteria

1. With a project whose `gitRepoUrl` points at a GitHub repository, opening a
   ticket with a branch and pressing copy puts `<repo>/tree/<branch>` on the
   clipboard.
2. The same flow yields `<repo>/-/tree/<branch>` for GitLab, `<repo>/src/<branch>`
   for Bitbucket, and `<repo>?version=GB<branch>` for Azure DevOps.
3. An unrecognised host yields the GitHub pattern.
4. With `gitRepoUrl` empty, pressing copy puts the branch name on the clipboard and
   the label reads *Copy branch name*.
5. With a URL available, the label and `aria-label` read *Copy branch URL*.
6. A `gitRepoUrl` in SSH form, or carrying a `.git` suffix or trailing slash, still
   produces a correct https branch URL.
7. A branch containing slashes produces a URL with those slashes intact.
8. The non-secure-context fallback still copies successfully.

## Testing expectations

- **Unit tests for the helper**: all four forges, unrecognised host, SSH form,
  `.git` suffix, trailing slash, empty `gitRepoUrl`, non-URL value, branch with
  slashes, and the Azure encoding.
- **Component tests**: copies the URL when a repository is configured; copies the
  branch name when it is not; label and `aria-label` change accordingly.
- Authoritative commands: `npm test` (vitest) per package, plus `tsc` /
  `next build` for typecheck.

## Open questions

None. Every question raised during brainstorming was resolved by explicit user
decision.

## Practical note recorded for the user

In this project `gitRepoUrl` is currently empty, so after this feature ships the
button will keep copying the branch name until the URL is filled in from the
project form. That is the empty state working as designed, not a defect.

## References

No Superpowers design document was created under `docs/superpowers/specs/**`; the
V3.1 bridge routes formalization to Spec Kit, and this handoff is the design
evidence. The previous feature's handoff is archived at
`.specify/bridge/archive/002-ticket-git-branch-view-design.md`.
