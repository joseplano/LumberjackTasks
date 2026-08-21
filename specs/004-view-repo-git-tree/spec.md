# Feature Specification: View repo — a graphical tree of the repository history

**Feature Branch**: `004-view-repo-git-tree`

**Created**: 2026-08-21

**Status**: Draft

**Input**: Approved design record `.specify/bridge/approved-design.md` (APPROVED by human partner, 2026-08-21), decisions D1–D10. Original user description: "Al lado del botón que dice crear un nuevo ticket que exista otro botón que diga view repo. Al hacer click ahí se entra en una pantalla que permite ver en forma de árbol la rama main de git y todas las ramas creadas a modo de historia… cada branch tendrá un círculo pequeño que representará cada commit realizado… Si la rama ya fue mergeada con main se mostrará en color gris, si es activa se mostrará en verde. La main se mostrará en azul. Si la rama no está commiteada va en amarillo… El árbol se mostrará de izquierda a derecha y existirá una barra en la parte inferior para poder desplazarla."

## Clarifications

### Session 2026-08-21

No questions were put to the human partner in this session: every ambiguity found by the
coverage scan was answerable from an authoritative source already on record. Each resolution
below names the source that settled it. Nothing here overrides an approved decision.

- Q: When a branch that was previously synced no longer exists in the repository (for example it
  was deleted after being merged), is it removed from the view? → A: **No. A sync only adds and
  updates; it never deletes recorded branches, commits, files or ticket links.** Source: approved
  design D8 — "History therefore does not rewrite itself and each lane keeps its circles" — and
  the original request, which asks for "todas las ramas creadas a modo de historia" (all the
  branches created, as a history). Encoded as FR-032.
- Q: What is the "description" the branch modal shows, given the approved branch entity has no
  description field? → A: **It is composed from data already recorded for that branch — its name,
  its state, and its commit messages. No separately authored branch description is stored or
  reported.** Source: approved design D6, which enumerates the branch entity's fields and does
  not include a description; and D2, which enumerates exactly what the agent reads locally
  (`git log`, `git status`, `git branch --merged`), none of which yields an authored branch
  description. Encoded as FR-015.
- Q: What does the view show while it is loading, or when loading fails, as distinct from a
  project that has never been synced? → A: **Three distinguishable states: a loading indication
  while the history is being fetched, an error message when the fetch fails, and the
  never-synced empty state of FR-029.** Source: repository evidence — the existing project board
  and backlog screens already establish this convention (an error banner, then a "Loading…"
  placeholder, then content). Encoded as FR-033.
- Q: Who may open the repository view? → A: **Any authenticated user, with no per-project or
  per-user restriction, exactly like every other screen in this system.** Source: constitution
  v1.0.0 Principle III — the system is single-tenant by design and MUST NOT imply isolation that
  does not exist. Already encoded as FR-030; no change needed.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the repository history as a tree (Priority: P1)

A person looking at a project board wants to understand how the project's code history is
shaped: which branches exist, where each one forked from the trunk, how many commits it
carries, and which ones are finished. Today that information only exists on a developer's
machine. They open the project board, use a **View repo** control in the header next to
**View backlog** and **Add ticket**, and land on a read-only screen that draws the trunk as a
horizontal line running left to right, with every other branch as its own lane below it,
each commit a small circle in its lane. The tree scrolls horizontally along a scrollbar at
the bottom.

**Why this priority**: This is the feature. Without the drawing there is nothing to look at,
and every other story is a detail hung off it.

**Independent Test**: With history already recorded for a project, open the project board,
click **View repo**, and confirm the trunk line, one lane per branch, one circle per commit,
left-to-right ordering, and horizontal scrolling.

**Acceptance Scenarios**:

1. **Given** a project whose repository history has been recorded, **When** the user opens the
   project board, **Then** a **View repo** control is visible in the header alongside
   **View backlog** and **Add ticket**.
2. **Given** the user is on the project board, **When** they activate **View repo**, **Then**
   the repository view for that project opens.
