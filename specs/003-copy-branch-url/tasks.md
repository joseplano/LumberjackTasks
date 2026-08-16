# Tasks: Copy the branch URL, not just the branch name

**Feature**: `003-copy-branch-url` | **Branch**: `003-copy-branch-url` (stacked on `002-ticket-git-branch-view`)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/branchUrl.md](./contracts/branchUrl.md)

**Tests**: mandatory. Constitution Principle II (NON-NEGOTIABLE) requires tests with every behaviour change, and spec FR-011/SC-005 require the derivation to be verified without rendering a UI.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency
- **[Story]**: US1 (copy the URL), US2 (never useless or misleading), US3 (URLs as people store them)

---

## Phase 1: Setup — establish the baseline

**Purpose**: know the starting state before anything changes, so any later failure is attributable.

- [ ] T001 Run the baseline gate and record it green: `cd frontend && npm test` and `cd frontend && npx tsc --noEmit`. If either is already failing, stop and report — this feature must not be built on a red baseline.
- [ ] T002 [P] Confirm the two inputs are already available with no plumbing: `gitRepoUrl: string` on `Project` (inherited by `ProjectDetail`) in `frontend/src/lib/types.ts`; the `project: ProjectDetail` prop on `TicketDetailModal` in `frontend/src/components/TicketDetailModal.tsx`; and that prop being passed at both call sites, `frontend/src/app/(app)/projects/[id]/page.tsx` and `frontend/src/app/(app)/projects/[id]/backlog/page.tsx` (research.md §R1). If any of this is not true, stop — the frontend-only scope no longer holds.
- [ ] T003 [P] Confirm the existing modal test fixture in `frontend/src/__tests__/ticketDetail.test.tsx` stores an empty `gitRepoUrl`, which makes the existing copy tests the regression guard for FR-004/SC-003. Those tests must survive this feature unmodified.

---

## Phase 2: Tests first (TDD — these must fail before Phase 3)

**Purpose**: encode the contract as executable expectations before any production code exists.

- [ ] T004 [US1][US2][US3] Create `frontend/src/__tests__/branchUrl.test.ts` importing `buildBranchUrl` from `@/lib/branchUrl`, and cover normalisation and rejection from [contracts/branchUrl.md](./contracts/branchUrl.md) §Stage 1: surrounding whitespace, SSH form `git@github.com:owner/repo.git`, `.git` suffix, trailing slash, the combined `…/repo.git/`, empty string, whitespace-only string, `not a url`, `ftp://host/owner/repo`, and the explicit `ssh://git@github.com/owner/repo.git` form which is deliberately *not* converted (FR-003, FR-003a-c, FR-004). Rejection cases must assert `null`. Run the file and confirm it fails because the module does not exist yet.
- [ ] T005 [US1] Extend `frontend/src/__tests__/branchUrl.test.ts` with the forge shapes and host matching from [contracts/branchUrl.md](./contracts/branchUrl.md) §Stage 2: `github.com` → `/tree/`, `gitlab.com` → `/-/tree/`, `bitbucket.org` → `/src/`, `dev.azure.com` and `org.visualstudio.com` → `?version=GB…`, plus an unrecognised host (`git.internal.example`), a self-hosted look-alike (`gitlab.example.com` → GitHub shape) and a domain-boundary trap (`github.com.evil.example` must NOT be treated as GitHub) (FR-003d, FR-005, research.md §R4).
- [ ] T006 [US1] Extend `frontend/src/__tests__/branchUrl.test.ts` with encoding and boundary vectors: `feature/x` keeps literal slashes on the three path forges and on the fallback; `feature/x` becomes `feature%2Fx` in the Azure DevOps query; a repository address that already carries `?path=/x` gets `&version=GB…` appended; and an empty or whitespace-only `branch` returns `null` (FR-005a, contracts §Return value).
- [ ] T007 [US1][US2] Extend `frontend/src/__tests__/ticketDetail.test.tsx` (new cases only — leave the existing ones untouched) with a project fixture whose `gitRepoUrl` is `https://github.com/owner/repo`: pressing the copy control writes `https://github.com/owner/repo/tree/<branch>` to the clipboard and shows `Copiado`; the control's accessible name and its `title` both read `Copy branch URL`. Add the mirror case with `gitRepoUrl: ''`: the clipboard receives the exact branch text and both read `Copy branch name` (FR-001, FR-004, FR-006, SC-004). Query the control by accessible name so a stale label fails the test.
- [ ] T008 [US1] Extend `frontend/src/__tests__/ticketDetail.test.tsx` with the non-secure-context case for the URL payload: with `navigator.clipboard` undefined and a configured `gitRepoUrl`, the hidden-textarea fallback receives the branch URL — the same value the primary path would have copied — and the confirmation still appears (FR-007, SC-007).

