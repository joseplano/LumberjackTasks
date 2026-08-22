# Quickstart: proving "View repo" works

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

How to verify the feature end to end. Every command below is one that exists in this repository —
none is invented. Where a gate does not exist, that is stated rather than worked around.

---

## Prerequisites

- Node ≥ 20 and PostgreSQL 16, or `docker compose up -d` (publishes PostgreSQL on `127.0.0.1:5434`,
  backend `:4000`, frontend `:3000`, MCP `127.0.0.1:5000`).
- `backend/.env`, `mcp/.env` and `frontend/.env.local` derived from the committed `*.env.example`
  files. **This feature adds no new setting**, so nothing new needs configuring.
- A Lumberjack Tasks project mapped to this repository via `.claude/ticket-project.json`.

---

## 1. Schema and migration gates

```bash
cd backend
npx prisma validate
```

Expected: the schema is valid. Fails if a relation, enum or attribute is malformed.

```bash
cd backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
```

Expected: **exit code 0** — the committed migration and `schema.prisma` describe the same database.
A non-zero exit is drift, which constitution Principle V prohibits.

`SHADOW_DATABASE_URL` must point at an empty, disposable database. With the compose stack running,
an unused database on `127.0.0.1:5434` serves. **If no disposable database is available on this
machine, record that the check could not run — do not report it as passed.** Section 2 is then the
weaker remaining evidence, because it catches missing tables and columns but not differing
referential actions.

---

## 2. Backend suite

```bash
cd backend && npm run build && npm test
```

`npm run build` (`tsc`) is the backend type gate. `npm test` runs vitest; `tests/globalSetup.ts`
applies the migration with `npx prisma migrate deploy` first, so the suite exercises the real
migrated schema.

Must include, and must be watched for specifically:

- `POST …/git-history/sync` applied twice with the same batch leaves every count unchanged (FR-026,
  SC-010).
- A commit re-reported under a different branch keeps its original `branchId` (FR-024, D8).
- A batch of 51 commits, or 501 files on one commit, is rejected `400 VALIDATION` — not trimmed.
- A body over 100 KB returns `413 PAYLOAD_TOO_LARGE`, **not** `500 INTERNAL` (FR-020).
- A ticket id from another project is rejected `400 VALIDATION` naming the id, not skipped.
- **Deleting a ticket that has commit links still succeeds**, and removes only the links. This is
  the regression test for research R7 — without an explicit `onDelete: Cascade`, Prisma would have
  defaulted the required relation to `Restrict` and broken existing ticket deletion.
- A project with no branches returns `200` with `{ lastSyncedAt: null, branches: [], commits: [] }`,
  not `404` (FR-029).
- A commit with no reported ticket links returns branch-matched tickets, each with
  `source: "inferred"`; a commit with reported links returns them all as `source: "reported"`
  (FR-025, D9).

---

## 3. MCP suite

```bash
cd mcp && npm run build && npm test
```

Confirms `sync_git_history` is registered, that its `zod` schema rejects a bad `state`, a bad
`changeType`, a malformed `sha`, more than 50 commits and more than 500 files, and that a backend
error surfaces as `CODE (HTTP nnn): message` rather than a success-shaped result.

---

## 4. Plugin suite

Read the "Cómo está armado el plugin, y las cuatro trampas" section of `docs/ticket-sync.md`
**before** touching anything under `plugin/` — constitution Principle IV requires it.

```bash
node --test plugin/tests/*.test.mjs
```

The glob form is required. `node --test plugin/tests` fails with `MODULE_NOT_FOUND` on Windows and
is not a substitute.

---

## 5. Frontend suite and type gate

```bash
cd frontend && npm test
cd frontend && npm run build
```

`npm run build` (`next build`) is **the only type gate the frontend has**. There is no `typecheck`
script and no `lint` script in `frontend/package.json`; do not attempt to run them.

Unit tests that must exist and must pass:

- `branchColor` — all six `isTrunk × state` combinations asserted individually, including
  `{ isTrunk: true, state: 'MERGED' } → 'blue'` (FR-011) and
  `{ isTrunk: false, state: 'MERGED' } → 'grey'` even against a dirty tree (D5 precedence).
- `buildRepoTree` — column ordering with a date tie; lane assignment with the trunk not first in
  the input; a fork edge across lanes; a merge edge from a second parent; a merged branch keeping
  its own lane; a dangling parent sha producing no edge and no throw; a branch with no commits; empty
  input; and identical output across two calls.

---

## 6. End-to-end walkthrough on this repository

1. Start the stack: `docker compose up -d`, or run the three packages locally.
2. **Backfill** (D4). Ask the agent to sync this repository's history for the mapped project. It
   runs `git log --all` with `--name-status`, chunks at 50 commits, and calls `sync_git_history`
   until the history is loaded, per `plugin/skills/ticket-sync/SKILL.md`.
3. Open `http://localhost:3000/projects/<id>` and confirm a **View repo** control sits in the header
   beside **View backlog** and **Add ticket** (FR-001, SC-001).
4. Click it. Confirm `/projects/<id>/repo` opens and draws (FR-002):
   - `main` as one horizontal blue line, oldest commit leftmost (FR-004, FR-010 rule 1);
   - `001-terminal-column-sweep`, `002-ticket-git-branch-view`, `003-copy-branch-url` and
     `chore/ignore-mcp-bot-password` each in their own lane below it (FR-005);
   - each of those four **grey**, because all four are merged into `main` as of 2026-08-21
     (FR-010 rule 2). See the spec's Assumptions: the approved design's illustration of `002` and
     `003` as green described a pushed-but-unmerged state that no longer holds;
   - `004-view-repo-git-tree` itself **green** — it has commits and is not merged. This is the
     green case available on this repository (SC-003);
   - one circle per commit, in its branch's colour (FR-008, FR-012);
   - fork and merge edges matching the real topology (FR-006, FR-007);
   - a horizontal scrollbar along the bottom (FR-009);
   - a last-synced timestamp in the header (FR-028, SC-008).
5. Click a commit circle. Confirm the modal shows the message, the date, the files and the tickets
   (FR-014, SC-004), and that backfilled commits show their tickets **marked as inferred by branch**
   (FR-016, SC-006).
6. Click a branch lane or label. Confirm the modal shows that branch's tickets, files and its
   description composed from name, state and commit messages (FR-015, SC-005).
7. To see **yellow**: make an uncommitted edit on a branch and sync again. That branch turns yellow
   (FR-010 rule 3). Commit and sync again; it returns to green. Yellow is local and volatile by
   design.
8. To see the **empty state**: open `/projects/<other-id>/repo` for a project that has never been
   synced. Confirm the explanation of how to sync — not a blank canvas (FR-029, SC-007).
9. To see the **error state**: stop the backend and reload. Confirm an error naming the reason, and
   that it is *not* the never-synced empty state (FR-033, SC-012).
10. **Sync twice** with nothing changed. Confirm the tree is identical and no count grew (FR-026,
    SC-010).
11. **Non-deletion**: delete a synced branch locally (`git branch -d …`) and sync again. Confirm it
    is still drawn, with its commits in the same lane (FR-032, SC-011).

---

## 7. Whole-suite gate before a pull request

Constitution Principle II requires all four suites to pass:

```bash
cd backend  && npm test
cd mcp      && npm test
cd frontend && npm test
node --test plugin/tests/*.test.mjs
```

Plus the type gates: `backend && npm run build`, `mcp && npm run build`,
`frontend && npm run build`.
