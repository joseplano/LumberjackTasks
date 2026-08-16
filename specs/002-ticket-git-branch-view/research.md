# Phase 0 Research: Git branch visible on ticket

**Feature**: 002-ticket-git-branch-view
**Date**: 2026-08-16

All unknowns below were resolved from repository evidence, the constitution, or the approved
design at `.specify/bridge/approved-design.md`. No unknown remained that required a product
decision.

---

## R1 — Where the effective branch is computed

**Decision**: Compute `effectiveBranch` and `branchSource` in the backend service layer
(`backend/src/services/tickets.ts`), never in the frontend and never in the MCP server.

**Rationale**: Constitution Principle I makes the backend the single source of truth and
forbids the MCP server from embedding domain rules the backend does not enforce. Inheritance is
a domain rule. Computing it in two places would let the board chip and the detail block
disagree. The frontend receives the answer, it does not derive it.

**Alternatives considered**:
- Compute in the frontend from the already-loaded ticket list — rejected: the list can be
  filtered to a single parent's subtickets (`parent=<id>`), so the parent row is often absent
  from the response, and the board would silently show an empty chip for tickets that do have
  an inherited branch.
- Compute in the MCP server — rejected outright by Principle I.

---

## R2 — Loading the parent's branch without an N+1 query

**Decision**: Extend the existing Prisma reads with a narrow parent selection:
`include: { parent: { select: { gitBranch: true, number: true } } }` on both
`listTickets` and `getTicketDetail`, then derive the two fields in a small pure helper.

**Rationale**: Prisma resolves a relation `include` for a `findMany` with one additional
batched query, not one query per row, so the list endpoint stays at two queries regardless of
ticket count. Selecting only `gitBranch` and `number` avoids pulling whole parent rows into a
response that already carries the full ticket set.

**Alternatives considered**:
- A second explicit query fetching all referenced parents and joining in memory — same query
  count, more code, no benefit.
- A raw SQL `LEFT JOIN` — rejected: Principle V's spirit (no ad-hoc SQL) and unnecessary here.
- Denormalising the parent's branch onto the subticket row on write — rejected: it would make
  the subticket's stored value ambiguous between "own" and "copied", which is precisely the
  distinction `branchSource` exists to preserve, and it would need a fan-out write whenever a
  parent's branch changes.

**Critical serialization constraint**: the loaded `parent` relation must be **consumed and
dropped**, never spread into the response. Returning the Prisma result verbatim would add a
`parent` object to every ticket in the public payload — a fourth added field that contradicts
`contracts/rest-api.md` and leaks an internal query decision into the API. The mapping step
must build the response explicitly rather than spreading the query result.

**Nested subtickets**: `getTicketDetail` also returns a `subtickets` array, and the shared
frontend `Ticket` type declares the three fields as required. Those nested objects therefore
need the fields too. No extra query is needed: for a subticket nested inside its own parent's
detail response, the parent's value is the enclosing ticket's `gitBranch`.

**Note on the pure helper**: the derivation is a two-line pure function over
`(own, parentBranch)`. Placing it in `backend/src/services/ticketRules.ts` — the module that
already holds ticket-level pure domain rules — keeps it unit-testable without a database.

---

## R3 — Prisma schema change shape and referential-action safety

**Decision**: Add `gitBranch String?` as a **scalar** column on `model Ticket`. Introduce no new
relation, no foreign key, no index, and no unique constraint.

**Rationale**: The approved design fixes this shape (nullable, no unique index, no backfill).
Because the column is scalar, this change introduces **no** `onDelete`/`onUpdate` referential
action, so the constitution's standing concern about Prisma's optionality-derived referential
defaults cannot bite here. That is a claim to be *verified*, not assumed — see the verification
gate below, because the existing `Ticket.column` relation carries an explicit
`onDelete: Restrict` whose comment in `schema.prisma` warns that Prisma's default depends on
optionality. A regenerated migration that silently rewrote that action would be a serious
regression in the completion-sweep behavior shipped by feature 001.

