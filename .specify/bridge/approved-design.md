# Approved Design — Git branch visible on ticket

Status: APPROVED by human partner
Bridge version: 3.1.0
Classification: architectural (crosses schema → REST API → MCP tools → UI → plugin skill)

## Original feature idea

> cada ticket deberia tener la rama de git donde se va a trabajar de manera visual cuando se abre el ticket

## Framing clarification given by the human partner (authoritative)

The feature is a **view**. The agent and the repository are the source of truth for
the branch name. The ticket field mirrors what the agent reports; it never invents,
derives, or overrides a branch name.

This clarification superseded an earlier draft of the design that proposed a
persisted auto-generated branch name. Auto-generation was removed entirely.

## Decisions explicitly approved by the user

1. **Origin of the value** — the branch is auto-generated *nothing*; it is written
   exclusively by the agent via MCP. (An initial answer favoured "auto-generated +
   editable", but the follow-up clarification in the same session overrode it: the
   agent decides the name, so no generator exists.)
2. **Subtickets** — inherit the parent's branch by default, with the option to carry
   their own value when the agent sets one explicitly.
3. **Visual treatment** — a highlighted block under the ticket title in the detail
   modal: branch icon, branch name in monospace, copy button. Not just another row
   in the metadata list.
4. **Surfaces** — ticket detail modal, kanban card chip, and MCP tools. The
   create/edit form is explicitly OUT of scope.
5. **Empty state** — when the agent has not reported a branch, the ticket shows
   "Sin rama aún". No suggested or derived name is ever displayed.
6. **Human editing** — read-only in the UI. Only MCP writes the value, so a human
   cannot introduce a value that contradicts the repository.
7. **Duplicate branch values across tickets are allowed.** No unique index. If the
   agent reports the same branch for several tickets, the system reflects it.

## Rejected alternatives and trade-offs

- **Persisted auto-generated `feature/<n>-<slug>` name** — rejected after the
  clarification. It would present a fabricated value as if it were real, which
  contradicts the mirror semantics. Removing it also removed the slug generator,
  its unicode/emoji/length edge cases, and the branch-naming-convention validation
  from scope.
- **Read-time derived name (not stored)** — rejected for the same reason, plus it
  could never reflect the branch the agent actually used.
- **Backend reads the project repository's current branch from disk** — rejected:
  it would require the backend to have filesystem access to the user's repo, a
  substantially larger scope and infrastructure surface.
- **Per-project configurable branch prefix** — rejected as YAGNI; it would add
  project settings, a migration, and settings UI for no current need.
- **Label-derived prefix** — rejected as fragile; it depends on how labels happen
  to be named.
- **Human-editable field in the create/edit form** — rejected: it would allow the
  view to stop reflecting the repository.

## Functional behaviour

### Data model

- New nullable field `gitBranch String?` on `model Ticket` in
  `backend/prisma/schema.prisma`, plus a captured Prisma migration.
- `null` means literally "the agent has not reported a branch yet". There is no
  default value and no read-time computation.
- Existing tickets require **no backfill**; they are simply `null`.
- **No unique index** on the field.

### Write path (agent only)

- `TicketInput.branch` in `backend/src/services/tickets.ts`, accepted by the REST
  create and update endpoints.
- `branch` added to `create_ticket` / `update_ticket` inputs and to the ticket read
  output in `mcp/src/tools/tickets.ts`.
- The frontend never sends this field. `frontend/src/components/TicketFormModal.tsx`
  is not modified.

### Validation (defensive — the agent can send malformed input)

Implemented in `backend/src/services/ticketRules.ts`:

