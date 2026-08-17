# Contract: MCP tools — ticket branch mirror

**Feature**: 002-ticket-git-branch-view
**File**: `mcp/src/tools/tickets.ts`

The MCP server is a thin pass-through to the backend. It adds **no** validation, **no**
inheritance logic, and **no** default value — constitution Principle I forbids it from becoming
a second write path or embedding rules the backend does not enforce.

## Tool names — unchanged

`list_tickets`, `create_ticket`, `update_ticket`, `move_ticket`, `create_subticket`,
`update_subticket`. No tool is renamed, added, or removed. Renaming any of these would be a
breaking change under the constitution's Runtime Contracts section.

## Input change

One field is added to the shared `ticketFields` object, which is already spread into
`create_ticket`, `update_ticket`, `create_subticket`, and `update_subticket`:

```ts
branch: z
  .string()
  .nullable()
  .optional()
  .describe(
    "The git branch this ticket is being worked on. Report the repository's actual current branch (git rev-parse --abbrev-ref HEAD); never invent or derive a name. Empty string or null clears it. Subtickets inherit the parent's branch when they have none of their own.",
  ),
```

Adding it to the shared object — rather than to two tools individually — is what gives
subtickets their own reportable value, as approved design decision 2 requires.

`move_ticket` and `move_subticket` do **not** gain the field; they use `moveFields`, and
reporting a branch is an update, not a move.

## Output change

`list_tickets` and the ticket read responses relay whatever the backend returns, so they gain
`gitBranch`, `effectiveBranch`, and `branchSource` with no code change beyond the backend's.
The MCP layer must not reshape, rename, or filter these fields.

## Explicitly forbidden in this layer

- Generating, suggesting, or completing a branch name (FR-025).
- Reading the local repository to discover the branch (FR-026) — that is the **skill's** job,
  performed by the agent through Bash, not the server's.
- Validating the ref format locally — the backend rejects malformed values; duplicating the
  rules here would let the two drift. The tool schema's `z.string().nullable().optional()` is a
  **type** declaration, not ref-format validation: it says what kind of thing `branch` is, which
  every MCP tool parameter must declare. The backend applies the same type guard independently
  (`contracts/rest-api.md` §Validation errors), so a direct REST caller cannot bypass it — which
  is exactly the Principle I split, not a duplicated rule.
- Computing inheritance — the backend supplies `effectiveBranch` already resolved.

## Behavioural expectations verified by `mcp/tests/tickets.test.ts`

1. `create_ticket` with `branch` forwards it in the POST body.
2. `update_ticket` with `branch` forwards it in the PATCH body.
3. `create_subticket` and `update_subticket` forward it too.
4. Omitting `branch` sends no `branch` key at all — absent must not become `null`, because the
   backend treats absent as "leave alone" and `null` as "clear".
5. A ticket read relays `gitBranch`, `effectiveBranch`, and `branchSource` unmodified.
6. A backend `400 VALIDATION` for a malformed branch surfaces as a tool error rather than a
   silent success.