**Required verification** (technology gate, `prisma` + `database-migrations` profiles):
1. `npx prisma validate` — the schema parses and is internally consistent.
2. `npx prisma migrate deploy`, then `npx prisma migrate diff --from-config-datasource
   --to-schema ./prisma/schema.prisma --exit-code` must report **no drift** (`No difference
   detected`, exit code `0`) after the migration is authored. This is the schema-to-migration
   consistency check: deploy applies the migration history, and the diff then proves the
   resulting database is exactly what the schema describes.

   Flags verified against the installed Prisma **7.8.0** CLI (`prisma migrate diff --help`), not
   carried over from Prisma 6: `--to-schema-datamodel` is now `--to-schema`, `migrate diff` no
   longer takes `--shadow-database-url`, and `--from-migrations` is unusable in this repository
   because its hand-authored `backend/prisma/migrations/` has no `migration_lock.toml` — the CLI
   aborts with `Could not determine the connector from the migrations directory`. Adding a lock
   file purely to satisfy the check would be a schema-tooling change this feature has no mandate
   to make, and `--from-config-datasource` gives the same guarantee without it.
3. The authored `migration.sql` must contain exactly one `ALTER TABLE "tickets" ADD COLUMN`
   statement and **no** `DROP CONSTRAINT` / `ADD CONSTRAINT` / `ALTER ... REFERENCES` statement.
   Any foreign-key statement in the diff means a referential action was rewritten and the
   migration must be rejected.
4. The partial unique index `kanban_columns_projectId_completion_key`, which exists only in
   feature 001's `migration.sql` and cannot be expressed in the Prisma schema language, must
   still exist after applying the new migration. `prisma migrate diff` is blind to it by
   design, so it is asserted separately.

**Alternatives considered**:
- `String @default("")` instead of nullable — rejected: it destroys the "not reported yet"
  meaning that FR-002 requires and would make the empty state indistinguishable from a reported
  empty value.
- Adding an index on `gitBranch` — rejected as YAGNI: nothing queries or filters by branch
  (filtering by branch is explicitly out of scope), so an index would be pure write cost.

---

## R4 — Migration authoring and application

**Decision**: Author a new directory `backend/prisma/migrations/20260816_ticket_git_branch/`
containing a single `migration.sql`, matching the naming style already used by the three
existing migrations (`20260702_init`, `20260709_phases`, `20260816_completion_column_sweep`).

**Rationale**: Repository evidence — `backend/Dockerfile` runs `npx prisma migrate deploy`, and
`backend/tests/globalSetup.ts` runs the same command before the backend suite. This means the
migration is applied and therefore exercised on **every** backend test run against a real
PostgreSQL instance; a broken or drifting migration fails the suite rather than reaching a
user. It also means no separate manual verification step is needed to prove the migration
applies cleanly.

**Consequence for safety**: `ADD COLUMN ... NULL` on PostgreSQL 16 does not rewrite the table
and takes only a brief lock, so the migration is safe on a populated board. Rollback is a
`DROP COLUMN`, which loses only branch values — no other data depends on the column.

---

## R5 — Git reference validation

**Decision**: Implement the rejection rules exactly as enumerated in FR-009 as a pure function
in `backend/src/services/ticketRules.ts`, alongside `validateTicketData`, throwing the existing
`ApiError(400, 'VALIDATION', …)`.

**Rationale**: `ticketRules.ts` is already the home of pure ticket validation and is already
unit-tested at `backend/tests/unit/ticketRules.test.ts`, so the rules get cheap, database-free
coverage. `ApiError(400, 'VALIDATION')` is the code the approved design specifies and matches
how `tickets.ts` reports every other bad input.

**Scope note**: the rules are a deliberate, enumerated subset of `git check-ref-format`, not a
reimplementation of it. They reject what would obviously break a shell command or a URL and
cap length at 255. The system never executes the value, so the rules are input hygiene, not a
security boundary — the value is only ever displayed as text and copied to a clipboard.

**Ordering that matters**: trim first, then treat empty as a clear (FR-007, FR-008), then
validate. Validating before trimming would reject `" main "` for containing whitespace, which
contradicts FR-007.

**Alternatives considered**:
- Shelling out to `git check-ref-format` — rejected: the backend has no repository and no git
  binary guarantee, and it would introduce process execution on user-supplied input.
- Validating only in the MCP layer — rejected by Principle I; a direct REST caller would bypass
  it.

---

## R6 — Clipboard copy over a non-secure context

