# Quickstart: validating the ticket branch mirror

**Feature**: 002-ticket-git-branch-view

How to prove this feature works end to end once it is implemented. Every command is
repository-authoritative — none is invented for this document.

## Prerequisites

- Node ≥ 20 and a reachable PostgreSQL 16 (or `docker compose up -d`).
- `backend/.env`, `mcp/.env`, `frontend/.env.local` derived from the committed `*.env.example`.
- Dependencies installed in `backend/`, `frontend/`, and `mcp/`.

## 1. Apply the schema change

```bash
cd backend
npx prisma migrate deploy
```

Expected: the new migration `20260816_ticket_git_branch` is applied. Existing tickets keep every
value they had; their `gitBranch` is `NULL`. No backfill runs.

## 2. Verify the migration is honest about the schema

```bash
cd backend
npx prisma validate
npx prisma migrate diff \
  --from-config-datasource \
  --to-schema ./prisma/schema.prisma \
  --exit-code
```

Run this **after** step 1, because it works by comparing the database the migrations just
produced against the schema they claim to produce. Expected: `validate` succeeds, and
`migrate diff` prints `No difference detected` and exits `0`. Exit code `2` means differences
were found — the schema and the migrations disagree, which the constitution prohibits.

Flags are those of the installed Prisma **7.8.0** CLI, confirmed with
`npx prisma migrate diff --help`. Three notes for anyone porting a Prisma 6-era command:

- `--to-schema-datamodel` is now `--to-schema`.
- `migrate diff` has no `--shadow-database-url` option in Prisma 7; the source and destination
  are chosen entirely with `--from-…` / `--to-…`.
- `--from-migrations ./prisma/migrations` cannot be used in this repository. Its migrations are
  hand-authored and carry no `migration_lock.toml`, so the CLI aborts with
  `Could not determine the connector from the migrations directory (missing migration_lock.toml)`.
  `--from-config-datasource` reads the datasource from `backend/prisma.config.ts` and gives the
  same guarantee here, because step 1 applied the migration history to that database.

No new environment variable is introduced by this feature, so no `*.env.example` entry is owed.
`migrate diff` is read-only and writes to no datasource.

Then read the new `migration.sql` and confirm it contains exactly one `ALTER TABLE "tickets" ADD
COLUMN` and **no** `CONSTRAINT`, `REFERENCES`, `INDEX`, or `UPDATE` statement. A foreign-key
statement would mean a referential action was rewritten — see data-model.md.

## 3. Run the automated suites

```bash
cd backend  && npm test
cd ../mcp   && npm test
cd ../frontend && npm test
cd ..       && node --test plugin/tests/*.test.mjs
```

The backend suite applies the migration itself through `tests/globalSetup.ts`, so a migration
that does not apply cleanly fails here rather than in production.

## 4. Typecheck and build

```bash
cd backend && npm run build     # tsc
cd ../mcp && npm run build      # tsc
cd ../frontend && npm run build # next build
```

Expected: all three succeed. This is what proves the three new fields line up across the
backend response, the shared frontend types, and the components that read them.

## 5. Manual end-to-end walkthrough

Start the stack (`docker compose up -d`, or each package's `npm run dev`), then:

### 5.1 A ticket with a reported branch

1. Through the agent tools, update a ticket with `branch` set to `002-ticket-git-branch-view`.
2. Open that ticket in the board UI.

Expected: a highlighted block sits directly under the title, showing a branch icon, the branch
in a monospaced typeface, and a copy button. Pressing copy puts the exact text on the clipboard
and shows `Copiado`. **(SC-001)**

### 5.2 A ticket with no reported branch

Open any ticket never touched by the agent.

Expected: the block reads `Sin rama aún` in muted text. Nothing that looks like a branch name
appears anywhere in the view. **(SC-002)**

### 5.3 Inheritance

1. Report a branch on a parent ticket only.
2. Open one of its subtickets.

Expected: the parent's branch is shown with a muted `(heredada de #<parent number>)`. **(SC-003)**

3. Now report a different branch on that subticket and reopen it.

Expected: the subticket's own value is shown, with no inheritance marker. **(SC-004)**

### 5.4 Board chip

Look at the board.

Expected: cards for tickets with an effective branch carry a compact chip; cards without one
carry nothing at all. A long branch is truncated with an ellipsis and the full value appears on
hover. **(SC-008)**

### 5.5 Validation and clearing

Through the agent tools:

| Send | Expect |
|---|---|
| `branch: "feature/has space"` | `400 VALIDATION`; nothing stored; previous value intact **(SC-006)** |
| `branch: "bad..name"` | `400 VALIDATION` |
| `branch: "/leading"` or `"trailing/"` | `400 VALIDATION` |
| `branch: "x.lock"` | `400 VALIDATION` |
| a 256-character value | `400 VALIDATION` |
| `branch: ""` | stored value cleared; the ticket shows `Sin rama aún` **(SC-007)** |
| `branch` omitted entirely | stored value unchanged |

### 5.6 Read-only in the UI

Open the ticket edit form and the create form.

Expected: no branch field anywhere. There is no path by which a person can set or change the
value. **(SC-010)**

### 5.7 The mirror stays true

On a repository checked out on a known branch, have the agent start work on a ticket following
its normal `ticket-sync` workflow.

Expected: the ticket ends up displaying that exact branch, without anyone typing it. In detached
HEAD state, the agent reports nothing and the stored value is left alone.

### 5.8 Nothing else moved

Compare a project's reports and metrics before and after reporting branches on several tickets.

Expected: identical figures. No total, count, or duration changes — branch reporting feeds no
report. **(SC-009)**
