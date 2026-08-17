# Implementation Plan: Git branch visible on ticket

**Branch**: `002-ticket-git-branch-view` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-ticket-git-branch-view/spec.md`
**Design handoff**: `.specify/bridge/approved-design.md` (APPROVED by the human partner)

## Summary

Give every ticket a visible git branch that **mirrors** what the agent reports, so a person
opening a ticket can see where the work happens without asking. One nullable scalar column on
`Ticket`; a write path that only the agent reaches; a read shape that adds the ticket's own
value, the effective value (own, else the parent's), and which of the two it is; a highlighted
block in the detail modal with a copy button; a compact chip on the board card; and an update to
the agent's `ticket-sync` skill so it actually reports the branch it is on.

The feature deliberately contains **no** branch-name generator, **no** read-time derivation from
the ticket's identity, and **no** repository filesystem access from the backend. The agent and
the repository are the source of truth; the ticket is a view of them.

## Technical Context

**Language/Version**: TypeScript throughout (backend, frontend, mcp). Node ≥ 20.
`plugin/` is plain ESM `.mjs` with zero dependencies.

**Primary Dependencies**: Express 5 + Prisma 7 (`@prisma/adapter-pg`) on the backend; Next.js 15
+ React 19 + Tailwind 4 on the frontend; `@modelcontextprotocol/sdk` + `zod` in `mcp/`. **No new
dependency is added to any package by this feature.**

**Storage**: PostgreSQL 16 via Prisma. One additive migration under
`backend/prisma/migrations/`.

**Testing**: `vitest run` in `backend/`, `frontend/`, and `mcp/`;
`node --test plugin/tests/*.test.mjs` for the plugin (glob form is mandatory on Windows).
Backend integration tests run against a real PostgreSQL, with `npx prisma migrate deploy`
executed by `backend/tests/globalSetup.ts`.

**Typecheck/Build**: `npm run build` per package — `tsc` for `backend/` and `mcp/`,
`next build` for `frontend/`.

**Target Platform**: self-hosted web app; `localhost` or an operator-controlled reverse proxy,
which may be plain HTTP on a LAN — this is why the clipboard fallback exists.

**Project Type**: web application, four packages (backend / frontend / mcp / plugin).

**Performance Goals**: no regression. The list endpoint must stay O(1) in query count with
respect to ticket count — one extra batched relation query, not one per row (research.md R2).

**Constraints**: additive only; no published endpoint, MCP tool name, or response field may
change meaning; no new runtime dependency in `plugin/`.

**Scale/Scope**: ~6 source files plus one migration, one skill document, and a README note.
Single-tenant board with tickets in the hundreds — no scale concern.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design.*

| Principle | Applies how | Verdict |
|---|---|---|
| **I. Module boundaries & single source of truth** | Validation and inheritance live in `backend/src/services/ticketRules.ts` and `tickets.ts`. `mcp/` stays a pass-through; the frontend only renders what it is given. No second write path, no DB connection from `mcp/`. | **PASS** |
| **II. TypeScript & test discipline** | All new stack code is TypeScript. Every behavior change ships tests that **cover the change itself**: backend unit (validation, derivation) + integration (endpoints, inheritance), frontend component tests (modal states, copy, card chip), mcp pass-through tests, and — for the `SKILL.md` behavior change (FR-023/FR-024) — a dedicated assertion in `plugin/tests/plugin-config.test.mjs` that the skill instructs the agent to read the branch from the repository and never fabricate one. Full suite before PR. | **PASS** |
| **III. Security posture & scope honesty** | No change to auth, CORS, rate limiting, password handling, JWT config, or MCP binding. A branch name is not a secret; it is visible to every authenticated account exactly like every other ticket field, consistent with the documented single-tenant posture (spec A-005). No isolation is implied that does not exist. The backend never executes the value and never touches a filesystem repository. | **PASS** |
| **IV. Plugin portability & silent-failure avoidance** | `plugin/skills/ticket-sync/SKILL.md` gains text only — no dependency, no `node_modules`. `plugin/.claude-plugin/plugin.json` is not touched (adding `skills`/`hooks` there would silently kill the MCP server). `docs/ticket-sync.md` is read before the edit. Plugin tests run in glob form. | **PASS** |
| **V. Configuration, secrets & reproducible environments** | No new environment variable, so no `.env.example` change. The schema change ships as a captured Prisma migration under `backend/prisma/migrations/`; no ad-hoc SQL, no uncaptured drift. Docker one-command bring-up is unaffected. | **PASS** |
| **Runtime contracts** | No port, endpoint path, MCP tool name, or `.claude/ticket-project.json` shape changes. Every API change is an added optional field. Not a breaking change. | **PASS** |
| **Development workflow** | Work happens on topic branch `002-ticket-git-branch-view` off `main`. `README.md` gains a note on the user-visible behavior; `docs/ticket-sync.md` is consulted for the plugin change. | **PASS** |

**Result: no violations. Complexity Tracking is therefore empty and omitted.**

Post-Phase-1 re-evaluation: the design artifacts introduced no new project, no new dependency,
no new abstraction layer, and no new configuration surface. The verdicts above stand unchanged.

**Correction to the Principle II justification (finding C1).** An earlier version of the row
above justified PASS for the `plugin/skills/ticket-sync/SKILL.md` change on the grounds that the
"plugin suite [is] re-run". That justification was wrong: re-running a suite that never reads the
changed content proves only that nothing broke, not that the change is covered, and Principle II
is about coverage of the behavior change. FR-023 and FR-024 are behavior — the skill document is
the agent's executable instruction — so they owed a test. That test now exists:
`plugin/tests/plugin-config.test.mjs`, `the skill reads the branch from the repo and never
fabricates one (FR-023, FR-024)`, asserting that `SKILL.md` names
`git rev-parse --abbrev-ref HEAD` as the source, reports through `update_ticket`/
`update_subticket` rather than `move_ticket`, covers the detached-`HEAD` case, reports nothing in
that case, and forbids inventing or slugifying a name. It was mutation-checked against the
pre-feature `SKILL.md` and fails there, so it is a real gate and not a tautology. The PASS is now
carried by that coverage.

## Project Structure

### Documentation (this feature)

```text
specs/002-ticket-git-branch-view/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── rest-api.md      # REST request/response contract
│   ├── mcp-tools.md     # MCP tool input/output contract
│   └── ui-and-skill.md  # Frontend surfaces + agent skill contract
├── checklists/
│   ├── requirements.md  # Spec quality gate
│   ├── readiness.md     # Pre-implementation readiness gate
│   └── technology.md    # Prisma / migration / TypeScript verification gate
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma                                  # + gitBranch on model Ticket
│   └── migrations/20260816_ticket_git_branch/
│       └── migration.sql                              # NEW: ADD COLUMN
├── src/services/
│   ├── ticketRules.ts                                 # + normalizeBranch/validation + derivation helper
│   └── tickets.ts                                     # + branch on TicketInput, create, update; + parent include on reads
└── tests/
    ├── unit/ticketRules.test.ts                       # + validation & derivation cases
    └── integration/tickets.test.ts                    # + endpoint & inheritance cases

frontend/
└── src/
    ├── lib/types.ts                                   # + 3 fields on Ticket
    ├── components/
    │   ├── TicketDetailModal.tsx                      # + highlighted branch block
    │   └── kanban/TicketCard.tsx                      # + branch chip
    └── __tests__/
        ├── ticketDetail.test.tsx                      # + block states, copy, inherited marker
        ├── ticketCard.test.tsx                        # + chip present/absent/truncated
        ├── board.test.tsx                             # FIXTURE ONLY: 3 fields on Ticket literals
        ├── moveTicketLocally.test.ts                  # FIXTURE ONLY: 3 fields on Ticket literals
        └── ticketForm.test.tsx                        # FIXTURE ONLY: 3 fields on Ticket literals

mcp/
├── src/tools/tickets.ts                               # + branch in shared ticketFields
└── tests/tickets.test.ts                              # + pass-through cases

plugin/
├── skills/ticket-sync/SKILL.md                        # + report the current branch
└── tests/plugin-config.test.mjs                       # + FR-023/FR-024 skill-content coverage

README.md                                              # + user-visible note
```

**Fixture-only test files.** `Ticket` gains three **required** properties, so every existing
object literal typed `Ticket` must supply them or `tsc`/`vitest` fails. The three files marked
FIXTURE ONLY above are touched for exactly that reason: each adds
`gitBranch: null, effectiveBranch: null, branchSource: null` to existing literals and changes
**no assertion**. This is case (a) of T050 — expected and additive — not the case (b) red flag.
`ticketForm.test.tsx` appearing here does **not** contradict FR-006/T029: the component under
test, `frontend/src/components/TicketFormModal.tsx`, is unmodified; only its test's fixtures are
extended.

**SDD artifacts are outside this structure.** `specs/002-ticket-git-branch-view/**`,
`.specify/feature.json`, and `.specify/bridge/**` are specification and feature-tracking
artifacts, not source. They are expected in the working tree and are not part of the source
changed-file set that T052 compares against this section.

**Structure Decision**: the existing four-package layout is used as-is. No new directory, module,
or package is introduced. Each change lands in the file that already owns that responsibility:
pure ticket rules in `ticketRules.ts`, persistence and read shaping in `tickets.ts`, tool schemas
in `mcp/src/tools/tickets.ts`, presentation in the two components that already render the two
surfaces.

**Explicitly not modified**: the **component** `frontend/src/components/TicketFormModal.tsx`
(FR-006 — the create/edit form is out of scope and must not appear in the diff; its test file
`frontend/src/__tests__/ticketForm.test.tsx` is a separate, fixture-only entry above and its
presence in the diff does not weaken this),
`backend/src/services/backlog.ts`, `reports.ts`, `metrics.ts`, `moves.ts`, `sweep.ts`, and
`plugin/.claude-plugin/plugin.json`.

## Implementation Approach

Ordered so each layer is verifiable before the next depends on it.

1. **Schema + migration.** Add the scalar column; author `migration.sql` by hand in the
   repository's existing naming style. Verify with `prisma validate` and a `prisma migrate diff`
   that reports no drift, and confirm the SQL contains no constraint or foreign-key statement
   (data-model.md, checklists/technology.md).
2. **Pure rules.** Add branch normalization + validation and the `effectiveBranch`/`branchSource`
   derivation to `ticketRules.ts`. Unit-test both, including the full six-row truth table.
   Database-free, so it is the cheapest place to prove the semantics.
3. **Service + endpoints.** Thread `branch` through `TicketInput`, `createTicket`, and
   `updateTicket`, honouring absent-vs-null. Add the narrow parent `include` to `listTickets`
   and `getTicketDetail` and map the derived pair onto the responses. Integration-test the
   endpoints, inheritance, clearing, and rejection.
4. **MCP.** Add `branch` to the shared `ticketFields`. Test that it is forwarded on all four
   tools and that omitting it sends no key.
5. **Frontend types + card.** Add the three fields to `Ticket`; render the chip conditionally.
   Test present/absent/truncated.
6. **Frontend detail block.** Render the highlighted block with its four states and the copy
   control with its fallback. Test all states, the copy, and the degraded inherited marker.
7. **Skill + README.** Read `docs/ticket-sync.md` first, then extend `SKILL.md` step 5 and add
   the README note. Re-run the plugin suite in glob form.

## Testing Strategy

| Layer | Command | Must cover |
|---|---|---|
| backend unit | `cd backend && npm test` | every FR-009 rejection rule; trim; empty-clears; the six-row derivation truth table; the two invariants |
| backend integration | `cd backend && npm test` | create with branch; update with branch; omit leaves unchanged; `""` and `null` clear; malformed → `400 VALIDATION` with the prior value intact; parent→subticket inheritance; own beats inherited; parent without branch; all three fields present on both read endpoints |
| mcp | `cd mcp && npm test` | `branch` forwarded by all four ticket tools; omitted → key absent; read fields relayed; backend `400` surfaces as an error |
| frontend | `cd frontend && npm test` | modal: own / inherited-with-number / inherited-degraded / empty state; copy via Clipboard API; copy via fallback when the API is absent; card: chip shown, hidden, and title carries the full value |
| plugin | `node --test plugin/tests/*.test.mjs` | FR-023/FR-024 content coverage: `SKILL.md` names `git rev-parse --abbrev-ref HEAD` as the branch source, reports via `update_ticket`/`update_subticket` (not `move_ticket`), handles detached `HEAD` by reporting nothing, and forbids inventing a name; plus the pre-existing suite still green |
| typecheck/build | `npm run build` in `backend/`, `mcp/`, `frontend/` | the three new fields typecheck end to end |
| migration | `npx prisma validate`; `npx prisma migrate deploy` then `npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code` (Prisma 7.8 flags — see quickstart.md §2); grep of `migration.sql` | no drift (exit code `0`); no constraint/FK statement; feature 001's partial unique index still present |

Regression guard for SC-009: the existing backend, frontend, and mcp suites must pass
**unchanged** — no existing assertion may be edited to accommodate this feature. An existing
test that needs editing is a signal that something non-additive happened and must be
investigated, not accommodated.

## Risks

| Risk | Mitigation |
|---|---|
| A regenerated migration silently rewrites `Ticket.column`'s explicit `onDelete: Restrict`, resurrecting the bug feature 001 fixed | The migration is authored by hand and the SQL is asserted to contain no `CONSTRAINT`/`REFERENCES` statement; `prisma migrate diff` must report no drift (checklists/technology.md) |
| Copy button silently dead on a plain-HTTP LAN deployment | Explicit fallback path, with a test that simulates `navigator.clipboard` being undefined |
| `(heredada de #null)` rendered when the auxiliary parent fetch fails | Spec edge case + FR-019 degradation to `(heredada)`, with a dedicated test |
| Inheritance computed twice and drifting between board and modal | Computed once, in the backend; the frontend never derives it (research.md R1) |
| The parent relation loaded for the derivation leaks into the API payload as a fourth added field | Responses are built explicitly instead of spreading the Prisma result, with an integration test asserting no `parent` key is present (T016a, T018) |
| Nested subtickets in the detail response omit the three fields, making the required frontend `Ticket` type dishonest | The derivation is applied to the `subtickets` array too, using the enclosing ticket as their parent (T018a), and asserted in T016 |
| Reporting a branch quietly moves a report or metric | Verified that no report/metric reads `updatedAt` or the audit log; asserted in contracts/rest-api.md |
| `plugin.json` accidentally gaining a `skills` key while editing the skill | The file is on the explicit do-not-modify list; the plugin suite is re-run |
