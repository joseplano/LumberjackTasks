import { describe, it, expect } from 'vitest';
import { buildBranchUrl } from '@/lib/branchUrl';

describe('buildBranchUrl', () => {
  // --- Stage 1: normalisation (T004) ---

  it('strips surrounding whitespace from gitRepoUrl', () => {
    expect(buildBranchUrl('  https://github.com/owner/repo/  ', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('converts the SSH remote shorthand git@host:path to https', () => {
    expect(buildBranchUrl('git@github.com:owner/repo.git', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('strips a trailing .git suffix', () => {
    expect(buildBranchUrl('https://github.com/owner/repo.git', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('strips a trailing slash', () => {
    expect(buildBranchUrl('https://github.com/owner/repo/', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('strips a trailing .git suffix and trailing slash together, in that order', () => {
    expect(buildBranchUrl('https://github.com/owner/repo.git/', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('returns null for an empty gitRepoUrl', () => {
    expect(buildBranchUrl('', 'main')).toBeNull();
  });

  it('returns null for a whitespace-only gitRepoUrl', () => {
    expect(buildBranchUrl('   ', 'main')).toBeNull();
  });

  it('returns null for a string that is not a URL', () => {
    expect(buildBranchUrl('not a url', 'main')).toBeNull();
  });

  it('returns null for a non-http(s) scheme such as ftp', () => {
    expect(buildBranchUrl('ftp://host/owner/repo', 'main')).toBeNull();
  });

  it('does not convert the explicit ssh:// scheme form (only git@host:path shorthand is converted)', () => {
    expect(buildBranchUrl('ssh://git@github.com/owner/repo.git', 'main')).toBeNull();
  });

  // --- Stage 2: forge shapes and host matching (T005) ---

  it('builds a github.com URL with /tree/', () => {
    expect(buildBranchUrl('https://github.com/owner/repo', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('builds a gitlab.com URL with /-/tree/', () => {
    expect(buildBranchUrl('https://gitlab.com/owner/repo', 'feature/x')).toBe(
      'https://gitlab.com/owner/repo/-/tree/feature/x'
    );
  });

  it('builds a bitbucket.org URL with /src/', () => {
    expect(buildBranchUrl('https://bitbucket.org/owner/repo', 'feature/x')).toBe(
      'https://bitbucket.org/owner/repo/src/feature/x'
    );
  });

  it('builds a dev.azure.com URL with a ?version=GB query', () => {
    expect(buildBranchUrl('https://dev.azure.com/org/proj/_git/repo', 'feature/x')).toBe(
      'https://dev.azure.com/org/proj/_git/repo?version=GBfeature%2Fx'
    );
  });

  it('builds an org.visualstudio.com URL with a ?version=GB query', () => {
    expect(buildBranchUrl('https://org.visualstudio.com/proj/_git/repo', 'main')).toBe(
      'https://org.visualstudio.com/proj/_git/repo?version=GBmain'
    );
  });

  it('falls back to the GitHub shape for an unrecognised host', () => {
    expect(buildBranchUrl('https://git.internal.example/owner/repo', 'main')).toBe(
      'https://git.internal.example/owner/repo/tree/main'
    );
  });

  it('falls back to the GitHub shape for a self-hosted look-alike subdomain', () => {
    expect(buildBranchUrl('https://gitlab.example.com/owner/repo', 'main')).toBe(
      'https://gitlab.example.com/owner/repo/tree/main'
    );
  });

  // Non-discriminating by construction: the GitHub shape and the fallback shape produce
  // the identical string, so this case passes whether or not the host is classified as
  // GitHub — it documents the intent (contracts/branchUrl.md, github.com.evil.example row)
  // while the four sibling guards below (gitlab.com/bitbucket.org/dev.azure.com/
  // visualstudio.com), whose forges have distinct URL shapes, are what actually enforce it.
  it('does not treat a domain-boundary trap host as github.com', () => {
    expect(buildBranchUrl('https://github.com.evil.example/owner/repo', 'main')).toBe(
      'https://github.com.evil.example/owner/repo/tree/main'
    );
  });

  it('does not treat a domain-boundary trap host as gitlab.com (FR-003d regression guard)', () => {
    expect(buildBranchUrl('https://gitlab.com.evil.example/owner/repo', 'main')).toBe(
      'https://gitlab.com.evil.example/owner/repo/tree/main'
    );
  });

  it('does not treat a domain-boundary trap host as bitbucket.org (FR-003d regression guard)', () => {
    expect(buildBranchUrl('https://bitbucket.org.evil.example/owner/repo', 'main')).toBe(
      'https://bitbucket.org.evil.example/owner/repo/tree/main'
    );
  });

  it('does not treat a domain-boundary trap host as dev.azure.com (FR-003d regression guard)', () => {
    expect(buildBranchUrl('https://dev.azure.com.evil.example/owner/repo', 'main')).toBe(
      'https://dev.azure.com.evil.example/owner/repo/tree/main'
    );
  });

  it('does not treat a domain-boundary trap host as visualstudio.com (FR-003d regression guard)', () => {
    expect(buildBranchUrl('https://visualstudio.com.evil.example/owner/repo', 'main')).toBe(
      'https://visualstudio.com.evil.example/owner/repo/tree/main'
    );
  });

  // --- Encoding and boundary vectors (T006) ---

  it('keeps literal slashes in the branch path on the github.com shape', () => {
    expect(buildBranchUrl('https://github.com/owner/repo', 'feature/x')).toBe(
      'https://github.com/owner/repo/tree/feature/x'
    );
  });

  it('keeps literal slashes in the branch path on the gitlab.com shape', () => {
    expect(buildBranchUrl('https://gitlab.com/owner/repo', 'feature/x')).toBe(
      'https://gitlab.com/owner/repo/-/tree/feature/x'
    );
  });

  it('keeps literal slashes in the branch path on the bitbucket.org shape', () => {
    expect(buildBranchUrl('https://bitbucket.org/owner/repo', 'feature/x')).toBe(
      'https://bitbucket.org/owner/repo/src/feature/x'
    );
  });

  it('keeps literal slashes in the branch path on the fallback shape', () => {
    expect(buildBranchUrl('https://git.internal.example/owner/repo', 'feature/x')).toBe(
      'https://git.internal.example/owner/repo/tree/feature/x'
    );
  });

  it('percent-encodes the branch in the Azure DevOps query', () => {
    expect(buildBranchUrl('https://dev.azure.com/org/proj/_git/repo', 'feature/x')).toBe(
      'https://dev.azure.com/org/proj/_git/repo?version=GBfeature%2Fx'
    );
  });

  it('appends with & when the repository address already has a query string', () => {
    expect(
      buildBranchUrl('https://dev.azure.com/org/proj/_git/repo?path=/x', 'main')
    ).toBe('https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain');
  });

  it('returns null for an empty branch', () => {
    expect(buildBranchUrl('https://github.com/owner/repo', '')).toBeNull();
  });

  it('returns null for a whitespace-only branch', () => {
    expect(buildBranchUrl('https://github.com/owner/repo', '   ')).toBeNull();
  });

  // --- Fix round 1 (T009 review finding): totality under encoding failure ---

  it('returns null rather than throwing for a lone surrogate branch on an Azure DevOps URL', () => {
    expect(() =>
      buildBranchUrl('https://dev.azure.com/org/proj/_git/repo', '\uD800')
    ).not.toThrow();
    expect(buildBranchUrl('https://dev.azure.com/org/proj/_git/repo', '\uD800')).toBeNull();
  });

  it('matches the host case-insensitively and preserves the original casing of the repo address', () => {
    expect(buildBranchUrl('HTTPS://GitHub.COM/owner/repo', 'main')).toBe(
      'HTTPS://GitHub.COM/owner/repo/tree/main'
    );
  });

  // --- Phase 6: the 2026-08-17 rulings — query and fragment (T016) ---
  //
  // Rule 6a: the fragment is decoration on EVERY shape, Azure DevOps included, and is
  //          always discarded.
  // Rule 6b: the query is decoration only on the path shapes (github.com, gitlab.com,
  //          bitbucket.org, unrecognised-host fallback) and is discarded there; on the
  //          Azure DevOps shape it is addressing information and is preserved (FR-003e).
  // Rule 6c: after 6a/6b, rules 3 and 4 are re-applied to what remains, because a query
  //          or a fragment can mask a trailing `.git` or `/` from them.
  // Every vector below must produce exactly the string the bare address produces.

  // github.com — path shape

  it('rule 6b: discards a query string on the github.com shape', () => {
    expect(buildBranchUrl('https://github.com/owner/repo?tab=readme', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('rule 6a: discards a fragment on the github.com shape', () => {
    expect(buildBranchUrl('https://github.com/owner/repo#readme', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  it('rules 6a and 6b: discards a query string and a fragment together on the github.com shape', () => {
    expect(buildBranchUrl('https://github.com/owner/repo?tab=readme#top', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  // gitlab.com — path shape

  it('rule 6b: discards a query string on the gitlab.com shape', () => {
    expect(buildBranchUrl('https://gitlab.com/owner/repo?ref_type=heads', 'main')).toBe(
      'https://gitlab.com/owner/repo/-/tree/main'
    );
  });

  it('rule 6a: discards a fragment on the gitlab.com shape', () => {
    expect(buildBranchUrl('https://gitlab.com/owner/repo#readme', 'main')).toBe(
      'https://gitlab.com/owner/repo/-/tree/main'
    );
  });

  it('rules 6a and 6b: discards a query string and a fragment together on the gitlab.com shape', () => {
    expect(buildBranchUrl('https://gitlab.com/owner/repo?ref_type=heads#top', 'main')).toBe(
      'https://gitlab.com/owner/repo/-/tree/main'
    );
  });

  // bitbucket.org — path shape

  it('rule 6b: discards a query string on the bitbucket.org shape', () => {
    expect(buildBranchUrl('https://bitbucket.org/owner/repo?utm_source=x', 'main')).toBe(
      'https://bitbucket.org/owner/repo/src/main'
    );
  });

  it('rule 6a: discards a fragment on the bitbucket.org shape', () => {
    expect(buildBranchUrl('https://bitbucket.org/owner/repo#readme', 'main')).toBe(
      'https://bitbucket.org/owner/repo/src/main'
    );
  });

  it('rules 6a and 6b: discards a query string and a fragment together on the bitbucket.org shape', () => {
    expect(buildBranchUrl('https://bitbucket.org/owner/repo?utm_source=x#top', 'main')).toBe(
      'https://bitbucket.org/owner/repo/src/main'
    );
  });

  // unrecognised host — the fallback is a path shape too

  it('rule 6b: discards a query string on the unrecognised-host fallback shape', () => {
    expect(buildBranchUrl('https://git.internal.example/owner/repo?utm_source=x', 'main')).toBe(
      'https://git.internal.example/owner/repo/tree/main'
    );
  });

  it('rule 6a: discards a fragment on the unrecognised-host fallback shape', () => {
    expect(buildBranchUrl('https://git.internal.example/owner/repo#readme', 'main')).toBe(
      'https://git.internal.example/owner/repo/tree/main'
    );
  });

  it('rules 6a and 6b: discards a query string and a fragment together on the unrecognised-host fallback shape', () => {
    expect(
      buildBranchUrl('https://git.internal.example/owner/repo?utm_source=x#top', 'main')
    ).toBe('https://git.internal.example/owner/repo/tree/main');
  });

  // Masked suffix — 6b discards the query, then 6c re-applies rules 3 and 4

  it('rule 6c: strips a trailing .git that a query string had masked from rules 3 and 4', () => {
    expect(buildBranchUrl('https://github.com/owner/repo.git?tab=readme', 'main')).toBe(
      'https://github.com/owner/repo/tree/main'
    );
  });

  // Azure DevOps — the query is addressing information and is exempt from 6b (FR-003e)

  it('FR-003e exemption guard: preserves the query string on the Azure DevOps shape and appends with & (rule 6b does not apply)', () => {
    expect(buildBranchUrl('https://dev.azure.com/org/proj/_git/repo?path=/x', 'main')).toBe(
      'https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain'
    );
  });

  // Azure DevOps — the fragment rule is universal, so 6a applies here too (FR-003e, FR-005a)

  it('rule 6a: discards a fragment on the dev.azure.com shape so ?version=GB is not buried inside it', () => {
    expect(buildBranchUrl('https://dev.azure.com/org/proj/_git/repo#readme', 'main')).toBe(
      'https://dev.azure.com/org/proj/_git/repo?version=GBmain'
    );
  });

  it('rules 6a and 6b: on dev.azure.com the fragment goes and the query stays (FR-003e)', () => {
    expect(
      buildBranchUrl('https://dev.azure.com/org/proj/_git/repo?path=/x#readme', 'main')
    ).toBe('https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain');
  });

  it('rule 6a: discards a legacy visualstudio.com hash route carrying a stale branch selector (FR-005a)', () => {
    expect(
      buildBranchUrl('https://org.visualstudio.com/proj/_git/repo#path=/x&version=GBmaster', 'main')
    ).toBe('https://org.visualstudio.com/proj/_git/repo?version=GBmain');
  });
});
