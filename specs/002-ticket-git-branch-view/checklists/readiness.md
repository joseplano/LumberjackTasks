# Pre-Implementation Readiness Checklist: Git branch visible on ticket

**Purpose**: Validate that the requirements for this feature are complete, unambiguous, and
mutually consistent **before** any production code is written
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)
**Depth**: Formal pre-implementation gate
**Audience**: The implementing agent and the human reviewer, before implementation starts

> These items test the **requirements**, not the implementation. Every item asks whether
> something is adequately *written down*, not whether code does it.

## Requirement Completeness

- [x] CHK001 - Are the stored, derived, and displayed forms of the branch value each defined separately, so no reader confuses them? [Completeness, Spec §FR-001/FR-012/FR-013/FR-014]
- [x] CHK002 - Is the meaning of "no value" stated explicitly rather than left to interpretation? [Completeness, Spec §FR-002]
- [x] CHK003 - Are the write-path entry points enumerated, and is the set of actors allowed to write defined? [Completeness, Spec §FR-005/FR-006]
- [x] CHK004 - Are requirements defined for both read surfaces the UI consumes (single ticket and ticket list)? [Coverage, Spec §FR-015]
- [x] CHK005 - Are requirements defined for what happens to tickets that already exist when the change lands? [Completeness, Spec §FR-003, SC-009]
- [x] CHK006 - Is the agent-side behavior that populates the value specified, rather than assumed? [Completeness, Spec §FR-023/FR-024]
- [x] CHK007 - Are documentation obligations for user-visible behavior identified? [Completeness, Constitution §Development Workflow, Contract ui-and-skill.md]

## Requirement Clarity

- [x] CHK008 - Is the set of rejected branch values enumerated exactly, rather than described as "invalid characters"? [Clarity, Spec §FR-009]
- [x] CHK009 - Is the order of trim / clear / validate specified, given that a different order changes which inputs are rejected? [Clarity, Spec §FR-007/FR-008/FR-009, data-model.md §Write-path rules]
- [x] CHK010 - Is the difference between "field absent" and "field explicitly null" defined for the write path? [Clarity, Ambiguity, data-model.md §Write-path rules, contracts/rest-api.md]
- [x] CHK011 - Is "prominently" resolved into a concrete, checkable placement and treatment rather than left as an adjective? [Measurability, Spec §FR-017/FR-018, A-006]
- [x] CHK012 - Are the exact literal display strings specified, including their language? [Clarity, Spec §FR-019/FR-020, A-001]
- [x] CHK013 - Is the branch-source vocabulary fixed to a closed set of values? [Clarity, Spec §FR-014, data-model.md]

## Requirement Consistency

- [x] CHK014 - Does the spec's framing (a mirror with no generated value) hold consistently across every requirement, with no requirement reintroducing derivation? [Consistency, Spec §Framing, FR-002, FR-025, FR-026, FR-027]
- [x] CHK015 - Do the contracts agree with the spec about which fields are added and which are unchanged, with no contract claiming "unchanged" where the spec mandates a change? [Consistency, Conflict-check, contracts/rest-api.md vs Spec §FR-012–FR-016]
- [x] CHK016 - Is the claim that no existing figure changes (SC-009/SC-009a) consistent with the side effects the write path admits to producing, and is the boundary between "deploying the change" and "later agent activity" drawn explicitly? [Consistency, Conflict-check, Spec §SC-009/§SC-009a vs contracts/rest-api.md §Side effects]
- [x] CHK016a - Does any success criterion state universally something that an edge case is permitted to violate? [Conflict-check, Spec §SC-003 vs §Edge Cases]
- [x] CHK017 - Do the edge cases and the success criteria agree, with no edge case permitting what a success criterion forbids? [Consistency, Spec §Edge Cases vs §Success Criteria]
- [x] CHK018 - Are the surfaces in scope stated identically in the spec, the plan, and the contracts? [Consistency, Spec §Out of Scope, plan.md §Project Structure, contracts/ui-and-skill.md]
- [x] CHK019 - Is the inheritance rule stated once and referenced, rather than restated differently in several artifacts? [Consistency, data-model.md §Derived values]

## Acceptance Criteria Quality

- [x] CHK020 - Can each success criterion be judged true or false without reading the implementation? [Measurability, Spec §SC-001–SC-010]
- [x] CHK021 - Is there a success criterion covering the negative case — that no interface path exists for a person to write the value? [Coverage, Spec §SC-010]
- [x] CHK022 - Are the success criteria free of framework, language, and storage names? [Measurability, Spec §Success Criteria]
- [x] CHK023 - Does every functional requirement trace to at least one acceptance scenario or success criterion? [Traceability]

## Scenario Coverage

- [x] CHK024 - Are primary-flow requirements defined for a ticket with its own branch? [Coverage, Spec §US1]
- [x] CHK025 - Are alternate-flow requirements defined for a subticket inheriting from its parent? [Coverage, Spec §US2]
- [x] CHK026 - Are requirements defined for the board surface as distinct from the detail surface? [Coverage, Spec §US3]
- [x] CHK027 - Are exception-flow requirements defined for malformed input, including what happens to the previously stored value? [Coverage, Exception Flow, Spec §FR-010]
- [x] CHK028 - Are requirements defined for the environment where the clipboard API is unavailable? [Coverage, Exception Flow, Spec §FR-021, research.md R6]
- [x] CHK029 - Are requirements defined for the agent-side case where no branch name exists (detached HEAD)? [Coverage, Exception Flow, Spec §FR-024]
- [x] CHK030 - Are rollback/reversal expectations documented for the stored change? [Recovery, Gap-check, data-model.md §Migration]

## Edge Case Coverage

