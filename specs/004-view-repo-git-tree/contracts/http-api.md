# Contract: HTTP API — repository history

**Feature**: `specs/004-view-repo-git-tree` | **Date**: 2026-08-21

All four endpoints sit under `/api/v1`, behind `requireAuth` (mounted in `backend/src/app.ts`
before the project routes). There is no per-user or per-project restriction: this system is
single-tenant, and any authenticated account already reaches every project (constitution
Principle III, FR-030). Errors follow the existing envelope
`{ "error": { "code": "...", "message": "..." } }` produced by `backend/src/middleware/errors.ts`.

---

## 1. `GET /api/v1/projects/:projectId/git-history`

Returns everything needed to draw the tree, and nothing else. **File lists are excluded on
purpose** (research R12).

**200 response**

```json
{
  "lastSyncedAt": "2026-08-21T19:40:00.000Z",
  "branches": [
    {
      "id": "b1f0…",
      "name": "main",
      "isTrunk": true,
      "forkedFromBranchName": null,
      "state": "ACTIVE",
      "lastSyncedAt": "2026-08-21T19:40:00.000Z"
    }
  ],
  "commits": [
    {
      "sha": "92d4063ce7fb0234e9dfce7d0a7a843979b40002",
      "branchId": "b1f0…",
      "message": "Merge branch '003-copy-branch-url'",
      "authorName": "juglarx",
      "committedAt": "2026-08-21T18:02:11.000Z",
      "pushed": true,
      "isMerge": true,
      "parentShas": ["…", "…"],
      "fileCount": 12,
      "truncatedFileCount": 0
    }
  ]
}
```

**Rules**

1. `lastSyncedAt` is the maximum `lastSyncedAt` across the project's branches, or `null` when the
   project has no branches.
2. `branches: []` and `commits: []` with `lastSyncedAt: null` means **never synced**. The client
   MUST render the FR-029 empty state for exactly this shape, and MUST NOT render it for a
   transport failure (FR-033).
3. `commits` is ordered by `committedAt` ascending, ties broken by `sha` ascending. The ordering is
   part of this contract because the geometry function's output must be assertable (research R11).
4. `fileCount` is the number of **stored** file rows. `truncatedFileCount` is how many more the
   commit changed. `fileCount + truncatedFileCount` is the real total.
5. Unknown `projectId` → `404 NOT_FOUND`. An existing project that has never been synced is a
   `200` with the shape in rule 2, **not** a `404`.

---

## 2. `GET /api/v1/projects/:projectId/git-history/commits/:sha`

Powers the commit modal (FR-014, FR-016, FR-017).

**200 response**

```json
{
  "sha": "b0c1841…",
  "branchId": "b1f0…",
  "branchName": "003-copy-branch-url",
  "message": "feat(frontend): discard query and fragment per FR-003e (T017)",
  "authorName": "juglarx",
  "committedAt": "2026-08-20T10:15:00.000Z",
  "pushed": true,
  "isMerge": false,
  "parentShas": ["74ecdc2…"],
  "files": [{ "path": "frontend/src/lib/branchUrl.ts", "changeType": "M" }],
  "truncatedFileCount": 0,
  "tickets": [
    { "id": "t-uuid", "number": 41, "name": "Discard query and fragment", "source": "reported" }
  ]
}
```

**Rules**

1. `files` holds at most 500 entries (FR-023), ordered by `path` ascending.
2. `truncatedFileCount > 0` means the list is incomplete; the client MUST say how many more files
   exist and MUST NOT present the list as complete (FR-017).
3. `tickets[].source` is `"reported"` or `"inferred"` and is **always present**.
   - When the commit has at least one reported link, `tickets` is exactly those links, every one
     `"reported"`. Inference is not mixed in.
   - When the commit has no reported link, `tickets` is the project's tickets whose `gitBranch`
     equals the commit's branch name, every one `"inferred"`.
   - A commit with no reported link and no branch-matching ticket returns `tickets: []`.
4. A response MUST NEVER carry a ticket without a `source`. This is the machine-readable half of
   D9: an inference is never presented as reported data.
5. Unknown `sha` for the project → `404 NOT_FOUND`.

---

## 3. `GET /api/v1/projects/:projectId/git-history/branches/:branchId`

Powers the branch modal (FR-015). Keyed on `branchId`, not name, because branch names contain `/`
(research R12).

**200 response**

```json
{
  "id": "b1f0…",
  "name": "003-copy-branch-url",
  "isTrunk": false,
  "state": "MERGED",
  "forkedFromBranchName": "main",
  "lastSyncedAt": "2026-08-21T19:40:00.000Z",
  "commitCount": 9,
  "commitMessages": ["chore(speckit): mark T016-T018 complete with gate evidence"],
  "files": [{ "path": "frontend/src/lib/branchUrl.ts", "changeType": "M" }],
  "truncatedFileCount": 0,
  "tickets": [{ "id": "t-uuid", "number": 41, "name": "…", "source": "reported" }]
}
```

