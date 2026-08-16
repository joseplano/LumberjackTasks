# Phase 0 Research: Completion Column & Automatic Board Sweep

**Feature**: `specs/001-terminal-column-sweep` | **Date**: 2026-08-15

All decisions below were taken against the code as it exists today. File references are to the current repository, and each rejected alternative names the concrete cost that rejected it.

---

## R1. How does a ticket represent "completed / off the board"?

This is the load-bearing decision. `Ticket.columnId` is currently a required, non-nullable relation, so today no ticket can exist outside a column.

**Decision: make `Ticket.columnId` nullable, and define `columnId IS NULL` to mean exactly "completed / off the board".**

**Rationale**

- **One field, one meaning.** Constitution Principle I requires a single source of truth and warns that duplicated rules drift silently. With a nullable `columnId`, the question "is this ticket on the board?" has exactly one answer in exactly one place. There is no second flag that can disagree with the first.
- **No backfill.** The migration is `ALTER COLUMN "columnId" DROP NOT NULL`. Every existing row keeps its column and therefore stays on the board, which is precisely what FR-007 demands (existing projects behave as they do today until someone opts in).
- **It fixes `deleteColumn` for free.** `deleteColumn` refuses with `409 COLUMN_NOT_EMPTY` based on `prisma.ticket.count({ where: { columnId } })`. Completed tickets have a null `columnId`, so they are not counted, and the completion column can be deleted normally after a sweep. The alternative below actively breaks this.
- **It matches the ordering rule cleanly.** `validateParentMove` compares column `position` values. A completed ticket has no position, which maps directly onto FR-011a ("completed ranks after every column"): absent position is treated as later than every column, so a completed subticket never appears in the `behind` set, and restoring a ticket to any column is always a backward move and therefore always allowed.
- **Reporting code is untouched.** `reports.ts` and `metrics.ts` aggregate over `projectId` with no column filter at all, so FR-019b (work-aggregate numbers must not move) is satisfied without changing a line of them. This is verified, not assumed — see `backend/src/services/reports.ts` and `backend/src/services/metrics.ts`. Note the numbers are not *all* frozen even though the code is: `transitionsReport()` counts `TicketStatusHistory` rows, and FR-020 requires one per swept ticket, so `mostChanges` grows by design. That is the boundary FR-019b draws and FR-019c pins.

**Cost accepted**

- `backend/src/services/backlog.ts` has `include: { column: true }` and derives `status: t.column.name`. Its `TicketRow` type and its status derivation must both handle a null column. This is a known, contained change in one file.
- `moveTicket` currently throws `500 INTERNAL 'Ticket column missing'` when the current column cannot be found. That branch stops being an internal error and becomes the legitimate "restoring a completed ticket" path.
- The domain must guarantee that a null `columnId` can arise only from a sweep. `createTicket` always assigns a column and `updateTicket` rejects `columnId` outright, so the only writer is the new sweep. This invariant must be stated in code and covered by a test.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Keep `columnId` required, add a separate `completedAt`/`onBoard` flag | Two fields would describe one thing: a completed ticket would still point at the Done column while claiming not to be on the board. Every "on the board" query would then need to remember a second predicate, and forgetting it is a silent wrong-answer bug — the exact failure mode Principle I exists to prevent. It also breaks `deleteColumn`: the completion column would still count completed tickets and report `409 COLUMN_NOT_EMPTY` for a column the user can plainly see is empty. |
| A hidden per-project "archive" column that swept tickets are moved into | Contradicts the spec's explicit finding that off-the-board is a ticket state, not a column. It would appear in `listColumns`, in `getProject().columns`, in the MCP `manage_columns list` output and in `reorderColumns` validation (which requires `orderedIds` to contain exactly the project's column ids), so every one of those would need a special case — more special-casing than the nullable column it was meant to avoid, plus a fake row in the data. |
| A separate `completed_tickets` table that rows are moved into | Loses the ticket id, breaks `TicketStatusHistory` and `parentTicketId` foreign keys, and makes the backlog a union query. Enormously more expensive for no benefit. |