3. **Given** the repository view is open for a project with recorded history, **Then** the trunk
   is drawn as a single horizontal line and every other branch is drawn as a separate lane
   beneath it.
4. **Given** a branch that forked from the trunk, **Then** its lane begins at its fork commit;
   **and given** that branch was merged back, **Then** its lane rejoins the trunk at the merge
   point.
5. **Given** a branch with N commits of its own, **Then** the lane shows exactly N circles, one
   per commit, ordered oldest-to-newest from left to right.
6. **Given** the history is wider than the viewport, **Then** the tree can be scrolled
   horizontally using a scrollbar along the bottom of the tree.

---

### User Story 2 - Read a branch's state from its colour (Priority: P1)

Someone scanning the tree needs to tell at a glance which work is finished, which is still in
flight, and which has not been committed yet. Colour carries that meaning.

**Why this priority**: The colour scheme was the largest part of the original request and is
the screen's primary information channel. It ships with the drawing or the drawing is
meaningless.

**Independent Test**: Record a set of branches covering trunk, merged, unmerged-with-commits,
dirty, and no-commits-of-its-own, then confirm each renders in the colour its rule dictates.

**Acceptance Scenarios**:

1. **Given** the trunk branch, **Then** it is drawn blue regardless of every other condition.
2. **Given** a non-trunk branch that has been merged into the trunk, **Then** it is drawn grey.
3. **Given** a non-trunk branch that has commits of its own and has not been merged into the
   trunk and has no uncommitted changes, **Then** it is drawn green.
4. **Given** a non-trunk, unmerged branch with uncommitted working-tree changes, **Then** it is
   drawn yellow.
5. **Given** a non-trunk, unmerged branch that has no commit of its own yet, **Then** it is drawn
   yellow.
6. **Given** a branch that is both merged into the trunk and has uncommitted changes, **Then**
   it is drawn grey, because merged outranks uncommitted.
7. **Given** a branch that has been pushed to a remote but not merged, **Then** it is drawn by the
   same rules as any other unmerged branch; being pushed is not itself a colour.

---

### User Story 3 - Inspect a single commit (Priority: P2)

Looking at a circle, a person wants to know what that commit actually was: its message, when
it happened, which tickets it advanced, and which files it touched.

**Why this priority**: This is the payoff for drawing individual commits, but the tree is
already useful without it.

**Independent Test**: Click a commit circle and confirm the modal shows that commit's
description, date, ticket list and file list.

**Acceptance Scenarios**:

1. **Given** the repository view, **When** the user clicks a commit circle, **Then** a modal opens
   showing that commit's description, its date, the tickets committed in it, and the files it
   changed.
2. **Given** a commit whose ticket links were reported by the agent, **Then** the modal presents
   those links as reported.
3. **Given** a commit whose ticket links were derived from the branch rather than reported,
   **Then** the modal marks them as inferred by branch, so an inference is never shown as
   reported fact.
4. **Given** a commit that changed more files than the stored limit, **Then** the modal lists the
   stored files and states how many further files were not stored.
5. **Given** the commit modal is open, **When** the user dismisses it, **Then** the tree is shown
   again unchanged.

---

### User Story 4 - Inspect a whole branch (Priority: P2)

A person wants the summary of a line of work, not one commit at a time: everything that branch
touched and what it was for.

**Why this priority**: Same class of value as the commit modal; useful, not load-bearing.

**Independent Test**: Click a branch lane or its label and confirm the modal shows that
branch's tickets, files and description.

**Acceptance Scenarios**:

1. **Given** the repository view, **When** the user clicks a branch lane or its label, **Then** a
   modal opens showing that branch's tickets, the files its commits changed, and its
   description.
2. **Given** a branch whose ticket associations were inferred rather than reported, **Then** the
   modal marks them as inferred, exactly as the commit modal does.

---

### User Story 5 - Know how fresh the picture is, and what to do when it is empty (Priority: P2)

The screen is a mirror of a repository that lives elsewhere. A person must never mistake it
for the truth, and must never be shown a blank canvas with no explanation.