- Trim surrounding whitespace.
- Empty string clears the value to `null`.
- Reject invalid Git ref characters: whitespace, `~`, `^`, `:`, `?`, `*`, `[`, `\`,
  the sequences `..` and `@{`, and control characters.
- Reject a leading or trailing `/`.
- Reject a `.lock` suffix.
- Reject values longer than 255 characters.
- Any rejection returns `400 VALIDATION`.

### Inheritance

- A subticket with `gitBranch = null` displays the parent's effective branch,
  marked as inherited.
- A subticket with its own value takes precedence over the parent's.
- Nesting is a single level, which the existing detail modal already enforces
  (the "Add subticket" action is only offered when `parentTicketId` is null).
- If the parent has no branch either, the subticket shows the empty state.

### API read shape

The ticket read response exposes three fields:

- `gitBranch: string | null` — the ticket's own stored value.
- `effectiveBranch: string | null` — own value, else the parent's, else `null`.
- `branchSource: 'own' | 'inherited' | null`.

`frontend/src/lib/types.ts` is updated with the same three fields on `Ticket`.

### View

- `frontend/src/components/TicketDetailModal.tsx` — a highlighted block under the
  title and the parent link: branch icon, branch name in monospace, copy button.
  An inherited branch carries a muted `(heredada de #<n>)` suffix. With no branch,
  the block shows `Sin rama aún` in muted text.
- Copying uses `navigator.clipboard` with a text-selection fallback, because the
  app may be served over a non-secure context on a LAN, and shows a "Copiado"
  confirmation.
- `frontend/src/components/kanban/TicketCard.tsx` — a compact chip shown only when
  an effective branch exists, truncated with an ellipsis and carrying the full
  value in a `title` attribute.

### What makes the mirror actually work

`plugin/skills/ticket-sync/SKILL.md` is updated so that when the agent starts
working a ticket — the existing step that moves it to "In development" — it reads
`git rev-parse --abbrev-ref HEAD` and reports it with `update_ticket branch=…`.
If the branch changes mid-work, the agent reports it again. In detached HEAD state
the agent reports nothing.

## Edge cases discussed

- Duplicate branch values across tickets are allowed.
- A branch deleted from the repository after being reported keeps being displayed:
  it is the record of where the work happened.
- Renaming a ticket never touches its branch value.
- Detached HEAD: nothing is reported.
- Parent with no branch: the subticket shows the empty state, not an error.
- Empty string from the agent clears the value rather than storing `""`.

## Architecture constraints agreed

- Prisma schema changes must carry explicit referential-action verification rather
  than relying on optionality-derived defaults (existing repository constitution
  constraint). This feature adds a scalar column and no new relation, so no
  `onDelete`/`onUpdate` action is introduced.
- No ad-hoc SQL and no uncaptured schema drift: the change ships as a captured
  Prisma migration under `backend/prisma/migrations/`.
- Follow the existing service/route/tool layering already used by the codebase.
- The plugin test suite must be run as `node --test plugin/tests/*.test.mjs` on
  Windows; the directory form fails with `MODULE_NOT_FOUND`.

## Success / acceptance criteria

1. Opening a ticket whose agent reported a branch shows that branch prominently,
   in monospace, with a working copy button.
2. Opening a ticket with no reported branch shows "Sin rama aún" and no fabricated
   name anywhere in the UI.
3. Opening a subticket whose parent has a branch shows the parent's branch marked
   as inherited, including the parent's ticket number.
4. A subticket with its own reported branch shows its own value, not the parent's.
5. `create_ticket` and `update_ticket` accept `branch`, and the ticket read returns
   `gitBranch`, `effectiveBranch`, and `branchSource`.
6. Malformed branch values are rejected with `400 VALIDATION` and never stored.
7. An empty string clears the stored value.
8. A kanban card shows the branch chip when an effective branch exists and shows
   nothing when it does not.
9. Existing tickets continue to work unchanged, with no migration backfill.

## Testing expectations

- **backend (vitest)**: invalid ref rejection, empty string clearing the value,
  parent → subticket inheritance, correct `branchSource` in all three cases,
  parent without a branch yielding a subticket without one.
- **frontend (vitest)**: the modal renders the branch, the empty state, and the
  inherited marker; the copy button copies; the card hides the chip when there is
  no branch.
- **mcp**: `branch` travels through create and update and comes back on read.
- **plugin**: `node --test plugin/tests/*.test.mjs`.
- **migration**: captured under `backend/prisma/migrations/`, with no drift.
- Authoritative commands are `npm test` (vitest) per package, and `tsc` /
  `next build` for typecheck.

## Open questions

None. All questions raised during brainstorming were resolved by explicit user
decision.

## References

No Superpowers design document was created under `docs/superpowers/specs/**`; the
V3.1 bridge routes formalization to Spec Kit, and this handoff is the design
evidence.
