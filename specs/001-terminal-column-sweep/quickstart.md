# Quickstart: validating the Completion Column & Automatic Board Sweep

**Feature**: `specs/001-terminal-column-sweep` | **Date**: 2026-08-15

How to prove this feature works end to end once it is implemented. Shapes and endpoints are in [contracts/http-api.md](./contracts/http-api.md); schema details are in [data-model.md](./data-model.md). No implementation code appears here.

---

## Prerequisites

- Node ≥ 20 and PostgreSQL 16, or Docker Compose.
- `backend/.env`, `frontend/.env.local` and `mcp/.env` derived from the committed `*.env.example` files.
- The migration from data-model.md applied: `cd backend && npx prisma migrate deploy` (or `migrate dev` in development).

Bring the stack up the supported way:

```bash
docker compose up -d          # backend :4000, frontend :3000, MCP 127.0.0.1:5000, Postgres :5434
curl http://localhost:4000/health
```

---

## Automated verification (the gate)

Per constitution Principle II, the whole suite must pass before a PR opens, and the plugin suite must use the glob form.

```bash
cd backend  && npm test
cd mcp      && npm test
cd frontend && npm test
node --test plugin/tests/*.test.mjs
```

`plugin/` is untouched by this feature; its suite runs to prove that.

### What the new tests must demonstrate

| Area | File | Must prove |
|---|---|---|
| Designation | `backend/tests/integration/columns.test.ts` | Set, clear and move the designation; a second designation clears the first; rename and reorder preserve it; deleting the column clears it; two concurrent designations do not both succeed (FR-001…FR-006) |
| Trigger | `backend/tests/integration/moves.test.ts` | No sweep while another column holds a ticket; sweep on the move that empties the last other column; no sweep at all without a designation; single-ticket project sweeps; empty board never sweeps (FR-008…FR-012) |
| Atomicity & concurrency | new `backend/tests/integration/sweep.test.ts` | A forced mid-sweep failure leaves the board exactly as before, including the triggering move; no read ever observes a partially swept board; concurrent moves into the completion column produce exactly one sweep and never a missed one; a delete concurrent with a sweep corrupts neither the board nor the audit record (FR-014, FR-014a, FR-021a, SC-002, SC-008) |
| Preservation | `backend/tests/integration/sweep.test.ts` | Nothing is deleted — every ticket, subticket, label link, phase link, history row and token/time total survives; and the project's columns keep their set, names, order and designation (FR-015, FR-016) |
| Repeat sweeps | `backend/tests/integration/sweep.test.ts` | Fill, sweep, refill and sweep again, 3 cycles in a row — already-completed tickets neither block the condition nor get swept twice (FR-010, SC-009) |
| Audit & history | `backend/tests/integration/moves.test.ts` | Exactly one `board.swept` audit entry per sweep — not one per ticket — attributed to the actor whose move triggered it and carrying the ids of the tickets actually swept; one status-history row per swept ticket recording its exit from the completion column (FR-020, FR-021, FR-021a) |
| Restore | `backend/tests/integration/moves.test.ts` | A completed ticket moves back into a column, is no longer completed, counts toward the condition again, and records the restoration with `fromColumnName: 'Completed'`; restoring a parent while its subtickets stay completed is allowed (FR-023, FR-024, FR-011a) |
| Creation unaffected | `backend/tests/integration/tickets.test.ts` | New tickets are still placed on the board regardless of how many times the project was swept before (FR-025) |
| Backlog | `backend/tests/integration/backlog.test.ts` | Swept tickets still listed, phase grouping and subtask nesting intact, `completed: true`, `total` unchanged (FR-018, FR-019) |
| Board exclusion | `backend/tests/integration/tickets.test.ts` | `placement=board` excludes completed, `placement=completed` returns only them, and **omitting `placement` returns everything exactly as before** (FR-019a and the no-breaking-change promise) |
| Reporting regression | `backend/tests/integration/reports.test.ts`, `metrics.test.ts` | Every report and metric figure is identical immediately before and after a sweep (FR-019b, SC-011) |
| Ordering | `backend/tests/unit/` | `validateParentMove` treats a completed subticket as later than every column and never blocks a parent (FR-011a) |
| Live update | `backend/tests/integration/events.test.ts` | Exactly one `board.swept` event per sweep, project-scoped (FR-022) |
| Invariant | any backend integration test | No ordinary create or update path can leave a ticket with a null `columnId` |
| Settings UI | `frontend/src/__tests__/settings.test.tsx` | The designation control marks one column and only one |
| Board UI | `frontend/src/__tests__/board.test.tsx`, `boardPage.test.tsx` | Completed tickets never render on the board; a `sweep` response triggers a refetch rather than a local patch |
| Backlog UI | `frontend/src/__tests__/backlogPage.test.tsx` | Completed rows render distinguishably from on-board rows |
| MCP passthrough | `mcp/` suite | Request, response and error fidelity per contracts/mcp-tools.md §Tests: `set_completion` and `placement` forward correctly, a sweep-bearing move response is relayed unchanged including its null `columnId`, and backend errors surface uninterpreted — the three assertions that fail if sweep logic ever leaks into `mcp/` |

