# Contract: UI surfaces and agent skill — ticket branch mirror

**Feature**: 002-ticket-git-branch-view

## Frontend types — `frontend/src/lib/types.ts`

Three fields are added to `interface Ticket` (and therefore inherited by `TicketDetail`):

```ts
gitBranch: string | null;
effectiveBranch: string | null;
branchSource: 'own' | 'inherited' | null;
```

No existing field is changed. `BacklogItem` is **not** modified — the backlog is out of scope.

## Ticket detail modal — `frontend/src/components/TicketDetailModal.tsx`

**Placement**: a highlighted block, rendered after the title heading and after the existing
`Parent: #n (view)` link, and **before** the description paragraph. It is deliberately not a row
in the `<dl>` metadata grid (FR-017).

**States**:

| Condition | Rendering |
|---|---|
| `effectiveBranch` non-null, `branchSource === 'own'` | branch icon · `effectiveBranch` in a monospaced typeface · copy control |
| `effectiveBranch` non-null, `branchSource === 'inherited'`, parent number known | as above, plus muted `(heredada de #<n>)` |
| `effectiveBranch` non-null, `branchSource === 'inherited'`, parent number **not** known | as above, plus muted `(heredada)` — never `#null`, `#undefined`, or `#` with a blank |
| `effectiveBranch` null | muted `Sin rama aún`, no icon-plus-value, no copy control |

The parent number comes from the modal's existing `parentNumber` state, which is loaded by an
auxiliary fetch that the current code already allows to fail. The branch value itself comes
from the primary ticket response and is therefore **never** withheld because of that failure.

**Copy control**:

- Places the exact `effectiveBranch` text on the clipboard — no trimming, no decoration, no
  inheritance marker.
- Primary path `navigator.clipboard.writeText`; fallback hidden-textarea +
  `document.execCommand('copy')` when `navigator.clipboard` is unavailable or rejects, because
  the app is supported behind a plain-HTTP LAN reverse proxy where the Clipboard API is
  undefined (FR-021).
- Shows a transient `Copiado` confirmation on either path.
- Carries a text alternative so it is operable without interpreting the icon (FR-022a).

**Read-only**: the modal offers no control that sets, edits, or clears the value.
`TicketFormModal.tsx` is **not** modified and must not appear in any diff for this feature
(FR-006, SC-010).

## Board card — `frontend/src/components/kanban/TicketCard.tsx`

- Renders a compact chip **iff** `ticket.effectiveBranch` is non-null (FR-022).
- Truncated with an ellipsis; the full value is exposed via the `title` attribute.
- No inheritance marker on the card — that distinction is detail-view only.
- No placeholder, dash, or empty chip when there is no branch.

`Board.tsx` needs no change: it already passes the whole `Ticket` object to `TicketCard`.

## Agent skill — `plugin/skills/ticket-sync/SKILL.md`

Extends the existing step 5 ("Keep the board in sync while working"), where the agent already
moves a ticket to "In development":

- Read the repository's current branch with `git rev-parse --abbrev-ref HEAD`.
- Pass it as `branch` on the `update_ticket` / `update_subticket` call that accompanies that
  move.
- Re-report when the branch changes during the work.
- When the command outputs the literal `HEAD` (detached), report **nothing** — do not send
  `branch` at all, and do not send a commit hash (FR-024).
- Never invent, derive, or "tidy" a branch name; report only what the command printed
  (FR-025).

**Constitution constraints on this file** (Principle IV):

- `docs/ticket-sync.md` must be read before editing anything under `plugin/`.
- `plugin/` gains no runtime dependency and no `node_modules` — this is a text-only change.
- `plugin/.claude-plugin/plugin.json` is not touched; adding a `skills` or `hooks` key there
  would silently disable the plugin's MCP server.
- The plugin suite runs as `node --test plugin/tests/*.test.mjs` — the glob form. The directory
  form fails with `MODULE_NOT_FOUND` on Windows and is not a substitute.
- The instruction change above is a **behavior** change and owes coverage of itself, not merely a
  green suite. `plugin/tests/plugin-config.test.mjs` asserts against the contents of `SKILL.md`
  that it names `git rev-parse --abbrev-ref HEAD` as the source, reports through
  `update_ticket`/`update_subticket` rather than `move_ticket`, covers the detached-`HEAD` case,
  reports nothing in that case, and forbids inventing or slugifying a name (FR-023, FR-024,
  FR-025). Mutation-checked against the pre-feature `SKILL.md`, where it fails.

## Documentation

`README.md` gains a short note that a ticket displays the branch the agent reported, that it is
read-only in the UI, and that subtickets inherit the parent's. Required by the constitution's
rule that user-visible behavior is reflected in `README.md`.
