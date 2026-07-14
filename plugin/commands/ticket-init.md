---
description: Link this repo to a project in the Lumberjack Tasks system, so work here is tracked as tickets.
---

# Link this repo to the Lumberjack Tasks system

Opt this repository in to ticket tracking. Idempotent — safe to run twice.

## Steps

1. **Check the stack is reachable.** The MCP tools are `mcp__plugin_lumberjack-tasks_lumberjack-tasks__*` (load them with ToolSearch if not yet loaded). Call `list_projects`.
   - If it fails, the backend/MCP is down. Tell the user to start it (`docker compose up -d` in the Lumberjack Tasks repo, or set `LUMBERJACK_TASKS_MCP_URL` if their stack is hosted elsewhere) and **stop here** — do not write a mapping against a backend you could not reach.

2. **Resolve the project.** Use the `lumberjack-tasks:ticket-sync` skill, step 1 of its workflow: match an existing project against this repo's name, confirm a plausible match with the user, or ask before creating a new one. Never create a project without the user confirming the name.

3. **Write the mapping** to `.claude/ticket-project.json`:

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

4. **Ignore the session state files.** Append to the repo's `.gitignore` (create it if absent), unless already present:

   ```
   .claude/.session-state.json
   .claude/.session-tokens-state.json
   ```

5. **Confirm to the user:** the repo is now linked to project `<name>`, the mapping takes effect on the next session start, and from now on new work here is tracked as tickets.