**Rules**

1. `files` is the distinct union of the paths its commits changed, ordered by `path` ascending.
   When a path appears with several change types across commits, the type from the most recent
   commit wins.
2. `truncatedFileCount` is the sum across the branch's commits; `> 0` means the union is
   incomplete and the client must say so.
3. `tickets` is the union of the branch's commits' tickets under rule 3 of endpoint 2,
   de-duplicated by ticket id. A ticket that is `reported` on any commit is `reported` here;
   otherwise `inferred`.
4. The branch **description** shown in the modal is composed by the client from `name`, `state`
   and `commitMessages` (FR-015). No authored description field exists, here or in the database.
5. `commitMessages` is ordered newest first and capped at 50 entries; `commitCount` gives the true
   total. When `commitCount > commitMessages.length` the client MUST indicate that the messages
   shown are a subset, for the same reason as rule 2 and FR-017: a shortened list is never
   presented as the whole (FR-015).
6. Unknown `branchId`, or a branch belonging to another project → `404 NOT_FOUND`.

---

## 4. `POST /api/v1/projects/:projectId/git-history/sync`

The **only** write path. Reached by the MCP server with bot credentials on the agent's behalf
(D2, constitution Principle I). One call carries one batch (research R2).

**Request**

```json
{
  "branches": [
    {
      "name": "004-view-repo-git-tree",
      "isTrunk": false,
      "forkedFromBranchName": "main",
      "state": "ACTIVE"
    }
  ],
  "commits": [
    {
      "sha": "…40 hex…",
      "branchName": "004-view-repo-git-tree",
      "message": "…",
      "authorName": "…",
      "committedAt": "2026-08-21T18:02:11.000Z",
      "pushed": true,
      "isMerge": false,
      "parentShas": ["…"],
      "files": [{ "path": "backend/prisma/schema.prisma", "changeType": "M" }],
      "truncatedFileCount": 0,
      "ticketIds": ["t-uuid"]
    }
  ]
}
```

**200 response**

```json
{ "branchesUpserted": 1, "commitsUpserted": 1, "filesUpserted": 1, "ticketLinksUpserted": 1, "lastSyncedAt": "…" }
```

**Rules**

1. **Idempotent (FR-026).** Branches match on `(projectId, name)`; commits on `(projectId, sha)`;
   files on `(commitId, path)`; ticket links on `(commitId, ticketId)`. Sending the same batch
   twice changes no count.
2. **Additive (FR-032).** The endpoint never deletes a branch, commit, file or ticket link. A
   branch absent from a batch keeps its previous record and its previous `lastSyncedAt`.
3. **Attribution is fixed (FR-024/D8).** If a commit's `sha` is already recorded, its `branchId` is
   **not** updated, even when the batch reports a different `branchName`. Every other field is
   updated.
4. `lastSyncedAt` is set by the **server clock** for every branch in the batch. A client-supplied
   value is ignored; a mirror that can be told it is fresh is not a mirror.
5. **Batch cap**: at most 50 commits per call. More → `400 VALIDATION`. The whole history is
   loaded by calling repeatedly; that is also how the D4 backfill works.
6. **File cap**: at most 500 `files` entries per commit (FR-023). More → `400 VALIDATION`, never a
   silent trim. `truncatedFileCount` must carry the remainder.
7. **Validation, all `400 VALIDATION` with a message naming the field**: `sha` is 40 lowercase hex
   characters; `state` is one of the three enum values; `changeType` is one of `A`/`M`/`D`/`R`;
   `committedAt` parses as a date; every `commits[].branchName` appears either in this batch's
   `branches` or in an already-recorded branch — a commit is never attached to an invented branch.
8. **Unknown `ticketIds`**: a ticket id that does not belong to this project is rejected with
   `400 VALIDATION` naming the id. It is not skipped silently (constitution Principle IV).
9. **Trunk**: at most one branch per project may have `isTrunk: true`. A batch that would produce a
   second one → `400 VALIDATION`.
10. **Oversize body**: the global `express.json({ limit: '100kb' })` in `backend/src/app.ts` stays
    as it is. `backend/src/middleware/errors.ts` MUST map the body parser's `entity.too.large` to
    `413 PAYLOAD_TOO_LARGE` with a message telling the caller to send fewer commits. Without this
    mapping the condition surfaces as `500 INTERNAL / "Unexpected error"`, which breaks FR-020 and
    constitution Principle IV.
11. The whole batch applies in **one transaction**. A batch that fails validation records nothing;
    there is no partial sync.
12. Unknown `projectId` → `404 NOT_FOUND`.