**Why this priority**: This is the honesty requirement that makes a mirrored view safe to
ship. It is cheap and it prevents the worst failure mode: silent staleness.

**Independent Test**: Open the repository view for a project that has never been synced and
confirm the explanatory empty state; open one that has been synced and confirm the last-synced
timestamp.

**Acceptance Scenarios**:

1. **Given** a project whose repository history has been recorded, **Then** the repository view
   header shows when that history was last synced.
2. **Given** a project whose repository history has never been recorded, **Then** the view shows
   an empty state explaining how to sync, and never a blank canvas or fabricated history.
3. **Given** the repository view is opened, **While** the history is still being fetched, **Then**
   the view indicates that it is loading, and does not show the never-synced empty state.
4. **Given** the history cannot be fetched, **Then** the view shows an error naming the reason,
   and does not show an empty history or the never-synced empty state.

---

### User Story 6 - Record history from the working repository (Priority: P1)

The history has to get into the system. The agent, which is the only participant that can see
the repository, deliberately reports branch, commit, file and ticket-link state; and a one-time
backfill loads the history that already exists so the screen is useful the day it ships.

**Why this priority**: Nothing renders without this, and a screen that ships empty for weeks
delivers nothing. It is the first thing that must be built and verified.

**Independent Test**: Run a sync against a project, then read the recorded branches, commits,
files and ticket links back; run the backfill against an existing repository and confirm the
full existing history is present.

**Acceptance Scenarios**:

1. **Given** a repository with branches and commits, **When** the agent performs a sync for a
   project, **Then** the branches, their commits, each commit's parent commit identifiers, each
   commit's changed files, and the reported commit-to-ticket links are recorded against that
   project.
2. **Given** a sync has already been performed, **When** the same history is synced again,
   **Then** no duplicate branch, commit, file or ticket-link records are created, and changed
   branch state and the last-synced timestamp are updated.
3. **Given** a repository with pre-existing history and no prior sync, **When** the one-time
   backfill is run, **Then** the trunk, every existing branch, their commits, files and merge
   points are recorded.
4. **Given** a commit that changed more files than the stored limit, **When** it is recorded,
   **Then** at most the limit is stored together with a count of the files that were not stored.
5. **Given** a commit recorded without any reported ticket links, **When** it is read back,
   **Then** the tickets shown for it are those whose recorded branch matches the commit's branch,
   and each is marked as inferred rather than reported.
6. **Given** a commit that was introduced on a branch, **When** that branch is later merged into
   the trunk and synced again, **Then** the commit remains attributed to the branch it was
   introduced on and does not move to the trunk lane.
7. **Given** a branch that was recorded by an earlier sync, **When** it no longer exists in the
   repository and a further sync is performed, **Then** the branch and its commits, files and
   ticket links remain recorded and are still drawn.
8. **Given** a sync that cannot complete, **Then** it reports the reason and does not silently
   record a partial or empty history.

---

### Edge Cases

- **A branch that exists with no commits of its own** — drawn yellow (D5), with a lane and a
  label but no circles.
- **A branch that is both merged and has uncommitted changes** — drawn grey; merged outranks
  uncommitted (D5 precedence).
- **The trunk with uncommitted changes** — drawn blue; the trunk is always blue.
- **A commit touching thousands of files** — the stored file list is capped and the modal states
  how many more files exist, rather than listing an unbounded set or silently truncating.
- **A merged branch's commits** — they keep their original lane. History does not rewrite itself.
- **A backfilled commit with no reported ticket links** — links are inferred by branch and
  labelled as inferred.
- **A project that has never been synced** — an empty state explaining how to sync.
- **A project whose recorded history is stale** — surfaced through the last-synced timestamp, not
  hidden.
- **Re-syncing history that is already recorded** — updates in place; it does not duplicate.
- **A branch whose fork point is not recorded** (its parent history was never synced) — it is
  drawn as a lane anchored at its earliest recorded commit, rather than being dropped from the
  tree or attached to a fabricated fork point.
- **A branch deleted from the repository after it was recorded** — it stays in the tree with its
  commits and its last recorded state. Sync never deletes (FR-032).
