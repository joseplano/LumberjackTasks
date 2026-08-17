# Tasks: Git branch visible on ticket

**Feature**: 002-ticket-git-branch-view
**Branch**: `002-ticket-git-branch-view`
**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [data-model.md](./data-model.md), [research.md](./research.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests are mandatory here.** Constitution Principle II is NON-NEGOTIABLE: every behavior change
ships with tests that cover it. Test tasks are therefore not optional and are ordered before the
implementation they cover.

**Path conventions**: repository root is the four-package layout (`backend/`, `frontend/`,
`mcp/`, `plugin/`). All paths below are repository-relative.

---

## Phase 1: Setup

- [X] T001 Confirm the working tree is on branch `002-ticket-git-branch-view` and that a PostgreSQL 16 instance is reachable for `backend/` (via `docker compose up -d` or a local server configured in `backend/.env`)
- [X] T002 [P] Confirm dependencies are installed in `backend/`, `frontend/`, and `mcp/`, and record the baseline: run `cd backend && npm test`, `cd mcp && npm test`, `cd frontend && npm test`, and `node --test plugin/tests/*.test.mjs`, all green before any change

---

## Phase 2: Foundational (BLOCKING — all user stories depend on this)

This phase delivers the whole backend semantic in one increment. It is deliberately not split
per story: the read contract in `contracts/rest-api.md` is atomic — shipping `gitBranch` without
`effectiveBranch`/`branchSource` would publish a half-contract that the board could not consume.

### Schema and migration

- [X] T003 Add the `gitBranch String?` field to `model Ticket` in `backend/prisma/schema.prisma`, with the explanatory comment specified in `data-model.md` (mirror semantics, `null` = not reported, deliberately not unique). Change nothing else in the file.
- [X] T004 Create `backend/prisma/migrations/20260816_ticket_git_branch/migration.sql` containing exactly one statement: `ALTER TABLE "tickets" ADD COLUMN "gitBranch" TEXT;`
- [X] T005 Run `cd backend && npx prisma validate` and confirm it succeeds
- [X] T006 Run `cd backend && npx prisma migrate deploy` then `npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code` and confirm it reports **no difference** (exit code 0), proving the migrations reproduce the schema (schema-to-migration consistency, per `research.md` R3). Flags verified against the installed Prisma 7.8.0 CLI: `--to-schema-datamodel` and `migrate diff --shadow-database-url` do not exist in Prisma 7, and `--from-migrations` cannot be used here because this repository's hand-authored `backend/prisma/migrations/` carries no `migration_lock.toml` (the CLI aborts with `Could not determine the connector from the migrations directory`)
- [X] T007 Inspect the new `migration.sql` and confirm it contains **no** `CONSTRAINT`, `REFERENCES`, `CREATE INDEX`, `DROP INDEX`, or `UPDATE` statement — any such statement means a referential action or index was rewritten and the migration must be rejected (`data-model.md` §Referential actions)
- [X] T008 Apply the migration to a test database and confirm the partial unique index `kanban_columns_projectId_completion_key` from feature 001 still exists (query `pg_indexes`). `prisma migrate diff` is blind to it by design, so it is asserted separately (`checklists/technology.md` CHK064)
- [X] T009 Confirm the explicit referential actions on `Ticket` — `project: Cascade`, `column: Restrict`, `label: SetNull`, `phase: SetNull`, `parent: Cascade` — are unchanged in both `schema.prisma` and the applied database schema

### Pure domain rules (database-free, TDD)

- [X] T010 [P] Add failing unit tests in `backend/tests/unit/ticketRules.test.ts` for branch normalization and validation: trimming; empty/whitespace-only clearing to `null`; and one rejection case per rule in FR-009 (whitespace, `~`, `^`, `:`, `?`, `*`, `[`, `\`, `..`, `@{`, control character, leading `/`, trailing `/`, `.lock` suffix, length > 255); plus acceptance of ordinary names such as `main`, `feature/x-y`, and `002-ticket-git-branch-view`
- [X] T011 [P] Add failing unit tests in `backend/tests/unit/ticketRules.test.ts` for the branch derivation covering all six rows of the truth table in `data-model.md`, plus the two invariants: `branchSource === null` iff `effectiveBranch === null`, and `branchSource === 'own'` iff `gitBranch !== null`
- [X] T012 Implement branch normalization and validation in `backend/src/services/ticketRules.ts`, throwing `ApiError(400, 'VALIDATION', …)`, applying the order trim → empty-clears → validate (order is load-bearing: validating before trimming would reject `" main "`)
- [X] T013 Implement the pure derivation helper in `backend/src/services/ticketRules.ts` returning `{ effectiveBranch, branchSource }` from a ticket's own value and its parent's value
- [X] T014 Run `cd backend && npm test` and confirm T010–T011 now pass

### Service, endpoints and read shape

- [X] T015 Add failing integration tests in `backend/tests/integration/tickets.test.ts` for the write path: create with `branch`; update with `branch`; omitting `branch` leaves the stored value unchanged; `""` and `null` clear it; a malformed value returns `400 VALIDATION` **and leaves the previously stored value intact**
- [X] T015a Cover the non-string `branch` case (FR-010): the REST body is untyped JSON, so a caller can send a number, boolean, object, or array. Add unit tests in `backend/tests/unit/ticketRules.test.ts` asserting `400 VALIDATION` and **no** `TypeError` for each, and an integration test in `backend/tests/integration/tickets.test.ts` asserting `400 VALIDATION` over HTTP with the previously stored value intact. Guard it in `normalizeBranch` with an explicit `typeof branch !== 'string'` check placed **after** the absent/null short-circuits and **before** `.trim()`, so a non-string is a validation failure rather than a `TypeError` surfacing as a `500` (`data-model.md` §Write-path rules step 2, `contracts/rest-api.md` §Validation errors)
- [X] T016 Add failing integration tests in `backend/tests/integration/tickets.test.ts` asserting that `GET /api/v1/tickets/:id` and `GET /api/v1/projects/:projectId/tickets` both return `gitBranch`, `effectiveBranch`, and `branchSource` on every ticket object, **including every element of the detail response's `subtickets` array**
- [X] T016a Add a failing integration test in `backend/tests/integration/tickets.test.ts` asserting that neither read response contains a `parent` key — the parent relation is loaded to compute the derived pair and must be dropped, not serialized (`contracts/rest-api.md`)
- [X] T017 Add `branch?: string | null` to `TicketInput` and thread it through `createTicket` and `updateTicket` in `backend/src/services/tickets.ts`, honouring absent-versus-null and calling the validation from T012
- [X] T018 Add the narrow parent selection `include: { parent: { select: { gitBranch: true, number: true } } }` to `listTickets` and `getTicketDetail` in `backend/src/services/tickets.ts`, and map the derived pair from T013 onto every returned ticket object. Build each response object **explicitly** rather than spreading the Prisma result, so the loaded `parent` relation is consumed and dropped rather than leaking into the payload.
- [X] T018a In `getTicketDetail`, apply the same derivation to every element of the `subtickets` array, using the enclosing ticket's `gitBranch` as their parent value (no extra query). Required because `frontend/src/lib/types.ts` declares the three fields as non-optional on `Ticket`, and `TicketDetail.subtickets` is typed `Ticket[]`.
- [X] T019 Confirm the list endpoint still issues a constant number of queries regardless of ticket count (one batched relation load, not one per row — `research.md` R2)
- [X] T020 Run `cd backend && npm test` and confirm T015–T016 pass and every pre-existing backend test still passes **unedited**

### Shared frontend types

- [X] T021 Add `gitBranch: string | null`, `effectiveBranch: string | null`, and `branchSource: 'own' | 'inherited' | null` to `interface Ticket` in `frontend/src/lib/types.ts`. Do **not** modify `BacklogItem`.
- [X] T022 Run `cd backend && npm run build` and confirm `tsc` succeeds

**Checkpoint**: the mirror engine exists and is proven. All user stories can now proceed.

---

## Phase 3: User Story 1 — See the branch the agent is working on (P1) 🎯 MVP

**Goal**: A person opening a ticket sees the reported branch prominently and can copy it; a
ticket with no branch shows `Sin rama aún`.

**Independent test**: Report a branch on a ticket through the agent-facing tool, open that
ticket, confirm the highlighted block and a working copy button; open a ticket with no branch and
confirm the empty state.

- [X] T023 [P] [US1] Add failing tests in `frontend/src/__tests__/ticketDetail.test.tsx` for the own-branch state: the block renders after the title and before the description, shows the branch in a monospaced element, and shows a copy control
- [X] T024 [P] [US1] Add failing tests in `frontend/src/__tests__/ticketDetail.test.tsx` for the empty state: `Sin rama aún` is rendered in muted styling, no copy control is offered, and no branch-like string appears anywhere in the rendered output
- [X] T025 [P] [US1] Add failing tests in `frontend/src/__tests__/ticketDetail.test.tsx` for copying: the exact `effectiveBranch` text (no marker, no decoration) reaches the clipboard via `navigator.clipboard.writeText`; a `Copiado` confirmation appears; and with `navigator.clipboard` undefined the textarea + `document.execCommand('copy')` fallback is used and still confirms
- [X] T026 [US1] Implement the highlighted branch block in `frontend/src/components/TicketDetailModal.tsx`: placed after the title heading and the existing parent link, before the description; branch icon, value in a monospaced typeface, copy control; muted `Sin rama aún` when `effectiveBranch` is null
- [X] T027 [US1] Implement the copy handler in `frontend/src/components/TicketDetailModal.tsx` with the `navigator.clipboard` primary path and the hidden-textarea `execCommand` fallback, plus the transient `Copiado` confirmation
- [X] T028 [US1] Give the copy control and the branch icon a text alternative so the block is operable without interpreting the icon (FR-022a)
- [X] T029 [US1] Confirm `frontend/src/components/TicketFormModal.tsx` is **not** modified and appears in no diff for this feature (FR-006, SC-010)
- [X] T030 [US1] Run `cd frontend && npm test` and confirm T023–T025 pass with no pre-existing test edited

**Checkpoint**: US1 is independently demonstrable and is a shippable MVP on its own.

---

## Phase 4: User Story 4 — The agent keeps the mirror truthful (P1)

**Goal**: The agent reports the repository's real branch, so the view has something true to show.

**Independent test**: Follow the agent's `ticket-sync` workflow on a repository checked out on a
known branch and confirm the ticket ends up displaying that branch.

- [X] T031 [US4] Read the "Cómo está armado el plugin, y las cuatro trampas" section of `docs/ticket-sync.md` before touching anything under `plugin/` (constitution Principle IV, mandatory)
- [X] T032 [P] [US4] Add failing tests in `mcp/tests/tickets.test.ts`: `branch` is forwarded in the request body by `create_ticket`, `update_ticket`, `create_subticket`, and `update_subticket`; omitting `branch` sends **no** `branch` key at all (absent must not become `null`); a ticket read relays `gitBranch`, `effectiveBranch`, and `branchSource` unmodified; a backend `400 VALIDATION` surfaces as a tool error rather than a silent success
- [X] T033 [US4] Add the `branch` field to the shared `ticketFields` object in `mcp/src/tools/tickets.ts` as `z.string().nullable().optional()` with the description from `contracts/mcp-tools.md`. Do not add it to `moveFields`, do not add validation, and do not compute inheritance.
- [X] T034 [US4] Run `cd mcp && npm test && npm run build` and confirm T032 passes with no pre-existing test edited
- [X] T035 [US4] Extend step 5 of `plugin/skills/ticket-sync/SKILL.md`: read the current branch with `git rev-parse --abbrev-ref HEAD` and pass it as `branch` on the update accompanying the move into "In development"; re-report when the branch changes during the work; report nothing when the command outputs the literal `HEAD` (detached); never invent, derive, or tidy a name
- [X] T036 [US4] Add a row to the "Common mistakes" table in `plugin/skills/ticket-sync/SKILL.md` covering inventing a branch name instead of reading it from the repository
- [X] T036a [US4] Add coverage for the `SKILL.md` behavior change to `plugin/tests/plugin-config.test.mjs` — a test asserting that the skill names `git rev-parse --abbrev-ref HEAD` as the branch source, reports the value through `update_ticket`/`update_subticket` rather than `move_ticket`, covers the detached-`HEAD` case, reports nothing in that case, and forbids inventing/deriving/slugifying a name (FR-023, FR-024, FR-025). Constitution Principle II requires the change itself to be covered: re-running a suite that never reads `SKILL.md` proves only that nothing broke. Mutation-check the test against the pre-feature `SKILL.md` and confirm it fails there.
- [X] T037 [US4] Confirm `plugin/.claude-plugin/plugin.json` is **not** modified (adding a `skills` or `hooks` key there silently disables the plugin's MCP server) and that `plugin/` gained no dependency and no `node_modules`
- [X] T038 [US4] Run `node --test plugin/tests/*.test.mjs` — the glob form; the directory form fails with `MODULE_NOT_FOUND` on Windows and is not a substitute

**Checkpoint**: the mirror is now self-maintaining. Combined with US1 this is a complete feature.

---

## Phase 5: User Story 2 — A subticket shows the branch of the work it belongs to (P2)

**Goal**: A subticket displays the parent's branch, marked as inherited, unless it has its own.

**Independent test**: Report a branch on a parent only, open a subticket, confirm the parent's
branch with the inherited marker and the parent's number.

- [X] T039 [P] [US2] Add failing integration tests in `backend/tests/integration/tickets.test.ts` covering the full inheritance matrix over HTTP: parent with branch → subticket without one returns the parent's value with `branchSource: 'inherited'`; subticket with its own value returns it with `branchSource: 'own'`; parent without a branch → subticket returns all three fields null; a parent ticket never returns `'inherited'`
- [X] T040 [P] [US2] Add failing tests in `frontend/src/__tests__/ticketDetail.test.tsx` for the inherited marker: `(heredada de #<n>)` in muted styling when the parent number is known, and degradation to `(heredada)` when it is not — asserting explicitly that `#null`, `#undefined`, and a blank number never render, and that the branch value itself is still shown
- [X] T041 [US2] Implement the inherited marker in `frontend/src/components/TicketDetailModal.tsx`, sourcing the parent number from the modal's existing `parentNumber` state and degrading as specified when it is null
- [X] T042 [US2] Run `cd backend && npm test` and `cd frontend && npm test`, confirming T039–T040 pass

**Checkpoint**: inheritance is visible and correct on the detail surface.

---

## Phase 6: User Story 3 — Spot the branch from the board (P3)

**Goal**: A board card carries a compact chip when the ticket has an effective branch.

**Independent test**: Place a ticket with a branch and one without on the board and confirm only
the first shows a chip.

- [X] T043 [P] [US3] Add failing tests in `frontend/src/__tests__/ticketCard.test.tsx`: the chip renders when `effectiveBranch` is non-null; nothing renders when it is null (no placeholder, no dash, no empty chip); a long value is truncated and the full value is present in the `title` attribute; no inheritance marker appears on the card
- [X] T044 [US3] Implement the branch chip in `frontend/src/components/kanban/TicketCard.tsx`, rendered conditionally on `ticket.effectiveBranch`, truncated with an ellipsis, full value in `title`
- [X] T045 [US3] Confirm `frontend/src/components/kanban/Board.tsx` needs no change — it already passes the whole `Ticket` object to `TicketCard`
- [X] T046 [US3] Run `cd frontend && npm test` and confirm T043 passes

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T047 [P] Add a note to `README.md` describing the user-visible behavior: a ticket shows the branch the agent reported, it is read-only in the UI, subtickets inherit the parent's, and `Sin rama aún` means the agent has not reported one (constitution: user-visible behavior is reflected in `README.md`)
- [X] T048 Run the complete suite: `cd backend && npm test`, `cd mcp && npm test`, `cd frontend && npm test`, `node --test plugin/tests/*.test.mjs` — all green
- [X] T049 Run all three builds: `cd backend && npm run build`, `cd mcp && npm run build`, `cd frontend && npm run build`
- [X] T050 Confirm **no pre-existing test assertion was weakened or changed** to accommodate this feature. Distinguish two cases: (a) extending an existing test **fixture** with the three new fields is expected and additive — `Ticket` gains required properties, so object literals may legitimately need them; (b) changing what an existing test **asserts** is a red flag meaning something non-additive happened, and must be investigated rather than accommodated (SC-009, plan.md §Testing Strategy)
- [X] T051 Confirm reports and metrics are unchanged: create a project, record its reports and metrics figures, report branches on several tickets, and confirm every figure is identical afterwards (SC-009a, `contracts/rest-api.md` §Side effects)
- [X] T052 Review `git diff --stat` and confirm the changed **source** file set matches `plan.md` §Project Structure exactly — including the three FIXTURE ONLY frontend test files, whose diffs must consist solely of adding the three new required `Ticket` properties to existing object literals — with no entry for the components `frontend/src/components/TicketFormModal.tsx`, `plugin/.claude-plugin/plugin.json`, `backend/src/services/backlog.ts`, `reports.ts`, `metrics.ts`, `moves.ts`, or `sweep.ts`. SDD artifacts (`specs/002-ticket-git-branch-view/**`, `.specify/feature.json`, `.specify/bridge/**`) are expected in the diff and are outside this comparison (`plan.md` §Project Structure). In the same review, assert the three anti-requirements against the diff: no branch-name generator, slug builder, or convention validator anywhere (FR-025); no filesystem or child-process API introduced in `backend/` or `mcp/` to discover a branch (FR-026); and no per-project branch prefix or related configuration key (FR-027, reinforced by T054)
- [X] T053 Walk through `quickstart.md` §5 manually against a running stack and confirm every expected outcome, including §5.6 (no UI path to set the value) and §5.8 (nothing else moved)
- [X] T054 Confirm no new environment variable was introduced, so no `*.env.example` or configuration documentation change is owed

---

## Dependencies

**Phase order**:

```
Phase 1 (Setup)
   ↓
Phase 2 (Foundational) ← BLOCKS everything below
   ↓
   ├─→ Phase 3 (US1, P1)  ─┐
   ├─→ Phase 4 (US4, P1)  ─┤
   ├─→ Phase 5 (US2, P2)  ─┼─→ Phase 7 (Polish)
   └─→ Phase 6 (US3, P3)  ─┘
```

**Within Phase 2** (strictly ordered where noted):

- T003 → T004 → T005, T006, T007, T008, T009 (migration must exist before it can be verified)
- T010, T011 (failing tests) → T012, T013 (implementations) → T014
- T015, T015a, T016, T016a (failing tests) → T017, T018, T018a (implementations) → T019, T020
- T021 depends on T018 (the shape the types describe must exist)

**Across stories**:

- Phase 5 (US2) depends on Phase 3 (US1) only for the modal block it decorates — T041 edits the
  component T026 creates. Its backend half (T039) is independent of US1 entirely.
- Phases 4 and 6 are fully independent of Phases 3 and 5 and of each other.
- T031 must precede any edit under `plugin/` (T035, T036, T036a, T037).

## Parallel opportunities

Within Phase 2: T010 and T011 are parallel (independent test cases in the same file — coordinate
if written by separate agents). T015 and T016 are parallel.

Across stories, once Phase 2 is complete, three tracks can run simultaneously:

- Track A (frontend detail): T023 → T030, then T040 → T042
- Track B (agent path): T031 → T038
- Track C (board card): T043 → T046

Track A and Track C both touch `frontend/` tests but different files
(`ticketDetail.test.tsx` vs `ticketCard.test.tsx`) and different components, so they do not
conflict.

## Implementation strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1). That alone gives a person a visible, copyable
branch on any ticket the agent has reported — the original request, satisfied.

**Recommended increment order**: MVP → Phase 4 (US4, which makes the mirror self-maintaining and
is the other half of P1) → Phase 5 (US2) → Phase 6 (US3) → Phase 7.

**Stop condition**: this task list ends before any commit, push, merge, or pull request. Those
are the human's call.

## Task summary

| Phase | Story | Tasks | Count |
|---|---|---|---|
| 1 | Setup | T001–T002 | 2 |
| 2 | Foundational | T003–T022 (incl. T015a, T016a, T018a) | 23 |
| 3 | US1 (P1) | T023–T030 | 8 |
| 4 | US4 (P1) | T031–T038 (incl. T036a) | 9 |
| 5 | US2 (P2) | T039–T042 | 4 |
| 6 | US3 (P3) | T043–T046 | 4 |
| 7 | Polish | T047–T054 | 8 |
| | **Total** | | **58** |
