# Feature Specification: Completion Column & Automatic Board Sweep

**Feature Branch**: `001-terminal-column-sweep`

**Feature Directory**: `specs/001-terminal-column-sweep`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description (verbatim, Spanish): "cuando se agrega el ultimo ticket a DONE y no queda ningun en todas las otras columnas, saca todos los ticket de la columna done. Cuando configuro una columna deberia agregarle un atribito a la culumnas que quiero usar como columan de terminacion que significa que cuando todos los tickets estan en esa columna se sacan de esa columan y quedan como done en el backlog"

## Clarifications

### Session 2026-08-15

This session ran non-interactively. Every answer below was derived either from the requester's own verbatim wording (quoted in **Input** above) or from behavior that already exists in this repository, and the source is stated for each. No answer was invented; no question was left unresolved.

- Q: After a sweep, does a completed ticket still appear on the board (for example in a collapsed or hidden lane)? → A: **No.** The board shows only tickets currently placed in a column; completed tickets appear in the backlog only. *Source: the requester's verbatim "saca todos los ticket de la columna done" — take them out of the column — combined with "quedan como done en el backlog", which names the backlog as the place they remain visible.*
- Q: Where does "completed / off the board" rank relative to the ordered columns, for the existing rule that a parent ticket may not advance past its own subtickets? → A: **Strictly after every column.** Completed is later than the last column, so a completed subticket never blocks its parent, and a parent that is completed is ahead of any subticket returned to the board. *Source: the existing parent-move rule compares column order positions and blocks only when a subticket sits at an earlier position; the sweep itself can only fire once parent and subtickets are all in the completion column, so the invariant already holds at sweep time and only needs a defined meaning on restore.*
- Q: Do project-wide reports, metrics and backlog totals keep counting completed tickets after a sweep? → A: **Yes, unchanged.** A sweep must not move any reporting number. *Source: existing project-wide reports and totals aggregate over every ticket of a project with no filtering by column whatsoever, and the backlog total counts every top-level ticket; a sweep that changed those numbers would be a regression, not a feature.*
- Q: What must a sweep emit so that boards already open elsewhere show the emptied board? → A: **One project-scoped live-update signal for the whole sweep**, not one per ticket. *Source: the existing live-update channel is project-scoped and its consumers reload the affected view wholesale on any signal, so a single signal is both sufficient and cheaper than one per swept ticket.*
- Q: May an automated agent set and clear the completion designation, or only read it? → A: **Both — read and set/clear**, through the same column-configuration surface a person uses. The sweep rule itself stays server-side and is not re-implemented by the agent. *Source: the project's stated premise is that an agent drives the board through the same column-management capability that already covers creating, renaming, reordering and deleting columns; the constitution requires that the server remain the single source of truth for domain rules and forbids the agent layer from holding rules of its own.*

### Session 2026-08-16

This session was interactive. It ran after implementation, to resolve a contradiction the implementation surfaced rather than one the artifacts predicted.

- Q: A sweep writes one status-history entry per swept ticket (FR-020), and a report that counts status transitions therefore counts them — so does the traceability of FR-020 win, or the "no report figure moves" promise of FR-019b/SC-011? → A: **Traceability wins, and FR-019b/SC-011 are scoped.** They govern aggregates of recorded work — token totals, time totals, per-ticket metrics and the backlog count — which a sweep must never move. A report whose subject is movement itself legitimately reflects the sweep's transitions, because those transitions genuinely happened. Excluding them would require matching on the column name `Completed`, which collides with a user-chosen column name and is already documented in this codebase as unsafe.
- Q: When an operator restores a completed ticket from the backlog, which column should it land in if the project's first column happens to be the completion column? → A: **The first column that is not the completion column.** Restoring into the completion column of an otherwise empty board re-satisfies the condition immediately and bounces the ticket straight back off the board, so the restore affordance must not choose that destination by default. If the completion column is the project's only column, it is used anyway and the immediate re-sweep is the documented outcome. Choosing a destination is not an opt-out from FR-017: a move into an ordinary column simply does not meet the condition.