- **A branch that is not the one currently checked out** — it can only reach the yellow state
  through the "no commit of its own" half of FR-010 rule 3. A working tree belongs to the branch
  that is checked out, so uncommitted changes can only ever be observed for that branch. This is a
  property of how repositories work, not a defect: yellow-for-dirty is by nature a statement about
  the branch someone is standing on.
- **A branch modal for a branch with a very long history** — the commit messages used to compose
  the description may be a capped subset; the modal says so rather than implying it is complete
  (FR-015).
- **The history fails to load** — an error naming the reason, never a silently empty tree and
  never the never-synced empty state (FR-033).

## Requirements *(mandatory)*

### Functional Requirements

**Entry point and navigation**

- **FR-001**: The project board header MUST offer a **View repo** control, positioned alongside
  the existing **View backlog** and **Add ticket** controls, styled consistently with
  **View backlog**.
- **FR-002**: Activating **View repo** MUST open a repository view scoped to that project.
- **FR-003**: The repository view MUST be read-only. It MUST NOT create, modify or delete any
  domain state, and MUST NOT become a second write path for repository history.

**Tree rendering**

- **FR-004**: The repository view MUST draw the trunk branch as a single horizontal line running
  left to right, oldest commit at the left.
- **FR-005**: The repository view MUST draw every non-trunk branch as its own lane below the
  trunk line.
- **FR-006**: A branch lane MUST begin at the commit it forked from, and, when the branch has
  been merged into the trunk, MUST rejoin the trunk at its merge point.
- **FR-007**: Fork and merge connections MUST be derived from the recorded parent commit
  identifiers of each commit, so the drawn topology matches the recorded history rather than
  being inferred from ordering alone.
- **FR-008**: Every recorded commit MUST be drawn as a small circle in the lane of the branch it
  was introduced on.
- **FR-009**: The tree MUST scroll horizontally, with a scrollbar along the bottom of the tree.

**Branch colour**

- **FR-010**: Each branch MUST be assigned exactly one of four states, resolved by applying these
  rules in strict order and stopping at the first that matches:
  1. the branch is the trunk → **blue**;
  2. the branch has been merged into the trunk → **grey**;
  3. the branch has uncommitted working-tree changes, **or** has no commit of its own → **yellow**;
  4. otherwise → **green**.
- **FR-011**: The trunk MUST be blue regardless of any other condition. The trunk is never
  evaluated against the merged rule, so rules 1 and 2 can never both apply.
- **FR-012**: A commit circle MUST be drawn in the colour of the branch it belongs to.
- **FR-013**: Having been pushed to a remote MUST NOT be a branch state and MUST NOT introduce a
  fifth colour. A pushed branch is coloured by FR-010 like any other.

**Detail modals**

- **FR-014**: Clicking a commit circle MUST open a modal showing that commit's description, its
  date, the tickets associated with it, and the files it changed.
- **FR-015**: Clicking a branch lane or its label MUST open a modal showing that branch's
  tickets, the files changed across its commits, and the branch's description. The branch
  description MUST be composed from data already recorded for that branch — its name, its state,
  and the messages of its commits. No separately authored branch description is stored or
  reported (Clarifications, 2026-08-21). Where the set of commit messages used is capped rather
  than complete, the modal MUST say so, on the same principle as FR-017: a shortened list is never
  presented as the whole.
- **FR-016**: Any ticket association that was inferred rather than reported MUST be visibly
  labelled as inferred by branch, in both modals. An inference MUST NEVER be presented as
  reported data.
- **FR-017**: When a commit's stored file list was truncated, the modal MUST state how many
  further files exist rather than presenting the stored list as complete.

**Recording history**

- **FR-018**: Repository history MUST be recorded only through the existing agent write path.
  The agent, which reads the repository locally, is the only writer, consistent with the rule
  already governing the recorded ticket branch.
- **FR-019**: A sync MUST carry, for a project: each branch with its name, whether it is the
  trunk, the branch it originated from, its state and the time it was synced; each commit with
  its identifier, message, author, date, whether it has been pushed, whether it is a merge
  commit, and its parent commit identifiers; each commit's changed files with the kind of change
  (added, modified, deleted, renamed); and the commit-to-ticket links the agent reports.