**Recovering which column a ticket completed in**: not stored on the ticket, and not needed. A project has at most one completion column (FR-002), and `TicketStatusHistory.fromColumnName` records the column name at the moment of the sweep. Nothing is lost.

---

## R2. Where does the completion designation live, and how is "at most one per project" guaranteed?

**Decision: add `isCompletionColumn Boolean @default(false)` to `KanbanColumn`, and enforce uniqueness with a Postgres partial unique index, not with application code alone.**

```sql
CREATE UNIQUE INDEX "kanban_columns_projectId_completion_key"
  ON "kanban_columns" ("projectId")
  WHERE "isCompletionColumn" = true;
```

**Rationale**

- Putting the flag on the column is what FR-004 asks for: the designation must be part of what is returned whenever columns are listed. `listColumns`, `getProject().columns` and the MCP `manage_columns list` output all carry it with no additional query or join.
- The partial unique index makes the invariant true at the database level, as the planning input required. Application code that clears the previous designation and sets the new one inside a single transaction is the *mechanism*; the index is the *guarantee*.
- The guarantee is not theoretical. Under PostgreSQL's default READ COMMITTED isolation, two concurrent "designate this column" transactions can each read a state with no designation, each clear nothing, and each set their own — leaving two designated columns. This codebase already documents an awareness of exactly this class of race: see the comment in `backend/src/services/backlog.ts` explaining that two concurrent `createPhase` calls can read the same `_max.position`. The same reasoning applies here, so the same defensive posture is warranted.

**Known caveat, with mitigation**: Prisma's schema language cannot express a partial (filtered) unique index, so the index exists only in the hand-written `migration.sql`. A future `prisma migrate dev` that regenerates migrations from the schema will not know about it and could drop it. Mitigations: (a) the repository already writes migrations by hand — `backend/prisma/migrations/20260709_phases/migration.sql` is hand-authored SQL — so this is the established pattern, not a deviation; (b) add an integration test that attempts to designate two columns of one project concurrently and asserts the second fails, so the guard's disappearance breaks the suite loudly; (c) record the index in a comment in `schema.prisma` next to the field.

**Alternative considered**: `Project.completionColumnId` as a nullable foreign key to `KanbanColumn`. This gets at-most-one by construction with no partial index, and FR-005 (deleting the column clears the designation) falls out of `onDelete: SetNull`. Rejected because it puts the attribute somewhere the column listing does not naturally reach: `listColumns` returns bare column rows, and the settings UI and the MCP tool both read that endpoint, so both would need the project fetched and the flag stitched in. It also introduces a second relation between `Project` and `KanbanColumn`, which Prisma requires to be explicitly named and which makes the cascade semantics harder to read. The requester's own framing — "cuando configuro una columna debería agregarle un atributo a la columna" — describes an attribute of the column.

FR-005 is still satisfied under the chosen design: the flag lives on the column row, so deleting the column deletes the flag with it, and the designation cannot migrate to another column.

---

## R3. Where is the sweep triggered, and how does it stay atomic?

**Decision: trigger inside the existing `moveTicket` transaction in `backend/src/services/moves.ts`, in a dedicated `services/sweep.ts` module, and serialize per project with a row lock taken only when it is actually needed.**

`moveTicket` is already the single write path for column changes (`updateTicket` rejects `columnId` with `400 VALIDATION`), it already runs in `prisma.$transaction`, already writes `TicketStatusHistory`, already calls `logAudit`, and already publishes its SSE event after commit. Every structural need of the sweep is already present there. Putting the sweep anywhere else would create a second write path, which Principle I forbids.

**Atomicity (FR-014)**: the sweep runs inside the same transaction as the move that triggered it. If any part fails, the move rolls back too, so the board is exactly as it was and the caller is told. There is no intermediate state in which some tickets left the board and others did not.

**Concurrency (spec Edge Cases)**: three distinct hazards, and only one of them is fixed by a conditional statement.

