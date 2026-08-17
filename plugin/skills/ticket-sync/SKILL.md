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
