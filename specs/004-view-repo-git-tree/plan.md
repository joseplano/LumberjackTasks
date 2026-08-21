# Implementation Plan: View repo — a graphical tree of the repository history

**Branch**: `004-view-repo-git-tree` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-view-repo-git-tree/spec.md`, itself derived from
the approved design record `.specify/bridge/approved-design.md` (D1–D10).

## Summary

Add a read-only **View repo** screen to the project board that draws the repository's branch and
commit history as a left-to-right tree, with four branch-state colours, a commit modal and a
branch modal. Nothing in the stack can read a git repository today, so the feature also adds the
data pipeline that feeds it: four new tables behind a committed Prisma migration, four HTTP
endpoints (three read, one write), one new MCP tool `sync_git_history`, and instructions in the
plugin's `ticket-sync` skill telling the agent when and how to sync. The agent is the only writer,
which is the same rule that already governs `Ticket.gitBranch`.

The technical approach in one line per module: **backend** stores what the agent reports and
enforces every invariant it can see; **mcp** is a thin validating pass-through; **plugin** gains
instructions and no code; **frontend** consumes the read endpoints and draws hand-rolled SVG whose
geometry and colour rules live in two pure, separately tested functions.

Work is ordered so the backend is built and verified before any SVG work starts (D1).

## Technical Context

**Language/Version**: TypeScript throughout (`backend/`, `mcp/`, `frontend/`); plain ESM `.mjs`
in `plugin/`. Node ≥ 20.

**Primary Dependencies**: no new dependency in any package. `backend/` — Express 5, Prisma 7.8
(`@prisma/adapter-pg`); `mcp/` — `@modelcontextprotocol/sdk`, `zod`; `frontend/` — Next.js 15,
React 19, Tailwind 4 (its only UI dependency remains `@dnd-kit/core`); `plugin/` — none, and none
may be added (constitution Principle IV).

**Storage**: PostgreSQL 16 via Prisma. Four new tables, two new enums, one hand-written migration
at `backend/prisma/migrations/20260821_git_history/`. No existing column changes.

**Testing**: `cd backend && npm test` (vitest + supertest; `tests/globalSetup.ts` runs
`prisma migrate deploy` first); `cd mcp && npm test` (vitest); `cd frontend && npm test`
(vitest + Testing Library + jsdom); `node --test plugin/tests/*.test.mjs` — the glob form, which
the constitution requires because the directory form fails with `MODULE_NOT_FOUND` on Windows.

**Type gates — asymmetric, and this matters**:

| Package | Type gate | Lint |
|---|---|---|
| `backend/` | `npm run build` (`tsc`) | none |
| `mcp/` | `npm run build` (`tsc`) | none |
| `frontend/` | **`npm run build` (`next build`) — the only one there is** | **none** |

`frontend/package.json` declares exactly `dev`, `build`, `start`, `test`. **There is no
`typecheck` script and no `lint` script in `frontend/`.** No task may invoke
`npm run typecheck` or `npm run lint` there; those commands do not exist, and calling them
produces a missing-script failure that looks like a broken gate rather than an absent one. Frontend
type safety is claimed only after `next build` succeeds. See research R10.

**Target Platform**: self-hosted Linux/Docker or local Node; browser for the frontend. Supported
deployment is `localhost` or an operator-controlled authenticated reverse proxy.

**Project Type**: web application across four packages (backend, frontend, MCP server, plugin).

**Performance Goals**: none specified by the approved design, and none implied by a single-user
localhost deployment mirroring one repository per project. Recorded as a deliberate boundary in
research R13 rather than left implicit.

**Constraints**: `express.json({ limit: '100kb' })` in `backend/src/app.ts` is a security control
and stays as it is — the sync is chunked to fit it instead (research R2). No token, credential or
filesystem path is stored (FR-027). The screen is read-only.

**Scale/Scope**: one repository per project, tens to low hundreds of commits. The whole recorded
history is drawn at once; no pagination is specified or built.

## Constitution Check

*Constitution v1.0.0, ratified 2026-08-15. Checked before Phase 0 and re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| **I. Module boundaries & single source of truth** | Frontend stays an HTTP consumer only; the MCP server reaches the backend over HTTP with bot credentials, opens no database connection, and holds no rule the backend does not enforce; the backend is the single source of truth. | **PASS.** The screen is read-only (FR-003). The MCP tool is a validating pass-through (contract `mcp-tool.md`); its `zod` schema only pre-checks shape, and identity, idempotence, attribution, trunk uniqueness and ticket ownership are enforced backend-side (contract `http-api.md` §4). |
| **II. TypeScript & test discipline (NON-NEGOTIABLE)** | New stack code is TypeScript; every behaviour change ships with tests; the full suite passes. | **PASS.** All new stack code is TypeScript. TDD across all four modules. Backend HTTP behaviour gets supertest integration coverage, not unit coverage alone. The two pure functions are unit-tested without rendering. |
| **III. Security posture & scope honesty** | Single-tenant posture preserved; no implied per-user isolation; no listed control weakened. | **PASS.** FR-030 forbids implying isolation that does not exist. FR-027 forbids storing tokens or paths — this is *why* the forge-API option was rejected. The 100 KB body limit is preserved by chunking rather than raised (research R2). New routes sit behind the existing `requireAuth`. No auth, CORS, rate-limit, password or JWT behaviour is touched. |
| **IV. Plugin portability & silent-failure avoidance** | No plugin dependency; `plugin.json` declares only `mcpServers`; no silent failure. | **PASS, with mandatory reading.** Only `plugin/skills/ticket-sync/SKILL.md` changes — instructions, no code, no dependency, no `plugin.json` edit. Constitution requires reading the "Cómo está armado el plugin, y las cuatro trampas" section of `docs/ticket-sync.md` before the change and running `node --test plugin/tests/*.test.mjs` after it; both are tasks. Silent failure is attacked directly by the `entity.too.large` → `413` mapping (research R2), without which an oversize sync reports `500 "Unexpected error"`. |
| **V. Configuration, secrets & reproducible environments** | Schema changes go through a committed Prisma migration; new settings documented; `docker compose up -d` still works. | **PASS.** One committed migration, matching the repository's `YYYYMMDD_snake_name` hand-written-SQL convention (research R8). **No new environment variable**, so no `.env.example` change is needed. `README.md` gains a section for the new user-visible behaviour (FR-031). |

**Development Workflow gates that become tasks**: work on a topic branch off `main` (done —
`004-view-repo-git-tree` was cut from `main`); tests for every behaviour changed; full suite before
a PR; migration committed alongside the code; `README.md` updated.

**Post-Phase-1 re-check**: unchanged, still PASS. Phase 1 added no dependency, no environment
variable, no second write path and no weakened control. The one design decision that could have
breached a principle — raising the JSON body limit to fit a backfill — was rejected in research R2
for exactly that reason.

**Complexity Tracking**: not required. No principle is violated, so there is nothing to justify.

## Project Structure

### Documentation (this feature)

```text
specs/004-view-repo-git-tree/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — R1..R13
├── data-model.md        # Phase 1 output — four tables, two enums, one migration
├── quickstart.md        # Phase 1 output — how to prove it works
├── contracts/
│   ├── http-api.md      # Four endpoints
│   ├── mcp-tool.md      # sync_git_history + plugin instructions
│   └── tree-geometry.md # branchColor + buildRepoTree pure functions
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma                                  # + 2 enums, 4 models, 3 back-relations
│   └── migrations/20260821_git_history/migration.sql  # NEW, committed
├── src/
│   ├── app.ts                                         # + mount git-history routes
│   ├── middleware/errors.ts                           # + entity.too.large -> 413
│   ├── routes/gitHistory.ts                           # NEW
│   └── services/gitHistory.ts                         # NEW
└── tests/
    ├── integration/gitHistory.test.ts                 # NEW
    └── integration/tickets.test.ts                    # + ticket-delete regression (R7)

mcp/
├── src/
│   ├── server.ts                                      # + registerGitHistoryTools
│   └── tools/gitHistory.ts                            # NEW
└── tests/                                             # + tool tests

frontend/
├── src/
│   ├── app/(app)/projects/[id]/page.tsx               # + View repo control
│   ├── app/(app)/projects/[id]/repo/page.tsx          # NEW screen
│   ├── components/RepoTree.tsx                        # NEW  (SVG)
│   ├── components/CommitDetailModal.tsx               # NEW
│   ├── components/BranchDetailModal.tsx               # NEW
│   ├── lib/branchColor.ts                             # NEW  (pure)
│   ├── lib/repoTree.ts                                # NEW  (pure)
│   ├── lib/api.ts                                     # + typed calls
│   ├── lib/types.ts                                   # + response types
│   └── __tests__/                                     # + unit and component tests
plugin/
└── skills/ticket-sync/SKILL.md                        # + Repository history sync section

README.md                                              # + View repo section
```

**Structure Decision**: the existing four-package layout is kept exactly. Each package gains files
in the directory its peers already live in — routes beside routes, services beside services, pure
helpers in `frontend/src/lib/` beside `branchUrl.ts`, tests in the suites that already exist. No
new top-level directory and no new package.

## Implementation Phasing

Ordered to satisfy D1 — **the backend is verified before the SVG work begins** — and so each phase
leaves the suite green.

1. **Schema and migration.** Prisma models, enums, explicit `onDelete` on every relation (research
   R7), the hand-written migration. Verified by `prisma validate`, `prisma migrate diff` and the
   backend suite, plus the ticket-delete regression test that proves the `GitCommitTicket → Ticket`
   cascade did not turn into a `Restrict`.
2. **Backend write path.** `POST …/git-history/sync`: validation, idempotent upserts, fixed
   attribution, the transaction, the caps, and the `entity.too.large` → `413` mapping. Integration
   tests first.
3. **Backend read paths.** The three `GET` endpoints, including inferred-ticket derivation and the
   never-synced shape.
4. **Checkpoint — backend proven.** `cd backend && npm run build && npm test` green. Only now does
   SVG work start (D1).
5. **MCP tool.** `sync_git_history` with its `zod` schema and its description text, including the
   state-precedence wording.
6. **Plugin instructions.** After reading `docs/ticket-sync.md`; plugin tests re-run.
7. **Pure frontend functions.** `branchColor` and `buildRepoTree`, unit-tested without rendering.
8. **Frontend screen.** Route, SVG tree, two modals, loading/failed/never-synced states, and the
   **View repo** control on the board.
9. **Documentation and whole-suite verification.** `README.md`, then all four suites plus
   `next build`.

## Risks carried into tasks

| Risk | Where it bites | Mitigation, as a task |
|---|---|---|
| Prisma's default `onDelete` for a required relation is `Restrict` | Adding `GitCommitTicket` would silently break deleting any ticket that has a commit link | Explicit `onDelete: Cascade` **and** a regression test that deletes such a ticket (R7) |
| 100 KB body limit vs. a backfill | An unchunked backfill fails, and today it fails as `500 "Unexpected error"` | 50-commit batch cap plus the `413` mapping (R2) |
| Merged-and-dirty branch reported as `UNCOMMITTED` | The branch renders yellow when D5 says grey | Precedence stated in the tool description and the plugin instructions, plus a `branchColor` test for rule 2 before rule 3 (R4) |
| A merged branch's commits being folded into the trunk | Breaks D8/FR-024; history rewrites itself | `branchId` never updated on re-sync, with a test; `buildRepoTree` test for a merged branch keeping its lane |
| Assuming a frontend `typecheck` or `lint` script exists | A task that cannot run, or a type gate believed to have run when it did not | Every frontend type claim goes through `next build` (R10) |
| Non-deterministic geometry | Tests that pass locally and flake elsewhere | Explicit tie-breaks on `sha` and branch name, plus a determinism test (R11) |
