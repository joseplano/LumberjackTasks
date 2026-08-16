# Pre-Implementation Readiness Checklist: Copy the branch URL, not just the branch name

**Purpose**: Validate that the requirements for this feature are complete, unambiguous, and mutually consistent **before** any production code is written
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)
**Depth**: Formal pre-implementation gate
**Audience**: The implementing agent and the human reviewer, before implementation starts

> These items test the **requirements**, not the implementation. Every item asks whether something is adequately *written down*, not whether code does it.

## Requirement Completeness

- [x] CHK001 - Is the condition under which a URL is copied, versus the condition under which the branch name is copied, stated exhaustively with no third state left undefined? [Completeness, Spec §FR-001/FR-004, contracts/branchUrl.md §Return value]
- [x] CHK002 - Is the transformation from the stored repository value to a repository address defined step by step, including the order of the steps? [Completeness, Spec §FR-003/FR-003a/FR-003b, research.md §R3]
- [x] CHK003 - Is a URL shape defined for every forge named in scope, plus for hosts that match none of them? [Coverage, Spec §FR-005/FR-003d, contracts/branchUrl.md §Stage 2]
- [x] CHK004 - Is the rule for what counts as a given forge's host written down, rather than left as "the host is GitHub"? [Completeness, Spec §FR-003d, spec §Clarifications, research.md §R4]
- [x] CHK005 - Are both copy mechanisms (primary and non-secure-context fallback) covered by the requirement that decides the payload? [Coverage, Spec §FR-007, SC-007]
- [x] CHK006 - Is the obligation to update user-facing documentation identified, given that user-visible behaviour changes? [Completeness, Spec §FR-010, Constitution §V and §Development Workflow]
- [x] CHK007 - Is the behaviour for a ticket with no effective branch stated, rather than assumed to be unreachable? [Completeness, Spec §FR-009, §Edge Cases, contracts/branchUrl.md §Return value]

## Requirement Clarity

- [x] CHK008 - Is "the label" resolved into the exact attributes that change, so it cannot be read as the visible button text? [Clarity, Ambiguity, Spec §FR-006 and §Clarifications, research.md §R9]
- [x] CHK009 - Is the encoding rule stated per URL position (path segment versus query parameter) rather than as a single global rule? [Clarity, Spec §FR-005a, research.md §R6]
- [x] CHK010 - Is the exact literal text of both control names specified, including capitalisation? [Clarity, Spec §FR-006, §User Story 2 scenarios 3-4]
- [x] CHK011 - Is the difference between "no repository URL" and "a repository URL that is not usable" defined, and do both lead to a stated outcome? [Clarity, Spec §FR-003c/FR-004, §Edge Cases]
- [x] CHK012 - Is the order-dependence of `.git`-stripping and trailing-slash-stripping made explicit, given that the reverse order changes the result for `…/repo.git/`? [Clarity, Spec §FR-003b, research.md §R3, contracts/branchUrl.md §Stage 1]
- [x] CHK013 - Is the query-parameter append rule defined for a repository address that already carries a query string? [Clarity, Spec §FR-005a, §Edge Cases, contracts/branchUrl.md §Stage 2]

## Requirement Consistency

