# Phase 0 Research: View repo — a graphical tree of the repository history

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

Every finding below was verified against this repository. Product decisions D1–D10 come from
`.specify/bridge/approved-design.md` and are inputs here, not subjects of research.

---

## R1 — How repository data reaches the system

**Decision**: One new MCP tool, `sync_git_history`, carries a **batch** of repository state that
the agent read locally. The agent is the only writer, exactly as it is for `Ticket.gitBranch`.

**Rationale**: D2. Verified: nothing in `backend/`, `mcp/`, `plugin/` or `frontend/` can read a
git repository today — no `git` invocation, no `simple-git`/`isomorphic-git`/`nodegit`
dependency, and `docker-compose.yml` mounts no repository into the backend container. The agent
is the only participant that can see the working repository.

**Alternatives considered**: a forge API (rejected in D2 — cannot see uncommitted work, so the
yellow state becomes impossible; requires a stored token, which FR-027 forbids; needs outbound
network from a localhost-only product). Mounting the repository into the backend container
(rejected in D2 — per-machine mounting, and it would give the backend command execution over
arbitrary filesystem paths, colliding with constitution Principle III).

---

## R2 — Request size: the sync must be chunked

**Decision**: `sync_git_history` accepts one batch per call. The agent calls it repeatedly until
the history is exhausted. **Batch cap: at most 50 commits per call.** No global body limit is
changed.

**Rationale**: `backend/src/app.ts` sets `express.json({ limit: '100kb' })` globally. A single
commit is allowed up to 500 file paths (FR-023/D7); at a typical 40–60 bytes per path that is
25–30 KB for one commit alone, so an unchunked backfill of this repository would exceed the
limit and fail. Raising the limit — globally or for one route — weakens an existing
denial-of-service control, and constitution Principle III forbids weakening a listed control
without an explicit documented amendment. Chunking leaves every control intact and costs
nothing, because FR-026 already requires each batch to be idempotent.

**Consequence that must be built**: express's body parser raises `entity.too.large` on an
oversize body. `backend/src/middleware/errors.ts` currently recognises only `ApiError` and
Prisma `P2002`, so that condition would surface as `500 INTERNAL / "Unexpected error"` — a sync
failing without saying why, which FR-020 and constitution Principle IV forbid. The error handler
must map it to a `413` with a code the agent can act on.

**Alternatives considered**: raising `limit` for the sync route only (rejected — still weakens a
security control, and still has no upper bound on a large repository); having the MCP server read
the repository directly (rejected — the MCP server runs in Docker with no repository mounted, and
D2 already rejected this shape).

---

## R3 — Where the backfill lives

**Decision**: The backfill (D4) is the **same tool**, driven by instructions added to
`plugin/skills/ticket-sync/SKILL.md`: the agent runs `git log --all` with a machine-readable
format, chunks the result per R2, and calls `sync_git_history` until the history is loaded. No
new script and no new plugin file are added.

**Rationale**: D4 requires a one-time walk of `git log --all` on the developer's machine, which is
where the repository is; it does not require new runtime code. Reusing the sync tool means the
backfill exercises the same idempotent path (FR-026) that every later sync uses, so there is only
one write path to test. Constitution Principle IV makes any change under `plugin/` costly and
risky; adding zero files there is the cheapest correct option.

**Alternatives considered**: a zero-dependency `plugin/scripts/git-history-backfill.mjs` that
posts straight to the backend (rejected — it would need its own backend credentials, creating a
second write path and a new secret, against constitution Principles I and V). A backend-side
import (rejected — the backend cannot see the repository).

**Trade-off accepted**: a backfill of a large repository takes several tool calls and moves its
payload through the agent's context. For a self-hosted single-repository deployment this is a
one-time cost measured in a handful of calls.

---

## R4 — Deriving branch state, and where the precedence rule lives

**Decision**: The **agent** derives the `UNCOMMITTED` / `ACTIVE` / `MERGED` state from
`git status --porcelain`, `git branch --merged main` and `git rev-list`, and reports it. The
**backend** validates the value against the enum and stores it, without deriving it. The
**frontend** maps `(isTrunk, state)` to a colour in one pure function.

**Rationale**: D2 and D5. The backend cannot see a working tree, so it cannot derive the state; it
can and must reject an invalid one (constitution Principle I: domain invariants are enforced in
the backend). Splitting it this way keeps exactly one place per concern.

**The trap to encode explicitly**: FR-010's precedence must be applied *when reporting*, not only
when drawing. A branch that is both merged into the trunk and has uncommitted changes must be
reported `MERGED`, not `UNCOMMITTED` — a naive implementation checks `git status` first and gets
this backwards. The plugin instructions must state the order, and the sync contract must state it
too.

