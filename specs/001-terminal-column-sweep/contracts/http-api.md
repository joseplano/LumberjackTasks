# Contract: Backend HTTP API changes

**Feature**: `specs/001-terminal-column-sweep` | **Base**: `/api/v1`, JWT required (mounted behind `requireAuth` in `backend/src/app.ts`)

Every change below is **additive**, with one exception: no existing request shape becomes invalid and no existing response field is removed or renamed, but `columnId` and the included `column` widen to nullable in every ticket-bearing response — including endpoints whose default behavior is otherwise unchanged (§3). A consumer that assumed non-null must handle it. Error envelope stays `{ error: { code, message } }` as produced by `backend/src/middleware/errors.ts`.

---

## 1. `GET /projects/:projectId/columns`

Existing endpoint. Each column object gains one field.

```jsonc
[
  { "id": "…", "projectId": "…", "name": "TODO",  "position": 0, "isCompletionColumn": false },
  { "id": "…", "projectId": "…", "name": "Done",  "position": 4, "isCompletionColumn": true  },
  { "id": "…", "projectId": "…", "name": "Committed", "position": 5, "isCompletionColumn": false }
]
```

`isCompletionColumn` is always present and always boolean. At most one element of the array has it `true`. Satisfies FR-004.

The same field appears in `GET /projects/:id`, whose `columns` array is produced by the same rows.

---

## 2. `PATCH /projects/:projectId/columns/:columnId`

Existing rename endpoint, extended to carry the designation. This is the "configure a column" verb the requester described.

**Request** — at least one of the two fields must be present:

```jsonc
{
  "name": "Done",                 // optional; unchanged semantics, still rejected if present-but-blank
  "isCompletionColumn": true      // optional; true designates, false clears
}
```

**Behavior**

| Input | Result |
|---|---|
| `name` only | Rename, exactly as today |
| `isCompletionColumn: true` | This column becomes the project's completion column; any other designated column in the same project is cleared in the same transaction (FR-002) |
| `isCompletionColumn: false` | Clears the designation on this column; the project ends up with none (FR-003) |
| Both fields | Both applied in one transaction |
| Neither field | `400 VALIDATION` — "name or isCompletionColumn is required" |
| `name` present but blank | `400 VALIDATION`, as today |

**Response**: `200` with the updated column object, including `isCompletionColumn`.

**Errors**: `404 NOT_FOUND` when the column does not belong to the project (existing behavior). `409 COMPLETION_COLUMN_CONFLICT` if the database's partial unique index rejects a concurrent double designation — the losing caller should retry. See research.md R2.

**Audit**: `column.completion_set` or `column.completion_cleared` on `entityType: 'kanban_column'`, alongside the existing `column.renamed` when a rename happened in the same call.

**Live update**: the existing `columns.changed` event for the project. No new event type is needed.

**Not changed**: designation is untouched by `PUT /columns/order` (FR-006) and by rename (FR-006). `DELETE /columns/:columnId` removes the designation with the row (FR-005) and needs no code change for that.

---

## 3. `GET /projects/:projectId/tickets`

Existing endpoint. **Default behavior is unchanged** — see research.md R4 for why.

**New optional query parameter**

| `placement` | Returns |
|---|---|
| omitted, or `all` | Every ticket of the project — identical to today |
| `board` | Only tickets currently in a column (`columnId` not null) |
| `completed` | Only tickets swept off the board (`columnId` null) |

Any other value → `400 VALIDATION`. Composes with the existing `parent` parameter.

Each ticket object's `columnId` is now `string | null`, and its included `column` is the column object or `null`.

The board (`frontend/src/app/(app)/projects/[id]/page.tsx`) passes `placement=board`, which is what satisfies FR-019a.

---

## 4. `POST /tickets/:id/move`

Existing endpoint. Request shape is unchanged: `{ targetColumnId, tokensDelta?, timeDelta?, llmName? }`.

**Two behavioral additions.**

**(a) It accepts a completed ticket as the subject.** Moving a ticket whose `columnId` is null restores it to the board (FR-023). Previously such a ticket could not exist. The history row records `fromColumnName: "Completed"`.

**(b) It may trigger a sweep.** When the project has a completion column, the target *is* that column, and after the move every ticket still on the board sits in it, the sweep fires inside the same transaction (FR-008, FR-009, FR-013).

**Response** — the moved ticket, plus an additive `sweep` field:

