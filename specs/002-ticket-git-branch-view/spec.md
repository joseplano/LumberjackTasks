# Feature Specification: Git branch visible on ticket

**Feature Branch**: `002-ticket-git-branch-view`

**Created**: 2026-08-16

**Status**: Approved — clarifications resolved, plan/tasks derived, readiness and technology gates
passed. This specification is the authority for the implementation; changing it now requires
re-running the readiness gates.

**Input**: Approved design handoff — `.specify/bridge/approved-design.md`

**Original idea (user's words)**: "cada ticket deberia tener la rama de git donde se va a trabajar de manera visual cuando se abre el ticket"

## Framing (authoritative, from the approved design)

This feature is a **view**. The agent and the repository are the source of truth for the
branch name. The ticket field **mirrors** what the agent reports; it never invents, derives,
generates, or overrides a branch name. An earlier draft that proposed a persisted
auto-generated branch name was explicitly overridden by the user and is out of scope.

## Clarifications

### Session 2026-08-16

No question required the human partner. The approved design records "Open questions: None",
and every ambiguity found during the scan was resolvable from a higher authority. Each
resolution below names the authority it came from, so a reviewer can audit it rather than
trust it.

- Q: Do the agent-facing *subticket* create/update capabilities also accept a branch value, or
  only the top-level ticket ones? → A: Yes, subticket capabilities accept it too. Source:
  approved design decision 2 — subtickets "carry their own value when the agent sets one
  explicitly" — which is impossible unless the subticket write path accepts the field.
- Q: Does the board card chip mark an inherited value the way the detail view does? → A: No.
  The card chip shows the effective value with no inheritance marker; the design specifies the
  chip as "compact ... truncated ... full value in a hover title" and places the inheritance
  marker only in the detail block. Source: approved design, "View" section.
- Q: Does reporting a branch identical to the stored one still produce the ordinary update
  side effects (audit entry, live board refresh)? → A: Yes, unchanged from every other ticket
  field. Source: repository evidence — the existing ticket update path emits an audit entry
  and an update event for any accepted update, and this feature introduces no exception.
  Verified that no report or metric consumes those side effects, so no derived figure moves.
- Q: Do the backlog and report surfaces show the branch? → A: No. Source: approved design
  decision 4 fixes the surfaces at ticket detail modal, kanban card, and agent tools;
  everything else is out of scope.
- Q: What happens on concurrent reports for the same ticket? → A: Last accepted report wins,
  identically to every other ticket field. Source: repository evidence — no ticket field uses
  optimistic concurrency, and introducing it for this field alone would be unjustified scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the branch the agent is working on (Priority: P1)

A person opens a ticket in the board and immediately sees, prominently, the git branch the
agent reported for that work, so they can switch to it, review it, or find the commits
without asking the agent or guessing a naming convention.

**Why this priority**: This is the entire point of the request. Without it there is no
feature. It is independently valuable even if no other story ships.

**Independent Test**: Report a branch for a ticket through the agent-facing tool, open that
ticket's detail view, and confirm the branch is displayed prominently and can be copied.

**Acceptance Scenarios**:

1. **Given** a ticket whose agent has reported the branch `002-ticket-git-branch-view`,
   **When** a person opens that ticket's detail view,
   **Then** the branch is shown as a highlighted block directly under the ticket title,
   in a monospaced typeface, with a branch icon and a copy control.
2. **Given** that same ticket detail view is open,
   **When** the person activates the copy control,
   **Then** the exact branch text is placed on the clipboard and a short confirmation is shown.
3. **Given** a ticket for which no branch has ever been reported,
   **When** a person opens its detail view,
   **Then** the block shows the empty-state text `Sin rama aún` in muted styling,
   **And** no branch name, suggestion, placeholder, or derived value appears anywhere.

---

### User Story 2 - A subticket shows the branch of the work it belongs to (Priority: P2)

Subtickets are components of one parent task and are usually worked on the same branch. A
person opening a subticket sees the parent's branch rather than an empty field, and can tell
that the value is inherited rather than reported for that subticket specifically.

**Why this priority**: Real work is decomposed into subtickets. Without inheritance most
tickets in the board would look empty. It is still secondary to Story 1 because Story 1 alone
is already usable.

**Independent Test**: Report a branch on a parent only, then open a subticket and confirm the
parent's branch appears marked as inherited with the parent's ticket number.

**Acceptance Scenarios**:

1. **Given** a parent ticket with branch `feature/x` and a subticket with no branch of its own,
   **When** a person opens the subticket,
   **Then** `feature/x` is shown together with a muted `(heredada de #<parent number>)` marker.
2. **Given** a parent ticket with branch `feature/x` and a subticket whose agent reported
   `feature/y`,
   **When** a person opens the subticket,
   **Then** `feature/y` is shown with no inheritance marker.
3. **Given** a parent ticket with no branch and a subticket with no branch,
   **When** a person opens the subticket,
   **Then** the empty state is shown and no error occurs.

---

### User Story 3 - Spot the branch from the board without opening the ticket (Priority: P3)

Scanning the board, a person can tell at a glance which tickets already have a branch and
which one, without opening each ticket.

**Why this priority**: Convenience on top of Stories 1 and 2. The board stays fully usable
without it.

**Independent Test**: Place a ticket with a reported branch and one without on the board and
confirm only the first shows a branch chip.

**Acceptance Scenarios**:

1. **Given** a ticket on the board with an effective branch (own or inherited),
   **When** the board is displayed,
   **Then** its card shows a compact branch chip.
2. **Given** a long branch name that does not fit the card,
   **When** the board is displayed,
   **Then** the chip is truncated with an ellipsis and the full value is available on hover.
3. **Given** a ticket with no effective branch,
   **When** the board is displayed,
   **Then** its card shows no branch chip and no placeholder.

---

### User Story 4 - The agent keeps the mirror truthful (Priority: P1)

When the agent starts working a ticket it reports the branch it is actually on, and reports
again if that branch changes, so the displayed value keeps matching the repository.

**Why this priority**: Without this, the field is permanently empty and Stories 1-3 have
nothing to show. It is P1 alongside Story 1: they are the two halves of the mirror.

**Independent Test**: Follow the agent's documented ticket workflow on a repository checked
out on a known branch and confirm the ticket ends up displaying that branch.

**Acceptance Scenarios**:

1. **Given** a repository checked out on branch `B` and an agent starting work on a ticket,
   **When** the agent performs the existing "move the ticket into development" step,
   **Then** the agent reports `B` for that ticket and the ticket displays `B`.
2. **Given** the agent has already reported `B` and the work later continues on branch `C`,
   **When** the agent notices the change,
   **Then** it reports `C` and the ticket displays `C`.
3. **Given** the repository is in a detached-HEAD state,
   **When** the agent performs the same step,
   **Then** it reports nothing and the ticket's stored value is left untouched.

---

### Edge Cases

- **Duplicate branches**: several tickets may carry the same branch value. This is allowed and
  never rejected or de-duplicated; a branch commonly hosts several tickets.
- **Deleted branch**: a branch removed from the repository after being reported keeps being
  displayed. It is the record of where the work happened, not a live existence check. The
  system performs no existence verification against any repository.
- **Ticket renamed**: renaming or re-describing a ticket never alters its branch value.
- **Empty string reported**: an empty or whitespace-only value clears the stored value back to
  "not reported" rather than storing an empty value.
- **Malformed value reported**: a value that could not be a git reference is rejected with a
  validation error and nothing is stored; the previously stored value is preserved.
- **Value of the wrong kind reported**: a reported value that is not text at all — a number, a
  true/false, a list, a structure — is rejected the same way, as a validation error that stores
  nothing and preserves the previous value. It is never reported as a system fault, because a
  system fault makes no promise about whether anything was written (FR-010).
- **Parent without branch**: a subticket whose parent has no branch shows the empty state, not
  an error.
- **Deep nesting**: not applicable — the system already permits only one level of subtickets,
  so inheritance is a single hop with no cycles.
- **Very long value**: a value longer than 255 characters is rejected as malformed.
- **Parent number unavailable while showing an inherited branch**: the detail view already
  loads the parent's number as an auxiliary, failure-tolerant step in order to render the
  existing parent link. When that auxiliary load has not completed or has failed, the inherited
  branch MUST still be shown, with the marker degraded to `(heredada)` — never `#null`,
  `#undefined`, or a blank number. The branch value itself is never withheld for this reason.
- **Person tries to set the branch**: no interface offers it. The value cannot be entered,
  edited or cleared by a person through the application.

## Requirements *(mandatory)*

### Functional Requirements

**Storage**

- **FR-001**: The system MUST store, per ticket, an optional branch value whose only meaning is
  "the branch the agent last reported for this ticket".
- **FR-002**: The absence of a value MUST mean literally "the agent has not reported a branch
  yet". The system MUST NOT substitute a default, a computed value, or a value derived from the
  ticket's number, name, label, phase, or project.
- **FR-003**: Existing tickets MUST require no backfill; they start with no reported branch and
  keep working exactly as before.
- **FR-004**: The system MUST allow the same branch value on any number of tickets. No
  uniqueness constraint may be introduced.

**Write path (agent only)**

- **FR-005**: The agent-facing ticket creation and ticket update capabilities MUST accept a
  branch value.
- **FR-006**: The system MUST NOT offer any way for a person to set, edit, or clear the branch
  value through the application interface. The ticket create/edit form is explicitly unchanged.
- **FR-007**: A reported value MUST be trimmed of surrounding whitespace before any further
  handling.
- **FR-008**: A reported value that is empty after trimming MUST clear the stored value to "not
  reported" rather than storing an empty value.
- **FR-009**: The system MUST reject a reported value that cannot be a valid git reference,
  specifically one that: contains whitespace, `~`, `^`, `:`, `?`, `*`, `[`, `\`, the sequence
  `..`, the sequence `@{`, or a control character; begins or ends with `/`; ends with `.lock`;
  or exceeds 255 characters.
- **FR-010**: A rejection MUST be reported as a validation failure that leaves the previously
  stored value unchanged.
- **FR-011**: Validation MUST be enforced where the domain rules live, so that no client can
  bypass it; other layers may mirror it for convenience but never replace it.

**Read shape**

- **FR-012**: A ticket read MUST expose the ticket's **own** reported value, which is null when
  the agent never reported one for that ticket specifically.
- **FR-013**: A ticket read MUST expose an **effective** branch: the ticket's own value if
  present, otherwise its parent's value if the ticket is a subticket and the parent has one,
  otherwise null.
- **FR-014**: A ticket read MUST expose a **source** indicator distinguishing a value that is
  the ticket's own from one inherited from the parent, and null when there is no effective
  value.
- **FR-015**: The effective value and source MUST be available wherever a ticket is represented
  in a read response: when reading a single ticket, when listing a project's tickets (because
  the board renders from the list), and on the subticket entries nested inside a single-ticket
  read. A ticket representation that omits them would contradict FR-013 and FR-014.
- **FR-015a**: A read response MUST NOT expose any additional **new** field beyond the three
  above. Every field a read response already returns today is unaffected and continues to be
  returned (FR-016); this requirement constrains only what this feature *adds*. Whatever the
  system loads internally in order to resolve the parent's value is not part of the published
  shape.
- **FR-016**: Adding these fields MUST NOT remove or change the meaning of any field that
  existing readers already consume.

**View**

- **FR-017**: The ticket detail view MUST present the effective branch as a visually
  highlighted block placed directly under the ticket title and the parent link — not as another
  row in the metadata list.
- **FR-018**: That block MUST contain a branch icon, the branch name in a monospaced typeface,
  and a copy control.
- **FR-019**: When the effective value is inherited, the block MUST carry a muted
  `(heredada de #<parent number>)` suffix, degrading to `(heredada)` when the parent's number
  is not available to the view.
- **FR-020**: When there is no effective value, the block MUST show `Sin rama aún` in muted
  styling and MUST NOT show a suggested, derived, or example branch name.
- **FR-021**: The copy control MUST place the exact branch text on the clipboard and confirm
  visibly, and MUST work when the application is served over a non-secure context such as a
  plain-HTTP LAN address.
- **FR-022**: A board card MUST show a compact branch chip when and only when the ticket has an
  effective branch, truncated with an ellipsis when it does not fit, with the full value
  available on hover. The chip MUST NOT carry an inheritance marker; that distinction belongs
  to the detail view only.
- **FR-022a**: The copy control and the branch icon MUST carry a text alternative, so the block
  is usable without relying on the icon's appearance alone.

**Keeping the mirror truthful**

- **FR-023**: The agent's documented ticket workflow MUST instruct it to read the repository's
  current branch and report it at the existing point where it moves a ticket into development,
  and to report again when the branch changes during the work.
- **FR-024**: When the repository has no current branch name (detached HEAD), the agent MUST
  report nothing rather than reporting a commit identifier or a fabricated name.

**Anti-requirements (explicitly out of scope by user decision)**

- **FR-025**: The system MUST NOT contain a branch-name generator, slug builder, or naming
  convention validator of any kind.
- **FR-026**: The system MUST NOT read any repository's working state from disk to discover a
  branch; the only source is what the agent reports.
- **FR-027**: The system MUST NOT introduce per-project branch prefixes or any related
  configuration.

### Key Entities

- **Ticket**: gains one optional attribute — the branch the agent last reported for it. Every
  other attribute is untouched. A ticket may be a parent or a subticket (one level only).
- **Effective branch (derived, not stored)**: the value shown for a ticket — its own if it has
  one, otherwise its parent's, otherwise none. Computed at read time; never persisted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening a ticket whose agent reported a branch shows that branch prominently, in
  a monospaced typeface, within the same view load as the rest of the ticket, with a copy
  control that reliably places the exact text on the clipboard.
- **SC-002**: Opening a ticket with no reported branch shows `Sin rama aún`, and a search of the
  rendered view finds no branch-like fabricated name.
- **SC-003**: Opening a subticket whose parent has a branch shows the parent's branch marked as
  inherited, including the parent's ticket number whenever that number is available to the view.
  In the degraded case where it is not, the branch and the inherited marker are still shown; a
  fabricated, blank, or placeholder number is never shown (see Edge Cases, FR-019).
- **SC-004**: A subticket with its own reported branch shows its own value, never the parent's.
- **SC-005**: The agent-facing create and update capabilities accept a branch value, and a
  ticket read returns own value, effective value, and source, in 100% of reads.
- **SC-006**: 100% of malformed branch values from the list in FR-009 are rejected as validation
  failures and none is stored.
- **SC-007**: Reporting an empty value clears the stored value in 100% of cases.
- **SC-008**: A board card shows the branch chip exactly when an effective branch exists and
  shows nothing when it does not.
- **SC-009**: Introducing this change alters no existing data and no existing behavior. Every
  ticket that existed before it continues to load, display, move, update, and report
  identically; there is no migration backfill; and no previously returned field changes its
  name, type, or value as a result of the change being deployed.

  Scope note: this criterion is about **deploying the feature**, not about later agent activity.
  Once an agent reports a branch, that report is an ordinary ticket update and carries exactly
  the same side effects any other field update already carries — a refreshed modification
  timestamp, one audit entry, one live-update event. What SC-009 forbids is a **new** kind of
  consequence. Verified accordingly: no report, metric, or backlog figure is derived from the
  modification timestamp or the audit log, so no reported number moves when a branch is
  reported (see SC-009a).
- **SC-009a**: Reporting branches on any number of tickets leaves every figure in the reports
  and metrics surfaces numerically identical.
- **SC-010**: No interface path exists by which a person can set or alter a ticket's branch
  value; an attempt to find one in the application finds nothing.

## Assumptions

- **A-001**: The Spanish literal strings `Sin rama aún` and `(heredada de #<n>)` are exactly as
  approved by the user and are used verbatim, even though surrounding interface text is in
  English. This is a deliberate, approved choice and not an oversight.
- **A-002**: Mutation responses (create/update) naturally carry the ticket's own stored value
  because they return the stored ticket. The derived effective value and source are guaranteed
  on read paths (FR-015); mutation responses are not required to compute them, and no consumer
  in this feature depends on them doing so.
- **A-003**: One level of subticket nesting is already enforced by the system, so inheritance
  needs no cycle detection or recursion depth limit.
- **A-004**: The agent reaches the write path through the same authenticated channel it already
  uses for every other ticket field; this feature introduces no new authentication or
  authorization concept.
- **A-005**: The system's existing single-tenant posture is unchanged. A branch name is not a
  secret and is visible to every authenticated account, exactly like every other ticket field.
- **A-006**: "Prominently" in SC-001 is satisfied by the highlighted block described in FR-017
  and FR-018; no numeric visual metric is implied.

## Dependencies

- **D-001**: Depends on the existing one-level subticket relationship for inheritance.
- **D-002**: Depends on the existing agent-facing ticket tools as the sole write path.
- **D-003**: Depends on the existing ticket detail view and board card as the display surfaces.

## Out of Scope

- The ticket create/edit form (unchanged).
- Any branch-name generation, suggestion, or convention enforcement.
- Verifying that a reported branch exists in any repository.
- Linking to a remote host's branch page, commits, or pull requests.
- Filtering or grouping the board by branch.
- Per-project branch configuration.