**A limit of the yellow state, worth writing down before someone tries to work around it**:
`git status --porcelain` reports the working tree, and a working tree belongs to the branch that is
checked out. **Only the currently checked-out branch can ever be reported `UNCOMMITTED` because of
a dirty tree.** Every other branch reaches `UNCOMMITTED` only through the other half of the rule —
having no commit of its own. This is not a gap to be engineered around (there is no honest way to
ask git whether an un-checked-out branch has uncommitted changes, because the concept does not
exist); it is what D5 means when it calls yellow "a local, volatile state that only exists while
the agent reports it". The plugin instructions must not imply otherwise.

**Trunk and the merged rule**: FR-011 makes the trunk blue unconditionally, so the frontend colour
function must check `isTrunk` before `state`. A defensive test must cover trunk reported as
`MERGED`; the function returns blue and must not crash or fall through.

---

## R5 — Modelling the fork/merge topology

**Decision**: Store each commit's **parent SHAs** as a scalar string array on the commit, and
derive fork and merge edges from them at draw time. Store the originating branch as a **plain
branch name** on the branch record, not as a self-referencing foreign key.

**Rationale**: D6 names parent SHAs and calls them what allows fork and merge edges to be drawn
truthfully; FR-007 requires the topology to come from them rather than from ordering. Making the
originating branch a self-relation would introduce an optional self-referencing foreign key, whose
Prisma default `onDelete` is decided by optionality (`SetNull`) — the exact hazard the existing
schema already warns about in the `Ticket.column` comment — and would force branches to be synced
in dependency order. A name is descriptive metadata; the drawn structure comes from parent SHAs
regardless, so nothing is lost. This matches how `Ticket.gitBranch` already stores a branch name.

---

## R6 — Ticket links: reported are stored, inferred are derived when read

**Decision**: The commit↔ticket table stores **only links the agent reported**. When a commit has
no reported link, the read path returns the tickets whose `gitBranch` matches the commit's branch
and marks them `inferred`. Every ticket association in an API response carries an explicit
`source` of `reported` or `inferred`.

**Rationale**: D6 calls the table the "explicit commit ↔ ticket link", and D9 requires an
inference never to be presented as reported data. Deriving at read time also avoids a direct
conflict with FR-032 (a sync never deletes recorded history): stored inferences would have to be
recomputed — that is, deleted and rewritten — on every re-sync. It is additionally more truthful,
because a ticket whose branch is set after the sync appears immediately instead of waiting for the
next one.

**Alternatives considered**: storing inferred rows with a flag (rejected — collides with FR-032
and goes stale between syncs).

**Note on the existing doctrine**: `backend/prisma/schema.prisma` states that `Ticket.gitBranch`
has "no generator and no read-time derivation". That rule governs the *stored* branch value, which
this feature does not derive. Presenting a derived association, clearly labelled as derived, is a
different thing and is what D9 asks for.

---

## R7 — Referential actions must be explicit on every new relation

**Decision**: Every new relation declares `onDelete` explicitly:

| Relation | Action | Why |
|---|---|---|
| `GitBranch → Project` | `Cascade` | Deleting a project removes its recorded history, as it already does for columns, labels, tickets and phases. |
| `GitCommit → Project` | `Cascade` | Same; this relation exists to carry the `(projectId, sha)` identity of FR-026. |
| `GitCommit → GitBranch` | `Cascade` | A branch record and its commits are one unit. Nothing else references them. |
| `GitCommitFile → GitCommit` | `Cascade` | Files have no meaning without their commit. |
| `GitCommitTicket → GitCommit` | `Cascade` | The link has no meaning without its commit. |
| `GitCommitTicket → Ticket` | `Cascade` | **Load-bearing.** This relation is required, and Prisma's default for a required relation is `Restrict`. Left implicit, adding this table would make deleting any ticket that has a commit link fail — silently changing existing, working behaviour. |

**Rationale**: Prisma's default `onDelete` depends on the relation's optionality (required →
`Restrict`, optional → `SetNull`). The existing schema already documents this hazard in the
`Ticket.column` comment and in `specs/001-terminal-column-sweep`. Relying on the default here
would let a schema change alter a product invariant that nobody wrote down.

**Verification required, not assumed**: a regression test must delete a ticket that has commit
links and assert that the delete still succeeds and removes only the links.

---

## R8 — Migration mechanics in this repository

**Decision**: Add one hand-written migration directory,
`backend/prisma/migrations/20260821_git_history/migration.sql`, and commit it with the code.

