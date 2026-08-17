# Contract: REST API — ticket branch mirror

**Feature**: 002-ticket-git-branch-view
**Base path**: `/api/v1`
**Auth**: unchanged — the existing bearer-token requirement applies to every endpoint below.

All changes are **additive**. No field is removed, renamed, retyped, or given a different value
than it has today. This satisfies FR-016 and SC-009 and keeps the change out of the
constitution's MAJOR/breaking category.

---

## Shared shape: `Ticket` (read)

Three fields are **added** to the ticket object returned by the read endpoints listed below.
Every field that exists today keeps its current name, type, and value.

| Field | Type | Notes |
|---|---|---|
| `gitBranch` | `string \| null` | The ticket's **own** reported branch. `null` = never reported for this ticket. |
| `effectiveBranch` | `string \| null` | Own value, else the parent's, else `null`. Derived per read; never stored. |
| `branchSource` | `"own" \| "inherited" \| null` | `null` exactly when `effectiveBranch` is `null`. |

Consistency guarantee asserted by tests: `branchSource === null` **iff**
`effectiveBranch === null`, and `branchSource === "own"` **iff** `gitBranch !== null`.

---

## `GET /api/v1/tickets/:id`

**Change**: the returned ticket object gains the three fields above, **and so does every object
in its `subtickets` array**.

The nested case is not optional. `frontend/src/lib/types.ts` declares `TicketDetail.subtickets`
as `Ticket[]`, and `Ticket` now carries the three fields as **required** properties. Omitting
them on nested subtickets would make the declared type a lie — the field would be typed
`string | null` while actually being `undefined`. For a subticket nested inside its own parent's
detail response, the parent's value is simply the enclosing ticket's `gitBranch`, so no extra
query is involved.

Unchanged: `history`, `totals`, `label`, `column`, and every scalar already returned.

**No other field may appear.** Resolving the parent's branch requires loading the parent
relation, but that relation MUST NOT be serialized into the response. A response containing a
`parent` object would be a fourth added field, contradicting this contract and leaking an
internal query detail into the public API. The parent data is consumed to compute
`effectiveBranch`/`branchSource` and then dropped.

Example (subticket inheriting from parent `#7`):

```json
{
  "id": "…",
  "number": 12,
  "parentTicketId": "…",
  "name": "Backend: validation",
  "gitBranch": null,
  "effectiveBranch": "002-ticket-git-branch-view",
  "branchSource": "inherited"
}
```

Example (no branch anywhere):

```json
{ "gitBranch": null, "effectiveBranch": null, "branchSource": null }
```

---

## `GET /api/v1/projects/:projectId/tickets`

**Change**: **every element** of the returned array gains the three fields above, and no other
field — the loaded parent relation is consumed and dropped, exactly as on the detail endpoint.

This is required, not optional: the board renders its cards from this endpoint, so the chip
(FR-022) has no data source without it (FR-015).

Unchanged: the `parent` and `placement` query parameters and their filtering semantics, the
ordering by `number`, and the embedded `label`/`column` objects.

Note: when `parent=<id>` filters the response down to one parent's subtickets, the parent row
itself is absent from the array — the derived fields are still correct, because the backend
resolves the parent through the relation, not through the response.

---

## `POST /api/v1/projects/:projectId/tickets`

**Change**: accepts an optional `branch` field in the request body.

| Field | Type | Behaviour |
|---|---|---|
| `branch` | `string \| null` (optional) | Absent → stored value stays `null`. Empty/whitespace-only or `null` → stored as `null`. Otherwise trimmed, validated, stored. |

Response: unchanged shape plus `gitBranch`. Status `201` as today.

---

## `PATCH /api/v1/tickets/:id`

**Change**: accepts an optional `branch` field in the request body, with the same behaviour as
on create.

**Absent vs null**: omitting `branch` leaves the stored value untouched; sending `""` or `null`
clears it. These are distinct and both are tested.

Response: unchanged shape plus `gitBranch`.

Unchanged: `columnId` is still rejected here (`400 VALIDATION`, use the move endpoint), and
`parentTicketId` is still rejected after creation.

---

## Validation errors

| Condition | Status | Code | 
|---|---|---|
| `branch` is present and is neither a string nor `null` (number, boolean, object, array) | `400` | `VALIDATION` |
| `branch` contains whitespace, `~`, `^`, `:`, `?`, `*`, `[`, `\`, `..`, `@{`, or a control character | `400` | `VALIDATION` |
| `branch` begins or ends with `/` | `400` | `VALIDATION` |
| `branch` ends with `.lock` | `400` | `VALIDATION` |
| `branch` longer than 255 characters | `400` | `VALIDATION` |

A rejected request stores nothing and leaves any previously stored value intact.

**Non-string values are a validation failure, never a `500`.** A REST client sends JSON, and
nothing in the transport constrains `branch` to a string; `{"branch": 42}` is a request the API
must answer. It is answered with `400 VALIDATION` and the message
`branch must be a string, null or absent`. This is FR-010 applied to the whole space of inputs a
client can send: an unhandled type would reach the trim, raise a `TypeError`, and surface as a
`500`, which is neither a validation failure nor a response that promises the stored value was
left alone. The check runs after the absent/`null` short-circuits, so it never interferes with
omitting the field or with clearing the value. Both the type-guarded rejection and the absence of
a `TypeError` are asserted directly by tests (see `tasks.md` T015a).

---

## Side effects — explicitly unchanged

Reporting a branch is an ordinary ticket update. It therefore produces exactly the side effects
every other ticket field produces, and no others:

- one `ticket.updated` audit entry;
- one `ticket.updated` event on the SSE stream, so an open board picks the chip up live;
- `updatedAt` is refreshed.

No report, metric, or backlog figure is derived from any of these, so **no reported number
changes anywhere as a result of this feature**. This statement is verified against
`backend/src/services/metrics.ts` (aggregates only `tokensConsumed`,
`developmentTimeMinutes`, and a row count) and `backend/src/services/reports.ts` (reads
neither `updatedAt` nor the audit log).

## Endpoints explicitly NOT changed

`POST /api/v1/tickets/:id/move`, `DELETE /api/v1/tickets/:id`, the backlog endpoint, the
reports endpoints, the metrics endpoint, and the events stream keep their exact current request
and response shapes. In particular the backlog item shape gains **no** branch field — the
backlog is out of scope by approved design decision 4.
