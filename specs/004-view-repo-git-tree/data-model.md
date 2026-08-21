# Phase 1 Data Model: View repo — a graphical tree of the repository history

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

Four new tables and two new enums. **No column on any existing table changes.** `Project` and
`Ticket` gain back-relation fields only, which Prisma requires to declare the relation and which
produce no SQL.

---

## Enums

### `GitBranchState`

| Value | Meaning |
|---|---|
| `UNCOMMITTED` | The branch has uncommitted working-tree changes, or has no commit of its own yet. |
| `ACTIVE` | The branch has commits of its own and has not been merged into the trunk. |
| `MERGED` | The branch has been merged into the trunk. |

The trunk is not exempt from carrying a state, but its state never affects its colour (FR-011).

**Reported, never derived by the backend.** The backend cannot see a working tree. It validates
the value against this enum and rejects anything else with `400 VALIDATION` (constitution
Principle I: the backend enforces what it can).

**Precedence is applied when reporting, not only when drawing** (FR-010, research R4): a branch
that is both merged and dirty is reported `MERGED`.

### `GitFileChange`

| Value | Meaning |
|---|---|
| `A` | Added |
| `M` | Modified |
| `D` | Deleted |
| `R` | Renamed |

Matches D6 and the letters `git diff --name-status` emits. A rename arrives from git as `R###`;
the score is discarded and only `R` is stored.

---

## `GitBranch` → table `git_branches`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Surrogate key; used in the branch-detail URL (research R12). |
| `projectId` | `String` | FK to `Project`. |
| `name` | `String` | The branch name as git reports it, e.g. `004-view-repo-git-tree`. |
| `isTrunk` | `Boolean @default(false)` | Reported by the agent. Checked before `state` when choosing a colour. |
| `forkedFromBranchName` | `String?` | Plain name, not a foreign key (research R5). `null` when unknown. |
| `state` | `GitBranchState` | Required; no default, so an omitted state is a validation error rather than a silent `UNCOMMITTED`. |
| `lastSyncedAt` | `DateTime` | Set by the backend on every sync that carries this branch. Not client-supplied. |

**Constraints**

- `@@unique([projectId, name])` — branch identity within a project (FR-026). This is what makes a
  re-sync an update instead of a duplicate.
- `project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)` —
  **explicit**; see research R7.

**Lifecycle**: created on first sync that mentions the branch; `state`, `isTrunk`,
`forkedFromBranchName` and `lastSyncedAt` updated on later syncs. **Never deleted by a sync**
(FR-032) — only by deleting the project.

---

## `GitCommit` → table `git_commits`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Surrogate key. |
| `projectId` | `String` | FK to `Project`; carries the `(projectId, sha)` identity of FR-026. |
| `branchId` | `String` | FK to `GitBranch` — the branch the commit was **introduced on**. |
| `sha` | `String` | Full 40-character hex object name. |
| `message` | `String` | Full commit message, subject and body. |
| `authorName` | `String` | Author display name. No email is stored; none is needed and it is avoidable personal data. |
| `committedAt` | `DateTime` | Commit date. Primary sort key for horizontal position. |
| `pushed` | `Boolean @default(false)` | Recorded per D6. **Never affects colour** (FR-013). |
| `isMerge` | `Boolean @default(false)` | True when the commit has more than one parent. |
| `parentShas` | `String[]` | Ordered; `parentShas[0]` is the first parent. Empty for the root commit. Source of every fork and merge edge (FR-007). |
| `truncatedFileCount` | `Int @default(0)` | Number of changed files **not** stored because the 500 cap was hit (FR-023). `0` means the stored list is complete. |

**Constraints**

- `@@unique([projectId, sha])` — a SHA appears at most once per project. This is what enforces
  D8/FR-024: a commit cannot be re-attributed by appearing under a second branch.
- `@@index([branchId])` — the tree query reads commits by branch.
- `project` and `branch` relations both `onDelete: Cascade`, **explicit** (research R7).

**Attribution rule (FR-024)**: `branchId` is set when the commit is first recorded and is
**never updated**, including when its branch is later merged into the trunk. A sync that reports
an already-recorded SHA under a different branch MUST leave `branchId` alone. This is an
invariant of the write path, not a hint — it needs its own test.

---

## `GitCommitFile` → table `git_commit_files`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Surrogate key. |
| `commitId` | `String` | FK to `GitCommit`. |
| `path` | `String` | Repository-relative path. For a rename, the new path. |
| `changeType` | `GitFileChange` | Required. |

**Constraints**

- `@@unique([commitId, path])` — makes a re-sync of the same commit idempotent (FR-026).
- `@@index([commitId])`.
- `commit` relation `onDelete: Cascade`, **explicit**.

**Cap (FR-023/D7)**: at most 500 rows per commit. The count of files beyond the cap lives in
`GitCommit.truncatedFileCount`, so the modal can say "and N more files" (FR-017) instead of
presenting a truncated list as complete. The cap is enforced **in the backend**, not only in the
agent's instructions: a batch carrying more than 500 files for one commit is rejected with
`400 VALIDATION` rather than silently trimmed, so the agent learns it must truncate and report
the remainder.

---

## `GitCommitTicket` → table `git_commit_tickets`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Surrogate key. |
| `commitId` | `String` | FK to `GitCommit`. |
| `ticketId` | `String` | FK to `Ticket`. |

**This table stores only links the agent explicitly reported.** Inferred links are never stored;
they are derived when read (research R6, D9, FR-025). There is deliberately no `inferred` column —
a row's existence *is* the claim that the link was reported.

**Constraints**

- `@@unique([commitId, ticketId])` — idempotent re-sync (FR-026).
- `commit` relation `onDelete: Cascade`, **explicit**.
- `ticket Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)` —
  **explicit and load-bearing**. This relation is required, and Prisma's default for a required
  relation is `Restrict`. Left implicit, this table would make deleting any ticket that has a
  commit link fail with a foreign-key error, silently breaking existing working behaviour. See
  research R7; a regression test is mandatory.

---

## Back-relations added to existing models

These add fields to the Prisma models but **no columns and no SQL** to the existing tables:

- `Project`: `gitBranches GitBranch[]`, `gitCommits GitCommit[]`
- `Ticket`: `commitLinks GitCommitTicket[]`

---

## Derived values — computed, never stored

| Value | Derived from | Requirement |
|---|---|---|
| Project last-synced timestamp | `max(GitBranch.lastSyncedAt)` across the project's branches | FR-028. Avoids touching the `Project` table at all. |
| "Never synced" | The project has zero `GitBranch` rows | FR-029. Distinct from "loaded, but empty". |
| Inferred ticket links | Tickets whose `gitBranch` equals the commit's branch name, used only when the commit has no reported link | FR-025, D9 |
| Branch colour | `(isTrunk, state)` through FR-010's ordered rules | FR-010, FR-011 |
| Lane index and commit coordinates | Branches, commits and `parentShas` | FR-004–FR-008 |
| Fork and merge edges | `parentShas` | FR-007 |

---

## Migration

One directory, `backend/prisma/migrations/20260821_git_history/`, containing a hand-written
`migration.sql` that creates two enum types, four tables, their unique constraints, their indexes
and their foreign keys with the `ON DELETE CASCADE` actions above. It matches the repository's
existing convention (`YYYYMMDD_snake_name`, hand-written SQL, no `migration_lock.toml`) and is
applied by `npx prisma migrate deploy` — in `backend/Dockerfile`'s `CMD` and in
`backend/tests/globalSetup.ts`. Committed with the code, per constitution Principle V.
