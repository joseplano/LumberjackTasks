# Tasks: View repo — a graphical tree of the repository history

**Feature**: `specs/004-view-repo-git-tree` | **Branch**: `004-view-repo-git-tree` | **Date**: 2026-08-21

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [quickstart.md](./quickstart.md),
[contracts/](./contracts/), [checklists/](./checklists/)

## Format: `[ID] [P?] [Story] Description`

- **[P]** — parallelizable: different files, no dependency on an incomplete task.
- **[US#]** — the user story the task serves. Setup, Foundational, Checkpoint and Polish phases
  carry no story label.

**Tests are mandatory here, not optional.** Constitution v1.0.0 Principle II is non-negotiable:
every behaviour change ships with tests, and the approved design requires TDD across all four
modules. Test tasks are written before the implementation tasks they cover, and are expected to
fail first.

## Path Conventions

Four packages at the repository root: `backend/`, `frontend/`, `mcp/`, `plugin/`. All paths below
are repository-relative.

**Type gates differ per package and this is load-bearing** (research R10):

| Package | Type gate | Lint |
|---|---|---|
| `backend/` | `cd backend && npm run build` (`tsc`) | none exists |
| `mcp/` | `cd mcp && npm run build` (`tsc`) | none exists |
| `frontend/` | `cd frontend && npm run build` (`next build`) — **the only one** | **none exists** |

**No task may run `npm run typecheck` or `npm run lint` in `frontend/`.** Neither script exists in
`frontend/package.json`; invoking one fails as a missing script, which reads like a broken gate
rather than an absent one.

---

## Phase 1: Setup

- [X] T001 Read the "Cómo está armado el plugin, y las cuatro trampas" section of `docs/ticket-sync.md` before any file under `plugin/` is touched, and note the four failure modes in the task log. Constitution Principle IV requires this and it must happen before T033.
- [X] T002 [P] Confirm the four suites are green on the untouched branch as a baseline: `cd backend && npm test`, `cd mcp && npm test`, `cd frontend && npm test`, `node --test plugin/tests/*.test.mjs`. Record the result; a pre-existing failure must be known now, not discovered later and blamed on this feature.
- [X] T003 [P] Confirm a disposable PostgreSQL database is reachable for the migration drift check of T009 (the compose stack publishes `127.0.0.1:5434`), and set `SHADOW_DATABASE_URL`. If none is available, record that fact in the task log now — T009 will then be recorded as not run rather than reported as passed (quickstart §1).

---

## Phase 2: Foundational (blocking — no user story can start until this is done)

**Purpose**: the schema, the migration, and the error-handling gap that would otherwise make every
sync failure silent. Everything downstream depends on these.

- [X] T004 Add `GitBranchState` and `GitFileChange` enums to `backend/prisma/schema.prisma` per `data-model.md`.
- [X] T005 Add the `GitBranch`, `GitCommit`, `GitCommitFile` and `GitCommitTicket` models to `backend/prisma/schema.prisma` per `data-model.md`, with every unique constraint and index it names.
- [X] T006 Declare an **explicit** `onDelete` on every new relation in `backend/prisma/schema.prisma` per the table in research R7, and add a comment on `GitCommitTicket.ticket` recording why: the relation is required, Prisma's default for a required relation is `Restrict`, and leaving it implicit would silently break deleting any ticket that has a commit link.
- [X] T007 Add the back-relations `Project.gitBranches`, `Project.gitCommits` and `Ticket.commitLinks` to `backend/prisma/schema.prisma`. These add no columns and no SQL.
- [X] T008 Write `backend/prisma/migrations/20260821_git_history/migration.sql` by hand — two enum types, four tables, their unique constraints, their indexes, and their foreign keys with `ON DELETE CASCADE`. Follow the repository's convention (`YYYYMMDD_snake_name`, hand-written SQL, no `migration_lock.toml`), as in `20260816_ticket_git_branch/`.
- [X] T009 Run the Prisma integrity checks and record their output: `cd backend && npx prisma validate`, then `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code`. Exit code 0 is required. If T003 found no disposable database, record "not run" — never "passed".
- [X] T010 Write a failing regression test in `backend/tests/integration/tickets.test.ts` that creates a ticket, links a commit to it, deletes the ticket, and asserts the delete succeeds and removed only the link. This is the only proof that the `GitCommitTicket → Ticket` cascade is not a `Restrict`; no Prisma command can prove it (research R7, R9).
- [X] T011 Make T010 pass by confirming the explicit `onDelete: Cascade` from T006 and the `ON DELETE CASCADE` in T008 agree, and reconcile them if they do not.
- [X] T012 Write a failing test in `backend/tests/integration/gitHistory.test.ts` asserting that a request body over 100 KB to the sync endpoint returns `413 PAYLOAD_TOO_LARGE`, not `500 INTERNAL`.
- [X] T013 Map the body parser's `entity.too.large` to `413 PAYLOAD_TOO_LARGE` in `backend/src/middleware/errors.ts`, with a message telling the caller to send fewer commits. Do **not** raise `express.json({ limit: '100kb' })` in `backend/src/app.ts` — that limit is a security control and Principle III forbids weakening it (research R2).
- [X] T014 Add the response types for the four endpoints to `backend/src/routes/gitHistory.ts`'s module surface, and run `cd backend && npm run build` to confirm the schema regeneration and new models typecheck.

**Checkpoint**: `cd backend && npm run build && npm test` green, T009 recorded, T010 passing.

---

## Phase 3: User Story 6 — Record history from the working repository (Priority: P1)

**Goal**: the agent can put branch, commit, file and ticket-link data into the system, idempotently
and additively, and a one-time backfill can load the history that already exists.

**Independent test**: run a sync for a project, read the recorded branches, commits, files and
ticket links back, and run it a second time with the same batch — nothing duplicates.

### Tests for User Story 6

- [X] T015 [P] [US6] Test in `backend/tests/integration/gitHistory.test.ts`: a first sync records branches, commits, `parentShas`, files and reported ticket links against the project (spec US6 scenario 1).
- [X] T016 [P] [US6] Test: the identical batch sent twice leaves `branchesUpserted`/`commitsUpserted`/`filesUpserted`/`ticketLinksUpserted` counts unchanged and creates no duplicate rows (FR-026, SC-010, US6 scenario 2).
- [X] T017 [P] [US6] Test: a commit re-reported under a different `branchName` keeps its original `branchId`, and every other field updates (FR-024, D8, US6 scenario 6).
- [X] T018 [P] [US6] Test: a branch recorded earlier and absent from a later batch survives with its previous record and previous `lastSyncedAt` (FR-032, SC-011, US6 scenario 7).
- [X] T019 [P] [US6] Test: 51 commits in one batch → `400 VALIDATION`; 501 files on one commit → `400 VALIDATION`. Neither is trimmed silently (FR-023, contract §4 rules 5–6).
- [X] T020 [P] [US6] Test: a bad `state`, a bad `changeType`, a malformed `sha`, an unparseable `committedAt`, and a `commits[].branchName` naming neither a batch branch nor a recorded one each return `400 VALIDATION` with the offending field named (contract §4 rule 7).
- [X] T021 [P] [US6] Test: a `ticketIds` entry belonging to another project returns `400 VALIDATION` naming the id — not skipped silently (contract §4 rule 8, Principle IV).
- [X] T022 [P] [US6] Test: a batch that would give a project a second `isTrunk: true` branch returns `400 VALIDATION` (contract §4 rule 9).
- [X] T023 [P] [US6] Test: `lastSyncedAt` is set from the server clock and a client-supplied value is ignored (contract §4 rule 4).
- [X] T024 [P] [US6] Test: a batch failing validation records nothing at all — the whole batch is one transaction (contract §4 rule 11, US6 scenario 8).
- [X] T025 [P] [US6] Test: an unknown `projectId` returns `404 NOT_FOUND` (contract §4 rule 12).

### Implementation for User Story 6

- [X] T026 [US6] Implement the sync service in `backend/src/services/gitHistory.ts`: validation, the transaction, and idempotent upserts keyed on `(projectId, name)`, `(projectId, sha)`, `(commitId, path)` and `(commitId, ticketId)`. Never delete; never update `branchId` on an existing sha.
- [X] T027 [US6] Implement `POST /` in `backend/src/routes/gitHistory.ts` delegating to the service, returning the count envelope from contract §4.
- [X] T028 [US6] Mount the router at `/api/v1/projects/:projectId/git-history` in `backend/src/app.ts`, below `app.use('/api/v1', requireAuth)` so it inherits authentication like every other project route.
- [X] T029 [US6] Run `cd backend && npm run build && npm test`; T015–T025 green.

### MCP tool for User Story 6

- [X] T030 [P] [US6] Write failing tests in `mcp/tests/` asserting `sync_git_history` is registered, and that its `zod` schema rejects a bad `state`, a bad `changeType`, a malformed `sha`, more than 50 commits and more than 500 files on one commit.
- [X] T031 [P] [US6] Write a failing test in `mcp/tests/` asserting a backend error surfaces through `run()` as `CODE (HTTP nnn): message` with `isError: true`, never as a success-shaped result (FR-020, Principle IV).
- [X] T032 [US6] Implement `mcp/src/tools/gitHistory.ts` per `contracts/mcp-tool.md` — a thin `zod`-validated pass-through over `apiFetch`, no domain rules the backend does not enforce, no database connection — and register it in `mcp/src/server.ts`. Write the tool description exactly as the contract specifies, including the state-precedence ordering (merged is checked **before** `git status`). Then run `cd mcp && npm run build && npm test`.

### Plugin instructions for User Story 6

- [X] T033 [US6] After T001, add a **Repository history sync** section to `plugin/skills/ticket-sync/SKILL.md` covering: when to sync (after committing, after changing branch — D3); the git commands to run, including `--all` for the D4 backfill; the state precedence with merged checked first; batching at 50 commits; first-parent attribution never moving (D8); and the 500-file cap with the remainder in `truncatedFileCount`. Change no other file under `plugin/` — no new script, no dependency, and no edit to `plugin/.claude-plugin/plugin.json` (Principle IV).
- [X] T034 [US6] Run `node --test plugin/tests/*.test.mjs` — the glob form; the directory form fails with `MODULE_NOT_FOUND` on Windows and is not a substitute.

**Checkpoint**: history can be recorded and re-recorded safely. US6 is independently testable here.

---

## Phase 4: CHECKPOINT — backend proven before any drawing begins

**This gate is decision D1 and is not optional.** No task in Phase 5 or later may start until it
passes.

- [X] T035 Run `cd backend && npm run build && npm test` and `cd mcp && npm run build && npm test`, and confirm T009's Prisma checks and T010's cascade regression are recorded as passing (or, for T009 only, explicitly recorded as not run for lack of a disposable database). Record the evidence in the task log.

---

## Phase 5: User Story 2 — Read a branch's state from its colour (Priority: P1)

**Goal**: one pure function turns a branch's reported state into exactly one of four colours, with
FR-010's ordering enforced and tested.

**Independent test**: call `branchColor` with all six `isTrunk × state` combinations and assert
each result individually.

- [X] T036 [P] [US2] Write failing unit tests in `frontend/src/__tests__/branchColor.test.ts` asserting all six combinations **individually**, not through a table that iterates the same mapping the implementation uses: trunk with each of the three states → `blue` (FR-011, including the defensive trunk-reported-`MERGED` case); non-trunk `MERGED` → `grey` (D5 precedence, which must beat a dirty tree); non-trunk `UNCOMMITTED` → `yellow`; non-trunk `ACTIVE` → `green`.
- [X] T037 [US2] Implement `frontend/src/lib/branchColor.ts` per `contracts/tree-geometry.md` §A — pure, total, `isTrunk` checked before `state`, `pushed` not an input (FR-013). Cite the contract rule beside each branch of the logic, as `frontend/src/lib/branchUrl.ts` does.
- [X] T038 [US2] Run `cd frontend && npm test`; T036 green.

---

## Phase 6: User Story 1 — See the repository history as a tree (Priority: P1) 🎯 MVP

**Goal**: the **View repo** control, the route, and the drawn tree — trunk line, one lane per
branch, one circle per commit, left to right, horizontally scrollable.

**Independent test**: with history recorded, open the board, click **View repo**, and confirm the
trunk line, the lanes, the circles, the ordering and the scrollbar.

### Tests for User Story 1

- [X] T039 [P] [US1] Write failing tests in `backend/tests/integration/gitHistory.test.ts` for `GET /api/v1/projects/:projectId/git-history`: the response carries `lastSyncedAt`, `branches` and `commits`; `commits` is ordered by `committedAt` then `sha`; **no file lists are included**; `fileCount` and `truncatedFileCount` are present per commit; an unknown project is `404` (contract §1).
- [X] T040 [P] [US1] Write failing unit tests in `frontend/src/__tests__/repoTree.test.ts` for `buildRepoTree`: **completeness — every input branch yields exactly one lane and every input commit yields exactly one node, so nothing recorded can go undrawn (SC-002)**; column ordering with a `committedAt` tie broken by `sha`; lane assignment with the trunk **not** first in the input; a fork edge across lanes; a merge edge from a second parent; a merged branch keeping its own lane rather than folding into the trunk (D8/FR-024); a dangling parent sha producing no edge and no throw; a branch with no commits getting a lane with `startX === endX`; empty input returning empty arrays with zero width and height; and identical output across two calls (contract §tree-geometry.md §B).
- [X] T041 [P] [US1] Write a failing component test in `frontend/src/__tests__/boardPage.test.tsx` asserting a **View repo** control appears in the project board header alongside **View backlog** and **Add ticket**, and links to `/projects/[id]/repo` (FR-001, SC-001).
- [X] T042 [P] [US1] Write a failing component test in `frontend/src/__tests__/repoPage.test.tsx` asserting the screen renders one lane per branch and one circle per commit from a fixture, in the colours `branchColor` dictates (FR-005, FR-008, FR-012).

### Implementation for User Story 1

- [X] T043 [US1] Implement `listGitHistory` in `backend/src/services/gitHistory.ts` and `GET /` in `backend/src/routes/gitHistory.ts` per contract §1, deriving `lastSyncedAt` as the maximum across the project's branches and returning `null` with empty arrays when the project has no branches.
- [X] T044 [US1] Implement `frontend/src/lib/repoTree.ts` per `contracts/tree-geometry.md` §B — pure and total, with the explicit tie-breaks, edges derived only from `parentShas`, and `width`/`height` returned so the container can scroll.
- [X] T045 [P] [US1] Add the response types to `frontend/src/lib/types.ts` and the typed fetchers to `frontend/src/lib/api.ts`.
- [X] T046 [US1] Implement `frontend/src/components/RepoTree.tsx` — hand-rolled inline SVG consuming `buildRepoTree`'s output, no new dependency (D10). Give commit circles and branch lanes accessible names so the modals in US3/US4 can be reached from the keyboard as well as the pointer.
- [X] T047 [US1] Implement the route `frontend/src/app/(app)/projects/[id]/repo/page.tsx`, sizing the SVG from `width`/`height` inside a container with `overflow-x: auto` so the scrollbar sits along the bottom of the tree (FR-009).
- [X] T048 [US1] Add the **View repo** control to the header in `frontend/src/app/(app)/projects/[id]/page.tsx`, next to **View backlog** and styled to match it (it is a `Link`, not a button).
- [X] T049 [US1] Run `cd frontend && npm test` then `cd frontend && npm run build`. `next build` is the frontend's only type gate — do not look for `npm run typecheck` or `npm run lint`, which do not exist here.

**Checkpoint**: the MVP. The tree draws, in the right colours, from recorded history.

---

## Phase 7: User Story 3 — Inspect a single commit (Priority: P2)

**Goal**: clicking a commit circle opens a modal with the commit's description, date, files and
tickets, with inferred ticket links labelled as inferred.

**Independent test**: click a circle; the modal shows that commit's four pieces of information.

- [X] T050 [P] [US3] Write failing tests in `backend/tests/integration/gitHistory.test.ts` for `GET …/git-history/commits/:sha`: files ordered by path and capped at 500; `truncatedFileCount` reported; a commit with reported links returns them all as `source: "reported"`; a commit with no reported link returns branch-matched tickets all as `source: "inferred"`; a commit with neither returns `tickets: []`; **no ticket is ever returned without a `source`**; unknown sha → `404` (contract §2, FR-025, D9).
- [X] T051 [US3] Implement the commit-detail service and route per contract §2, deriving inferred links at read time from tickets whose `gitBranch` matches the commit's branch (research R6). Store nothing inferred.
- [X] T052 [P] [US3] Write a failing component test in `frontend/src/__tests__/commitDetailModal.test.tsx`: the modal shows message, date, files and tickets; an inferred ticket is visibly labelled as inferred by branch; a truncated file list states how many more files exist; dismissing returns to the unchanged tree (FR-014, FR-016, FR-017, SC-004, SC-006).
- [X] T053 [US3] Implement `frontend/src/components/CommitDetailModal.tsx` and wire it to the circle click in `RepoTree.tsx`.
- [X] T054 [US3] Run `cd backend && npm test`, `cd frontend && npm test`, `cd frontend && npm run build`.

---

## Phase 8: User Story 4 — Inspect a whole branch (Priority: P2)

**Goal**: clicking a branch lane or label opens a modal with that branch's tickets, files and
description.

**Independent test**: click a lane; the modal shows that branch's three pieces of information.

- [X] T055 [P] [US4] Write failing tests in `backend/tests/integration/gitHistory.test.ts` for `GET …/git-history/branches/:branchId`: the distinct union of files ordered by path with the most recent commit's change type winning; `truncatedFileCount` summed; tickets de-duplicated with `reported` winning over `inferred`; `commitMessages` newest-first and capped at 50 with `commitCount` giving the true total; a branch from another project → `404` (contract §3).
- [X] T056 [US4] Implement the branch-detail service and route per contract §3, keyed on `branchId` rather than name because branch names contain `/` (research R12).
- [X] T057 [P] [US4] Write a failing component test in `frontend/src/__tests__/branchDetailModal.test.tsx`: the modal shows the branch's tickets, files, and a description composed from name, state and commit messages; inferred tickets are labelled exactly as in the commit modal; and when `commitCount` exceeds the number of `commitMessages` returned, the modal states that the messages shown are a subset rather than implying completeness (FR-015, SC-005).
- [X] T058 [US4] Implement `frontend/src/components/BranchDetailModal.tsx` and wire it to the lane and label click in `RepoTree.tsx`.
- [X] T059 [US4] Run `cd backend && npm test`, `cd frontend && npm test`, `cd frontend && npm run build`.

---

## Phase 9: User Story 5 — Freshness, emptiness and honesty (Priority: P2)

**Goal**: the screen never pretends. It shows when it was last synced, explains itself when there
is nothing to draw, and never presents a failure as an empty history.

**Independent test**: open the screen for a synced project, a never-synced project, and with the
backend stopped; confirm three distinguishable outcomes.

- [X] T060 [P] [US5] Write a failing test in `backend/tests/integration/gitHistory.test.ts`: an existing project with no branches returns `200` with `{ lastSyncedAt: null, branches: [], commits: [] }`, **not** `404` (contract §1 rules 2 and 5).
- [X] T061 [US5] Write failing component tests in `frontend/src/__tests__/repoPage.test.tsx` for the three states: loading shows a loading indication and **not** the empty state; a failed fetch shows an error naming the reason and **not** the empty state; the never-synced shape shows the explanatory empty state with sync instructions and no fabricated data (FR-029, FR-033, SC-007, SC-012).
- [X] T062 [US5] Add a failing component test to `frontend/src/__tests__/repoPage.test.tsx` asserting the last-synced timestamp is rendered whenever `lastSyncedAt` is non-null, and is absent when it is `null` (FR-028, SC-008). **Not parallel with T061** — same file.
- [X] T063 [US5] Implement the three states in `frontend/src/app/(app)/projects/[id]/repo/page.tsx`, following the convention the existing screens already use (`if (error) …; if (!data) return <p>Loading…</p>;` as in `projects/[id]/page.tsx`), plus the last-synced header and the never-synced empty state.
- [X] T064 [US5] Run `cd backend && npm test`, `cd frontend && npm test`, `cd frontend && npm run build`.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T072 [P] Write a test in `frontend/src/__tests__/repoPage.test.tsx` asserting the repository view issues **only** `GET` requests — stub the fetch layer, exercise the screen and both modals, and assert no request used any other method. This is the executable form of FR-003 and of constitution Principle I ("the frontend is an HTTP consumer only and never a second write path"); without it that MUST has no failing test behind it.
- [X] T065 [P] Add a **View repo** section to `README.md` describing the screen, the four colours and their precedence, the last-synced mirror semantics, and how to sync and backfill (FR-031, constitution Principle V). State plainly that the screen is single-tenant and read-only, and implies no per-user ownership (FR-030).
- [X] T066 [P] Confirm no new environment variable was introduced, so no `*.env.example` needs changing. If one crept in, add it to the right `.env.example` with a safe default and document it in `README.md` (Principle V).
- [X] T067 Review the diff against constitution Principle III: no token, credential or filesystem path is stored (FR-027); `express.json({ limit: '100kb' })` is unchanged; no auth, CORS, rate-limit, password or JWT behaviour was touched; the new routes sit behind `requireAuth`.
- [X] T068 Re-run the Prisma integrity checks from T009 against the final schema and migration, and record the output.
- [X] T069 Run the full gate set and record the evidence: `cd backend && npm run build && npm test`; `cd mcp && npm run build && npm test`; `cd frontend && npm test`; `cd frontend && npm run build`; `node --test plugin/tests/*.test.mjs`.
- [ ] T070 Walk `quickstart.md` §6 end to end against this repository after a backfill: confirm `main` blue; `001`, `002`, `003` and `chore/ignore-mcp-bot-password` **grey**, because all four are merged into `main` as of 2026-08-21; `004-view-repo-git-tree` **green**; then make an uncommitted edit and re-sync to see **yellow**, and commit and re-sync to see it return to green.
- [ ] T071 Confirm the yellow, empty-state, error-state, double-sync and deleted-branch walkthroughs of `quickstart.md` §6 steps 7–11 behave as specified, and record the result. These are the checks that cannot be proven headlessly.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → no dependencies. T001 must precede T033.
- **Phase 2 (Foundational)** → blocks everything. Nothing in Phases 3–10 may start first.
- **Phase 3 (US6)** → depends on Phase 2. It is the data pipeline; nothing can be drawn without it.
- **Phase 4 (Checkpoint)** → depends on Phase 3. **Hard gate, decision D1**: the backend is proven
  before any SVG work starts.
- **Phase 5 (US2)** → depends on Phase 4. `branchColor` is needed by `buildRepoTree`.
- **Phase 6 (US1)** → depends on Phase 5.
- **Phases 7, 8, 9 (US3, US4, US5)** → each depends on Phase 6; independent of one another and can
  proceed in parallel.
- **Phase 10 (Polish)** → depends on everything.

### User Story Dependencies

| Story | Priority | Depends on | Why |
|---|---|---|---|
| US6 — record history | P1 | Foundational | It is the source of every other story's data. |
| US2 — branch colour | P1 | US6 (via checkpoint) | Pure function; the tree needs it. |
| US1 — see the tree | P1 | US2 | Lanes and nodes are coloured by `branchColor`. |
| US3 — commit modal | P2 | US1 | Opened from a circle the tree draws. |
| US4 — branch modal | P2 | US1 | Opened from a lane the tree draws. |
| US5 — freshness/empty | P2 | US1 | Layers three states onto the screen. |

### Parallel Opportunities

- T002 and T003 in Setup.
- T015–T025 (all backend sync tests, one file but independent cases) and T030–T031 (MCP tests).
- T039–T042 across four different test files.
- Phases 7, 8 and 9 as three independent tracks once Phase 6 lands.
- T065 and T066 in Polish.

---

## Implementation Strategy

### MVP

**Phases 1 → 6**: setup, schema and migration, the sync pipeline, the D1 checkpoint, the colour
function, and the tree screen. That is a working **View repo** — history recorded, the tree drawn,
the colours correct. The modals and the freshness states are the next increment.

Note that US6 is not skippable in favour of "just the screen": nothing in this stack can read a git
repository today, so without the pipeline the screen has nothing to draw. This is precisely why the
split into 004 (data) + 005 (screen) was offered and declined (D1).

### Incremental Delivery

1. Phases 1–2 → schema safe, migration committed, cascade proven.
2. Phase 3 → history can be recorded; backfill possible.
3. Phase 4 → backend proven (D1 gate).
4. Phases 5–6 → MVP: the tree draws.
5. Phases 7–9 → modals and honest states, in any order.
6. Phase 10 → docs, security review, full-suite evidence, manual walkthrough.

---

## Notes

- **Test tasks come first within each phase and are expected to fail** before their implementation
  task. Constitution Principle II makes this non-negotiable, and the approved design asks for TDD
  across all four modules.
- **T010 is the highest-value test in this feature.** It is the only thing that catches Prisma
  defaulting the required `GitCommitTicket → Ticket` relation to `Restrict`, which would silently
  break deleting any ticket that has a commit link. No Prisma command proves this.
- **T009/T068 may legitimately be unrunnable** on a machine with no disposable database. Record
  "not run" in that case. Reporting an unrun check as passed is worse than not having it.
- **T070 and T071 are human/browser verification.** The tree's appearance, the colours and the
  scrollbar are visual, and the yellow state depends on a real dirty working tree. These cannot be
  proven headlessly and are marked as such rather than being faked with a unit test.
- The frontend has **no typecheck and no lint script**. `next build` is the type gate. This is
  repeated here because it is the single easiest thing to get wrong in this repository.

- **Only the checked-out branch can ever be reported dirty.** A working tree belongs to the branch
  that is checked out, so yellow-for-dirty applies to that branch alone; every other branch reaches
  yellow only by having no commit of its own. T033's instructions must not imply otherwise, and no
  task should try to engineer around it (research R4).

**Task counts**: 72 total — Setup 3, Foundational 11, US6 20, Checkpoint 1, US2 3, US1 11, US3 5,
US4 5, US5 5, Polish 8 (T065–T072).

---

## Implementation status (recorded 2026-08-21 by the SDD controller)

**70 of 72 tasks complete.** T070 and T071 are intentionally left unchecked.

**Gate evidence at the close of implementation:**

| Gate | Result |
|---|---|
| `cd backend && npm run build && npm test` | clean; **346 passed** (baseline 282) |
| `cd mcp && npm run build && npm test` | clean; **93 passed** (baseline 80) |
| `cd frontend && npm test` | **240 passed** (baseline 183) |
| `cd frontend && npm run build` | clean, zero warnings, `/projects/[id]/repo` generated |
| `node --test plugin/tests/*.test.mjs` | **21 pass, 0 fail** |
| `npx prisma validate` | valid |
| `prisma migrate diff --exit-code` | **exit 0** — no drift |

**T070/T071 — partially performed, and honestly not claimed.** The *data half* was executed
end to end by the controller against a disposable database, replaying this repository's real
history (74 commits) through the sync endpoint trunk-first with `git log --first-parent`:
**30 of 30 checks passed**, covering SC-002 whole-history coverage (74 sent, 74 drawn, 74 in
`git rev-list --all`), SC-003 colours (`main` blue; `001`, `002`, `003` and
`chore/ignore-mcp-bot-password` grey; `004-view-repo-git-tree` **yellow**, because the working
tree was genuinely dirty — FR-010 rule 3 behaving as specified, where quickstart §6 step 4
tacitly assumes a clean tree), SC-010 double-sync idempotence, SC-011 non-deletion, the
yellow↔green transition, D5 precedence, and both modal endpoints.

The *browser half* was **not** performed and must not be treated as done. Outstanding for a
human, in priority order:

1. That the SVG renders lanes, circles, edges and labels legibly. This is the highest-value
   check: the label gutter is sized from `LABEL_CHAR_WIDTH = 7`, an **estimate**, because
   jsdom cannot measure text.
2. That the horizontal scrollbar sits along the bottom of the tree (FR-009), rather than on
   `<main>` or the document.
3. Whether branch labels, pinned at the left edge of the scrolling canvas, leave the viewport
   on a wide history — leaving lanes unidentifiable once scrolled right.
4. That merged-grey labels remain legible on `bg-surface` across all seven themes, in both
   light and dark polarities.
5. The live error state with the backend stopped (FR-033) — component-tested, not
   browser-tested.

**Artifact defects found during implementation and deliberately NOT repaired here** (repairing
Spec Kit artifacts is not the implementation controller's authority — run `/spec-kit-bootstrap`):

1. `research.md` R9, `quickstart.md` §1, and T009/T068 above prescribe a `prisma migrate diff`
   invocation that does not run on the pinned Prisma 7.8.0: `--to-schema-datamodel` is now
   `--to-schema`, `--shadow-database-url` was removed in favour of
   `datasource.shadowDatabaseUrl`, and `--from-migrations` requires a `migration_lock.toml`
   this repository deliberately lacks. The check *was* executed via an equivalent recipe and
   proven load-bearing; only the written command is stale.
2. `contracts/mcp-tool.md` line 79 still prescribes `git log --all` for the D4 backfill. `--all`
   cannot supply `commits[].branchName`, which contract `http-api.md` §4 rule 7 requires and
   rule 3 makes permanent. The skill now uses trunk-first `--first-parent` per FR-024/D8.
3. `contracts/tree-geometry.md` §A and T036 claim the rule-2-before-rule-3 ordering is testable
   at the `branchColor` layer. It is not: `state` is a single enum, so `MERGED` and
   `UNCOMMITTED` are mutually exclusive and swapping those two branches changes no output. D5's
   precedence is genuinely pinned in the MCP tool-description test instead.
4. No contract specifies **edge** (fork/merge connector) colour; `tree-geometry.md` rule 3
   covers lanes and nodes only.
5. `contracts/http-api.md` §3 is silent on whether the branch-detail file union is capped, while
   §2 caps the commit file list at 500 — so the two endpoints can disagree about one commit
   after an additive re-sync.
