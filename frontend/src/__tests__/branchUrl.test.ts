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

  it('does not treat a domain-boundary trap host as github.com', () => {
    expect(buildBranchUrl('https://github.com.evil.example/owner/repo', 'main')).toBe(
      'https://github.com.evil.example/owner/repo/tree/main'
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
});