---

## Manual walkthrough

Log in at `http://localhost:3000` and create a project. It starts with the six default columns (`TODO`, `In development`, `In testing`, `In Human review`, `Done`, `Committed`) and — per FR-007 — **no** completion column.

**1. Designate.** Project settings → Kanban columns → mark `Done` as the completion column. Reload: the marking persisted and only `Done` carries it. Mark `Committed` instead: `Done` reverts. Mark `Done` again.

> Note `Done` is not the last column by position. That is intentional and worth exercising: the designation is independent of column order (FR-006).

**2. Fill the board.** Create three tickets. Move two into `Done`, leave one in `In development`. The board still shows all three, and the two in `Done` sit there — no sweep, because another column is occupied (FR-009).

**3. Sweep.** Open a second browser tab on the same board, then in the first tab drag the last ticket into `Done`.

Expect: every column empties, including `Done`. **The second tab empties too, within a few seconds, with no refresh** (FR-022, SC-005).

**4. Nothing was lost.** Open the project backlog. All three tickets are listed, grouped by phase as before, each marked completed and visibly distinct from on-board tickets. Open one: its history shows the transition out of `Done` (FR-018, FR-020, SC-007).

**5. Reporting did not move.** Note the project metrics before step 3 and compare after. Identical (FR-019b).

**6. Restore.** From the backlog, put one completed ticket back into `In development`. It reappears on the board; the backlog no longer marks it completed. Move it to `Done` — it is the only ticket on the board, so the board sweeps again (FR-023, FR-024, SC-009).

**7. Opt-out still works.** Create a second project, designate nothing, and move every ticket into `Done`. Nothing is swept (FR-012, SC-006).

---

## Agent walkthrough

Prove SC-012: an agent can drive a whole batch with no human step.

From a Claude Code session with the Lumberjack Tasks MCP server registered:

1. `manage_columns` with `action: 'list'` — each column carries `isCompletionColumn`.
2. `manage_columns` with `action: 'set_completion'`, the `Done` column id, `isCompletionColumn: true`.
3. Create a couple of tickets, then `move_ticket` them into `Done` one at a time.
4. The final `move_ticket` returns a non-null `sweep` summary, and the returned ticket's `columnId` is `null`. That is success, not an error (contracts/mcp-tools.md §3).
5. `list_tickets` with `placement: 'board'` returns nothing; with `placement: 'completed'` returns the batch; with no `placement` returns everything, as it always did.

---

## Edge cases worth exercising by hand

- **Subticket blocks the sweep**: a parent in `Done` with a subticket still in `In testing` must not sweep. Move the subticket to `Done` and it sweeps (FR-011).
- **Partial family restore**: restore a parent while its subtickets stay completed. Allowed, and the parent-ordering rule stays satisfied (FR-011a).
- **Delete the completion column after a sweep**: it is genuinely empty, so it deletes without the `409 COLUMN_NOT_EMPTY` prompt, and the project is left with no designation (FR-005).
- **Single-column project**: the first ticket moved into a lone completion column sweeps immediately. Surprising but correct.
- **Rename the completion column** while it holds tickets: the designation survives, and the sweep still fires (FR-006).

---

## Rollback

Clearing the designation stops all future sweeps immediately and needs no deployment. Already-completed tickets stay completed and can be restored individually (FR-023).

Reverting the migration is **not** safe while any completed ticket exists — restoring `NOT NULL` on `tickets.columnId` would fail on those rows. Put every completed ticket back on the board first. This is called out in data-model.md and must be stated in the migration file itself.
