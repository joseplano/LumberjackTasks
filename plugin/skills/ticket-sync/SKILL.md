---
name: ticket-sync
description: Use when planning or starting any new feature, bugfix, refactor or task in this repo, when the user asks to track work in the ticket system, or when the session context says the repo has (or lacks) a Lumberjack Tasks project mapping.
---

# Ticket Sync (Lumberjack Tasks MCP)

## Overview

The Lumberjack Tasks system is the source of truth for work in this repo. Every substantive task gets a ticket (with subtickets per component) BEFORE implementation starts, and the tickets move through the board as the work progresses. The MCP tools are `mcp__plugin_lumberjack-tasks_lumberjack-tasks__*` (load them with ToolSearch if not yet loaded).

## Mapping file

`.claude/ticket-project.json` links this repo to a ticket project:

```json
{
  "projectId": "<uuid>",
  "projectName": "<name>",
  "standardLabels": {
    "feature": "#2563eb",
    "bug": "#dc2626",
    "refactor": "#7c3aed",
    "docs": "#059669",
    "test": "#d97706",
    "infra": "#6b7280"
  }
}
```

## Workflow

1. **Resolve the project.** Read `.claude/ticket-project.json`.
   - Present → verify it with `get_project` (ids can go stale if the DB was reset). Valid → use it.
   - Missing, invalid or stale → `list_projects` and search for a name matching the repo.
     - Plausible match → confirm with the user before adopting it.
     - No match → ask the user (AskUserQuestion): create a new project? Under what name? **Never call `create_project` without the user confirming the name.**
   - After resolving, write `.claude/ticket-project.json` so future sessions skip this step.
   - Also add `.claude/.session-state.json` and `.claude/.session-tokens-state.json` to the repo's `.gitignore` (create it if absent), unless already present — these are per-machine session state and should not be committed.
2. **Resolve labels.** `manage_labels action=list`.
   - Pick the existing label that matches the task type (case-insensitive match on name).
   - No match → offer to create the needed one from `standardLabels` (only the one this task needs, not the whole set). Create it after the user confirms — creating labels is a project-wide change. User declines → create the tickets without a label.
   - When both a project and a label need confirmation, bundle them into a single AskUserQuestion — one interruption, not two.
3. **Resolve the phase (optional).** For work that spans several tickets, group it under a phase:
   `manage_phases action=list` and reuse a matching phase, or create one with
   `manage_phases action=create name="<phase>"`. Pass its id as `phaseId` when creating the parent
   ticket. Subtickets inherit the phase from their parent — never pass `phaseId` on a subticket
   (the backend rejects it with `SUBTASK_PHASE`). Small one-off tasks need no phase.
4. **Create the tickets.** One parent ticket for the user-level task; one subticket per component or step (`create_ticket` / `create_subticket`).
   - Complexity is Fibonacci: 1, 2, 3, 5, 8, 13, 21.
   - Description: goal + chosen approach, in the user's language.
   - Apply the `labelId` resolved in step 2.
   - Apply the `phaseId` resolved in step 3, if any, to the parent ticket only.
5. **Keep the board in sync while working.** Move tickets with `move_ticket` as states change:
   - implementation starts → "In development"; tests running/passing → "In testing"; implemented + verified → "In Human review"; user approves → "Done"; committed to git → "Committed".
   - Register `timeDelta` (minutes actually spent) on moves, and **real token usage**: the SessionStart context gives you the exact token command for this repo (`node "<plugin>/scripts/session-tokens.mjs" --project-dir "<repo>" --consume`). Run it (Bash) right before the move — it returns the exact tokens spent since the last registration plus the `llmName` to pass as `tokensDelta`/`llmName`. Never guess the path: the script lives in the plugin, not in the repo. `--consume` zeroes the checkpoint, so each spend is registered exactly once; when working several tickets in one session, `--consume` at each ticket's registration move keeps the attribution per ticket.
   - For retroactive attribution, run that same command with `--since <ISO> --until <ISO>` instead of `--consume` (reads the transcript for that window; does not touch the checkpoint) and pass the result to `update_ticket`.
   - **Move all subtickets before the parent** — the backend rejects a parent moving ahead of any subticket. (`move_ticket` works for subtickets too; `move_subticket` is equivalent.)
   - **Report the git branch.** When moving a ticket into "In development", read the repo's current branch with `git rev-parse --abbrev-ref HEAD` (Bash) and pass it as `branch` on the `update_ticket` / `update_subticket` call that accompanies the move — `move_ticket` does not accept `branch`. Re-report it the same way whenever the branch changes during the work.
     - Report **only what the command printed**. Never invent, derive, slugify or "tidy" a branch name, and never build one from the ticket's title or number.
     - If the command outputs the literal `HEAD` (detached), report **nothing**: omit `branch` entirely and do not send a commit hash instead.

## Repository history sync

The **View repo** screen draws the repository's branches and commits as an SVG tree. It is fed by
`sync_git_history`, a mirror tool: it changes nothing in the repository, only records what the
repository already contains.

- **When to sync.** After committing, and after changing branch. Do this deliberately, as a normal
  step of the workflow above — never from a hook, since a hook shelling out to git on every tool
  use is heavy and would fail silently, which this skill's tools never do.
