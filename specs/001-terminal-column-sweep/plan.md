# Implementation Plan: Completion Column & Automatic Board Sweep

**Branch**: `001-terminal-column-sweep` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-terminal-column-sweep/spec.md`

## Summary

Let an operator mark one kanban column per project as the **completion column**. When a ticket is moved into that column and no ticket remains in any other column, the backend sweeps every ticket in the completion column off the board in the same transaction as the move. Nothing is deleted: swept tickets stay in the project backlog marked completed, keep their history, phase, label, nesting and token/time totals, keep counting in every report, and can be put back on the board individually.

**Technical approach**: `Ticket.columnId` becomes nullable, and `columnId IS NULL` is defined to mean exactly "completed / off the board" — one field with one meaning, rather than a board placement plus a flag that can disagree with it. `KanbanColumn` gains `isCompletionColumn`, made unique per project by a Postgres partial unique index rather than by application code alone. The sweep lives in a new `backend/src/services/sweep.ts` called from inside the existing `moveTicket` transaction — the single write path for column changes — and serializes per project with a row lock taken only when the project has a completion column and the move targets it. Everything reaching the frontend and the MCP server is an additive field or an optional parameter: no request shape, response field or tool name is removed or renamed. One field's **type widens** — `columnId` and the included `column` become nullable, and consumers that never saw null before, including the unchanged-by-default `GET /projects/:projectId/tickets` and the `list_tickets` an agent already calls, can now receive it. That widening is the one compatibility change in the feature and is documented in [contracts/http-api.md](./contracts/http-api.md) §3.

Full reasoning, with the rejected alternatives and the cost that rejected each, is in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript throughout. Node ≥ 20.

**Primary Dependencies**: `backend/` Express 5, Prisma 7 (`@prisma/adapter-pg`), `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit` · `frontend/` Next.js 15, React 19, Tailwind 4, `@dnd-kit/core` · `mcp/` `@modelcontextprotocol/sdk`, Express 5, `zod`. **No new dependency is introduced by this feature in any package.**

**Storage**: PostgreSQL 16 via Prisma. One migration: two `ALTER TABLE`s and one partial unique index, no data backfill. See [data-model.md](./data-model.md).

**Testing**: vitest + supertest for `backend/` (integration + unit, with `tests/globalSetup.ts`), vitest for `mcp/`, vitest + Testing Library + jsdom for `frontend/`. `plugin/` uses Node's built-in runner and is untouched by this feature.

**Target Platform**: Self-hosted Linux/Docker or localhost. Backend `:4000`, frontend `:3000`, MCP published to `127.0.0.1:5000`, Postgres `:5434` — all unchanged.

**Project Type**: Web application in a four-package monorepo, plus an MCP server that exposes the backend to Claude Code.

**Performance Goals**: A sweep is bounded by the number of tickets on one project's board — tens, not thousands — and fires at most once per completed batch of work. The single added `SELECT … FOR UPDATE` is taken only on moves that target a designated completion column, so projects that have not opted in pay nothing. SC-005 requires open boards to reflect a sweep within 5 seconds; the existing SSE channel with its 200 ms debounce already meets that with a single event.

**Constraints**: `Ticket.columnId` is presently required — the central constraint this design has to resolve (research.md R1). The MCP layer may not hold domain rules. Every published port, endpoint, MCP tool name and response field must keep working. No security control may be weakened.

**Scale/Scope**: Single-tenant, self-hosted, small teams. Roughly 8 backend source files, 5 frontend files, 2 MCP files and one migration, plus tests across all three suites.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. Source: `.specify/memory/constitution.md` v1.0.0.*

| Principle | Verdict | Evidence |
|---|---|---|
| **I. Module Boundaries & Single Source of Truth** | **PASS** | The sweep rule exists only in `backend/src/services/sweep.ts`, invoked from the backend's single move path. `mcp/` gets one new passthrough action and one passthrough parameter and contains no sweep logic — [contracts/mcp-tools.md](./contracts/mcp-tools.md) states this as a testable requirement ("no test asserting sweep logic inside `mcp/`, because there must be no sweep logic inside `mcp/`"). The frontend mirrors state and never decides it. The nullable-`columnId` design was chosen specifically because the alternative kept two fields describing one fact — the drift this principle exists to prevent. **This is falsifiable, not aspirational**: if the rule ever leaked out of `sweep.ts`, a named test would fail — the MCP passthrough-fidelity tests (contracts/mcp-tools.md §Tests) fail if `mcp/` branches on `sweep` or on a null `columnId`; the frontend board tests fail if the board patches local state instead of refetching on a reported sweep (research.md R8); and the backend concurrency and repeat-sweep tests fail if the condition is evaluated anywhere but inside the move transaction. |
| **II. TypeScript & Test Discipline (NON-NEGOTIABLE)** | **PASS** | All changes are TypeScript; no JavaScript is added. Every behavior change has named test coverage in [quickstart.md](./quickstart.md), mapped file by file to the FRs it proves. Backend HTTP behavior changes are covered by integration tests, not unit tests alone. The unchanged plugin suite still runs in the required glob form. |
| **III. Security Posture Preservation & Scope Honesty** | **PASS** | No change to authentication, CORS, rate limiting, password handling, JWT configuration or MCP binding. The feature adds no endpoint outside `requireAuth`. Consistent with the documented single-tenant model, any authenticated user can designate a completion column and trigger a sweep; this is stated plainly rather than papered over, and no part of this feature implies per-user isolation that does not exist. |
| **IV. Plugin Portability & Silent-Failure Avoidance** | **PASS** | `plugin/` is not modified. No dependency is added to it, `plugin/.claude-plugin/plugin.json` is untouched, and no MCP server or tool is renamed — so none of the four documented packaging traps is approached. |
| **V. Configuration, Secrets & Reproducible Environments** | **PASS** | No new environment variable, so no `.env.example` change is required. The schema change ships as one Prisma migration under `backend/prisma/migrations`, hand-written in the same style as `20260709_phases/migration.sql`. No ad-hoc SQL is run against a running database — the raw partial-index SQL lives inside the migration, which is exactly where the constitution requires schema changes to live. `docker compose up -d` remains a working one-command bring-up. |
| **Technology Stack & Runtime Constraints** | **PASS** | No dependency added anywhere. Ports `:4000`, `:3000`, `127.0.0.1:5000` and `:5434` unchanged. No endpoint, MCP tool name or `.claude/ticket-project.json` shape is broken: every API change is an added field or an optional parameter with today's behavior as the default (research.md R4 rejects a default change specifically to avoid this). The single exception to "purely additive" is the `columnId` type widening to nullable (see §Summary and contracts/http-api.md §3) — a widening, not a removal or rename, so no MAJOR review is triggered, but a consumer that assumed non-null must be updated. |
| **Development Workflow & Quality Gates** | **PASS** | Work proceeds on the `001-terminal-column-sweep` topic branch. The schema change ships with its migration in the same change. User-visible behavior and the new column attribute must be reflected in `README.md`; `docs/ticket-sync.md` needs no change since `plugin/` is untouched. |

**Complexity gate**: passed. No new project, package, service, dependency, environment variable, port or abstraction layer. The one non-obvious construct — a partial unique index that Prisma's schema language cannot express — is justified against a concrete race the codebase already documents elsewhere, and carries a stated mitigation (research.md R2).

**Post-Phase-1 re-evaluation**: re-run after `data-model.md`, `contracts/` and `quickstart.md` were written. No verdict changed, and the design surfaced no new violation. Two items are recorded as risks to carry into implementation rather than as violations:

1. The partial unique index is invisible to Prisma's schema and could be dropped by a future `prisma migrate dev` regeneration. Mitigated by a schema comment, the hand-written-migration convention this repo already follows, and a concurrency test that fails loudly if the guard disappears.
   - **Owner**: T004 (the schema comment) and T018 (the tripwire test), both in [tasks.md](./tasks.md).
   - **Accepted when**: T018 exists, fails if the index is absent, and is part of the backend suite that gates every pull request — so the risk is detected by CI rather than by a corrupted board.
2. Reverting the migration is unsafe while completed tickets exist, since `columnId` would not go back to `NOT NULL`. Must be stated in the migration file itself, not just in the docs.
   - **Owner**: T006, which writes the migration.
   - **Accepted when**: the migration file itself contains the irreversibility warning naming the precondition (every completed ticket must be restored to the board first), so an operator reading only that file cannot revert unsafely. Documentation elsewhere does not discharge this.

## Project Structure

### Documentation (this feature)

```text
specs/001-terminal-column-sweep/
├── plan.md                    # This file
├── spec.md                    # Feature specification (with Clarifications)
├── research.md                # Phase 0 — 8 decisions with rejected alternatives
├── data-model.md              # Phase 1 — schema, invariant, migration, blast radius
├── quickstart.md              # Phase 1 — how to prove it works
├── contracts/
│   ├── http-api.md            # Backend HTTP changes (all additive)
│   └── mcp-tools.md           # MCP tool changes (passthrough only)
├── checklists/
│   ├── requirements.md        # Spec quality checklist
│   └── readiness.md           # Engineering readiness gate — must be resolved before implementation
└── tasks.md                   # Phase 2 — created by /speckit-tasks, NOT by /speckit-plan
```

### Source Code (repository root)

Only paths this feature touches. Everything else in the four packages is unchanged.

```text
backend/
├── prisma/
│   ├── schema.prisma                       # + KanbanColumn.isCompletionColumn; Ticket.columnId nullable
│   └── migrations/
│       └── <ts>_completion_column_sweep/
│           └── migration.sql               # 2 ALTER TABLEs + partial unique index
├── src/
│   ├── services/
│   │   ├── sweep.ts                        # NEW — the condition and the sweep; the only home for this rule
│   │   ├── moves.ts                        # calls the sweep in-transaction; accepts a completed ticket (restore)
│   │   ├── columns.ts                      # set/clear the designation, transactional + audited
│   │   ├── tickets.ts                      # `placement` filter on listTickets; tolerate a null column
│   │   ├── ticketRules.ts                  # completed ranks after every column (FR-011a)
│   │   └── backlog.ts                      # nullable column; `status` marker + `completed` flag
│   └── routes/
│       ├── columns.ts                      # PATCH accepts isCompletionColumn
│       └── projectTickets.ts               # GET accepts the optional placement parameter
└── tests/
    ├── integration/                        # columns, moves, backlog, tickets, reports, metrics, events
    │   └── sweep.test.ts                   # NEW — atomicity and concurrency
    └── unit/                               # validateParentMove with completed subtickets