- **FR-020**: Sync MUST be an explicit, deliberate operation. It MUST NOT be driven by an
  automatic per-action hook, and it MUST NOT fail silently: a sync that cannot complete MUST
  report why.
- **FR-021**: The agent's working instructions MUST direct it to sync after committing and after
  changing branch.
- **FR-022**: A one-time backfill MUST be able to walk the whole existing history of a repository
  and record it, so the view is populated with history that predates the feature.
- **FR-023**: At most 500 files MUST be stored per commit. When a commit changed more, the count
  of files not stored MUST be recorded alongside it.
- **FR-024**: A commit MUST be attributed to the branch it was introduced on, determined by its
  first parent, and MUST NEVER be reassigned to another branch, including when its branch is
  merged into the trunk.
- **FR-025**: When a commit has no ticket link reported by the agent, the tickets shown for that
  commit MUST be those whose recorded branch matches the commit's branch, and they MUST be
  presented as inferred rather than reported. Reported and inferred associations MUST be
  distinguishable wherever either is shown. Whether an inferred association is stored or derived
  when read is an implementation choice, provided the presented behaviour is this one.
- **FR-026**: Re-syncing history that is already recorded MUST update the existing records in
  place rather than creating duplicates. Commit identity is the commit identifier within a
  project; branch identity is the branch name within a project.
- **FR-027**: Recording history MUST NOT store any access token, credential, or filesystem path.

**Freshness, emptiness and honesty**

- **FR-028**: The repository view MUST show when the project's history was last synced.
- **FR-029**: When a project has never been synced, the repository view MUST show an empty state
  that explains how to sync, and MUST NOT show a blank canvas or fabricated history.
- **FR-030**: The repository view MUST NOT imply per-user ownership or isolation of projects,
  branches or commits, because none exists in this system.
- **FR-031**: `README.md` MUST document the new user-visible behaviour.
- **FR-032**: A sync MUST NOT delete recorded history. Branches, commits, files and ticket links
  that were recorded by an earlier sync MUST remain recorded even when they no longer exist in
  the repository — for example a branch deleted after being merged. Sync adds and updates only.
- **FR-033**: The repository view MUST distinguish three states and MUST NOT conflate them:
  history is being loaded; history could not be loaded, with the reason shown; and the project
  has never been synced (FR-029). A failure to load MUST NOT be presented as an empty history.

### Key Entities

- **Repository branch**: a line of development within a project. Carries its name, whether it is
  the project's trunk, the branch it originated from, its current state (uncommitted, active, or
  merged) and the time it was last synced. Belongs to exactly one project.
- **Repository commit**: a single recorded commit. Carries its identifier, message, author, date,
  whether it has been pushed, whether it is a merge commit, and the identifiers of its parent
  commits. Belongs to exactly one branch — the one it was introduced on — and that attribution
  never changes.
- **Commit file**: one file a commit changed, carrying its path and the kind of change (added,
  modified, deleted, renamed). Belongs to exactly one commit, capped per FR-023.
- **Commit–ticket link**: the association between a commit and a ticket it advanced, carrying
  whether the association was reported by the agent or inferred from the branch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the project board, a user reaches the repository view for that project in a
  single click, via a control visible in the board header without scrolling.
- **SC-002**: After a backfill against a repository with existing history, the repository view
  draws the trunk plus every existing branch, with one circle per recorded commit in its own
  lane, ordered left to right and scrollable horizontally — with no branch or commit from the
  recorded history missing from the drawing.
- **SC-003**: For every branch in the recorded history, the colour drawn is exactly the colour
  FR-010's ordered rules produce for that branch's state, with no branch drawn in a colour
  outside the four defined states. In particular: a merged branch is grey even when it also has
  uncommitted changes, the trunk is blue in every case, and an unmerged branch carrying commits
  with a clean working tree is green.