## Terminology

**"Completion column" is the canonical term** for the column a project designates as meaning "finished", and it is the only term used in requirements, design artifacts, contracts and tasks. Two other terms appear and are defined here so no reader treats them as different concepts:

- **"Terminal column"** — a synonym, surviving only in the feature slug and branch name `001-terminal-column-sweep`. It names the same thing. The slug is not renamed because the branch, the directory and every cross-reference already use it.
- **"Done"** — the *default name* of one column in this project's six seeded columns (`TODO`, `In development`, `In testing`, `In Human review`, `Done`, `Committed`). It is an ordinary, user-renameable column name and carries no meaning of its own. A project's completion column is whichever column is designated, which may be `Done`, may be any other column, and may be none.

The term **"completed"** describes a *ticket* that has been swept off the board, never a column.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Designate a completion column (Priority: P1)

While configuring a project's kanban columns, the operator marks exactly one column (typically "Done") as the project's **completion column**. The marking is visible in the column configuration and in any listing of the project's columns, so both a human operator and an automated agent can tell which column means "finished". A project may also have no completion column at all, in which case the project behaves exactly as it does today.

**Why this priority**: Nothing else in this feature can exist without the attribute, and the attribute alone is already useful — it declares which column means "finished" for a project whose column names are arbitrary and user-chosen. It is also the only part that is purely additive and risk-free.

**Independent Test**: Configure a project, mark a column as the completion column, reload the configuration, and confirm the marking persisted and that exactly one column carries it. Mark a different column and confirm the previous marking was cleared. Remove the marking and confirm the project has none.

**Acceptance Scenarios**:

1. **Given** a project whose columns have no completion column, **When** the operator marks the "Done" column as the completion column, **Then** "Done" is shown as the completion column and every other column is shown as ordinary.
2. **Given** a project where "Done" is the completion column, **When** the operator marks "Released" as the completion column instead, **Then** "Released" becomes the completion column and "Done" reverts to an ordinary column, without any prompt or data change to tickets.
3. **Given** a project where "Done" is the completion column, **When** the operator clears the marking, **Then** the project has no completion column and no automatic sweep can occur.
4. **Given** a project where "Done" is the completion column, **When** anyone lists the project's columns, **Then** the completion marking is part of what is listed.

---

### User Story 2 - Automatic sweep when the board is fully completed (Priority: P2)

The operator (or Claude Code acting as the operator) drags the last outstanding ticket into the completion column. At that moment no ticket remains in any other column of the project, so the whole batch of work is finished. The system automatically clears the completion column: every ticket in it leaves the board at once, the board is left empty and ready for the next batch of work, and nothing is deleted.

**Why this priority**: This is the value the requester actually asked for — the board self-resets at the end of a batch instead of accumulating a growing pile of finished cards that must be cleared by hand.

**Independent Test**: On a project with a completion column and several tickets spread across columns, move tickets one at a time into the completion column. Confirm that nothing happens while any other column still holds a ticket, and that the moment the last one arrives, every column of the project — including the completion column — becomes empty and the same number of tickets still exists in the project.

**Acceptance Scenarios**:

1. **Given** a project with a completion column, three tickets in the completion column and one ticket in "In Progress", **When** that last ticket is moved into the completion column, **Then** all four tickets leave the board and every column of the project is empty.
2. **Given** the same project, **When** a ticket is moved into the completion column while another ticket still sits in "To Do", **Then** no sweep occurs and the ticket simply rests in the completion column.
3. **Given** a project with **no** completion column designated, **When** the last ticket is moved into any column so that all tickets share one column, **Then** no sweep occurs and behavior is unchanged from today.
4. **Given** a project whose only ticket is moved into the completion column, **When** the move completes, **Then** that single ticket is swept and the board is empty.
5. **Given** a project with an empty board (no tickets on it), **When** the completion column is designated or any configuration change happens, **Then** no sweep occurs, because a sweep requires at least one ticket to sweep.
6. **Given** a sweep that cannot be completed for any reason, **When** the failure occurs, **Then** no ticket is left half-swept: either all tickets in the completion column leave the board or none do, and the move that triggered it reports the failure.

