import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiFetch } from '../apiClient';
import { run } from './helpers';

const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, 'sha must be 40 lowercase hex characters');

const branchSchema = z.object({
  name: z.string(),
  isTrunk: z.boolean().describe('True only for main, and only for one branch per project.'),
  forkedFromBranchName: z.string().nullable().optional(),
  state: z.enum(['UNCOMMITTED', 'ACTIVE', 'MERGED']),
});

const fileSchema = z.object({
  path: z.string(),
  changeType: z.enum(['A', 'M', 'D', 'R']),
});

const commitSchema = z.object({
  sha: shaSchema,
  branchName: z.string(),
  message: z.string(),
  authorName: z.string(),
  committedAt: z.string().describe('ISO 8601 timestamp'),
  pushed: z.boolean(),
  isMerge: z.boolean(),
  parentShas: z
    .array(shaSchema)
    .describe(
      'Always send this, including [] for a root commit -- every fork and merge edge is derived from it, so an omitted array erases a commit\'s topology.',
    ),
  files: z
    .array(fileSchema)
    .max(500, 'at most 500 files per commit; put the remainder in truncatedFileCount')
    .optional()
    .describe('Omit only for a commit with no recorded files.'),
  truncatedFileCount: z
    .number()
    .int()
    .min(0)
    .describe(
      'Always send this, including 0 when the file list above is complete -- defaulting it would falsely assert completeness.',
    ),
  ticketIds: z.array(z.string()).optional(),
});

const description = `Records the repository's branches and commits so the project's View repo screen can draw them. It is a mirror; it changes nothing in the repository.

How to derive state, with the precedence spelled out (checking git status first gets a merged-and-dirty branch wrong):
1. Merged into the trunk (\`git branch --merged main\` lists it) -> MERGED, even if the working tree is dirty.
2. Otherwise, uncommitted changes (\`git status --porcelain\` is non-empty) or no commit of its own -> UNCOMMITTED.
3. Otherwise -> ACTIVE.
The merged check comes first, always. The dirty-tree test applies only to the branch currently checked out -- a working tree belongs to the checked-out branch, so no other branch can ever be reported dirty. Every other branch reaches UNCOMMITTED only by having no commit of its own.

isTrunk is true only for main, and only for one branch.

Commits must be sent in batches of at most 50; a 413 PAYLOAD_TOO_LARGE response means send fewer commits in that call. A batch of one commit is the floor: if a single commit still gets a 413 on its own, send fewer files for that commit and add the difference to its truncatedFileCount, so the remainder is still reported.

Reporting ticketIds is preferred; omitting them causes the screen to fall back to inferring tickets by branch and to label them as inferred.

Safe to call repeatedly -- it updates in place and never deletes.`;

export function registerGitHistoryTools(server: McpServer) {
  server.registerTool(
    'sync_git_history',
    {
      title: 'Sync git history',
      description,
      inputSchema: {
        projectId: z.string(),
        branches: z.array(branchSchema),
        commits: z
          .array(commitSchema)
          .max(50, 'at most 50 commits per call; call repeatedly to load the rest'),
      },
    },
    async ({ projectId, branches, commits }) =>
      run(() =>
        apiFetch(`/projects/${encodeURIComponent(projectId)}/git-history/sync`, {
          method: 'POST',
          body: { branches, commits },
        }),
      ),
  );
}