- **SC-004**: Clicking any commit circle opens a modal that shows that commit's description,
  date, files and tickets — for 100% of recorded commits, including commits with zero files and
  commits with zero tickets.
- **SC-005**: Clicking any branch lane or label opens a modal showing that branch's tickets,
  files and description — for 100% of recorded branches, including a branch with no commits.
- **SC-006**: Every ticket association displayed anywhere in the view is identifiable as either
  reported or inferred; no inferred association is displayed without its inferred marker.
- **SC-007**: A project that has never been synced shows an explanatory empty state — never a
  blank canvas and never fabricated data — in 100% of cases.
- **SC-008**: The last-synced timestamp is visible on the repository view whenever any history
  has been recorded for the project.
- **SC-009**: A commit with more than 500 changed files displays at most 500 files plus an
  explicit count of the remainder, and never claims the list is complete.
- **SC-010**: Syncing the same unchanged history twice in a row leaves the drawn tree identical
  and does not increase the number of branches, commits, files or ticket links recorded.
- **SC-011**: A branch that was recorded and then deleted from the repository is still present in
  the drawn tree after the next sync, with the same commits in the same lane.
- **SC-012**: A failure to load the history is shown as an error naming the reason, and is never
  shown as an empty or never-synced history; the loading, failed and never-synced states are
  distinguishable from one another in 100% of cases.

## Assumptions

- **Trunk is `main`.** The project's trunk branch is `main`, matching this repository and the
  constitution's development workflow ("work on a topic branch off `main`"). "Trunk" is used in
  this spec wherever the approved design says `main`.
- **The agent is the only source of repository history.** Reading a forge API and mounting the
  repository into the backend were both considered and rejected in the approved design; neither
  is in scope. The consequence is that history exists in this system only as far as the agent
  has reported it, which is why FR-028 and FR-029 exist.
- **Sync is idempotent (FR-026).** The approved design has the agent syncing repeatedly — on each
  commit and each branch change — and separately has a one-time backfill. Both cannot hold
  unless repeated syncing updates in place. Commit identifier and branch name are used as the
  identities because they are already the natural keys of the underlying history.
- **Ticket-link inference uses the existing recorded ticket branch.** FR-025's inference matches
  tickets on the branch value that feature 002 already records per ticket; no new matching
  mechanism is introduced.
- **Uncommitted state is local and volatile.** Yellow only exists while the agent reports it. A
  branch's yellow state is expected to disappear on the next sync after the work is committed,
  and this is intended, not a defect.
- **Repository facts have moved since the design was approved.** The approved design's D5 note
  and its acceptance criterion 3 illustrate the green state with "branches `002` and `003`,
  currently pushed but unmerged, render green". As of 2026-08-21 both have since been merged into
  `main` (merge commits `df37b90` and `92d4063`), so applying FR-010 to this repository now draws
  them **grey** — exactly the transition the design's own text predicts ("cuando se pushea a main
  y se mergea pasa a gris"). SC-003 is therefore stated as a rule over branch state rather than
  pinned to those two branch names. Branch `004-view-repo-git-tree` itself, unmerged and carrying
  commits, is the green case available for verification on this repository.
- **Scope is one feature, not two.** Recording history and drawing it ship together (D1). Split
  delivery was offered and declined, because the data pipeline alone produces nothing visible.
- **No new drawing dependency.** The tree is drawn with what the stack already has; a git-graph
  rendering library was considered and rejected in the approved design.
- **A fifth colour for "pushed but not merged" is out of scope.** It was not requested and is
  deliberately excluded (FR-013).
- **The whole recorded history for one project is drawn at once; paging the tree is out of
  scope.** The supported deployment is a single self-hosted instance on `localhost` (constitution
  Principle III) mirroring one repository per project, so the recorded history is small. No
  pagination, windowing or level-of-detail behaviour is specified. If a repository ever grows
  large enough for this to hurt, that is a new feature, not a defect in this one.
- **Sync is additive (FR-032).** The recorded history is a cumulative record, not a snapshot of
  the repository's current shape. This follows D8; it also means the view can show a branch the
  developer has since deleted.