---

### User Story 3 - Completed work stays visible in the backlog (Priority: P3)

After a sweep, the operator opens the project backlog and still sees every swept ticket, grouped by phase exactly as before, each marked as completed and distinguishable from tickets that are currently on the board. No history, metric, label, phase or subticket relationship was lost.

**Why this priority**: The sweep is only acceptable if the work is not lost. The requester was explicit that swept tickets "quedan como done en el backlog". Without this, the sweep looks like deletion and the feature is unusable.

**Independent Test**: Count and record the backlog contents of a project, trigger a sweep, then re-open the backlog and confirm the same tickets are present, in the same phase grouping, now marked completed, with their history and accumulated token/time totals intact.

**Acceptance Scenarios**:

1. **Given** a project that has just been swept, **When** the operator opens the backlog, **Then** every swept ticket appears with a status that identifies it as completed.
2. **Given** the same backlog, **When** the operator compares it to the backlog before the sweep, **Then** the set of tickets, their phase grouping, their parent/subticket nesting, their labels and their recorded token and time totals are unchanged.
3. **Given** a project with both swept tickets and tickets currently on the board, **When** the operator opens the backlog, **Then** the two kinds are visually and semantically distinguishable.
4. **Given** a swept ticket, **When** the operator opens its detail, **Then** its status history includes the transition that took it out of the completion column.

---

### User Story 4 - Return a completed ticket to the board (Priority: P4)

Work is sometimes not as finished as it looked. The operator finds a swept ticket in the backlog and puts it back onto the board by placing it in a column. From that moment it is an ordinary board ticket again and counts toward any future sweep.

**Why this priority**: Makes the sweep recoverable rather than one-way. Lower priority because the sweep is not destructive — the ticket still exists — so this is a convenience, not a data-safety requirement.

**Independent Test**: Sweep a project, then place one swept ticket back into a column and confirm it appears on the board, that the backlog now shows it as on-board again, and that a subsequent sweep picks it up normally.

**Acceptance Scenarios**:

1. **Given** a swept ticket, **When** the operator places it into a column of its project, **Then** it appears on the board in that column and is no longer marked completed.
2. **Given** a project whose board holds only one restored ticket, **When** that ticket is moved into the completion column, **Then** a sweep occurs again and the board empties again.
3. **Given** a restored ticket, **When** the operator inspects its history, **Then** both the sweep and the restoration are recorded.

---

### Edge Cases

