# Feature Specification: Copy the branch URL, not just the branch name

**Feature Branch**: `003-copy-branch-url`

**Created**: 2026-08-16

**Status**: Ready for planning

**Input**: User description: "en los tickets, en el nombre del branch del repo en la opcion de copiar, que al portapapeles te copie toda la url incluye el branch asi podemos ir directamente al branch al repo"

**Approved design**: `.specify/bridge/approved-design.md` (APPROVED by the human partner; every decision below traces to it)

**Stacking note**: this feature modifies the branch block and copy control introduced by feature `002-ticket-git-branch-view`, which is committed but deliberately not merged into `main`. This branch is therefore cut from `002-ticket-git-branch-view`, not from `main`.

## Relationship to feature 002 *(supersession, explicit)*

Feature 002 states in **FR-021**: "The copy control MUST place the exact branch text on the clipboard and confirm the copy." This feature **narrows and supersedes the payload half of that requirement**: the control now places the branch *URL* on the clipboard whenever one can be built from the project's configured repository URL, and continues to place the exact branch text when one cannot. Everything else in 002's FR-021 — the confirmation, the non-secure-context fallback, the absence of trimming or decoration of the branch value itself — is preserved unchanged. Feature 002's spec is a historical record of a completed feature and is not rewritten; this section is the authoritative statement of the change (see FR-010).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump straight to the branch in the forge (Priority: P1)

A person is looking at a ticket whose agent has reported a git branch. The project has its repository URL configured. They press the copy control in the branch block and paste into the browser address bar; the browser opens that branch in the repository, with no manual URL assembly.

**Why this priority**: this is the entire point of the feature — it removes the manual step of finding the repository, then finding the branch, every time someone wants to look at the code behind a ticket.

**Independent Test**: configure a project with a repository URL, open a ticket that has a branch, press copy, and inspect the clipboard: it holds a URL that addresses that branch in that repository.

**Acceptance Scenarios**:

1. **Given** a project whose repository URL points at a GitHub repository and a ticket with the effective branch `feature/x`, **When** the person activates the copy control, **Then** the clipboard holds `<repository URL>/tree/feature/x` and the copy confirmation appears.
2. **Given** the same ticket in a project whose repository URL points at GitLab, **When** the person activates the copy control, **Then** the clipboard holds `<repository URL>/-/tree/feature/x`.
3. **Given** the same ticket in a project whose repository URL points at Bitbucket, **When** the person activates the copy control, **Then** the clipboard holds `<repository URL>/src/feature/x`.
4. **Given** the same ticket in a project whose repository URL points at Azure DevOps, **When** the person activates the copy control, **Then** the clipboard holds `<repository URL>?version=GBfeature%2Fx`.
5. **Given** a project whose repository URL is on a host that is none of the four recognised forges, **When** the person activates the copy control, **Then** the clipboard holds the GitHub-shaped URL `<repository URL>/tree/feature/x`.

---

### User Story 2 - The control never becomes useless or misleading (Priority: P1)

A person uses the same control in a project whose repository URL has not been filled in — the current state of this very project — or whose stored value is not a usable URL. The control keeps working exactly as it does today, copying the branch name, and it says so before it is pressed.

**Why this priority**: equal in priority to Story 1 because it is what makes Story 1 safe to ship. A control that silently copies a broken URL, or that disappears when a setting is missing, is worse than the control that exists today.

**Independent Test**: open a ticket with a branch in a project whose repository URL is empty, read the control's accessible name, press it, and inspect the clipboard: it holds the branch name and the accessible name said so.

**Acceptance Scenarios**:

1. **Given** a project with an empty repository URL and a ticket with the effective branch `feature/x`, **When** the person activates the copy control, **Then** the clipboard holds exactly `feature/x` and the copy confirmation appears.
2. **Given** a project whose stored repository URL is not a usable URL (for example `not a url` or an `ssh://`-less fragment), **When** the person activates the copy control, **Then** the clipboard holds exactly the branch name.
3. **Given** a project with an empty repository URL, **When** the person inspects the copy control before pressing it, **Then** its accessible name and its tooltip both read `Copy branch name`.
4. **Given** a project whose repository URL yields a branch URL, **When** the person inspects the copy control before pressing it, **Then** its accessible name and its tooltip both read `Copy branch URL`.

---

### User Story 3 - Repository URLs as people actually store them (Priority: P2)

A person has stored the repository URL in whatever form their forge offered them: an SSH remote, an https URL ending in `.git`, or one with a trailing slash. The copied URL is correct regardless.

**Why this priority**: it broadens Story 1 from "works if the URL was typed in the one canonical form" to "works with what people paste". Story 1 is still valuable without it, which is why it is P2 rather than P1.

**Independent Test**: store the same repository in SSH form, with a `.git` suffix, and with a trailing slash, and confirm all three produce the identical branch URL.

**Acceptance Scenarios**:

1. **Given** a repository URL stored as `git@github.com:owner/repo.git` and the effective branch `main`, **When** the person activates the copy control, **Then** the clipboard holds `https://github.com/owner/repo/tree/main`.
2. **Given** a repository URL stored as `https://github.com/owner/repo.git`, **When** the person activates the copy control, **Then** the clipboard holds `https://github.com/owner/repo/tree/main`.
3. **Given** a repository URL stored as `https://github.com/owner/repo/` or with surrounding whitespace, **When** the person activates the copy control, **Then** the clipboard holds `https://github.com/owner/repo/tree/main`.

---

### Edge Cases

- **Repository URL empty** — the current state of this project. The branch name is copied; the control's accessible name says `Copy branch name`. Not a defect (FR-004, FR-006).
- **Repository URL is not a usable web URL** — anything that does not normalise to an `http` or `https` address, including an unsupported scheme such as `ftp://`, yields no URL, so the branch name is copied (FR-003c, FR-004).
- **Repository URL in SSH form** — `git@host:owner/repo.git` is read as the https repository `https://host/owner/repo` (FR-003a).
- **Repository URL written as an explicit `ssh://` URL** — for example `ssh://git@host/owner/repo.git`. Only the `git@host:path` shorthand is converted (FR-003a), so an explicit `ssh://` value keeps a non-web scheme and is rejected by FR-003c: the branch name is copied. This is the approved empty-state behaviour applying to a form the approved design did not include, not a silent gap — the control stays useful and never copies an address a browser cannot open.
- **Repository URL with a `.git` suffix, a trailing slash, or surrounding whitespace** — all three are removed before the branch URL is built (FR-003b).
- **Branch containing slashes** — `feature/x` keeps its slashes in the path segment for GitHub, GitLab and Bitbucket, because that is the address those forges answer to. For Azure DevOps the branch travels in a query parameter, so it is encoded (`feature%2Fx`) (FR-005, FR-005a).
- **Unrecognised host** — a self-hosted or unknown forge produces the GitHub-shaped URL rather than refusing to build one (FR-003d). If that URL is wrong for that host, the person still holds a repository address they can navigate from, which is strictly more than the branch name alone.
- **Azure DevOps repository URL that already carries a query string** — the version parameter is appended to the existing query rather than replacing it (FR-005a).
- **Ticket with no effective branch** — the branch block already renders `Sin rama aún` and no copy control at all, so there is nothing for this feature to change (FR-009).
- **Non-secure context (plain-HTTP LAN proxy)** — the existing hidden-textarea fallback copies the same string the primary path would have copied; the payload choice is made before the copy mechanism is selected (FR-007).
- **Inherited branch** — a subticket showing its parent's branch copies a URL to that same inherited branch; inheritance changes which branch is effective, never how it is copied (FR-009).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a ticket's branch block is shown and the ticket has an effective branch, the copy control MUST place a URL addressing that branch in the project's repository on the clipboard, whenever such a URL can be derived from the project's configured repository URL.
- **FR-002**: The branch URL MUST be derived solely from the project's already-available repository URL and the ticket's already-available effective branch. No new data may be requested from, or stored in, the backend for this feature.
- **FR-003**: Deriving the repository address from the stored value MUST apply, in this order: strip surrounding whitespace; convert the SSH remote form to its https equivalent; strip a trailing `.git`; strip a trailing `/`.
  - **FR-003a**: `git@<host>:<path>` MUST be read as `https://<host>/<path>`.
  - **FR-003b**: A trailing `.git` and a trailing `/` MUST both be removed, in that order, so that `https://host/owner/repo.git/` and `https://host/owner/repo` address the same repository.
  - **FR-003c**: If the normalised value is not an `http` or `https` address, no branch URL exists for that project.
  - **FR-003d**: The forge shape MUST be selected from the host: GitHub, GitLab, Bitbucket and Azure DevOps each have their own; any other host MUST use the GitHub shape.
- **FR-004**: When no branch URL exists — the repository URL is empty, blank, or does not normalise to an `http`/`https` address — the copy control MUST place the exact effective branch text on the clipboard, exactly as it does today. It MUST NOT become disabled, hidden, or copy an incomplete address.
- **FR-005**: The branch URL MUST address the branch itself, using the shape the host expects: `<repo>/tree/<branch>` for GitHub and for unrecognised hosts, `<repo>/-/tree/<branch>` for GitLab, `<repo>/src/<branch>` for Bitbucket, and `<repo>?version=GB<branch>` for Azure DevOps.
  - **FR-005a**: A branch placed in a path segment MUST keep its slashes literal; a branch placed in a query parameter MUST be URL-encoded. Where a query parameter is used and the repository address already carries a query string, the parameter MUST be appended to it.