- **What to run.**
  - `git branch --format='%(refname:short)'` — the branches to report.
  - `git branch --merged main --format='%(refname:short)'` — which of them are merged (see state
    precedence below).
  - `git status --porcelain` — whether the **currently checked-out** branch's working tree is
    dirty.
  - `git log --format='%H|%P|%an|%aI|%s' --name-status <branch>` — commits for one branch, with
    parent SHAs (`%P`), author, ISO date, subject, and the changed files. `--name-status` emits one
    of `A`/`M`/`D`/`R` per file, which maps directly to `files[].changeType`.
  - `git log --all --format='%H|%P|%an|%aI|%s' --name-status` — the one-time backfill (D4): walks
    every branch's history in one pass instead of one branch at a time.
  - `git log --format=%H --branches --not --remotes` — the unpushed set, computed once per sync
    (see **Deriving `commits[].pushed`** below), not shelled out per commit.
- **Deriving `commits[].pushed`.** A commit is pushed when it is reachable from a remote-tracking
  ref. Run `git log --format=%H --branches --not --remotes` once per sync: it lists every commit on
  a local branch that no remote-tracking ref contains. `pushed` is `false` for a sha in that set,
  `true` for every other sha. This is accurate only as of the last `git fetch` — remote-tracking
  refs are a local cache, so a commit pushed from another machine reads as unpushed until the next
  fetch. That is a property of how git works, not a defect: the field is recorded for completeness
  (D6) and, per FR-013, being pushed is not a branch state and must never influence tree colour.
- **State precedence — merged is checked first.** For each branch:
  1. Listed by `git branch --merged main`? → `MERGED`, **even if `git status --porcelain` is
     non-empty**. Checking `git status` before the merged check gets a merged-and-dirty branch
     wrong.
  2. Otherwise, the working tree is dirty (`git status --porcelain` non-empty) **or** the branch
     has no commit of its own → `UNCOMMITTED`.
  3. Otherwise → `ACTIVE`.
  A working tree belongs to whichever branch is checked out, so **only the currently checked-out
  branch can ever be reported `UNCOMMITTED` from a dirty tree** — every other branch reaches
  `UNCOMMITTED` only by having no commit of its own. Do not try to ask git whether an un-checked-out
  branch is dirty; that information does not exist.
- **Batching.** Send at most 50 commits per `sync_git_history` call. Loop, calling it repeatedly,
  until the whole history (or the whole backfill) is loaded. A `413 PAYLOAD_TOO_LARGE` means send
  fewer commits in that call, not fewer files per commit.
- **First-parent attribution never moves (D8).** A commit belongs to the branch it was introduced
  on. If a commit's `sha` was already synced under one `branchName`, reporting it again under a
  different `branchName` will **not** move it — the backend keeps the original attribution and
  updates every other field. Re-running the backfill after new branches exist is safe for this
  reason.
- **The 500-file cap.** Report at most 500 `files` entries per commit; put the remainder in
  `truncatedFileCount` (0 when the list is complete — never omit it). Sending more than 500 files
  is rejected outright, not trimmed for you.
- **Every boolean and `parentShas` are required, always** — `branches[].isTrunk`,
  `commits[].pushed`, `commits[].isMerge`, and `commits[].parentShas` (`[]` for a root commit).
  Omitting one is read as new information, not "unchanged", so it can silently overwrite recorded
  truth on a later sync. Only `forkedFromBranchName`, `ticketIds` and `commits[].files` may be left
  out.
- **Tool name.** `mcp__plugin_lumberjack-tasks_lumberjack-tasks__sync_git_history` (load it with
  ToolSearch if not yet loaded, same as the other tools in this skill).

## Rules

- A repo with no `.claude/ticket-project.json` has not opted in, and the SessionStart hook stays silent there. Still use this skill when the user asks to track work or runs `/ticket-init` — step 1 resolves or creates the project and writes the mapping.
- Never create projects or labels without explicit user confirmation; creating tickets/subtickets for work the user already requested needs no extra confirmation.
- The user can opt out: if they explicitly say not to track this work in tickets, skip ticketing for that task (user instructions win) — but general impatience ("hacelo rápido") is not an opt-out.
- If the user declines creating a project, don't write the mapping file and skip ticketing for now; mention it can be set up later with this skill.
- If the MCP tools fail (server down), say so and continue the coding task — ticket sync must not block the work. List the pending ticket operations in your final message so the user (or a later session) can re-run the sync.
- Ticket and subticket names in the language the user speaks to you.

## Common mistakes

| Mistake | Fix |
|---|---|
| Implementing first, creating tickets at the end | Tickets are created at planning time, before code |
| Moving the parent ticket first | Subtickets first, then the parent |
| Creating the full standard label set upfront | Create only the label(s) the current task needs |
| Trusting a stale `projectId` from the mapping | Verify with `get_project` before using it |
| Passing `phaseId` on a subticket | Only top-level tickets carry a phase; subtickets inherit it |
| Inventing or deriving the branch name from the ticket | Read it from the repo with `git rev-parse --abbrev-ref HEAD` and report it verbatim |