- **Empty board**: the sweep condition requires at least one ticket on the board. A project with nothing on the board is never swept, so designating a completion column on an empty project does nothing.
- **Single-column project**: if the project's only column is the completion column, then the first ticket moved into it satisfies the condition and is swept immediately. This is correct but surprising; the configuration UI should make the consequence understandable rather than forbid it.
- **Ticket created directly into the completion column**: creating a ticket is not a move into the completion column, so it does not, by itself, trigger a sweep (see Assumptions). The ticket rests in the completion column until the next move into that column re-evaluates the condition.
- **Last non-completion ticket removed by deletion instead of by a move**: deleting the only ticket in "In Progress" can leave every remaining ticket sitting in the completion column without any move having occurred. Under the trigger defined here, no sweep happens until the next ticket enters the completion column. This is deliberately the narrow reading of the requirement.
- **Subtickets**: a subticket occupies a board column just like its parent. It counts toward the condition and is swept with everything else. A parent and its subtickets can therefore be swept together, and a subticket left in another column blocks the sweep.
- **Restoring only part of a family**: a parent may be returned to the board while its subtickets stay completed, or the reverse. Because completed ranks after every column (FR-011a), the parent-ordering rule stays satisfied in the first case, and the second case is no more permissive than what the board already allows for a subticket moved backwards today.
- **Restoring a completed ticket directly into the completion column**: this is a move into the completion column, so FR-008 requires the condition to be evaluated exactly as for any other move, and FR-017 forbids any actor from opting out. If the restored ticket is the only ticket on the board, the condition is met and it is swept again immediately — the operator sees it return to the backlog rather than settle on the board. This is the deliberate, determined consequence of FR-008 and FR-009, not an accident, and it is the same "correct but surprising" shape as the single-column project above. Restoring the ticket into any *other* column leaves it on the board normally, which is the path an operator who wants to resume work should use — and per FR-023a it is the path a restore affordance takes by default, so an operator reaches the bounce only by explicitly asking for the completion column, or in a project whose only column is the completion column.
- **Concurrent deletion of a ticket that a sweep is about to take off the board**: deleting a ticket is not a trigger (narrow reading above) and does not serialize against a move, so a delete may land while a sweep is in flight. Either order is safe and neither may corrupt the board: a ticket deleted before the sweep executes is simply not swept, because it no longer exists; a ticket swept before the delete lands is deleted afterwards as an ordinary completed ticket. What MUST NOT happen is a record that disagrees with reality — the audit's swept-ticket count and identities must describe the tickets actually taken off the board (FR-021a), not a set observed before the sweep executed. If a concurrent delete empties the last non-completion column, no sweep occurs until the next move into the completion column, exactly as for any other deletion.
- **Reporting after a sweep**: a project that has been swept several times still reports the same **work totals** it would have reported if the sweep feature did not exist, because completed tickets keep counting (FR-019b). A sweep is not a way to reset metrics. A report that counts *transitions* is the one exception and does grow, by exactly one transition per swept ticket — the sweep really did move those tickets, and FR-019c pins that number so the exception stays bounded and cannot quietly widen.
- **Deleting the completion column**: the designation disappears with the column, leaving the project with no completion column and no automatic sweep until a new one is designated.
- **Deleting a column while it still holds tickets**: existing behavior relocates those tickets to another column. If the relocation target is the completion column, the condition is not re-evaluated (same narrow reading as above).
- **Concurrent moves**: two moves into the completion column arriving at the same time must not produce two sweeps, a partial sweep, or a sweep that misses a ticket that arrived in between.
- **Multiple projects**: the condition and the sweep are strictly per project. A full board in one project never affects another.
- **Renaming the completion column**: renaming does not change the designation; the column keeps meaning "finished" under its new name.
- **Reordering columns**: the completion column may sit anywhere in the order; the designation is independent of position.

## Requirements *(mandatory)*

### Functional Requirements

#### Configuration

- **FR-001**: Users MUST be able to designate one of a project's kanban columns as that project's **completion column** while configuring the project's columns.
- **FR-002**: A project MUST have at most one completion column at any time. Designating a second column MUST clear the designation from the previous one, as a single action, with no intermediate state in which two columns are designated.
- **FR-003**: Users MUST be able to clear the designation, leaving the project with no completion column.
- **FR-004**: The completion designation MUST be part of what is returned whenever a project's columns are listed, so that both the board interface and an automated agent can read it.
- **FR-004a**: An automated agent MUST be able to set and clear the designation through the same column-configuration capability a person uses, with the same validation and the same single-designation guarantee. The agent MUST NOT hold or re-implement the sweep rule itself; it only reads and sets the designation and moves tickets.
- **FR-005**: Deleting the designated completion column MUST clear the designation along with it, and MUST NOT transfer the designation to another column.
- **FR-006**: Renaming or reordering the completion column MUST NOT change or clear its designation.
- **FR-007**: Existing projects MUST start with no completion column, so that every project behaves exactly as it does today until an operator opts in.

#### The sweep condition

