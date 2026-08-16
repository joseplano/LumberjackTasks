# Data Model: Copy the branch URL, not just the branch name

**Feature**: `003-copy-branch-url` | **Date**: 2026-08-16

**There is no persistent data change in this feature.** No table, column, index, constraint, enum or default is added or altered; no Prisma migration is created; no API request or response shape changes; no MCP tool signature changes. The model below documents the values the feature reads and the one value it derives in memory.

## Existing values read (all unchanged)

| Value | Where it lives today | Shape | Role here |
|---|---|---|---|
| `Project.gitRepoUrl` | `frontend/src/lib/types.ts` — `interface Project`, inherited by `ProjectDetail`; served by the backend and already passed to `TicketDetailModal` as part of the `project` prop | `string`, possibly empty, stored verbatim as entered | The repository address the branch URL is derived from. Read-only here. |
| `TicketDetail.effectiveBranch` | `frontend/src/lib/types.ts`; established by feature `002-ticket-git-branch-view` | `string \| null` — the ticket's own reported branch, or a parent's when inherited | The branch the URL points at. Read-only here; the value shown to the reader is untouched. |
| `TicketDetail.branchSource` | as above | `'own' \| 'inherited' \| null` | Not used by this feature; the inheritance marker it drives is unchanged. |

## Derived, non-persisted value

**Branch URL** — the address of an effective branch inside a project repository.

- **Derivation**: `buildBranchUrl(project.gitRepoUrl, detail.effectiveBranch)`, defined in [contracts/branchUrl.md](./contracts/branchUrl.md).
- **Lifetime**: computed during render and consumed by the copy handler; never stored in state, never persisted, never transmitted.
- **Cardinality**: at most one per rendered ticket branch block; `null` when the project has no usable repository URL.
- **Consumers**: exactly two, both in `TicketDetailModal` — the clipboard payload, and the control's `aria-label`/`title`. Both must read the *same* evaluation, which is the invariant behind SC-004.
- **Not a consumer of anything else**: no report, metric, count, total, duration, serializer or API payload reads this value, which is why SC-006 can assert that no figure anywhere changes.

## Invariants

1. **Read-only inputs.** Neither `gitRepoUrl` nor `effectiveBranch` is written, trimmed in place, or normalised in storage by this feature. Normalisation happens on a copy of the value, at read time, for the sole purpose of building the URL.
2. **Name matches payload.** The control's accessible name and tooltip are `Copy branch URL` if and only if the derived Branch URL is non-`null`, in which case that URL is what the clipboard receives. There is no state in which the name and the payload can diverge, because both come from one evaluation.
3. **Displayed text is never a URL.** The branch block continues to display the branch text. The Branch URL exists only on the clipboard.
4. **No control without a branch.** When `effectiveBranch` is absent the block renders `Sin rama aún` and no copy control, so the Branch URL is never derived for a ticket without a branch.
