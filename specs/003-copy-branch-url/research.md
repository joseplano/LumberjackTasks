# Phase 0 Research: Copy the branch URL, not just the branch name

**Feature**: `003-copy-branch-url` | **Date**: 2026-08-16

Every decision below was either taken by the human partner in `.specify/bridge/approved-design.md` or is a direct reading of existing repository code. Nothing here re-opens an approved decision.

## R1 — Where the two inputs come from

**Finding**: both values are already in the component.

- `frontend/src/lib/types.ts` — `interface Project` declares `gitRepoUrl: string`, and `interface ProjectDetail extends Project`.
- `frontend/src/components/TicketDetailModal.tsx` — the component signature already takes `project: ProjectDetail`, and both call sites (`frontend/src/app/(app)/projects/[id]/page.tsx` and `.../backlog/page.tsx`) already pass it.
- `detail.effectiveBranch` is already loaded and already gates the branch block.

**Decision**: no prop, no request, no state. **Rationale**: the approved design's frontend-only scope holds without any plumbing. **Alternatives rejected**: fetching the project inside the modal (a second source for data the parent already has, violating Principle I's single-source discipline).

## R2 — Branch URL shape per forge

**Finding / decision** (approved design, table reproduced here as the implementation reference):

| Forge | Shape | Note |
|---|---|---|
| GitHub | `<repo>/tree/<branch>` | also the fallback for unrecognised hosts |
| GitLab | `<repo>/-/tree/<branch>` | the `/-/` separator is what disambiguates a branch from a repository sub-path |
| Bitbucket | `<repo>/src/<branch>` | |
| Azure DevOps | `<repo>?version=GB<branch>` | `GB` is the branch selector prefix; the value is a query parameter, not a path |

**Rationale**: these are the addresses each forge answers to for "show me this branch". **Alternatives rejected**: GitHub-only support (rejected by the human partner in favour of full coverage); refusing to build a URL for unknown hosts (rejected — see R5).

## R3 — Normalising the stored repository URL

**Finding**: the project form stores whatever the person pastes; nothing normalises it on the way in.

**Decision**: normalise at read time, in this fixed order — trim whitespace, convert `git@host:path` to `https://host/path`, strip a trailing `.git`, strip a trailing `/`, then require an `http`/`https` scheme.

**Rationale**: order matters. `.git` must be stripped after the SSH conversion, because the SSH form is the one that most often carries it; the trailing slash must be stripped after `.git`, so that `https://host/owner/repo.git/` reduces correctly. Scheme validation comes last so it judges the normalised value, not the raw one.

**Alternatives rejected**: normalising on save (a backend/product change outside the approved frontend-only scope, and it would not repair values already stored); accepting any scheme (an `ftp://` or `file://` "branch URL" is not something a browser can open, so it is worse than the branch name).

## R4 — Recognising the host

**Decision**: match the normalised URL's hostname, case-insensitively, against each forge's domain and its subdomains — `github.com`, `gitlab.com`, `bitbucket.org`, `dev.azure.com`, and the legacy Azure domain `visualstudio.com`. Matching is on domain boundaries (equal to, or ending with `.` + the domain), never a bare substring.

**Rationale**: substring matching would misclassify a host such as `github.com.evil.example` or `mygithub.company.net`. Domain-boundary matching is the standard, cheap correct form. The legacy Azure domain is included because repositories stored years ago still carry it and its `?version=GB` shape is identical.

**Alternatives rejected**: a configurable host→forge mapping (no evidence anyone needs it; the approved design settled on a fallback instead of configuration); parsing the path to guess the forge (unreliable and unnecessary).

## R5 — Unrecognised hosts

**Decision**: produce the GitHub shape.

**Rationale**: explicitly approved. A self-hosted GitLab or Gitea instance is far more likely than a forge with an incompatible scheme, and even a wrong path leaves the person holding the repository host, which is strictly more useful than a bare branch name. The control's accessible name still says "Copy branch URL", which is true.

**Alternatives rejected**: returning `null` for unknown hosts (would silently degrade every self-hosted installation to the old behaviour); guessing from the path shape (unreliable).

## R6 — Encoding the branch

**Decision**: literal slashes in path segments (GitHub, GitLab, Bitbucket, fallback); `encodeURIComponent` for the Azure DevOps query parameter.

**Rationale**: forges address `feature/x` as a literal path segment sequence — percent-encoding the slash breaks the URL. A query parameter is the opposite: `feature/x` in a query value must be encoded to survive parsing.

**Alternatives rejected**: `encodeURIComponent` everywhere (breaks the three path forges); no encoding anywhere (breaks Azure DevOps branches containing `/`, `&` or `#`).

## R7 — Where the derivation lives

**Decision**: a new module `frontend/src/lib/branchUrl.ts` exporting one pure function.

**Rationale**: matches the existing convention — `frontend/src/lib/moveTicketLocally.ts` is exactly this pattern (one pure function, one module, one unit-test file in `frontend/src/__tests__/`). It satisfies FR-011: every forge shape and every malformed input can be verified without rendering a component, which is where the real combinatorial risk of this feature lives.

**Alternatives rejected**: an inline helper inside `TicketDetailModal.tsx` (all sixteen-plus input classes would then need a rendered modal to test); a hook (there is no state or effect to own).

## R8 — Keeping the copy mechanism untouched

**Finding**: `copyBranch` in `TicketDetailModal.tsx` already implements the primary `navigator.clipboard.writeText` path, the hidden-textarea `document.execCommand('copy')` fallback for non-secure contexts (feature 002's FR-021), and `confirmCopied()` on success only.

**Decision**: change only the string handed to it, plus its doc comment. The payload is chosen at the call site.

**Rationale**: the fallback exists for a real deployment shape (a plain-HTTP LAN reverse proxy) and is already tested. Deciding the payload before the mechanism means both paths copy the same value by construction, which is what SC-007 asserts.

**Alternatives rejected**: building the URL inside `copyBranch` (would couple payload choice to the copy mechanism and make the control's accessible name derive it a second time, risking the two disagreeing — precisely what SC-004 forbids).

## R9 — What the control calls itself

**Finding**: the button renders the visible text `Copy` with `aria-label` and `title` both set to `Copy branch name`.

**Decision**: swap both `aria-label` and `title` to `Copy branch URL` when a URL will be copied; leave the visible text as `Copy`.

**Rationale**: the approved design names exactly the two strings that already occupy the accessible-name slot, and it rejects crowding the branch row, which already holds an icon, the branch text and an inheritance marker. Keeping accessible name and tooltip in lockstep is what makes SC-004 checkable.

**Alternatives rejected**: changing the visible label to `Copy branch URL` (lengthens a row the design deliberately keeps tight, and would push the branch text); a second button (explicitly rejected in the approved design).

## R10 — Test and typecheck commands

**Finding**: `frontend/package.json` exposes `test` (`vitest run`) and `build` (`next build`); there is no `typecheck` script, and `frontend/tsconfig.json` already sets `"noEmit": true`.

**Decision**: gate on `cd frontend && npm test` plus `cd frontend && npx tsc --noEmit`, and run the other three package suites as regressions, with the plugin suite in the constitution's mandatory glob form `node --test plugin/tests/*.test.mjs`.

**Rationale**: constitution Principle II lists the four suites verbatim and warns that the directory form of the plugin command fails on Windows. `tsc --noEmit` is the repository-authoritative type gate for a change that adds no build-time behaviour.

**Alternatives rejected**: adding a `typecheck` script (a package-manifest change unrelated to the feature); requiring `next build` (slower, and it proves nothing extra here).