**Decision**: Try `navigator.clipboard.writeText` first; when it is unavailable or rejects, fall
back to a hidden textarea plus `document.execCommand('copy')`. Show the same `Copiado`
confirmation on either path.

**Rationale**: `navigator.clipboard` is gated on a secure context. The constitution's supported
deployment target is `localhost` **or a reverse proxy the operator controls** — the latter is
commonly plain HTTP on a LAN address, where `navigator.clipboard` is simply `undefined`. Without
the fallback, the copy button would be silently dead for a documented deployment mode, which
would fail FR-021 and SC-001. The approved design calls for this fallback explicitly.

**Alternatives considered**:
- `navigator.clipboard` only — rejected, see above.
- `execCommand` only — rejected: deprecated and blocked in some configurations; it is the
  fallback, not the primary.

---

## R7 — Which surfaces receive the new read fields

**Decision**: `GET /api/v1/tickets/:id` and `GET /api/v1/projects/:projectId/tickets` both return
`gitBranch`, `effectiveBranch`, and `branchSource`. Mutation responses
(`POST`/`PATCH`) return the stored ticket row and therefore carry `gitBranch` naturally; they
are not required to compute the derived pair.

**Rationale**: FR-015 requires the list to carry the derived fields because the board renders
cards from the list. Spec A-002 records that no consumer in this feature reads the derived pair
off a mutation response, so computing it there would be unused code.

**Compatibility**: every change is additive. No existing field is removed, renamed, or given a
new value, satisfying FR-016 and SC-009, and staying clear of the constitution's rule that
breaking a published endpoint or MCP tool shape is a MAJOR change.

---

## R8 — Reporting the parent number in the inherited marker

**Decision**: The detail view uses the parent number it **already loads** for the existing
"Parent: #n (view)" link. No new field is added to the read shape.

**Rationale**: The approved design fixes the read shape at three fields. The detail modal
already performs an auxiliary, failure-tolerant fetch of the parent to render the parent link,
holding the result in `parentNumber`. Reusing it satisfies FR-019 without contradicting the
design's three-field statement.

**Failure path**: that auxiliary fetch is explicitly allowed to fail (the existing code catches
and sets `parentNumber` to `null`). The spec's edge case therefore requires the marker to
degrade to `(heredada)` rather than render `#null`. The branch value itself is never withheld,
because it comes from the primary ticket response.

---

## R9 — Agent-side reporting in the plugin skill

**Decision**: Extend the existing step 5 of `plugin/skills/ticket-sync/SKILL.md` (the "keep the
board in sync while working" step) with an instruction to run `git rev-parse --abbrev-ref HEAD`
and pass the result as `branch` on the update that accompanies the move into "In development",
to re-report when the branch changes, and to report nothing when the command returns `HEAD`
(detached).

**Rationale**: This is the mechanism that makes the mirror true (FR-023, FR-024). Attaching it
to an existing step the agent already performs avoids adding a new ritual it might skip.
`git rev-parse --abbrev-ref HEAD` prints the literal string `HEAD` in detached state, which is
the exact, testable signal for "report nothing".

**Constitution constraints that apply** (Principle IV): `plugin/` must gain no runtime
dependency and no `node_modules`; this change is documentation text inside `SKILL.md`, so it
adds none. `plugin/.claude-plugin/plugin.json` must not gain a `skills` or `hooks` key — this
change does not touch that file. `docs/ticket-sync.md` must be read before changing anything
under `plugin/`, and the plugin suite must be run as `node --test plugin/tests/*.test.mjs`
(glob form; the directory form fails with `MODULE_NOT_FOUND` on Windows).

---

## R10 — MCP tool surface

**Decision**: Add `branch` to the shared `ticketFields` object in `mcp/src/tools/tickets.ts`, as
`z.string().nullable().optional()` with a description stating that the agent reports the
repository's current branch and that an empty value clears it.

**Rationale**: `ticketFields` is already shared by `create_ticket`, `update_ticket`,
`create_subticket`, and `update_subticket`. Adding the field there gives subtickets their own
reportable value in one edit, which is exactly what approved design decision 2 requires. No
tool is renamed and no existing input is changed, so no published tool name or shape breaks.

**Alternatives considered**:
- Adding `branch` only to the two top-level tools — rejected: it would make design decision 2
  ("subtickets may carry their own value when the agent sets one explicitly") unimplementable.