**Rationale**: verified conventions — migration directories here are named `YYYYMMDD_snake_name`
and contain a hand-written `migration.sql` (for example `20260816_ticket_git_branch/`); there is no
`migration_lock.toml`. Migrations are applied by `npx prisma migrate deploy`, both in
`backend/Dockerfile`'s `CMD` and in `backend/tests/globalSetup.ts`. Constitution Principle V makes
a committed migration mandatory and forbids drift.

**What this buys for verification**: because `backend/tests/globalSetup.ts` builds the test
database from the migrations while Prisma Client is generated from `schema.prisma`, any drift
between the two makes the backend suite fail loudly rather than quietly. That is a real gate, but
it is not a complete one — it catches missing columns and tables, not differing referential
actions. So it is a fallback, not a substitute for the checks in R9.

---

## R9 — Prisma verification commands available here

**Decision**: Three checks, in this order:

1. `cd backend && npx prisma validate` — the schema parses and is internally consistent.
2. `cd backend && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code` — proves the committed migration and the schema describe the same database. A non-zero exit means drift.
3. `cd backend && npm test` — applies the migration via `globalSetup` and exercises the routes against the real database.

**Rationale**: `prisma` 7.8 is a direct dependency of `backend/`, and `backend/prisma.config.ts`
points at `prisma/schema.prisma` and `prisma/migrations`, so all three run without new tooling.

**Fallback, stated honestly**: check 2 needs a disposable shadow database. The compose stack
publishes PostgreSQL on `127.0.0.1:5434`, so an empty database on that server can serve as the
shadow. If no disposable database is available on the machine running the check, the task must
record that fact rather than silently skip, and check 3 stands as the weaker evidence.

**Referential-action verification is separate**: no Prisma command proves that `onDelete: Cascade`
on `GitCommitTicket → Ticket` behaves as intended. Only the R7 regression test does.

---

## R10 — The frontend has no typecheck and no lint script

**Finding, verified**: `frontend/package.json` declares exactly `dev`, `build`, `start` and
`test`. There is **no `typecheck` script and no `lint` script**. `npm run build`
(`next build`) is the only type gate for frontend code, and `npm test` (vitest + Testing Library +
jsdom) is the only behavioural gate.

**Consequence for the plan**: any task that claims frontend type safety must run `next build`. No
task may invoke `npm run typecheck` or `npm run lint` in `frontend/` — those commands do not
exist and would fail as a missing script, which reads like a broken gate rather than a missing
one. By contrast `backend/` and `mcp/` both have `build` (`tsc`), which is their type gate.

---

## R11 — Drawing the tree without a new dependency

**Decision**: Hand-rolled inline SVG. Lane geometry lives in a pure function in
`frontend/src/lib/`, separate from the component, and is unit-tested without rendering.

**Rationale**: D10. Verified: `frontend/`'s only UI dependency is `@dnd-kit/core`; there is no
graph or chart library, and the constitution pins the frontend stack. `frontend/src/lib/branchUrl.ts`
from feature 003 is the precedent to follow — pure, total, no I/O, no module-level state, with its
contract rules referenced from the code comments.

**Determinism required for testability**: the geometry function must be a total function of its
input. Commits are ordered by commit date, ties broken by SHA; the trunk takes lane 0 and other
branches take lanes ordered by their earliest recorded commit, ties broken by branch name. Without
fixed tie-breaking the output is not assertable.

---

## R12 — Read API shape

**Decision**: Three read endpoints, so the tree payload stays small and the modals load what they
need on click:

- `GET /api/v1/projects/:projectId/git-history` — branches and commits **without** file lists.
- `GET /api/v1/projects/:projectId/git-history/commits/:sha` — one commit's files and tickets.
- `GET /api/v1/projects/:projectId/git-history/branches/:branchId` — one branch's aggregate.

**Rationale**: the tree needs every commit but no file paths; the modals need files for one commit
or one branch at a time. Sending 500 file paths per commit in the tree payload would make the
first paint pay for detail nobody has asked to see.

**Why the branch endpoint keys on id, not name**: branch names contain `/` (this repository has
`chore/ignore-mcp-bot-password`), which cannot travel in a single path segment without
double-encoding that proxies mangle. Commit SHAs are hex and are safe as a path segment.

---

## R13 — Non-functional targets

**Finding**: The approved design sets no performance, throughput or scale target, and none is
implied by the deployment. The supported target is a single self-hosted instance on `localhost`
(constitution Principle III) mirroring one repository per project.

**Decision**: No pagination, windowing or level-of-detail behaviour is specified or built, matching
the spec's Assumptions. The tree renders the whole recorded history. This is recorded as a known
boundary rather than left implicit, so that a future large-repository problem is recognised as new
work rather than as a defect in this feature.