- **FR-006**: The copy control MUST state what it will copy before it is pressed: its accessible name and its tooltip MUST read `Copy branch URL` when a branch URL will be copied and `Copy branch name` when the branch name will be copied. The two MUST always agree with each other and with what is actually copied.
- **FR-007**: The copy mechanism MUST be unchanged: the primary clipboard path with the existing hidden-textarea fallback for non-secure contexts, and the existing `Copiado` confirmation shown only on success. The choice of payload MUST be independent of which mechanism performs the copy.
- **FR-008**: This feature MUST NOT change any stored data, any backend behaviour, any API response, any MCP tool, or any report, count, total or duration. It changes only what a copy control puts on the clipboard and how that control names itself.
- **FR-009**: Everything else about the branch block MUST remain as feature 002 defined it: the block's placement and styling, the branch text shown to the reader (never a URL), the inheritance marker, the `Sin rama aún` empty state, the absence of a copy control when there is no effective branch, and the branch icon's text alternative.
- **FR-010**: The user-facing documentation that describes the branch block's copy control MUST be updated to state that the control copies the branch URL when the project has a repository URL configured and the branch name otherwise.
- **FR-011**: The derivation of a branch URL from a repository URL and a branch MUST be expressed as a single self-contained unit that can be exercised without rendering any user interface, so that every forge shape and every malformed input can be verified directly.

### Key Entities

- **Project repository URL**: the repository address already stored on a project and already delivered to the ticket detail view. This feature only reads it; it neither validates it at entry time nor writes it.
- **Effective branch**: the branch shown in the ticket's branch block — the ticket's own reported branch, or a parent's when inherited. Defined by feature 002 and unchanged here.
- **Branch URL**: a derived, non-persisted value: the address of the effective branch inside the project repository. It exists only for the duration of a copy; it is never stored, never displayed as text, and never sent anywhere.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a project whose repository URL points at GitHub, GitLab, Bitbucket or Azure DevOps, pressing the copy control on a ticket with a branch yields, in 100% of cases, a clipboard value that opens that branch in that repository in a browser.
- **SC-002**: Reaching a ticket's branch in the forge takes exactly two actions after the ticket detail is open — press copy, paste — with zero manual editing of the pasted value.
- **SC-003**: For a project with no repository URL configured, the clipboard value after pressing copy is byte-for-byte the effective branch text, identical to the behaviour before this feature.
- **SC-004**: In 100% of cases the control's accessible name before the press matches the kind of value found on the clipboard after it (`Copy branch URL` ↔ a URL, `Copy branch name` ↔ a branch name).
- **SC-005**: Every input class listed in the Edge Cases section — empty, blank, SSH shorthand, explicit `ssh://` form, `.git` suffix, trailing slash, surrounding whitespace, non-URL value, unsupported scheme, branch with slashes, existing query string, and each of the four forges plus an unrecognised host — is covered by an automated check, and the whole repository test suite passes.
- **SC-006**: No stored data, API response, report figure, count or duration changes as a result of this feature; the only observable differences are the clipboard payload and the control's accessible name and tooltip.
- **SC-007**: The copy confirmation continues to appear on both the primary clipboard path and the non-secure-context fallback, for both payload kinds.

## Clarifications

### Session 2026-08-16 *(resolved from the approved design and repository evidence; no open questions)*

- **Q: What exactly is the "label" that must state what will be copied?** → A: the control's accessible name and its tooltip. The control's visible text stays `Copy`. Evidence: the existing control already renders the visible text `Copy` with the accessible name and tooltip `Copy branch name` — the very string the approved design names as one of the two alternatives — and the design rejects adding anything that crowds the branch row. FR-006.
- **Q: Which hosts count as each forge?** → A: the host is matched against the forge's own domain, including its subdomains: GitHub, GitLab, Bitbucket, and Azure DevOps in both its current and legacy domains. A host that matches none of them is unrecognised and takes the GitHub shape, as the approved design directs. FR-003d.
- **Q: Does the branch value shown to the reader become a URL?** → A: no. Only the clipboard payload changes; the block still shows the branch text. Approved design, "Only the copied string changes". FR-009.
- **Q: Does this contradict feature 002's FR-021?** → A: it deliberately supersedes its payload clause, on the explicit instruction in the original request and the approved design. See "Relationship to feature 002". FR-010 keeps the user-facing documentation consistent with the new behaviour.

## Assumptions

- The project's repository URL is already present on the object the ticket detail view receives, and the ticket's effective branch is already present on the ticket detail — both established by feature 002 and by the existing project shape. No new data plumbing is assumed or required.
- Repository URLs are stored as people paste them; no normalisation is assumed to have happened at entry time, which is why FR-003 does it at read time.
- An unrecognised host is more likely to be a self-hosted instance of a common forge than a forge with an incompatible URL shape, so producing the most widespread shape is more useful than producing nothing. Explicitly approved.
- The current project's repository URL is empty, so after this feature ships the control will keep copying the branch name here until the URL is filled in from the project form. This is the empty state working as designed, not a defect.
- Out of scope: validating or normalising the repository URL when it is saved; deep links to a file or commit; any per-forge configuration setting; any change to the branch value the agent reports.