**Checkpoint**: all of T004-T008 fail for the right reason (missing module / unchanged component), and no previously passing test has been altered.

---

## Phase 3: Implementation

- [ ] T009 [US1][US2][US3] Create `frontend/src/lib/branchUrl.ts` exporting the pure function `buildBranchUrl(gitRepoUrl: string, branch: string): string | null`, implementing [contracts/branchUrl.md](./contracts/branchUrl.md) exactly: normalise (trim → SSH-to-https → strip trailing `.git` → strip trailing `/` → require `http`/`https`), then shape by host with domain-boundary matching and the GitHub fallback, keeping branch slashes literal in path segments and `encodeURIComponent`-encoding the Azure DevOps query value (appending with `&` when a query already exists). No I/O, no module state, no new dependency, no `any`. Run T004-T006 until green.
- [ ] T010 [US1][US2] Modify the branch block in `frontend/src/components/TicketDetailModal.tsx` (the `copyBranch` handler around line 106 and the copy button around line 194): derive `const branchUrl = buildBranchUrl(project.gitRepoUrl, detail.effectiveBranch)` once from the same evaluation that feeds both consumers; pass `branchUrl ?? detail.effectiveBranch` to `copyBranch`; set both `aria-label` and `title` to `branchUrl ? 'Copy branch URL' : 'Copy branch name'`; keep the visible button text `Copy`. Leave `copyBranch`'s clipboard/fallback/confirmation structure untouched and update its doc comment so it no longer claims the branch text is what is copied. Nothing else in the block — icon, monospaced branch text, inheritance marker, `Sin rama aún`, `Copiado` — may change (FR-001, FR-004, FR-006, FR-007, FR-009). Run T007-T008 until green.

**Checkpoint**: the whole frontend suite is green, including every pre-existing test, unmodified.

---

## Phase 4: Documentation

- [ ] T011 Update the branch-block sentence in `README.md` (the bullet describing the ticket detail's branch block "with a copy button", around line 152) to state that the control copies the branch URL when the project has a repository URL configured and the branch name otherwise (FR-010, Constitution §V). Do not touch `docs/ticket-sync.md` — no plugin internal changes.

---

## Phase 5: Verification

- [ ] T012 Run the feature gate: `cd frontend && npm test` and `cd frontend && npx tsc --noEmit`. Both must pass with no test skipped and no pre-existing test modified.
- [ ] T013 Run the regression suites in the constitution's exact form: `cd backend && npm test`, `cd mcp && npm test`, and `node --test plugin/tests/*.test.mjs` (glob form — the directory form fails on Windows). All must pass.
- [ ] T014 Walk [quickstart.md](./quickstart.md) manually against a running stack: the empty state, the GitHub path, the three stored-URL forms, the other forges, a branch with slashes, and a non-URL value. Confirm the "What must not have changed" list still holds.
- [ ] T015 Re-read [checklists/readiness.md](./checklists/readiness.md) and [checklists/technology.md](./checklists/technology.md) against the delivered code and confirm every item still holds — in particular CHK015/SC-006 (no report, count, total or duration anywhere moved) and CHK023 (the pre-existing copy tests still pass unmodified).

---

## Dependencies

```text
T001 ─┬─> T004 ─> T005 ─> T006 ─┐
T002 ─┤                         ├─> T009 ─> T010 ─> T011 ─> T012 ─> T013 ─> T014 ─> T015
T003 ─┴─> T007 ─> T008 ─────────┘
```

- T002 and T003 are `[P]` with each other; T004-T006 share one file and are sequential; T007-T008 share one file and are sequential; the two test files are independent of each other.
- T009 must not start before T004-T006 exist and fail. T010 must not start before T007-T008 exist and fail.
- T012-T013 are the completion gate; no task may be reported done on their strength before they have actually been run (verification before completion).

## Traceability

| Requirement | Tasks |
|---|---|
| FR-001 | T007, T010 |
| FR-002 | T002, T009 |
| FR-003, FR-003a-c | T004, T009 |
| FR-003d | T005, T009 |
| FR-004 | T003, T004, T007, T010 |
| FR-005 | T005, T009 |
| FR-005a | T006, T009 |
| FR-006 | T007, T010 |
| FR-007 | T008, T010 |
| FR-008 | T013, T015 |
| FR-009 | T010, T014 |
| FR-010 | T011 |
| FR-011 | T004-T006, T009 |
| SC-001, SC-002 | T005, T007, T014 |
| SC-003 | T003, T007 |
| SC-004 | T007 |
| SC-005 | T004-T006, T012 |
| SC-006 | T013, T015 |
| SC-007 | T008 |
