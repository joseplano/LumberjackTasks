# Quickstart: verifying the branch-URL copy

**Feature**: `003-copy-branch-url` | **Branch**: `003-copy-branch-url` (stacked on `002-ticket-git-branch-view`)

## Automated verification (the gate)

Run from the repository root on Windows:

```bash
cd frontend && npm test                    # the suite that covers this change
cd frontend && npx tsc --noEmit            # typecheck
cd backend && npm test                     # regression
cd mcp && npm test                         # regression
node --test plugin/tests/*.test.mjs        # regression — glob form is mandatory (constitution II)
```

All five must pass before the work is considered complete. The plugin command's directory form fails with `MODULE_NOT_FOUND` on Windows and is not a substitute.

## Manual verification

Bring the stack up (`docker compose up -d`, or the backend and frontend dev servers) and sign in.

### 1. The empty state — this project as it stands today

1. Open a project whose repository URL is blank, and a ticket that has a reported branch.
2. Hover the copy control in the branch block: the tooltip reads **Copy branch name**.
3. Press it. `Copiado` appears; paste anywhere — you get the branch name, exactly as before this feature.

### 2. The GitHub path

1. Open the project form and set the repository URL to `https://github.com/<owner>/<repo>`. Save.
2. Reopen the ticket. The tooltip now reads **Copy branch URL**.
3. Press copy and paste into the browser address bar: it opens `https://github.com/<owner>/<repo>/tree/<branch>` — that branch, in that repository.

### 3. The forms people actually paste

Repeat step 2 with each of these; all six must produce the identical URL `https://github.com/<owner>/<repo>/tree/<branch>`:

- `git@github.com:<owner>/<repo>.git`
- `https://github.com/<owner>/<repo>.git`
- `https://github.com/<owner>/<repo>/`
- `https://github.com/<owner>/<repo>.git/`
- `https://github.com/<owner>/<repo>?tab=readme` — what the browser address bar yields on the repository page
- `https://github.com/<owner>/<repo>#readme`

The last two are the case the 2026-08-17 ruling settled: the query and the fragment are decoration and are discarded before the branch path is appended (FR-003e). **Paste the result into the address bar and press Enter** — this step is the reason T014 exists, because it is the only check that proves a real browser opens the branch rather than merely that a string was produced.

### 4. The other forges

Set the repository URL to a GitLab, Bitbucket and Azure DevOps address in turn and confirm the pasted value matches the shape in [contracts/branchUrl.md](./contracts/branchUrl.md) — note that the Azure DevOps value carries the branch in `?version=GB…`, percent-encoded, while the other three keep slashes literal in the path.

Repeat the query/fragment check from step 3 on GitLab and Bitbucket (`…/<repo>?ref_type=heads`, `…/<repo>#readme`): both must open the branch.

Then check both halves of the Azure DevOps rule, which differ by URL component (FR-003e, FR-005a):

- **Query — preserved.** With `https://dev.azure.com/<org>/<proj>/_git/<repo>?path=/x` the pasted value keeps `?path=/x` and gains `&version=GB<branch>`. Azure's query is addressing information, so it is the one exception to the discard.
- **Fragment — discarded, like everywhere else.** With `https://dev.azure.com/<org>/<proj>/_git/<repo>#readme` the pasted value is `…/<repo>?version=GB<branch>` with no `#readme`. Paste it and press Enter: it must open the branch. If you instead see `…/<repo>#readme?version=GB<branch>`, the fragment rule is not implemented — the parameter is sitting inside the fragment and the browser never sends it.
- **Both together.** `…/_git/<repo>?path=/x#readme` must produce exactly what the query-only form produced.
- **The legacy domain.** `https://<org>.visualstudio.com/<proj>/_git/<repo>#path=/x&version=GBmaster` — the hash-routed form Azure used for years — must yield `…/_git/<repo>?version=GB<branch>`. Note the stored fragment names a *different* branch (`master`); keeping it would open the wrong one.

### 5. A branch with slashes

With a ticket whose branch is `feature/x` on a GitHub URL, the pasted value ends in `/tree/feature/x` — the slash intact, not `%2F`.

### 6. Something that is not a URL

Set the repository URL to `not a url`. The tooltip returns to **Copy branch name** and the clipboard holds the branch name. The control never copies a broken address.

### 7. Non-secure context (optional)

Reach the frontend over plain HTTP through a LAN reverse proxy, where `navigator.clipboard` is undefined. The copy still succeeds through the hidden-textarea fallback and copies the same value the secure path would have.

## What must not have changed

- The branch block still *shows* the branch text, never a URL.
- The inheritance marker, the `Sin rama aún` empty state and the `Copiado` confirmation are untouched.
- A ticket with no branch still shows no copy control.
- No report, count, total or duration anywhere in the application moves.