- [x] CHK014 - Does any success criterion state universally something that an edge case is permitted to violate? [Conflict-check, Spec §SC-001 vs §Edge Cases] — SC-001 is scoped to the four named forges, and the unrecognised-host edge case is deliberately excluded from it; SC-004 is universal and holds in every branch of the logic because the name and the payload come from one evaluation
- [x] CHK015 - Does any requirement mandate a change that a success criterion claims will not happen? [Conflict-check, Spec §FR-008 vs §SC-006, data-model.md §Derived, non-persisted value] — the feature writes nothing and has no downstream consumer: the derived Branch URL is read only by the clipboard and the control's name, so "no figure changes" is structurally true, not merely asserted
- [x] CHK016 - Is the contradiction with the previous feature's requirement identified explicitly and resolved by a stated authority, rather than left for a reader to discover? [Conflict-check, Spec §"Relationship to feature 002", §Clarifications] — feature 002's FR-021 says the control copies "the exact branch text"; this spec supersedes that clause on the explicit original request and the approved design, preserves the rest of FR-021, and requires the documentation to follow (FR-010)
- [x] CHK017 - Do the edge cases and the success criteria agree, with no edge case permitting what a success criterion forbids? [Consistency, Spec §Edge Cases vs §Success Criteria] — SC-003 (branch name copied when no URL) and SC-005 (every input class covered) are exactly the edge-case list restated as outcomes
- [x] CHK018 - Are the surfaces in scope stated identically across the spec, the plan and the contract? [Consistency, Spec §FR-002/FR-008, plan.md §Project Structure, contracts/branchUrl.md §Caller contract] — all three say: one new helper module, one component region, one README sentence, nothing else
- [x] CHK019 - Is one artifact designated normative for the derivation rule, and do the places that restate it agree with it word for word in effect? [Consistency, contracts/branchUrl.md is normative and is referenced as such by plan.md §Design, data-model.md and quickstart.md] — the ordered normalisation appears in three places by design, each for a different reader: spec §FR-003 states it as a requirement, contracts/branchUrl.md §Stage 1 states it normatively with test vectors, research.md §R3 explains why the order matters. All three were compared line by line and agree, including the deliberate non-conversion of the explicit `ssh://` form. Any future change must land in the contract first
- [x] CHK020 - Does the contract's test-vector table agree with the spec's acceptance scenarios wherever both cover the same input? [Consistency, contracts/branchUrl.md §Worked examples vs Spec §User Story 1/3 scenarios] — GitHub, GitLab, Bitbucket, Azure DevOps, SSH form, `.git` suffix, trailing slash and `feature/x` appear in both with identical expected values

## Acceptance Criteria Quality

- [x] CHK021 - Is each success criterion checkable by a person or a test without reading the implementation? [Measurability, Spec §SC-001…SC-007]
- [x] CHK022 - Is the "no surprise on paste" goal expressed as a checkable invariant rather than as an intention? [Measurability, Spec §SC-004] — stated as an if-and-only-if between the pre-press accessible name and the post-press clipboard content
- [x] CHK023 - Is the regression guard for the unchanged behaviour identified, including the fact that the existing tests already exercise it? [Coverage, plan.md §Testing Strategy, Spec §SC-003] — the existing component fixture stores an empty repository URL, so the current copy tests are the FR-004 regression guard and must keep passing untouched

## Scenario Coverage

- [x] CHK024 - Is every input class that can reach the derivation enumerated somewhere as a required check? [Coverage, Spec §SC-005, §Edge Cases, contracts/branchUrl.md §Worked examples] — empty, whitespace-only, SSH shorthand, explicit `ssh://`, `.git`, trailing slash, surrounding whitespace, non-URL, unsupported scheme, four forges, legacy Azure domain, unrecognised host, look-alike host, branch with slashes, pre-existing query string, empty branch
- [x] CHK025 - Is the inherited-branch case addressed, given that a subticket displays a parent's branch? [Coverage, Spec §FR-009, §Edge Cases] — inheritance decides *which* branch is effective and nothing about how it is copied
- [x] CHK026 - Are both call sites of the modified surface accounted for, so the change cannot be correct in one view and absent in the other? [Coverage, research.md §R1, plan.md §Design] — the board view and the backlog view both render the same modal with the same `project` prop; the change is inside the modal, so both inherit it

## Constitution Compliance

- [x] CHK027 - Is the branch topology deviation from "topic branch off `main`" recorded with its justification rather than performed silently? [Traceability, plan.md §Complexity Tracking, Spec §Stacking note]
- [x] CHK028 - Are the authoritative test commands for this repository stated, in the exact form the constitution mandates? [Completeness, plan.md §Testing Strategy, research.md §R10] — including the plugin glob form that is required on Windows
- [x] CHK029 - Is the absence of schema, backend, MCP and plugin impact asserted explicitly, so no migration or plugin re-read obligation is missed? [Completeness, Spec §FR-008, plan.md §Constitution Check, data-model.md] — no Prisma migration is required because no schema element changes; nothing under `plugin/` changes
- [x] CHK030 - Is the security assessment stated rather than assumed, given the constitution's list of security-relevant surfaces? [Completeness, plan.md §Constitution Check III] — no authentication, CORS, rate-limiting, password, JWT or MCP-binding surface is touched; the repository URL is data the same viewer already sees in the project form; the derivation builds a string and never fetches or executes it

## Notes

- No item on this list is a post-launch metric; every one is decidable from the artifacts as they stand.
- No item required a product decision from the human partner: every question that arose was answered by the approved design (`.specify/bridge/approved-design.md`), by the constitution, or by existing repository code, and each answer is recorded in the spec's Clarifications section with its evidence.