- **FR-008**: The system MUST evaluate the sweep condition immediately after a ticket is moved into a project's completion column.
- **FR-009**: The sweep condition is met when, at the moment of evaluation, **every** ticket of that project that is currently on the board sits in the completion column, **and** at least one such ticket exists.
- **FR-010**: Tickets that are already completed (off the board) MUST NOT count when evaluating the condition, so a project can be swept repeatedly over its lifetime.
- **FR-011**: Subtickets that occupy a board column MUST count toward the condition exactly like top-level tickets.
- **FR-011a**: For the existing rule that a parent ticket may not advance past its own subtickets, "completed / off the board" MUST rank strictly after every column. A completed subticket therefore never blocks its parent from moving forward, and the rule MUST continue to hold unchanged for every ticket that is on the board.
- **FR-012**: The system MUST NOT evaluate or trigger the sweep for a project that has no completion column designated.

#### The sweep

- **FR-013**: When the condition is met, the system MUST take every ticket in the completion column off the board, so that afterwards every column of the project — including the completion column — holds no tickets.
- **FR-014**: The sweep MUST be all-or-nothing per project: either every ticket in the completion column leaves the board or none does. A failure MUST leave the board exactly as it was before the triggering move, and MUST be reported to whoever triggered it.
- **FR-014a**: An observer MUST never be able to see a partially swept board. At no moment may any read of the project — the board, the backlog, a ticket list or a report — return a state in which some tickets of one sweep have left the board and others have not. This is a requirement on what is observable, not merely a consequence of how the sweep is implemented.
- **FR-015**: The sweep MUST NOT delete or detach any ticket, subticket, label, phase assignment, status history entry, or recorded token/time metric.
- **FR-016**: The sweep MUST NOT alter the project's columns, their order, or their designation.
- **FR-017**: The sweep MUST be triggered by the same action for any actor — a person using the board interface or an automated agent using the ticket tools — with identical results. No actor may opt out of it, and no actor may trigger it separately from a qualifying move.

#### Visibility and traceability

- **FR-018**: Swept tickets MUST remain listed in the project backlog, retaining their phase grouping, their parent/subticket nesting, their labels and their recorded totals.
- **FR-019**: The backlog MUST present a swept ticket with a status that identifies it as completed, and MUST let a viewer distinguish tickets that are off the board from tickets currently in a column.
- **FR-019a**: The board MUST show only tickets that are currently placed in a column. Completed tickets MUST NOT appear on the board in any form — not in the completion column, not in a hidden or collapsed lane.
- **FR-019b**: Project-wide reports, per-project totals, per-ticket token and time metrics, and the backlog's own ticket count MUST continue to include completed tickets. A sweep MUST NOT change any **aggregate of recorded work** — token totals, time totals, per-ticket metrics and the backlog's ticket count MUST be identical immediately before and immediately after a sweep. Reports whose subject is **movement itself**, such as a count of status transitions, are the deliberate exception: they MUST include the transitions FR-020 records for a sweep, because those transitions genuinely occurred and a report that hid them would misrepresent the audit trail. Such a report MUST NOT be made sweep-blind by matching on a column name, because the reserved name a swept ticket transitions to can collide with a user-chosen column name.
- **FR-019c**: The transition count a sweep adds MUST be pinned by a test asserting both halves — that transition-counting reports gain exactly one recorded transition per swept ticket, and that token and time aggregates gain nothing — so the boundary drawn in FR-019b cannot drift silently in either direction.
- **FR-020**: Each swept ticket MUST get a status-history entry recording its transition out of the completion column, attributed to the user whose action triggered the sweep. These entries are ordinary history: they are visible wherever transitions are reported, by design and per FR-019b.
- **FR-021**: The sweep MUST produce an audit record identifying the project, the completion column, the number of tickets swept, and the user whose action triggered it.
- **FR-021a**: The sweep has no actor of its own, so every path that can trigger one MUST credit the actor of the triggering move. When the move is made by a person, that person is credited. When the move arrives from an automated agent, the credited actor is the account that agent authenticates as — the agent acts with ordinary account credentials, not as an anonymous or system actor. The recorded number of swept tickets and the recorded ticket identities MUST describe the tickets the sweep actually took off the board, so that the record cannot overstate a sweep whose contents changed between evaluation and execution.
- **FR-022**: Board views that are open when a sweep occurs MUST reflect the emptied board without the viewer taking any manual action. The sweep MUST announce itself with a single project-scoped live-update signal covering the whole sweep, not one signal per swept ticket.