```jsonc
{
  "id": "…", "projectId": "…", "number": 12, "name": "…",
  "columnId": null,                       // null when this move triggered a sweep
  "tokensConsumed": 1200, "developmentTimeMinutes": 45,
  // …all existing ticket fields unchanged…
  "sweep": {
    "completionColumnId":   "…",
    "completionColumnName": "Done",
    "ticketCount": 4,
    "ticketIds": ["…", "…", "…", "…"]
  }
}
```

`sweep` is `null` on every move that did not trigger one — which is the overwhelming majority, and every move in a project with no completion column.

> **Callers must expect `columnId: null` in the response when `sweep` is non-null.** The ticket the caller just moved into the completion column has left the board along with the rest. This is the intended outcome, not an error. See research.md R5.

**Errors**: all existing ones are preserved — `400 VALIDATION`, `400 NEGATIVE_TOKENS`, `400 NEGATIVE_TIME`, `400 LLM_REQUIRED`, `404 NOT_FOUND`, `409 PARENT_MOVE_BLOCKED`. The former `500 INTERNAL "Ticket column missing"` is no longer reachable for a completed ticket, because that is now the legitimate restore path.

Because the sweep shares the move's transaction, a failing sweep rolls the move back and the endpoint returns the error with the board untouched (FR-014).

**Audit**: the existing `ticket.moved` entry, plus one `board.swept` entry on `entityType: 'project'` when a sweep fired, carrying `{ completionColumnId, completionColumnName, ticketCount, ticketIds }` and attributed to the calling user (FR-021).

---

## 5. `GET /projects/:id/backlog`

Existing endpoint, existing pagination, sorting and phase grouping. Each backlog item gains one field and its `status` gains one possible value.

```jsonc
{
  "groups": [
    {
      "phase": { "id": "…", "name": "Phase 1", "position": 0 },
      "tickets": [
        { "id": "…", "number": 1, "name": "…", "status": "In development", "completed": false, "subtasks": [] },
        { "id": "…", "number": 2, "name": "…", "status": "Completed",      "completed": true,  "subtasks": [] }
      ]
    }
  ],
  "total": 2, "page": 1, "pageSize": 50
}
```

- `completed` is the authoritative, machine-readable flag (FR-019). Consumers must branch on it rather than on the `status` string, which is display text and can collide with a user-chosen column name.
- `status` remains the column's name for on-board tickets and becomes `"Completed"` for swept ones.
- **`total` still counts every top-level ticket, swept or not** (FR-019b).
- Sorting by `status` continues to work, but **not under the marker value**. The sort is applied in the database against the related column's name, while `"Completed"` is synthesized afterwards in `toItem`. A swept ticket therefore has no column name to sort by and orders as a NULL — last under ascending order, first under descending — rather than alphabetically among the column names. Consumers that need completed work grouped explicitly should filter with `placement` (§3) instead of relying on sort position.

---

## 6. Reports and metrics — explicitly unchanged

`GET /reports/*` and `GET /projects/:id/metrics` keep their exact current shape, and every **aggregate of recorded work** keeps its exact current numbers: token totals, time totals, per-ticket metrics and the backlog's ticket count. `backend/src/services/reports.ts` and `backend/src/services/metrics.ts` aggregate by `projectId` with no column predicate, so completed tickets keep counting with no code change (FR-019b).

**One report does legitimately move**: a report whose subject is movement itself. `GET /reports/transitions` counts `TicketStatusHistory` rows, and FR-020 requires the sweep to write one row per swept ticket, so `mostChanges` gains exactly one transition per swept ticket. This is not a defect and MUST NOT be "fixed" by filtering those rows out on the column name — the reserved name a swept ticket transitions to can collide with a user-chosen column name, which `backend/src/services/backlog.ts` already documents as unsafe. The blast radius is bounded and was traced: `mostTokensInProcess` is exactly unchanged, because sweep rows carry null token and time deltas, and `longestTransition` gains only zero-minute gaps that can never rank.

This is a contract that must be defended by regression tests in both directions, not merely observed: assert that project metrics and work-aggregate report figures are identical immediately before and immediately after a sweep, **and** assert that the transition count grows by exactly one per swept ticket (FR-019c), so neither half can drift silently.

---

## 7. Live-update stream — one new event type

`GET /events` (SSE) gains exactly one event type. Shape is the existing `{ type, projectId, entityId? }`.

```json
{ "type": "board.swept", "projectId": "…" }
```

Emitted **once per sweep**, after the transaction commits, following the pattern every existing publisher in `backend/src/services/*.ts` uses. Not once per swept ticket — `frontend/src/lib/useLiveEvents.ts` debounces 200 ms and reloads wholesale, so one event is sufficient and per-ticket events would be waste (FR-022).