| Hazard | Cause | Fix |
|---|---|---|
| Half-sweep | Sweep spread over several statements, one fails | Same transaction as the move; a single `UPDATE ... WHERE` for the sweep itself |
| Double-sweep | Two moves both decide to sweep | The second finds nothing left to sweep and updates 0 rows — harmless, but the audit and event must be emitted only when rows were actually swept |
| **Missed sweep** | Two moves into the completion column commit concurrently; under READ COMMITTED each sees the other's ticket still in its old column, so neither considers the board complete and neither sweeps | **Not** fixed by a conditional statement. Requires serialization. |
| **Sweep vs. concurrent delete** | `deleteTicket` (`backend/src/services/tickets.ts`) runs in its own transaction and takes no project lock, so a delete can land while a sweep is in flight | Safe in both orders, but the *record* must not lie — see below |

The missed sweep is the one that violates SC-002 ("in 100% of cases"), and it is invisible — the board simply sits there full of Done cards. The fix is a `SELECT ... FROM projects WHERE id = $1 FOR UPDATE` taken at the start of the move transaction, which serializes concurrent moves within a single project.

Crucially, that lock is taken **only when the project has a completion column and the move targets it**. Projects that have not opted in pay nothing, and even opted-in projects only serialize on the final move of a batch.

**Why contention is not a practical concern — checked, not assumed.** The claim rests on three facts about this repository as it stands, each verifiable by inspection rather than on optimism about usage:

1. **There is no bulk or batch move path.** Every write route in `backend/src/routes/` acts on a single entity; the only writer of `columnId` is `POST /tickets/:id/move`, one ticket per request. No endpoint can issue a burst of moves, so the arrival rate is bounded by discrete interactive actions — a person dragging one card, or an agent issuing one `move_ticket` call.
2. **The lock's scope is one project row and its duration is one move transaction**, which performs a bounded, small number of statements and no external I/O. It cannot be held across a request boundary or a user's think-time.
3. **The worst realistic case is the case the lock exists for.** Contention requires two actors moving tickets into the *same project's* completion column at the same instant — precisely the missed-sweep scenario. Serializing those two moves is the intended behavior, not collateral cost.

If a bulk-move capability is ever added, this justification expires and the locking strategy must be re-evaluated; that dependency is recorded here so the re-evaluation is not forgotten.

**The sweep-vs-delete hazard in full.** Because a delete does not take the project lock, it may interleave with a sweep. Both orders are safe: a ticket deleted before the sweep's `UPDATE` executes is simply not swept, because it no longer exists; a ticket swept first is afterwards deleted as an ordinary completed ticket, which `deleteTicket` handles unchanged since it filters by ticket id and never by column. The board cannot be corrupted either way. The real risk is a **record that disagrees with reality**: if the audit entry's `ticketCount` and `ticketIds` were taken from the condition-evaluation `SELECT`, a ticket deleted in between would be reported as swept when it was not. Therefore the audit payload MUST be derived from the rows the `UPDATE` actually affected, not from any earlier read (spec FR-021a). A concurrent delete that empties the last non-completion column does not trigger anything, consistent with the narrow-trigger reading.

**Alternatives considered**: `isolationLevel: 'Serializable'` on the move transaction, rejected because it would require serialization-failure retry logic (`40001`) in a code path that currently has none, and would apply the cost to every move in the system rather than to the narrow case that needs it. A conditional single-statement sweep with no lock, rejected because — as the table shows — it silently leaves the missed-sweep hazard in place.

---

## R4. Should `GET /projects/:projectId/tickets` stop returning completed tickets?

**Decision: no. The default response stays exactly as it is today (every ticket of the project). Add an optional `placement` query parameter, and have the board pass `placement=board`.**

`placement` accepts `board` (tickets in a column), `completed` (tickets swept off the board) and `all` (default, current behavior).

**Rationale**

- FR-019a is a requirement about the *board*, not about the endpoint. The board is satisfied by passing one parameter.
- Silently changing the default would change the meaning of the published MCP tool `list_tickets` ("List a project's tickets"), and the constitution treats breaking a published MCP tool contract as a breaking change requiring a MAJOR review. There is no reason to incur that when a parameter costs nothing.
- The two callers are known and few: `frontend/src/app/(app)/projects/[id]/page.tsx` (the board, which will pass `placement=board`) and `mcp/src/tools/tickets.ts` (`list_tickets`, which gains an optional passthrough so an agent can ask for a board-only view).

