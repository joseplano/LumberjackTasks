---

description: "Task list for Completion Column & Automatic Board Sweep"
---

# Tasks: Completion Column & Automatic Board Sweep

**Input**: Design documents from `/specs/001-terminal-column-sweep/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are **MANDATORY** in this repository, not optional. Constitution Principle II (NON-NEGOTIABLE) requires every behavior change to ship with tests. The coverage table in [quickstart.md](./quickstart.md) is the authoritative mapping of which test file must prove which requirement, and the tasks below follow it.

**Organization**: Tasks are grouped by the spec's four prioritized user stories so each can be implemented, tested and shipped independently. The Foundational phase exists because making `Ticket.columnId` nullable breaks compilation in code that all four stories share — that phase changes the schema **and restores identical behavior**, delivering no user-visible change of its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks). Two tasks that edit the **same file** never both carry `[P]`, even when they are logically independent — they would collide if farmed out to parallel agents. Where several tasks share a file, the phase says so and they are authored as one unit; whole file-groups may still proceed concurrently with each other
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names exact repository-relative file paths

## Path Conventions

Four-package monorepo (see plan.md §Project Structure): `backend/src/`, `backend/tests/`, `backend/prisma/`, `frontend/src/`, `mcp/src/`. `plugin/` is **not touched by this feature**.

---

## Phase 1: Setup

**Purpose**: Establish a known-good baseline so that any later failure is attributable to this feature

- [ ] T001 Confirm work is on the `001-terminal-column-sweep` topic branch off `main`, per Constitution §Development Workflow
- [ ] T002 Record a green baseline by running all four suites and saving the output: `cd backend && npm test`, `cd mcp && npm test`, `cd frontend && npm test`, `node --test plugin/tests/*.test.mjs` (the plugin suite MUST use this glob form — the directory form fails with `MODULE_NOT_FOUND` on Windows)
- [ ] T003 [P] Capture the current project metrics and report figures for a seeded project as the comparison baseline for the FR-019b regression tasks (T041, T042)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Apply the schema change and restore byte-identical behavior. Making `Ticket.columnId` nullable breaks compilation in `backlog.ts`, `tickets.ts` and `moves.ts`, so those files must be made null-tolerant before any story can build.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete and T015 proves behavior is unchanged.

**⚠️ This phase must produce ZERO user-visible change.** No ticket can be completed yet because nothing sets `columnId` to null.

- [ ] T004 Add `isCompletionColumn Boolean @default(false)` to the `KanbanColumn` model in `backend/prisma/schema.prisma`, with a comment pointing at the partial unique index that the schema language cannot express (research.md R2)
- [ ] T005 Make `Ticket.columnId` optional (`String?`) and its `column` relation optional in `backend/prisma/schema.prisma`
- [ ] T006 Create `backend/prisma/migrations/<timestamp>_completion_column_sweep/migration.sql` containing, in this order: the `ADD COLUMN "isCompletionColumn" BOOLEAN NOT NULL DEFAULT false` on `kanban_columns`, the `ALTER COLUMN "columnId" DROP NOT NULL` on `tickets`, and the partial unique index `kanban_columns_projectId_completion_key ON "kanban_columns" ("projectId") WHERE "isCompletionColumn" = true` (data-model.md §Migration). Include a comment in the file stating that this migration is **not safely reversible while any completed ticket exists**
- [ ] T007 Confirm the migration requires no data backfill and that every existing column defaults to `false`, satisfying FR-007 (existing projects behave unchanged until opt-in)
- [ ] T008 [P] Make `backend/src/services/backlog.ts` null-tolerant: type `column` as nullable in `TicketRow` and in both Prisma queries, and keep `toItem` deriving `status` from the column name for on-board tickets. Do **not** add the completed marker yet — that is T043 (its test is T039)
- [ ] T009 [P] Make `backend/src/services/tickets.ts` null-tolerant: `listTickets` and `getTicketDetail` must accept a null `column` in their include shapes without changing what they return today
- [ ] T010 [P] Make `backend/src/services/moves.ts` null-tolerant: the current-column lookup must handle a null `columnId` instead of throwing `500 INTERNAL 'Ticket column missing'`. The restore path itself is T051
- [ ] T011 Implement the FR-011a ordering rule in `backend/src/services/ticketRules.ts`: `validateParentMove` must treat a subticket with no column position as ranking strictly after every column, so a completed subticket never appears in the blocking set
- [ ] T012 [P] Add unit tests in `backend/tests/unit/` proving `validateParentMove` never blocks a parent because of a completed subticket, and still blocks correctly for on-board subtickets (FR-011a)
- [ ] T013 [P] Mirror the schema change in `frontend/src/lib/types.ts`: add `isCompletionColumn: boolean` to `KanbanColumn` and make `Ticket.columnId` `string | null`
- [ ] T014 Add an integration test in `backend/tests/integration/tickets.test.ts` asserting the central invariant: no ordinary create or update path can leave a ticket with a null `columnId` (`createTicket` always assigns; `updateTicket` still rejects `columnId` with `400 VALIDATION`) — data-model.md §The central invariant
- [ ] T015 Re-run all four suites and confirm they pass with **no test modified to accommodate the schema change**. Any test needing a change here indicates behavior drifted and must be investigated, not edited

**Checkpoint**: schema is ready, behavior is unchanged, and user story implementation can begin

---

## Phase 3: User Story 1 - Designate a completion column (Priority: P1) 🎯 MVP

**Goal**: An operator or agent can mark exactly one column per project as the completion column, and can move or clear that marking. No sweep behavior yet — the attribute is useful on its own because column names are arbitrary and this declares which one means "finished".

**Independent Test**: Configure a project, mark a column, reload and confirm it persisted; mark a different column and confirm the first was cleared; clear it and confirm the project has none. FR-001…FR-007, FR-004a.

### Tests for User Story 1

> Write these first and confirm they fail before implementing T020–T024.
>
> T016–T019 all edit `backend/tests/integration/columns.test.ts`, so they carry no `[P]` — author them as one unit of work rather than farming them out to parallel agents that would collide in the same file.

- [ ] T016 [US1] Integration tests in `backend/tests/integration/columns.test.ts` for setting, clearing and moving the designation, and for its presence in the `GET /projects/:projectId/columns` payload (FR-001, FR-003, FR-004)
- [ ] T017 [US1] Integration test in `backend/tests/integration/columns.test.ts` proving that designating a second column clears the first in one operation, with no state in which two are designated (FR-002)
- [ ] T018 [US1] Integration test in `backend/tests/integration/columns.test.ts` proving two concurrent designation attempts on one project cannot both succeed — this test is the tripwire that fails loudly if the partial unique index is ever dropped (research.md R2)
- [ ] T019 [US1] Integration tests in `backend/tests/integration/columns.test.ts` proving that deleting the designated column clears the designation without transferring it, and that rename and reorder both preserve it (FR-005, FR-006)

### Implementation for User Story 1

- [ ] T020 [US1] Add designation set/clear to `backend/src/services/columns.ts`, running inside a `prisma.$transaction` that clears any other designated column of the project first, and emitting `column.completion_set` / `column.completion_cleared` audit entries via `logAudit` alongside the existing `column.*` actions (FR-002, contracts/http-api.md §2)
- [ ] T021 [US1] Extend `PATCH /projects/:projectId/columns/:columnId` in `backend/src/routes/columns.ts` to accept `isCompletionColumn`, requiring at least one of `name` or `isCompletionColumn` and returning `400 VALIDATION` when neither is present, while keeping the existing rename semantics and the blank-name rejection intact
- [ ] T022 [US1] Map the partial unique index violation to `409 COMPLETION_COLUMN_CONFLICT` in `backend/src/services/columns.ts`, rather than letting a raw Prisma error surface (contracts/http-api.md §2)
- [ ] T023 [P] [US1] Add the designation control to `frontend/src/components/settings/ColumnsManager.tsx` with radio-style semantics so at most one column can be marked, plus a clear affordance, and cover it in `frontend/src/__tests__/settings.test.tsx`
- [ ] T024 [P] [US1] Add the `set_completion` action to the existing `manage_columns` tool in `mcp/src/tools/management.ts` as a pure passthrough to the PATCH endpoint, update its description text per contracts/mcp-tools.md §1, and cover it in the `mcp/` suite. **Do not rename the tool** and do not put any rule logic in this layer

**Checkpoint**: designation works end to end through UI, API and agent, with no behavior change to boards

---

## Phase 4: User Story 2 - Automatic sweep when the board is fully completed (Priority: P2)

**Goal**: Moving the last ticket into the completion column empties the whole board in one atomic operation. This is the value the requester asked for.

**Independent Test**: On a project with a designated completion column and tickets spread across columns, move tickets in one at a time; nothing happens while another column holds a ticket, and the moment the last one arrives every column empties while the ticket count is unchanged. FR-008…FR-017, FR-020…FR-022.

**Depends on**: Phase 3 (needs a designation to exist) and T011 (ordering semantics).

### Tests for User Story 2

> These tests span three files. Tasks that share a file are **not** parallelizable across agents — author each file's tests as one unit. The three file groups can proceed concurrently: `moves.test.ts` (T025, T026, T031) · `sweep.test.ts` (T027, T028, T029, T029a, T029b) · `events.test.ts` (T030).

- [ ] T025 [US2] Integration tests in `backend/tests/integration/moves.test.ts` for the trigger condition: no sweep while another column holds a ticket; sweep on the move that empties the last other column; no sweep at all when no column is designated (FR-008, FR-009, FR-012, FR-013)
- [ ] T026 [US2] Integration tests in `backend/tests/integration/moves.test.ts` for the boundary cases: a single-ticket project sweeps; an empty board never sweeps; a subticket left in another column blocks the sweep and sweeps with the rest once moved (FR-009, FR-011)
- [ ] T027 [US2] Integration test in new file `backend/tests/integration/sweep.test.ts` proving atomicity: a forced mid-sweep failure leaves the board exactly as it was, **including the triggering move**, and returns an error; and that no read of the project ever observes a partially swept board — some tickets of one sweep off the board while others are still in the completion column (FR-014, FR-014a, SC-008)
- [ ] T028 [US2] Integration test in `backend/tests/integration/sweep.test.ts` proving concurrent moves into the completion column produce exactly one sweep — covering both the double-sweep and the **missed-sweep** hazard, which is the one that silently violates SC-002 (research.md R3)
- [ ] T029 [US2] Integration test in `backend/tests/integration/sweep.test.ts` proving that nothing is deleted: every swept ticket, subticket, label link, phase link, history row and token/time total still exists afterwards (FR-015). In the same test, assert the sweep left the project's columns untouched — same set, same names, same order, and the same column still designated (FR-016)
- [ ] T029a [US2] Integration test in `backend/tests/integration/sweep.test.ts` proving sweeps repeat: fill the board, sweep it, refill with new tickets and sweep again, three cycles in a row, asserting each cycle empties the board and that the previously completed tickets neither block the condition nor get swept a second time (FR-010, SC-009). **This is the guard against the silent failure mode** — a sweep that counts completed tickets simply stops firing after the first batch, with no error anywhere
- [ ] T029b [US2] Integration test in `backend/tests/integration/sweep.test.ts` for the sweep-vs-delete race (research.md R3, spec §Edge Cases): delete a ticket concurrently with a sweep and assert both orders are safe — a ticket deleted first is simply not swept, a ticket swept first still deletes cleanly afterwards — and that the `board.swept` audit entry reports only the tickets actually taken off the board, never a set observed before the update executed (FR-021a)
- [ ] T030 [US2] Integration test in `backend/tests/integration/events.test.ts` proving exactly one project-scoped `board.swept` event is emitted per sweep, not one per ticket (FR-022)
- [ ] T031 [US2] Integration test in `backend/tests/integration/moves.test.ts` proving the sweep produces one `board.swept` audit entry — not one per ticket — attributed to the actor whose move triggered it, and one status-history row per swept ticket recording its exit from the completion column (FR-020, FR-021, FR-021a)

### Implementation for User Story 2

- [ ] T032 [US2] Create `backend/src/services/sweep.ts` as the single home for the sweep rule: evaluate the condition (every on-board ticket of the project sits in the completion column, and at least one exists) and perform the sweep as a single conditional `UPDATE`, returning the affected ticket ids. Both the condition query and the `UPDATE` MUST be scoped to on-board tickets (`columnId` not null) so already-completed tickets never count — that scoping is the whole of FR-010 and is what makes a project sweepable repeatedly (FR-008, FR-009, FR-010, FR-013; tested by T025 and T029a)
- [ ] T033 [US2] Write the per-ticket `TicketStatusHistory` rows in `backend/src/services/sweep.ts` with `fromColumnName` = the completion column name and `toColumnName` = the reserved literal `Completed`, leaving `tokensDelta` and `timeDelta` null (research.md R6)
- [ ] T034 [US2] Write the single `board.swept` audit entry in `backend/src/services/sweep.ts` with `entityType: 'project'` and detail `{ completionColumnId, completionColumnName, ticketCount, ticketIds }`, emitted only when at least one ticket was actually swept, and attributed to the actor of the triggering move — for an agent-initiated move that is the account the MCP server authenticates as (FR-021, FR-021a, research.md R7). `ticketCount` and `ticketIds` MUST be derived from the rows the sweep's `UPDATE` actually affected, never from the earlier condition query, so a ticket deleted in between is not reported as swept (research.md R3, tested by T029b)
- [ ] T035 [US2] Call the sweep from inside the existing `prisma.$transaction` in `backend/src/services/moves.ts`, after the move and its history row, so the sweep and the move commit or roll back together (FR-014)
- [ ] T036 [US2] Add the per-project serialization in `backend/src/services/moves.ts`: take a `SELECT … FOR UPDATE` row lock on the project **only** when the project has a completion column and the move targets it, so projects that have not opted in pay nothing (research.md R3)
- [ ] T037 [US2] Publish `{ type: 'board.swept', projectId }` once per sweep from `backend/src/services/moves.ts` after the transaction commits, following the existing publish-after-commit pattern (FR-022)
- [ ] T038 [US2] Add the additive `sweep` summary to the move response in `backend/src/services/moves.ts` (`null` when no sweep fired), and update the `move_ticket` / `move_subticket` descriptions in `mcp/src/tools/tickets.ts` to explain that a successful sweep returns a ticket with a null `columnId` — that is the intended outcome, not an error (research.md R5, contracts/mcp-tools.md §3)

**Checkpoint**: the board sweeps correctly and atomically; swept tickets exist but are not yet distinguishable in the backlog

---

## Phase 5: User Story 3 - Completed work stays visible in the backlog (Priority: P3)

**Goal**: Swept tickets remain visible and clearly marked in the backlog, disappear from the board, and change no reporting figure. Without this the sweep looks like deletion.

**Independent Test**: Record the backlog and the metrics of a project, trigger a sweep, and confirm the same tickets appear with the same phase grouping and nesting, now marked completed, with every report figure unchanged. FR-018, FR-019, FR-019a, FR-019b.

**Depends on**: Phase 4 (needs sweeps to exist to observe).

### Tests for User Story 3

- [ ] T039 [P] [US3] Integration tests in `backend/tests/integration/backlog.test.ts` proving swept tickets stay listed with `completed: true` and the `Completed` status marker, retaining phase grouping, subtask nesting, labels and totals, and that `total` still counts them (FR-018, FR-019)
- [ ] T040 [P] [US3] Integration tests in `backend/tests/integration/tickets.test.ts` for the `placement` parameter: `board` excludes completed, `completed` returns only them, an invalid value returns `400 VALIDATION`, and **omitting it returns everything exactly as before** — that last assertion is what guards the no-breaking-change promise (FR-019a, research.md R4)
- [ ] T041 [P] [US3] Regression test in `backend/tests/integration/reports.test.ts` asserting every report figure is identical immediately before and immediately after a sweep (FR-019b, SC-011)
- [ ] T042 [P] [US3] Regression test in `backend/tests/integration/metrics.test.ts` asserting `GET /projects/:id/metrics` returns identical `totalTokens`, `totalTimeMinutes` and `ticketCount` across a sweep (FR-019b)

### Implementation for User Story 3

- [ ] T043 [US3] Add the completed marker and the `completed: boolean` flag to `BacklogItem` in `backend/src/services/backlog.ts`, deriving `status` from the column name when on the board and the reserved `Completed` literal when not, and keeping the existing phase grouping, pagination and sort behavior untouched (contracts/http-api.md §5)
- [ ] T044 [US3] Add the `placement` query parameter (`board` | `completed` | `all`, defaulting to `all`) to `listTickets` in `backend/src/services/tickets.ts` and to the route in `backend/src/routes/projectTickets.ts`, composing correctly with the existing `parent` parameter
- [ ] T045 [US3] Confirm by inspection that `backend/src/services/reports.ts` and `backend/src/services/metrics.ts` need **no change**, since both aggregate by `projectId` with no column predicate. Record the confirmation; T041 and T042 defend it
- [ ] T046 [P] [US3] Add `completed: boolean` to `BacklogItem` in `frontend/src/lib/types.ts` and render completed rows distinguishably in `frontend/src/app/(app)/projects/[id]/backlog/page.tsx`, branching on the `completed` flag rather than parsing the status string; cover in `frontend/src/__tests__/backlogPage.test.tsx`
- [ ] T047 [US3] Fetch the board with `placement=board` in `frontend/src/app/(app)/projects/[id]/page.tsx` so completed tickets never render on the board, and assert the exclusion in `frontend/src/__tests__/board.test.tsx` and `frontend/src/__tests__/boardPage.test.tsx` (FR-019a)
- [ ] T048 [US3] Refetch the board instead of patching local state when a move response carries a non-null `sweep`, in `frontend/src/app/(app)/projects/[id]/page.tsx` — `frontend/src/lib/moveTicketLocally.ts` handles single-ticket moves and must not be taught to express a whole-board change (research.md R8)
- [ ] T049 [P] [US3] Add the optional `placement` passthrough to `list_tickets` in `mcp/src/tools/tickets.ts`, keeping the parameter-omitted default unchanged, and cover both halves in the `mcp/` suite (contracts/mcp-tools.md §2)
- [ ] T049a [US3] Add the passthrough-fidelity tests to the `mcp/` suite per contracts/mcp-tools.md §Asserting the absence of sweep logic: given a stubbed backend move response carrying a non-null `sweep` and a null `columnId`, `move_ticket` and `move_subticket` relay it unchanged and never treat the null column as an error; `set_completion` issues exactly one `PATCH` with exactly `{ isCompletionColumn }`; and a `409 COMPLETION_COLUMN_CONFLICT` surfaces uninterpreted rather than being retried or swallowed. These are the assertions that fail if sweep logic ever leaks into `mcp/`, making Constitution Principle I checkable here (Constitution Principle I, plan.md §Constitution Check)

**Checkpoint**: work is visibly preserved, boards are clean, and reporting is provably untouched

---

## Phase 6: User Story 4 - Return a completed ticket to the board (Priority: P4)

**Goal**: A completed ticket can be put back on the board and behaves as an ordinary ticket again. This is what makes an unconfirmed automatic sweep safe.

**Independent Test**: Sweep a project, place one completed ticket into a column, confirm it appears on the board and is no longer marked completed in the backlog, then move it to the completion column and confirm the board sweeps again. FR-023, FR-024.

**Depends on**: Phase 4 (needs completed tickets to exist) and T010/T011.

### Tests for User Story 4

- [ ] T050 [US4] Integration tests in `backend/tests/integration/moves.test.ts` proving a completed ticket can be moved back into a column, that it then counts toward the sweep condition again, and that its restoration is recorded in status history with `fromColumnName: 'Completed'` (FR-023, FR-024)
- [ ] T051 [US4] Integration test in `backend/tests/integration/moves.test.ts` for partial-family restore: restoring a parent while its subtickets remain completed is allowed, because completed ranks after every column (FR-011a). Shares a file with T050 — author the two together
- [ ] T052 [P] [US4] Integration test in `backend/tests/integration/sweep.test.ts` for restoring a completed ticket **directly into the completion column** on an otherwise empty board: per spec §Edge Cases, this is a move into the completion column, so the condition is evaluated and met and the ticket is swept again immediately. Assert exactly that outcome — the ticket is off the board again, a second `board.swept` audit entry exists, and the restore and the re-sweep both appear in its status history — and assert that restoring into any other column leaves it on the board (FR-008, FR-009, FR-017, FR-023)

### Implementation for User Story 4

- [ ] T053 [US4] Complete the restore path in `backend/src/services/moves.ts`: accept a ticket with a null `columnId` as the move subject, write the history row with `fromColumnName: 'Completed'`, and emit the usual `ticket.moved` audit entry (FR-023)
- [ ] T054 [US4] Confirm `createTicket` in `backend/src/services/tickets.ts` still places new tickets on the board unaffected by prior sweeps, and cover it in `backend/tests/integration/tickets.test.ts` (FR-025)
- [ ] T055 [P] [US4] Surface a restore affordance from the backlog in `frontend/src/app/(app)/projects/[id]/backlog/page.tsx`, reusing the existing move endpoint with no new endpoint, and cover it in `frontend/src/__tests__/backlogPage.test.tsx`

**Checkpoint**: all four user stories are independently functional; the sweep is fully reversible

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T056 [P] Document the completion column attribute, the sweep behavior, the backlog's completed status and the restore path in `README.md`, per Constitution §Development Workflow (user-visible behavior and configuration MUST be reflected there)
- [ ] T057 [P] Confirm `docs/ticket-sync.md` needs no change, since `plugin/` is untouched by this feature
- [ ] T058 Verify no new environment variable was introduced, so no `*.env.example` file needs updating (Constitution Principle V)
- [ ] T059 Verify `plugin/` is byte-unchanged, including `plugin/.claude-plugin/plugin.json`, and that it still has no dependencies and no `node_modules` (Constitution Principle IV)
- [ ] T060 Verify no security control was touched — authentication, CORS, rate limiting, password handling, JWT configuration and MCP binding are all unchanged (Constitution Principle III)
- [ ] T061 Verify no MCP tool was renamed and no published port or endpoint path changed, so no MAJOR breaking-change review is triggered (Constitution §Technology Stack & Runtime Constraints)
- [ ] T062 Confirm the sweep rule exists only in `backend/src/services/sweep.ts`, that `mcp/` contains no sweep logic and no test asserting sweep *behavior*, and that the passthrough-fidelity tests from T049a are present and passing — those are the falsifying evidence for this claim, not the inspection alone (Constitution Principle I, contracts/mcp-tools.md §Asserting the absence of sweep logic)
- [ ] T063 Work through the manual and agent walkthroughs in [quickstart.md](./quickstart.md), including the five hand-exercised edge cases
- [ ] T064 Run all four suites green one final time using the exact commands in T002, then re-confirm the [readiness checklist](./checklists/readiness.md) — it was resolved before implementation began, so this is a check that the delivered artifacts and code did not invalidate any item, not a first pass over it

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**, because the nullable `columnId` breaks compilation until T008–T010 land
- **US1 (Phase 3)**: depends on Foundational only
- **US2 (Phase 4)**: depends on US1 (a designation must exist to trigger on) and on T011
- **US3 (Phase 5)**: depends on US2 (sweeps must exist to observe)
- **US4 (Phase 6)**: depends on US2 (completed tickets must exist to restore)
- **Polish (Phase 7)**: depends on all stories intended for the release

### Why the stories are not fully parallel here

The template's default assumption is that stories are independent. In this feature they form a chain — designation → sweep → visibility/restore — because each story's subject matter is created by the one before it. Each story is still independently **testable and shippable**: US1 delivers a usable attribute with no sweep, and US2 delivers a working sweep even before the backlog is prettied up in US3.

### Within each user story

- Tests are written first and must fail before the implementation tasks in the same phase
- Service layer before routes; backend before frontend and MCP, since both mirror the backend contract

### Parallel Opportunities

- T008, T009, T010 touch three different service files and can run together, after T004–T007
- T012, T013 are independent of each other and of T008–T010
- US1 tests T016–T019 all edit `columns.test.ts` and are one unit of work, **not** four parallel tasks; T023 and T024 touch different packages and can run in parallel
- US2 tests split into three concurrent file-groups — `moves.test.ts` (T025, T026, T031), `sweep.test.ts` (T027, T028, T029, T029a, T029b) and `events.test.ts` (T030) — parallel across groups, sequential within one; the implementation tasks T032–T038 are mostly sequential because they converge on `moves.ts`
- All US3 tests (T039–T042) can be written in parallel — they are genuinely four different files; T046 and T049 are in different packages. T049 and T049a both land in the `mcp/` suite and are one unit of work, not two parallel tasks
- US4 tests T050 and T051 share `moves.test.ts` and are one unit; T052 is in `sweep.test.ts` and is parallel to them
- T056–T062 are independent verification tasks and can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# After the schema and migration (T004-T007) are in place, make the three
# affected services null-tolerant together — different files, no shared edits:
Task: "Make backend/src/services/backlog.ts null-tolerant"
Task: "Make backend/src/services/tickets.ts null-tolerant"
Task: "Make backend/src/services/moves.ts null-tolerant"

# Independently, in parallel:
Task: "Unit tests for validateParentMove with completed subtickets in backend/tests/unit/"
Task: "Mirror the schema change in frontend/src/lib/types.ts"
```

## Parallel Example: User Story 2 Tests

```bash
# Write all sweep tests before any sweep implementation. Fan out by FILE, not by
# task — three agents, each owning one file end to end:
Task: "moves.test.ts: trigger-condition, boundary-case and audit/history tests (T025, T026, T031)"
Task: "sweep.test.ts: atomicity, concurrency, nothing-is-deleted + columns-untouched, repeat-sweep and sweep-vs-delete tests (T027, T028, T029, T029a, T029b)"
Task: "events.test.ts: single-event test (T030)"
```

---

## Implementation Strategy

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)** is the MVP: a project can declare which column means "finished", visible in the UI, the API and to the agent. It ships with zero behavioral risk because no sweep exists yet, and it validates the schema change in production before the risky part lands.

### Incremental delivery

1. Setup + Foundational → schema changed, behavior provably identical (T015 is the gate)
2. + US1 → designation usable everywhere → ship
3. + US2 → the sweep itself, the highest-risk increment → ship
4. + US3 → completed work visible, reporting provably untouched → ship
5. + US4 → the sweep becomes reversible → ship
6. Polish → docs and the constitution verification sweep

### Sequencing advice

Do not start Phase 4 until T027, T028 and T029a are written and failing. Atomicity, missed-sweep and repeat-sweep are the three tests that catch failure modes which are otherwise invisible — a board that quietly does not empty, or that sweeps once and then never again, produces no error anywhere.

---

## Notes

- `[P]` tasks touch different files and have no dependency on incomplete work
- `[Story]` labels map each task to its user story for traceability
- Test tasks are mandatory here (Constitution Principle II); verify they fail before implementing
- Commit after each task or logical group; keep the pull request focused
- No task in this list renames an MCP tool, adds a dependency to `plugin/`, changes a security control, or runs ad-hoc SQL against a database — all four are forbidden by the constitution
- **This list is not to be executed by the bootstrap agent.** Implementation begins with `/speckit-implement` in a normal session