- [x] CHK031 - Are requirements defined for duplicate values across tickets, including whether that is permitted? [Edge Case, Spec §FR-004, §Edge Cases]
- [x] CHK032 - Are requirements defined for a value that no longer exists in any repository? [Edge Case, Spec §Edge Cases]
- [x] CHK033 - Are requirements defined for a subticket whose parent also has no value? [Edge Case, Spec §US2 scenario 3]
- [x] CHK034 - Are requirements defined for the maximum accepted length? [Edge Case, Spec §FR-009]
- [x] CHK035 - Are requirements defined for rendering an inherited value when the parent's identifying number is unavailable to the view? [Edge Case, Spec §Edge Cases, §FR-019]
- [x] CHK036 - Are requirements defined for a value that does not fit the space available on a board card? [Edge Case, Spec §FR-022]
- [x] CHK037 - Is concurrent reporting on the same ticket addressed, or explicitly declared to follow existing behavior? [Edge Case, Spec §Clarifications]

## Non-Functional Requirements

- [x] CHK038 - Are accessibility requirements defined for the icon-only control introduced by this feature? [Coverage, Spec §FR-022a]
- [x] CHK039 - Is a performance expectation stated for the list read, given that it must now resolve a related record? [Non-Functional, plan.md §Performance Goals, research.md R2]
- [x] CHK040 - Are security and privacy implications stated, including whether the new value is treated as sensitive? [Non-Functional, Spec §A-005, plan.md §Constitution Check]
- [x] CHK041 - Is backward compatibility of the published interfaces stated explicitly? [Non-Functional, Spec §FR-016, contracts/rest-api.md, contracts/mcp-tools.md]
- [x] CHK042 - Are observability side effects (audit entry, live event) stated rather than left implicit? [Non-Functional, contracts/rest-api.md §Side effects]

## Dependencies & Assumptions

- [x] CHK043 - Are the assumptions recorded, each with the authority that justifies it? [Assumption, Spec §Assumptions, §Clarifications]
- [x] CHK044 - Is the dependency on the existing one-level subticket relationship stated, and its effect on inheritance depth? [Dependency, Spec §D-001, §A-003]
- [x] CHK045 - Is the dependency on the agent tooling as the sole write path stated? [Dependency, Spec §D-002]
- [x] CHK046 - Are the constitution constraints that govern the touched packages identified for each package? [Dependency, plan.md §Constitution Check, contracts/ui-and-skill.md]

## Ambiguities & Conflicts

- [x] CHK047 - Are all previously open questions resolved, with each resolution naming its source authority rather than asserting a preference? [Ambiguity, Spec §Clarifications]
- [x] CHK048 - Is the scope boundary explicit about the create/edit form being untouched, so it cannot be added by accident? [Ambiguity, Spec §FR-006, §Out of Scope, plan.md §Project Structure]
- [x] CHK049 - Is the rejected alternative (a generated branch name) recorded as a prohibition rather than merely omitted? [Conflict-prevention, Spec §FR-025, §Framing]
- [x] CHK050 - Are there any remaining requirements whose satisfaction cannot be judged before implementation and that are therefore mislabelled as pre-implementation gates? [Traceability]
- [x] CHK083 - Is the behavior for a reported value of the **wrong kind** (not text at all) specified as a validation failure that preserves the stored value, rather than left to the implementation to discover? [Coverage, Exception Flow, Gap-closure, Spec §FR-010 and §Edge Cases, data-model.md §Write-path rules step 2, contracts/rest-api.md §Validation errors]
- [x] CHK084 - Is the coverage owed for the **agent-instruction** change specified as coverage of the changed instruction itself, rather than as a re-run of a suite that never reads it? [Traceability, Gap-closure, Constitution §II, plan.md §Constitution Check and §Testing Strategy, tasks.md T036a]

## Notes

- Every item above was checked only after reading the concrete supporting text in the named
  artifact. Items are not checked on the basis that they "look fine".
- **CHK016** was the highest-risk item on this list. It was checked only after confirming from
  source that `backend/src/services/metrics.ts` aggregates solely `tokensConsumed`,
  `developmentTimeMinutes`, and a row count, and that `backend/src/services/reports.ts` and
  `backlog.ts` read neither `updatedAt` nor the audit log. Had any report consumed those, SC-009
  and the write-path side effects would have been in genuine conflict and this feature would
  have required a human decision.
- **CHK016** and **CHK016a** caused spec repairs during the behavioral-consistency pass, not
  waivers. SC-009 previously read "no change to any previously returned field's value", which
  taken literally contradicted the write path's refresh of the modification timestamp; it now
  scopes that claim to deploying the change and splits the numeric guarantee into SC-009a.
  SC-003 previously required the parent's number universally, which the degraded-parent edge
  case is permitted to omit; it now states the normal and degraded cases explicitly.
- **CHK035** and **CHK050** caused spec repairs during this gate rather than being waived: the
  degraded inherited marker was added as an edge case and to FR-019, and FR-022a was added for
  the icon-only control.
- **CHK083** and **CHK084** were added during the post-implementation artifact-alignment pass and
  each closed a real gap rather than restating a satisfied one. CHK083: the write-path rules
  described trimming and validating a string but never said what happens when the reported value
  is not a string at all, and a REST body is untyped JSON — the unspecified path produced a `500`
  instead of the `400` FR-010 promises. CHK084: the Constitution Check justified Principle II for
  the `SKILL.md` change on a "plugin suite re-run", which proves only that nothing broke, not that
  the change is covered; FR-023/FR-024 are behavior and owed a real test.
- **FR-015a** was reworded in the same pass. It read "MUST NOT expose any additional field beyond
  the three above", which taken literally forbade every field the read endpoints already return
  and contradicted both FR-016 and `contracts/rest-api.md`. It now says "any additional **new**
  field", which is the meaning the contract always carried.