**Alternative considered**: default the endpoint to board-only and let anyone who wants completed tickets opt in. Rejected for the contract-breakage reason above. The residual risk of the chosen option — a future board-like consumer forgetting the parameter and showing completed cards — is mitigated by the parameter being named for what it means and by board tests asserting the exclusion.

---

## R5. What does the move endpoint return when the move triggers a sweep?

**Decision: keep returning the moved ticket, and add an additive optional `sweep` summary. Document that the returned ticket's `columnId` will be `null` when a sweep fired.**

**Requirements this serves** (so it is not an orphan design): FR-014, which requires the outcome of a sweep-triggering move to be *reported to whoever triggered it* — a caller that cannot tell a sweep from a failure has not been told; FR-017, which requires identical results for a person and an agent, where the person learns what happened from the board refreshing (FR-022) and the agent, having no live-update stream, can only learn it from this response; and FR-004a, which requires an agent to drive the board through the same surface a person uses.

This is not cosmetic. Today `moveTicket` returns the updated ticket row; after a sweep that row has `columnId: null`, so a caller who moved a ticket into Done gets back a ticket that is in no column. Without an explanation that reads as a bug. The additive `sweep: { columnId, columnName, ticketCount } | null` tells the caller what happened and why, and gives the agent — which has no SSE stream — the feedback a human gets from the board refreshing.

The field is additive, so no existing consumer breaks.

---

## R6. How is the sweep transition recorded in per-ticket history?

**Decision: write one `TicketStatusHistory` row per swept ticket, with `fromColumnName` = the completion column's name and `toColumnName` = the reserved literal `Completed`.**

`TicketStatusHistory.toColumnName` is a plain non-null `String`, so a marker value is the only option without a schema change, and a schema change here would be gratuitous. `Completed` is chosen because it is what a human reading a ticket's history or the transitions report should see.

**Known cosmetic collision**: a project may legitimately name a column "Completed", making a history row ambiguous to a reader. This is acceptable because these two fields are display data only — `reports.ts` surfaces them in `longestTransition` and nothing anywhere branches on their value. The authoritative structured record of a sweep is the audit entry (R7), which carries ids rather than names.

`tokensDelta` and `timeDelta` are left null for sweep rows: a sweep consumes nothing.

---

## R7. Audit and live-update signals

**Decision**:

- Audit, one entry per sweep (not per ticket): `action: 'board.swept'`, `entityType: 'project'`, `entityId: <projectId>`, `detail: { completionColumnId, completionColumnName, ticketCount, ticketIds }`, attributed to the user whose move triggered it (FR-021).
- Audit for designation changes: `column.completion_set` and `column.completion_cleared` on `entityType: 'kanban_column'`, matching the existing `column.created` / `column.renamed` / `column.reordered` / `column.deleted` naming.
- One SSE event per sweep: `publishEvent({ type: 'board.swept', projectId })`, emitted after the transaction commits, exactly like every existing publisher in this codebase.

`frontend/src/lib/useLiveEvents.ts` debounces for 200 ms and reloads the affected view wholesale on any event for the project, so a single project-scoped event fully satisfies FR-022 and one-event-per-ticket would be pure waste. This is the clarification recorded in the spec, confirmed against the code.

---

## R8. Optimistic board updates

**Decision: when a move response carries a non-null `sweep`, the board discards its optimistic local state and refetches.**

`frontend/src/lib/moveTicketLocally.ts` applies a single-ticket move to local state. A sweep changes every ticket on the board at once, which that helper cannot express and should not be taught to express. A refetch is correct, simple, and happens exactly once per batch — at most once per completed batch of work, so the cost is irrelevant.

---

## Resolved unknowns

No `NEEDS CLARIFICATION` markers remain. Every question raised by the Technical Context was answered above from the repository as it stands, and each answer names the file it was checked against.