#### Reversibility

- **FR-023**: Users MUST be able to put a completed (off-board) ticket back onto the board by placing it into a column of its project.
- **FR-023a**: A restore affordance that picks the destination on the operator's behalf MUST default to the project's first column **that is not the completion column**, so that restoring does not immediately re-satisfy the sweep condition and bounce the ticket back off the board. If the completion column is the project's only column, it is used and the immediate re-sweep of the edge case below is the accepted outcome. Restoring into the completion column MUST remain possible when the operator asks for it explicitly — this requirement constrains the default destination only, and grants no actor an exemption from FR-017.
- **FR-024**: A restored ticket MUST count toward the sweep condition again, and its restoration MUST be recorded in its status history.
- **FR-025**: Creating a new ticket MUST place it on the board as it does today; a project's previous sweeps MUST have no effect on newly created tickets.

### Key Entities

- **Kanban Column**: a named, ordered lane belonging to a project. Gains one new attribute: whether it is the project's completion column. At most one column per project carries it.
- **Ticket**: an item of work belonging to a project. Gains one new aspect of its state: whether it is currently **on the board** (and if so, in which column) or **completed and off the board**. A ticket that is off the board still belongs to its project, phase, label and parent, still carries its recorded token and time totals, and still counts in every report. For any ordering comparison between tickets, **completed ranks after every column**.
- **Backlog Entry**: the project-wide, phase-grouped view of every ticket regardless of board placement. Its per-ticket status must now express "completed / off the board" as well as the name of the column a ticket sits in.
- **Ticket Status History**: the per-ticket record of status transitions. Gains entries for leaving the completion column during a sweep and for being restored to the board.
- **Audit Record**: the per-action record of who changed what. Gains an entry for the sweep and for changing a column's completion designation.

## Success Criteria *(mandatory)*

Every criterion below is verifiable before release — by test, by measurement or by inspection — **except SC-010**, which is explicitly labelled a post-launch adoption outcome because it measures operator behavior over time. Only the pre-release criteria gate implementation.

### Measurable Outcomes

- **SC-001**: An operator can designate a project's completion column in under 30 seconds from the project configuration screen, with no other setup step required.
- **SC-002**: In 100% of cases where the last ticket on the board enters the completion column of a project that has one, the board ends up with zero tickets in every column.
- **SC-003**: No work is ever lost: the number of tickets a project reports in its backlog is identical immediately before and immediately after a sweep, for 100% of sweeps.
- **SC-004**: 100% of swept tickets are visible in the backlog with a completed status immediately after the sweep, retaining their phase, label, nesting and recorded totals.
- **SC-005**: A board that is open when a sweep occurs shows the emptied board within 5 seconds without the viewer refreshing or navigating.
- **SC-006**: Projects with no completion column designated experience zero sweeps — the feature causes no observable behavior change for them.
- **SC-007**: 100% of swept tickets carry a status-history entry describing their exit from the completion column, so any past sweep can be reconstructed from a ticket's own record.
- **SC-008**: A sweep that fails part-way leaves 0 tickets in an inconsistent placement, verified by forcing a failure mid-sweep.
- **SC-009**: Repeated batches work indefinitely: a project can be filled, swept, refilled and swept again at least 3 times in a row with correct results each time.
- **SC-010** *(post-launch adoption outcome — not an implementation gate)*: Operators stop clearing finished cards by hand — manual "delete or move the Done pile" actions on projects with a completion column drop to zero. **Instrument**: the existing audit log, which already records a `ticket.moved` and a `ticket.deleted` entry per action with the acting user; the measurement is the count of such actions against tickets sitting in a designated completion column, compared before and after adoption. **Why it is not a gate**: this measures operator behavior over time after release, so no requirement or design artifact can satisfy it and no pre-merge test can falsify it. It is recorded here to state the feature's purpose and to name the instrument that will confirm it, and it MUST NOT be used to block implementation.
- **SC-011**: Sweeping does not alter recorded work: for a project taken through 3 fill-and-sweep cycles, every per-ticket token/time total, every project-wide token and time aggregate, and the backlog's ticket count are identical to the figures the same activity would produce with no completion column designated. Reports that count status transitions are excluded from this comparison per FR-019b; their expected change is pinned separately by FR-019c.
- **SC-012**: An automated agent can designate a project's completion column and then drive a full batch to a sweep using only the capabilities exposed to it, with no human step in between.