frontend/src/
├── lib/types.ts                            # isCompletionColumn; columnId nullable; BacklogItem.completed
├── components/settings/ColumnsManager.tsx  # the designation control (at most one)
├── components/kanban/Board.tsx             # renders only board tickets
├── app/(app)/projects/[id]/page.tsx        # fetch with placement=board; refetch when a sweep is reported
├── app/(app)/projects/[id]/backlog/page.tsx# render completed distinguishably
└── __tests__/                              # settings, board, boardPage, backlogPage

mcp/src/tools/
├── management.ts                           # manage_columns: + action 'set_completion' (passthrough)
└── tickets.ts                              # list_tickets: + optional 'placement' (passthrough)
```

**Structure Decision**: the existing four-package monorepo is kept exactly as it is. The feature follows the repository's established layering — route → service → Prisma for the backend, typed API client and page/component for the frontend, thin passthrough tools for MCP. The single new backend module, `services/sweep.ts`, exists so the sweep rule has one obvious home and one obvious test target rather than being spread through `moves.ts`; it is called from within the existing move transaction so it does not become a second write path. `plugin/` is not part of this feature's structure at all.

## Implementation order

Dependency-ordered. `/speckit-tasks` will expand this into concrete tasks; it is recorded here because the ordering is forced by the schema change.

1. **Schema and migration** — everything else depends on the nullable `columnId` and on `isCompletionColumn` existing.
2. **Designation** (US1, P1) — `columns.ts` + route + audit. Independently shippable and useful on its own; no sweep behavior yet.
3. **Ordering semantics** — `ticketRules.ts` and its unit tests. Must precede the sweep so restores and parent moves behave correctly the first time.
4. **The sweep** (US2, P2) — `sweep.ts`, wired into `moves.ts` with the transaction and the project row lock. The core value.
5. **Visibility** (US3, P3) — `backlog.ts`, `listTickets` `placement`, and the reporting regression tests that prove FR-019b.
6. **Restore** (US4, P4) — falls out of steps 3 and 4; needs its own tests, no new endpoint.
7. **Frontend** — types, settings control, board exclusion and sweep refetch, backlog rendering.
8. **MCP passthrough** — the new action and parameter, plus the description text that keeps an agent from misreading a null `columnId` as an error.
9. **Documentation** — `README.md` for the new column attribute and the sweep behavior.

Steps 2 and 4 correspond to the spec's two highest-priority user stories, and each is independently testable in the sense the spec requires.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

No violations. No entry required.
