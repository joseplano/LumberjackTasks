# Phase 1 Data Model: Git branch visible on ticket

**Feature**: 002-ticket-git-branch-view
**Date**: 2026-08-16

## Stored change

One column is added. Nothing else in the schema changes.

### `model Ticket` — new field

| Field | Type | Nullable | Default | Index | Meaning |
|---|---|---|---|---|---|
| `gitBranch` | `String?` | yes | none | none | The branch the agent last reported for **this** ticket. `null` means "the agent has not reported a branch yet" — never "empty" and never "unknown but derivable". |

Prisma declaration to add to `backend/prisma/schema.prisma`, inside `model Ticket`:

```prisma
/// Mirror of the branch the agent reported for this ticket. Written only
/// through the agent-facing write path; there is no generator and no
/// read-time derivation. null means "not reported yet" -- see
/// specs/002-ticket-git-branch-view/spec.md FR-002. Deliberately NOT unique:
/// one branch commonly hosts several tickets (FR-004).
gitBranch String?
```

### Referential actions — explicit statement

This change adds a **scalar** column. It introduces no relation, no foreign key, and therefore
**no `onDelete` or `onUpdate` action**. Prisma's optionality-derived referential defaults are
not engaged by this change.

The existing relations on `Ticket` MUST keep their current actions, byte for byte:

| Relation | Current action | Must remain |
|---|---|---|
| `project` | `onDelete: Cascade` | unchanged |
| `column` | `onDelete: Restrict` (explicit — a load-bearing comment in the schema explains that Prisma would otherwise infer `SetNull` and fabricate "completed" tickets) | unchanged |
| `label` | `onDelete: SetNull` | unchanged |
| `phase` | `onDelete: SetNull` | unchanged |
| `parent` | `onDelete: Cascade` | unchanged |

This is verified, not assumed — see research.md R3 and the migration checks in
`checklists/technology.md`.

### Migration

New directory: `backend/prisma/migrations/20260816_ticket_git_branch/migration.sql`

Content shape (one statement):

```sql
ALTER TABLE "tickets" ADD COLUMN "gitBranch" TEXT;
```

- **Backfill**: none. Every existing row becomes `NULL`, which is the correct meaning
  (FR-003).
- **Locking**: `ADD COLUMN` with no default and no `NOT NULL` does not rewrite the table on
  PostgreSQL 16.
- **Rollback**: `ALTER TABLE "tickets" DROP COLUMN "gitBranch";` — loses only reported branch
  values; no other data depends on the column.
- **Application**: `npx prisma migrate deploy`, already invoked by `backend/Dockerfile` and by
  `backend/tests/globalSetup.ts`, so the backend test suite applies and exercises it on every
  run.
- **Forbidden in this migration.sql**: any `CREATE/DROP INDEX`, `ADD/DROP CONSTRAINT`,
  `REFERENCES`, or `UPDATE` statement. Their presence means something other than this feature
  was captured and the migration must be rejected.

## Derived values (never stored)

Computed at read time by the backend from the ticket and its parent.

| Field | Type | Rule |
|---|---|---|
| `effectiveBranch` | `string \| null` | `ticket.gitBranch` if non-null; else `parent.gitBranch` if the ticket has a parent and that parent has a value; else `null`. |
| `branchSource` | `'own' \| 'inherited' \| null` | `'own'` when `ticket.gitBranch` is non-null; `'inherited'` when the value came from the parent; `null` when `effectiveBranch` is `null`. |

Truth table — the full space, since nesting is one level only:

| ticket.gitBranch | has parent | parent.gitBranch | effectiveBranch | branchSource |
|---|---|---|---|---|
| `"a"` | no | — | `"a"` | `own` |
| `null` | no | — | `null` | `null` |
| `"a"` | yes | `"b"` | `"a"` | `own` |
| `"a"` | yes | `null` | `"a"` | `own` |
| `null` | yes | `"b"` | `"b"` | `inherited` |
| `null` | yes | `null` | `null` | `null` |

Invariants that follow, and that tests assert directly:

- `branchSource === null` **iff** `effectiveBranch === null`.
- `branchSource === 'own'` **iff** `gitBranch !== null`.
- `branchSource === 'inherited'` implies `gitBranch === null` **and** the ticket has a parent.
- A parent ticket can never have `branchSource === 'inherited'` — there is nothing above it.

## Write-path rules

Applied in order. The order is load-bearing.

1. **Field absent from the request** → no change to the stored value. Absent is not the same as
   `null`.
2. **Type guard** (FR-010). The value arrives as untyped JSON, so after the absent and `null`
   short-circuits and **before** any string operation, reject anything that is not a string —
   a number, boolean, object, or array — with `400 VALIDATION` and the message
   `branch must be a string, null or absent`. This step is load-bearing and cannot be folded
   into step 5: `.trim()` on a non-string raises a `TypeError`, which would surface as a `500`
   rather than the validation failure FR-010 requires, and a `500` carries no guarantee about
   what was or was not written. Placing the guard before the trim keeps the FR-010 promise —
   a rejection stores nothing and leaves the previous value intact — true for every input a
   client can actually send, not only for well-typed ones.
3. **Trim** surrounding whitespace (FR-007).
4. **Empty after trimming** (including an explicit `null`) → store `null`, clearing the value
   (FR-008). No validation is applied to a clear.
5. **Validate** the trimmed value (FR-009). Reject with `400 VALIDATION` if it:
   - contains any whitespace character;
   - contains any of `~` `^` `:` `?` `*` `[` `\`;
   - contains the sequence `..` or the sequence `@{`;
   - contains an ASCII control character (`\x00`–`\x1F`, `\x7F`);
   - begins with `/` or ends with `/`;
   - ends with `.lock`;
   - is longer than 255 characters.
6. **Store** the trimmed value.

A rejection stores nothing and leaves the previous value intact (FR-010).

Validation lives in `backend/src/services/ticketRules.ts` so it cannot be bypassed by any
client (FR-011, constitution Principle I).

## Read shape

Both read endpoints return the three fields on every ticket object:

- `GET /api/v1/tickets/:id` — the ticket itself **and every element of its `subtickets` array**
  (the shared frontend `Ticket` type declares the fields as required, so omitting them on
  nested objects would make that type dishonest; the enclosing ticket is their parent, so no
  extra query is needed).
- `GET /api/v1/projects/:projectId/tickets` — every element of the list.

The parent relation loaded to compute the derived pair MUST be consumed and dropped, never
serialized. A `parent` object in the response would be an unintended fourth added field.

Mutation responses carry `gitBranch` because they return the stored row; they are not required
to compute `effectiveBranch`/`branchSource` (spec A-002, research.md R7).

## Entities NOT changed

`Project`, `KanbanColumn`, `Label`, `Phase`, `TicketStatusHistory`, `AuditLog`, `User`,
`ProjectCodeCounter` — untouched. No report, metric, or backlog projection reads the new
column; `projectMetrics` aggregates only `tokensConsumed`, `developmentTimeMinutes`, and a row
count, none of which this feature can move.
