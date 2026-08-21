# Approved Design — View repo: a graphical tree of the repository history

Status: APPROVED by human partner (2026-08-21)
Bridge version: 3.1.0
Classification: architectural (a new screen plus a data subsystem that does not exist today)

## Original feature idea

> Agrega la siguiente feature. En el proyecto: al lado del botón que dice crear un
> nuevo ticket que exista otro botón que diga view repo. Al hacer click ahí se entra
> en una pantalla que permite ver en forma de árbol la rama main de git y todas las
> ramas creadas a modo de historia. La representación debe ser gráfica por lo tanto
> debe representar un árbol la línea principal de main y las branches creadas; cada
> branch tendrá un círculo pequeño que representará cada commit realizado. Al hacer
> click en el círculo muestra una ventana modal con los tickets commiteados, los
> archivos que lo componen y la fecha y por supuesto la descripción del commit. Al
> hacer click en el branch muestra una ventana modal con todos los tickets y archivos
> que van en ese branch y la descripción pertinente. Si la rama ya fue mergeada con
> main se mostrará en color gris, si es activa o sea que todavía se está trabajando se
> mostrará en verde. La main se mostrará en azul. Si la rama no está commiteada va en
> amarillo, cuando se pushea a main y se mergea pasa a gris. El árbol se mostrará de
> izquierda a derecha y existirá una barra en la parte inferior para poder desplazarla.

Restated: the project board gains a `View repo` button that opens a read-only screen
drawing the repository's branch/commit history as a left-to-right graphical tree, with
per-commit and per-branch detail modals and a four-colour branch state scheme.

## Findings from project exploration that constrain the design

These are facts verified in the repository during brainstorming, not assumptions:

1. The button next to which `View repo` must sit is labelled **`Add ticket`**, in the
   project board header at `frontend/src/app/(app)/projects/[id]/page.tsx`, alongside a
   `View backlog` link. `View repo` is a third control there.
2. **Nothing in the stack can read a git repository today.** There is no `git` shell
   invocation, no `simple-git` / `isomorphic-git` / `nodegit` dependency in `backend/`,
   `mcp/`, `plugin/` or `frontend/`, and `docker-compose.yml` mounts no repository into
   the backend container.
3. The only git data in the database is `Project.gitRepoUrl` (a string) and
   `Ticket.gitBranch` (a mirror of the branch the agent reported). The Prisma schema
   states the rule explicitly: there is no generator and no read-time derivation; the
   only writer is the agent. There are **no** commit, file, or merge-state tables.
4. The frontend has **no graph/chart library** — its only UI dependency is `@dnd-kit/core`.
5. The frontend has **no typecheck or lint script**. `next build` is the only type gate.
6. Constitution v1.0.0 (ratified 2026-08-15) requires: frontend is an HTTP consumer only
   and never a second write path (I); TypeScript plus tests for every behaviour change
   (II, non-negotiable); single-tenant posture preserved and no implied per-user
   isolation (III); no silent failures in plugin code (IV); a committed Prisma migration
   for any schema change; README updated for user-visible behaviour.

## Branch topology decision (approved)

Cut the canonical feature branch from **`main`**. Explicit human decision on 2026-08-21:
the `View repo` control lives in the project board header, not in the ticket branch block
that features 002 and 003 introduced, so 004 does not depend on them and must not become
a third stacked branch. Features 002 and 003 remain pushed and unmerged; 004 merges
independently.

## Decisions explicitly approved by the user

### D1 — Scope stays whole, spanning four modules

The feature touches `backend/` (schema, migration, routes), `mcp/` (a new tool),
`plugin/` (agent instructions) and `frontend/` (screen, tree, two modals). The user was
offered a split into 004 (data pipeline) + 005 (visual screen) and **chose to keep it as
one feature**. Tasks must be ordered so the backend is verified before the SVG work
starts.

### D2 — The agent is the source of the git history

A new MCP tool, `sync_git_history`, carries repository state the agent reads locally
(`git log`, `git status`, `git branch --merged`) into the backend. This follows the
existing rule that governs `gitBranch`: the agent is the only writer.

Rejected alternatives (see below) were the forge API and a locally mounted repository.

### D3 — Reporting is explicit, not hook-driven

The agent syncs deliberately — the `ticket-sync` skill instructs it to sync on commit and
on branch change. A hook shelling out to git on every tool use was rejected as heavy and
prone to silent failure, which constitution principle IV forbids.

### D4 — A full one-time backfill is in scope

An import walks `git log --all` once and loads the history that already exists (`main`,
`001`, `002`, `003`, their commits, files and merge points). It runs on the developer's
machine, where the repository is. Without it the screen ships empty and delivers no value
for weeks.

### D5 — Four branch colours, with an explicit precedence rule

The original idea contained a contradiction: a newly created branch with no commits is
both *active* (green) and *not committed* (yellow). Resolved as:

| Colour | State | Rule |
|---|---|---|
| Blue | `main` | The trunk is always blue, regardless of anything else |
| Yellow | uncommitted | The branch has uncommitted working-tree changes, or has no commit of its own yet |
| Green | active | Has commits, not merged into `main` |
| Grey | merged | Has been merged into `main` |

**Precedence:** merged wins over everything; `main` is always blue; otherwise dirty →
yellow, else green.

**Push is not a state.** The user's phrase "cuando se pushea a main y se mergea pasa a
gris" is treated as describing the transition, not a fifth colour. Consequence accepted by
the user: branches `002` and `003`, currently pushed but unmerged, render **green**.

Yellow is a local, volatile state that only exists while the agent reports it — which is
precisely why the forge API was rejected.

### D6 — Data model: four new tables

