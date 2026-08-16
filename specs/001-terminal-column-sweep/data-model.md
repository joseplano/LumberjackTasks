# Phase 1 Data Model: Completion Column & Automatic Board Sweep

**Feature**: `specs/001-terminal-column-sweep` | **Date**: 2026-08-15

Two field changes, one index, no new tables. Decisions and their justification are in [research.md](./research.md) (R1, R2).

---

## Schema changes (`backend/prisma/schema.prisma`)

### `KanbanColumn` — new field

| Field | Type | Default | Notes |
|---|---|---|---|
| `isCompletionColumn` | `Boolean` | `false` | At most one `true` per `projectId`, enforced by a partial unique index (below). |

Unchanged: `id`, `projectId`, `name`, `position`, the `project` relation, the `tickets` relation.

### `Ticket` — one field becomes optional

| Field | Before | After |
|---|---|---|
| `columnId` | `String` (required) | `String?` |
| `column` | `KanbanColumn` (required relation) | `KanbanColumn?` |

Nothing else on `Ticket` changes. `parentTicketId`, `phaseId`, `labelId`, `tokensConsumed`, `developmentTimeMinutes`, `number` and the `@@unique([projectId, number])` constraint are all untouched.

The existing foreign key keeps its default `onDelete` behavior — column deletion continues to be governed by `deleteColumn`'s explicit `409 COLUMN_NOT_EMPTY` guard, which now naturally ignores completed tickets because their `columnId` is null.

---

## The central invariant

> **`Ticket.columnId IS NULL` means exactly, and only, "this ticket is completed and off the board".**

Nothing else in the domain may produce a null `columnId`. This holds today by construction and must keep holding:

- `createTicket` always resolves a column, falling back to the lowest-position column and throwing `409 NO_COLUMNS` when the project has none.
- `updateTicket` rejects `columnId` outright with `400 VALIDATION`.
- `moveTicket` is the only path that writes `columnId`, and the sweep is the only writer that sets it to null.

An integration test must assert that no ordinary create/update path can leave a ticket with a null column, so that a future change which breaks the invariant fails the suite rather than corrupting the board's meaning.

**If the invariant is ever breached anyway** — by a future code path, a hand-run statement or a restore from a bad backup — the required behavior is *uniform treatment, not special handling*: a ticket with a null `columnId` is treated as completed by every consumer, everywhere, with no exception. It is excluded from the board, listed in the backlog with the completed marker and the `completed` flag, counted in every report and metric, ranked after every column for parent ordering, and restorable by an ordinary move. No consumer may special-case it, attempt to infer a "real" column for it, or treat it as an error condition.

This is deliberate and follows from the invariant rather than adding to it: because `columnId IS NULL` *means* completed, a ticket that acquires a null column by any route has, by definition, become completed. The cost of a breach is therefore bounded — a ticket appears finished when it should not, and an operator can put it back on the board — instead of being a crash, a partially-rendered board, or a ticket that exists in the data but appears nowhere. The guarding test above is what keeps this a contingency rather than a routine path.

**Derived reading of the invariant**, used throughout:

| Predicate | Meaning |
|---|---|
| `columnId IS NOT NULL` | On the board, in that column |
| `columnId IS NULL` | Completed, off the board, still fully part of the project |

---

## Migration

New directory `backend/prisma/migrations/<timestamp>_completion_column_sweep/migration.sql`, hand-written in the style of the existing `20260709_phases/migration.sql`.

It must contain, in order:

1. `ALTER TABLE "kanban_columns" ADD COLUMN "isCompletionColumn" BOOLEAN NOT NULL DEFAULT false;`
2. `ALTER TABLE "tickets" ALTER COLUMN "columnId" DROP NOT NULL;`
3. The partial unique index:

   ```sql
   CREATE UNIQUE INDEX "kanban_columns_projectId_completion_key"
     ON "kanban_columns" ("projectId")
     WHERE "isCompletionColumn" = true;
   ```

**No data backfill is required or permitted.** The column default gives every existing column `false`, so no existing project has a completion column and none can be swept until an operator opts in — which is FR-007 exactly. Every existing ticket keeps its non-null `columnId` and therefore stays on the board.

**The migration is forward-safe but not blindly reversible.** Reverting step 2 would fail while any completed ticket exists, since those rows have a null `columnId`. This is expected and should be noted in the migration file itself rather than discovered in production.

Because Prisma's schema language cannot express a filtered unique index, step 3 exists only in this SQL file. Add a comment beside `isCompletionColumn` in `schema.prisma` pointing at it (see research.md R2 for the full mitigation).