## Assumptions

These defaults were chosen where the requirement did not state an answer. Each is recorded so it can be challenged during clarification rather than discovered during implementation. Each names the requirements that would have to change if it were overturned, so the cost of a wrong default is visible before implementation rather than after.

- **One completion column per project.** The requester wrote "una columna ... que quiero usar como columna de terminación" in the singular. Allowing several would make "all tickets are in that column" ambiguous. *If overturned:* FR-002 (at most one) and FR-009 (the condition's meaning) are rewritten, and the database-level uniqueness guarantee in the design is discarded.
- **Opt-in, and off by default.** No project — existing or new — has a completion column until someone designates one. This keeps every current board working unchanged. *If overturned:* FR-007 and FR-012 change, and the migration gains a data backfill it currently forbids.
- **The trigger is a move into the completion column (narrow reading).** The requester described the trigger as "cuando se agrega el último ticket a DONE". Other events that could incidentally satisfy the same state — deleting the last ticket of another column, or relocating tickets while deleting a column — are deliberately *not* treated as triggers in this version. This is the narrower and safer reading: it can only under-trigger, never surprise the user with a board that empties itself after an unrelated action. Broadening it later is additive. *If overturned:* FR-008 gains further evaluation points, and the two Edge Cases about deletion and column-deletion relocation invert.
- **"Off the board" is a state of the ticket, not a special column.** The requester asked for the tickets to leave the completion column and be "done en el backlog". The backlog is already a project-wide list rather than a column, so a swept ticket is modelled as a ticket with no board placement, not as a ticket parked in a hidden column. *If overturned:* FR-013, FR-019a and the Ticket entity change shape, and the whole data model is rebuilt around a hidden column instead.
- **Swept tickets are marked completed rather than merely uncategorised.** A viewer of the backlog must be able to tell "finished" apart from "not yet started", so the completed state carries a status of its own rather than an empty one. *If overturned:* FR-019 loses its distinguishability guarantee.
- **The sweep is automatic and needs no confirmation.** The requester described it as an automatic consequence of the last move. Reversibility (FR-023) is what makes this safe, rather than a prompt. *If overturned:* FR-013 and FR-017 gain a confirmation step, which would also have to be defined for an agent that cannot be prompted.
- **Subtickets are ordinary board tickets for this purpose.** They occupy columns today, so they both block and participate in the sweep. *If overturned:* FR-011 inverts and FR-011a's ordering rule needs a different resolution.
- **The user credited with the sweep is the one whose move triggered it**, since the sweep has no separate actor of its own. *If overturned:* FR-021 and FR-021a change, and the system needs a system-actor identity it does not currently have.
- **Scope excludes**: bulk re-opening of a whole swept batch, per-user or per-role restrictions on who may sweep, scheduled or time-based sweeping, and archiving swept tickets out of the backlog after some retention period. None was requested.

## Dependencies

- Relies on the existing project → column → ticket structure, on the existing dedicated "move a ticket to a column" action, and on the existing per-ticket status history.
- Relies on the existing project backlog view as the place where completed work stays visible.
- Relies on the existing live-update channel that keeps open boards in sync, so that FR-022 does not need a new delivery mechanism.
- The automated-agent tool surface that exposes column management and ticket moves must expose the new designation as well, so an agent can read which column is the completion column; it must not implement the sweep rule itself.
