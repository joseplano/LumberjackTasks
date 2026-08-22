# Contract: MCP tool `sync_git_history`

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

Registered in a new `mcp/src/tools/gitHistory.ts` and wired into `buildServer()` in
`mcp/src/server.ts`, alongside the existing project, ticket, management and report tool groups.
Packaged name: `mcp__plugin_lumberjack-tasks_lumberjack-tasks__sync_git_history`.

The tool is a **thin pass-through**. It validates shape with `zod`, calls
`POST /api/v1/projects/:projectId/git-history/sync` through the existing `apiFetch`, and returns
through the existing `run()` helper so a `BackendError` becomes a readable
`CODE (HTTP nnn): message`. It MUST NOT hold domain rules the backend does not enforce, and MUST
NOT open a database connection (constitution Principle I).

---

## Input schema

| Parameter | Type | Notes |
|---|---|---|
| `projectId` | `string` | The Lumberjack Tasks project this history belongs to. |
| `branches` | array | Each: `name` (string), `isTrunk` (boolean), `forkedFromBranchName` (string, nullable, optional), `state` (`"UNCOMMITTED" \| "ACTIVE" \| "MERGED"`). |
| `commits` | array, max 50 | Each: `sha`, `branchName`, `message`, `authorName`, `committedAt` (ISO 8601), `pushed` (boolean), `isMerge` (boolean), `parentShas` (string array), `files` (array of `{ path, changeType }`, max 500), `truncatedFileCount` (integer ≥ 0), `ticketIds` (string array, optional). |

`zod` enforces the enum values, the 50-commit and 500-file caps, and the 40-hex-character `sha`
so the agent gets a usable message before a request is made. Every other rule — identity,
idempotence, fixed attribution, trunk uniqueness, ticket ownership — is enforced by the backend
and only by the backend.

---

## Tool description text

The description the agent reads MUST state, in this order:

1. What it does: records the repository's branches and commits so the project's **View repo**
   screen can draw them. It is a mirror; it changes nothing in the repository.
2. **How to derive `state`, with the precedence spelled out** (FR-010, research R4):
   - merged into the trunk (`git branch --merged main` lists it) → `MERGED`, **even if the working
     tree is dirty**;
   - otherwise, uncommitted changes (`git status --porcelain` is non-empty) **or** no commit of its
     own → `UNCOMMITTED`;
   - otherwise → `ACTIVE`.
   The merged check comes first. Checking `git status` first gets a merged-and-dirty branch wrong.
   The dirty-tree test applies **only to the branch currently checked out** — a working tree
   belongs to the checked-out branch, so no other branch can be reported dirty. Other branches
   reach `UNCOMMITTED` only by having no commit of their own (research R4).
3. That `isTrunk` is true only for `main`, and only for one branch.
4. That commits must be sent in batches of at most 50, and that a `413 PAYLOAD_TOO_LARGE` means
   send fewer.
5. That reporting `ticketIds` is preferred; omitting them causes the screen to fall back to
   inferring tickets by branch and to label them as inferred.
6. That the tool is safe to call repeatedly — it updates in place and never deletes.

---

## Errors

`run()` already converts a `BackendError` into `isError: true` with `CODE (HTTP nnn): message`, so
`VALIDATION`, `NOT_FOUND` and `PAYLOAD_TOO_LARGE` all reach the agent with their reason intact.
The tool MUST NOT swallow an error or return a success-shaped result on failure — constitution
Principle IV forbids silent failure, and FR-020 requires a sync that cannot complete to say why.

---

## Plugin instructions

`plugin/skills/ticket-sync/SKILL.md` gains a **Repository history sync** section. It is
instructions only: no new plugin file, no new dependency, no change to
`plugin/.claude-plugin/plugin.json` (constitution Principle IV — declaring anything beyond
`mcpServers` there disables the plugin's MCP server, and the error message never mentions MCP).

The section must cover:

- **When to sync**: after committing, and after changing branch (D3). Deliberately, not from a
  hook — a hook shelling out to git on every tool use is heavy and fails silently, which
  Principle IV forbids.
- **What to run**: `git branch --format=…`, `git branch --merged main`, `git status --porcelain`,
  `git log --format=…` with `--name-status` for files, and `--all` for the one-time backfill (D4).
- **The state precedence**, repeated here so the agent does not have to infer it from the tool
  description alone.
- **Batching**: at most 50 commits per call; loop until the history is loaded.
- **First-parent attribution** (D8/FR-024): a commit belongs to the branch it was introduced on,
  and re-reporting it under another branch will not move it.
- **Truncation** (D7/FR-023): send at most 500 files for a commit and put the remainder in
  `truncatedFileCount`. Sending more is rejected, not trimmed.

Because this edits a file under `plugin/`, constitution Principle IV requires reading the "Cómo
está armado el plugin, y las cuatro trampas" section of `docs/ticket-sync.md` first, and running
`node --test plugin/tests/*.test.mjs` afterwards.
