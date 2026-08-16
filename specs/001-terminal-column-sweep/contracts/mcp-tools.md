# Contract: MCP tool surface changes

**Feature**: `specs/001-terminal-column-sweep` | **Server**: `mcp/`, HTTP to the backend via `mcp/src/apiClient.ts`

## Governing constraint

Constitution Principle I: the MCP server reaches the backend over HTTP with bot credentials and **must not** open its own database connection, embed domain rules the backend does not enforce, or become a second write path.

Therefore the sweep rule appears **nowhere** in `mcp/`. The agent can designate a completion column and can move tickets; the backend alone decides when a sweep happens. Every change below is a parameter passed through to an endpoint.

**No tool is renamed and no tool is removed.** Per the constitution, MCP tool names are referenced as literal text elsewhere and renaming one is a breaking change. All changes are additive parameters and description text.

---

## 1. `manage_columns` — new action

Currently `action: 'list' | 'create' | 'rename' | 'reorder' | 'delete'` in `mcp/src/tools/management.ts`.

**Add** `'set_completion'`.

| Parameter | Type | Required for `set_completion` |
|---|---|---|
| `projectId` | `string` | yes (already present) |
| `columnId` | `string` | yes — already an optional parameter, reused |
| `isCompletionColumn` | `boolean` | yes — **new** |

Maps directly to `PATCH /projects/{projectId}/columns/{columnId}` with body `{ isCompletionColumn }`. No other logic.

Validation in the tool is limited to the same "required parameter missing" checks the existing actions perform via `fail(...)` — for example, `columnId is required for action "set_completion"`. Everything else, including the at-most-one guarantee, is the backend's answer to give.

`action: 'list'` needs no code change: it already returns whatever the endpoint returns, which now includes `isCompletionColumn` on every column.

**Description text** must be updated so an agent understands the semantics without guessing, e.g.:

> `set_completion` (columnId, isCompletionColumn) marks a column as the project's completion column, or clears it. A project has at most one; designating a second moves the designation. When every ticket left on the board is in the completion column, the backend automatically sweeps them all off the board and they become completed tickets, visible in the backlog.

---

## 2. `list_tickets` — new passthrough parameter

In `mcp/src/tools/tickets.ts`, currently `{ projectId, parent? }` → `GET /projects/{projectId}/tickets`.

**Add** an optional `placement` of `'board' | 'completed' | 'all'`, passed straight through as a query parameter.

**The default is unchanged**: omitting it returns every ticket of the project, exactly as today. This is deliberate — see research.md R4. An existing agent workflow that calls `list_tickets` keeps getting the same answer it always did.

**Description text** should explain the new axis:

> `placement`: `board` for tickets currently in a column, `completed` for tickets already swept off the board, `all` (default) for both.

---

## 3. `move_ticket` and `move_subticket` — richer response, unchanged inputs

Both already POST to `/tickets/{id}/move`. Their input schemas do **not** change.

Because `mcp/src/tools/helpers.ts` `run()` serializes whatever the backend returns, both tools automatically surface the new `sweep` object and the possibly-null `columnId` with no code change.

What must change is the **tool description**, so the agent is not surprised by a successful move that returns a ticket with no column:

> Moving the last ticket on the board into the project's completion column causes the backend to sweep every ticket off the board. When that happens the response contains a non-null `sweep` summary and the returned ticket's `columnId` is `null` — the ticket is completed, not lost, and remains in the backlog.

The existing note about parent tickets only moving forward when every subticket is in the target column or later stays accurate: completed subtickets rank after every column, so they never block a parent (FR-011a).

**Restoring a completed ticket** requires no new tool: `move_ticket` with a `targetColumnId` puts it back on the board (FR-023). Worth one sentence in the description.

---

## 4. Unchanged tools

`create_project`, `get_project`, `delete_project`, `manage_labels`, `manage_phases`, `create_ticket`, `update_ticket`, `get_ticket`, the report tools and every other registered tool keep their current names, schemas and behavior. `get_project` picks up `isCompletionColumn` inside its `columns` array for free, since it forwards the backend's response.

---

## Tests

`mcp/` has its own vitest suite. It must cover:

- `manage_columns` with `action: 'set_completion'` issues the expected `PATCH` with the expected body, and fails cleanly when `columnId` or `isCompletionColumn` is missing.
- `list_tickets` forwards `placement` when given and omits it when not — the second half guards the no-breaking-change promise.
- A backend error from either path is surfaced through `run`/`BackendError` in the existing `CODE (HTTP nnn): message` form rather than being swallowed.

### Asserting the absence of sweep logic

There must be **no** test asserting sweep *behavior* inside `mcp/`, because there must be no sweep behavior inside `mcp/`. But "this layer holds no rule" cannot be left as an unfalsifiable claim — a rule that leaks in later would break nothing and no one would notice. It is therefore restated as a **passthrough-fidelity** requirement, which is positive and directly assertable:

- **Response fidelity.** Given a stubbed backend response for `move_ticket` / `move_subticket` that carries a non-null `sweep` summary and a `columnId` of `null`, the tool's output must be that backend response serialized unchanged — same `sweep` object, same null `columnId`, nothing added, nothing removed, nothing rewritten. The tool must not branch on `sweep`, must not treat a null `columnId` as an error, and must not synthesize a substitute column.
- **Request fidelity.** `set_completion` must issue exactly one `PATCH` with exactly `{ isCompletionColumn }` as its body, and `list_tickets` must forward `placement` verbatim when given and send no `placement` at all when omitted. Neither may consult project state, count tickets, or decide anything the backend was not asked.
- **Error fidelity.** A backend error is surfaced, not interpreted: a `409 COMPLETION_COLUMN_CONFLICT` reaches the caller as an error in the existing `CODE (HTTP nnn): message` form, and is not retried, swallowed or converted inside `mcp/`.

Together these three fail if any sweep decision ever migrates into this layer, which is what makes Constitution Principle I checkable here rather than merely asserted.