- `GitBranch` — name, project, is-trunk flag, originating branch, state
  (`UNCOMMITTED` / `ACTIVE` / `MERGED`), last-synced timestamp.
- `GitCommit` — sha, message, author, date, pushed flag, merge-commit flag, and **parent
  SHAs**. Parents are what allow fork and merge edges to be drawn truthfully.
- `GitCommitFile` — path and change type (`A` / `M` / `D` / `R`).
- `GitCommitTicket` — explicit commit ↔ ticket link.

A committed Prisma migration is required.

### D7 — File list is capped at 500 per commit

At most 500 files are stored per commit, with a truncation marker. The modal reports "and
N more files" rather than being unbounded on a very large commit.

### D8 — Commit-to-branch attribution never moves

A commit is attributed to the branch it was introduced on (first parent) and is **never
reassigned**, including when that branch is merged into `main`. History therefore does not
rewrite itself and each lane keeps its circles.

### D9 — Commit-to-ticket links, with honest inference

The agent reports the tickets for each commit, since it knows which ones it touched. When
no explicit report exists — the backfill case — the link is inferred by branch (tickets
whose `gitBranch` matches) and **the modal says so**: marked as inferred by branch. An
inference is never presented as reported data.

### D10 — Rendering is hand-rolled SVG

No new dependency. The geometry lives in a pure, separately testable function, apart from
the component — the same pattern as `frontend/src/lib/branchUrl.ts` from feature 003.

## Functional behaviour approved

- A `View repo` button in the project board header, next to `View backlog` and
  `Add ticket`, styled like `View backlog` (which is already a link).
- A new route `/projects/[id]/repo`.
- `main` renders as a horizontal blue line, left to right. Each branch is a lane below it,
  starting at its fork commit and, when merged, rejoining `main`.
- Each commit is a small circle in its lane, coloured by its branch's state.
- The tree scrolls horizontally, with a scrollbar along the bottom.
- Clicking a commit circle opens a modal with the commit description, date, committed
  tickets and files.
- Clicking a branch lane or label opens a modal with all of that branch's tickets, files
  and description.
- The header shows a **last-synced** timestamp. The screen is a mirror, not the truth.
- When the project has never been synced, an empty state explains how to sync instead of
  showing a blank canvas.

## Rejected alternatives and trade-offs

- **Forge API (GitHub/GitLab) as the source** — rejected: it cannot see uncommitted work,
  making the yellow state impossible; it would require storing a token in the database;
  it needs outbound network from a product the README declares localhost-only; and
  commit-to-ticket linking would depend on parsing commit messages.
- **Reading a locally mounted repository from the backend** — rejected: the backend runs
  in Docker with no repository mounted, it would need per-machine mounting, and it would
  give the backend command execution over arbitrary filesystem paths, colliding with
  constitution principle III.
- **Splitting into 004 (data) + 005 (screen)** — offered and declined by the user; 004
  alone would produce nothing visible.
- **A git-graph rendering library** — rejected: a new frontend dependency against a
  constitution-pinned stack, for geometry that is a few dozen lines of SVG.
- **A fifth colour for "pushed but not merged"** — not requested; deliberately out of scope.

## Edge cases discussed

- A branch that exists with no commits of its own → yellow (D5).
- A branch both merged and dirty → merged wins; grey (D5 precedence).
- A commit with thousands of files → stored list capped at 500 with a truncation marker (D7).
- A merged branch's commits → keep their original lane, not reassigned to `main` (D8).
- Backfilled commits with no explicit ticket report → inferred by branch and labelled as
  inferred (D9).
- A project that has never been synced → empty state with sync instructions.
- Data staleness in general → surfaced as a last-synced timestamp rather than hidden.

## Architecture constraints agreed

- The screen is **read-only**. It is not a second write path; the backend remains the
  single source of truth (constitution I).
- No tokens and no filesystem paths are stored in the database. Sync uses the existing
  agent authentication path (constitution III).
- Single-tenant posture is preserved; the screen must not imply per-user isolation or
  ownership that does not exist.
- New code is TypeScript with tests (constitution II).
- The schema change ships with a committed Prisma migration.
- `README.md` gains a section for the new user-visible behaviour.

## Success / acceptance criteria

1. The project board header shows a `View repo` control that opens `/projects/[id]/repo`.
2. After a backfill on this repository, the screen draws `main` plus the existing feature
   branches, each commit as a circle in its lane, left to right, horizontally scrollable.
3. Branch colours follow D5, including its precedence rule; `002` and `003` render green
   in their current pushed-but-unmerged state.
4. Clicking a commit circle opens a modal showing that commit's description, date, files
   and tickets.
5. Clicking a branch opens a modal showing that branch's tickets, files and description.
6. A commit whose ticket links were inferred rather than reported is labelled as inferred.
7. A project that has never been synced shows an explanatory empty state, never a blank
   canvas or fabricated data.
8. The last-synced timestamp is visible on the screen.

## Testing expectations

- TDD across all four modules, with `vitest` in each (`npm test`).
- The lane-geometry function and the branch-colour state machine are tested as pure
  functions, without rendering.
- Backend routes are tested with `supertest`, following the existing route-test pattern.
- **The frontend has no typecheck script**; `next build` is the only type gate. Plan and
  tasks must state this explicitly rather than assume a script exists.

## Open questions

None. All questions raised during brainstorming were resolved and are recorded above as
D1–D10.

## References

- No Superpowers design document was written; this feature was brainstormed in the main
  conversation and this file is the design record.
- Predecessor features: `specs/002-ticket-git-branch-view` (introduced `Ticket.gitBranch`),
  `specs/003-copy-branch-url` (introduced `frontend/src/lib/branchUrl.ts`).