---

## State transitions

A ticket has exactly two placement states.

```text
                    move into completion column,
                    and it was the last ticket on the board
   ON BOARD  ───────────────────────────────────────────────►  COMPLETED
  (columnId = X)                   sweep                       (columnId = NULL)
       ▲                                                              │
       │                    move to any column                        │
       └──────────────────────────────────────────────────────────────┘
                               restore (FR-023)
```

| Transition | Trigger | Writes |
|---|---|---|
| On board → on board | `POST /tickets/:id/move` | `columnId`, a `TicketStatusHistory` row, a `ticket.moved` audit entry |
| On board → completed | The sweep, inside the triggering move's transaction | `columnId = NULL` for every ticket in the completion column, one `TicketStatusHistory` row each, one `board.swept` audit entry for the whole sweep |
| Completed → on board | `POST /tickets/:id/move` on a completed ticket | `columnId`, a `TicketStatusHistory` row with `fromColumnName = 'Completed'`, a `ticket.moved` audit entry |

There is no transition into `COMPLETED` other than the sweep, and no way to delete a ticket by sweeping it (FR-015).

---

## Ordering semantics (FR-011a)

`validateParentMove(targetPosition, currentPosition, subticketPositions)` in `backend/src/services/ticketRules.ts` compares column `position` integers. Completed tickets have no position, and the spec defines completed as ranking **strictly after every column**.

| Situation | Required behavior |
|---|---|
| A subticket is completed, parent moves forward | The completed subticket is later than every column, so it is never "behind" and never blocks the parent. |
| The ticket being moved is completed (a restore) | It is coming from later than every column, so every restore is a backward move, and backward moves are already unconditionally allowed. |
| Both parent and subtickets on the board | Unchanged from today. |

Implementation note for the tasks phase: the callers gather positions via `include: { column: { select: { position: true } } }`, which now yields `null` for completed subtickets. Whatever representation is chosen for "after every column" — filtering nulls out of `subticketPositions`, or mapping them to `Number.POSITIVE_INFINITY` — must be covered by unit tests in `backend/tests/unit`, since `validateParentMove` is already a pure function tested there.

---

## Consumers that must change because `columnId` became nullable

Enumerated so none is missed. Each was checked against the current source.

| File | Why it is affected | Required change |
|---|---|---|
| `backend/src/services/backlog.ts` | `TicketRow` types `column` as non-null and `toItem` reads `t.column.name` for `status` | Type `column` as nullable; derive `status` as the column name when on the board and the completed marker when not; add a `completed: boolean` to `BacklogItem` so FR-019 distinguishability does not depend on parsing a string |
| `backend/src/services/tickets.ts` | `listTickets` returns every ticket; `getTicketDetail` includes `column` | Support the `placement` filter (research.md R4); tolerate a null `column` in the detail payload |
| `backend/src/services/moves.ts` | Looks up the current column and throws `500 INTERNAL 'Ticket column missing'` when absent | That branch becomes the legitimate restore path; add the sweep call after the move, inside the same transaction |
| `backend/src/services/ticketRules.ts` | `validateParentMove` assumes every position exists | Apply the ordering semantics above |
| `backend/src/services/columns.ts` | `deleteColumn` counts tickets by `columnId`; `renameColumn` is the natural home for the designation change | Counting needs no change (null `columnId` is excluded by the equality predicate); add designation set/clear, transactional and audited |
| `backend/src/services/reports.ts`, `backend/src/services/metrics.ts` | Aggregate by `projectId` with no column predicate | **No change.** Verified. Cover with a regression test asserting the work-aggregate numbers are identical across a sweep (FR-019b), plus one asserting `transitionsReport()` grows by exactly one transition per swept ticket, since it counts history rows and FR-020 adds them (FR-019c) |
| `frontend/src/lib/types.ts` | Mirrors the API shapes | `KanbanColumn.isCompletionColumn: boolean`; `Ticket.columnId: string \| null`; `BacklogItem.completed: boolean` |
| `mcp/src/tools/management.ts`, `mcp/src/tools/tickets.ts` | Expose columns and ticket listing to the agent | Pure passthrough for the designation and for `placement`; no rule logic (Principle I) |

---

## Entities that do not change

`Project`, `Label`, `Phase`, `User`, `ProjectCodeCounter`, `AuditLog` and `TicketStatusHistory` keep their current shape. The sweep writes new *rows* into `AuditLog` and `TicketStatusHistory` but needs no new *columns* in either — see research.md R6 and R7 for the values written and for the one cosmetic caveat about the reserved `Completed` marker.
