import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(__dirname, '..');
const RELEASE_SCRIPTS = [
  'cut-release.sh',
  'deploy-release.sh',
  'changelog-section.sh',
  'release-notes.sh',
  'release-check.sh',
] as const;
const COMMAND_TIMEOUT_MS = 60_000;
const CHANGELOG = `# Changelog

## [Unreleased]

- First change.
- Second change.

## [0.0.0] - 2026-01-01

- Earlier change.
`;

interface Repo {
  readonly base: string;
  readonly work: string;
  readonly origin: string;
}

/** Git sees only the identity below and no global or system config from the developer machine. */
function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) {
      env[key] = value;
    }
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    ...extra,
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: testEnv(),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  }).trim();
}

function runScript(cwd: string, script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  return spawnSync('bash', [join('scripts', script), ...args], {
    cwd,
    env: testEnv(env),
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function fixturePackage(version: string, test = 'exit 0'): string {
  return `${JSON.stringify({ name: 'stud', version, scripts: { test } }, null, 2)}\n`;
}

function fixtureLock(version: string): string {
  return `${JSON.stringify({ name: 'stud', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'stud', version } } }, null, 2)}\n`;
}

function makeRepo(): Repo {
  const base = mkdtempSync(join(tmpdir(), 'release-scripts-'));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  git(base, 'init', '--bare', '-b', 'develop', origin);
  mkdirSync(work);
  git(work, 'init', '-b', 'develop');
  git(work, 'remote', 'add', 'origin', origin);
  mkdirSync(join(work, 'scripts'));
  for (const name of RELEASE_SCRIPTS) {
    copyFileSync(join(ROOT, 'scripts', name), join(work, 'scripts', name));
  }
  writeFileSync(join(work, 'package.json'), fixturePackage('0.0.1'));
  writeFileSync(join(work, 'package-lock.json'), fixtureLock('0.0.1'));
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG);
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'chore: initial');
  git(work, 'branch', 'master');
  git(work, 'push', 'origin', 'develop', 'master');
  return { base, work, origin };
}

function withRepo<T>(run: (repo: Repo) => T): T {
  const repo = makeRepo();
  try {
    return run(repo);
  } finally {
    rmSync(repo.base, { recursive: true, force: true });
  }
}

function remoteRefs(origin: string): string {
  return git(origin, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function cutReleaseBranch(work: string): void {
  assert.equal(runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' }).status, 0);
}

function readVersion(dir: string): string {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
}

function assertRefused(result: SpawnSyncReturns<string>): void {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^error: /m);
}

test('changelog-section prints one version body and stops at the next heading', () => {
  withRepo(({ work }) => {
    const result = runScript(work, 'changelog-section.sh', ['CHANGELOG.md', 'Unreleased']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /First change/);
    assert.match(result.stdout, /Second change/);
    assert.doesNotMatch(result.stdout, /Earlier change/);
  });
});

test('changelog-section exits 1 with a message when the heading is missing', () => {
  withRepo(({ work }) => {
    const result = runScript(work, 'changelog-section.sh', ['CHANGELOG.md', '9.9.9']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no "## \[9\.9\.9\]" section/);
  });
});

test('changelog-section prints nothing for a whitespace-only body and still exits 0', () => {
  withRepo(({ work }) => {
    writeFileSync(join(work, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [0.0.0] - 2026-01-01\n\n- Earlier.\n');
    const result = runScript(work, 'changelog-section.sh', ['CHANGELOG.md', 'Unreleased']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});

function writeChangelog(work: string, body: string): void {
  writeFileSync(join(work, 'CHANGELOG.md'), `# Changelog\n\n${body}`);
}

test('release-notes prints the version notes and exits 0 when Unreleased is empty', () => {
  withRepo(({ work }) => {
    writeChangelog(work, '## [Unreleased]\n\n## [0.0.2] - 2026-11-06\n\n- Done.\n');
    const result = runScript(work, 'release-notes.sh', ['0.0.2']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Done\./);
  });
});

test('release-notes refuses a version whose section has no notes', () => {
  withRepo(({ work }) => {
    writeChangelog(work, '## [Unreleased]\n\n## [0.0.2] - 2026-11-06\n\n## [0.0.1] - 2026-01-01\n\n- Earlier.\n');
    const result = runScript(work, 'release-notes.sh', ['0.0.2']);
    assertRefused(result);
    assert.match(result.stderr, /no notes under 0\.0\.2/);
  });
});

test('release-notes refuses when Unreleased still has notes', () => {
  withRepo(({ work }) => {
    writeChangelog(work, '## [Unreleased]\n\n- Pending.\n\n## [0.0.2] - 2026-11-06\n\n- Done.\n');
    const result = runScript(work, 'release-notes.sh', ['0.0.2']);
    assertRefused(result);
    assert.match(result.stderr, /notes under Unreleased/);
  });
});

/** Stands in for gh: each reply is the output the real command gives for that call. */
const FAKE_GH = [
  '#!/bin/sh',
  'echo "$*" >> "$FAKE_GH_LOG"',
  'case "$1" in',
  '  release)',
  '    if [ -n "$FAKE_RELEASE_JSON" ]; then printf "%s\\n" "$FAKE_RELEASE_JSON"; exit 0; fi',
  '    echo "${FAKE_RELEASE_ERR:-release not found}" >&2',
  '    exit 1 ;;',
  '  api)',
  '    case "$2" in',
  '      */git/ref/tags/*)',
  '        if [ -n "$FAKE_REF" ]; then printf "%s\\n" "$FAKE_REF"; exit 0; fi',
  '        echo "${FAKE_REF_ERR:-gh: Not Found (HTTP 404)}" >&2',
  '        exit 1 ;;',
  '      */git/tags/*)',
  '        if [ -n "$FAKE_PEEL_ERR" ]; then echo "$FAKE_PEEL_ERR" >&2; exit 1; fi',
  '        printf "%s\\n" "$FAKE_PEEL"; exit 0 ;;',
  '    esac ;;',
  'esac',
  'echo "unexpected gh call: $*" >&2',
  'exit 2',
  '',
].join('\n');

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const ARCHIVE_JSON = JSON.stringify({ isDraft: false, assets: [{ name: 'stud-0.0.2.vsix' }] });

interface GhReplies {
  readonly release?: string;
  readonly releaseErr?: string;
  readonly ref?: string;
  readonly refErr?: string;
  readonly peel?: string;
  readonly peelErr?: string;
}

function runReleaseCheck(replies: GhReplies, sha = SHA): { result: SpawnSyncReturns<string>; calls: string } {
  const fakeDir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(fakeDir, 'calls.log');
  mkdirSync(join(fakeDir, 'bin'));
  writeFileSync(join(fakeDir, 'bin', 'gh'), FAKE_GH, { mode: 0o755 });
  try {
    return withRepo(({ work }) => {
      const result = runScript(work, 'release-check.sh', ['0.0.2', sha], {
        PATH: `${join(fakeDir, 'bin')}:${process.env.PATH ?? ''}`,
        GH_TOKEN: 'test-token',
        GH_REPO: 'Studapart/stud-vsx-extension',
        FAKE_GH_LOG: log,
        FAKE_RELEASE_JSON: replies.release ?? '',
        FAKE_RELEASE_ERR: replies.releaseErr ?? '',
        FAKE_REF: replies.ref ?? '',
        FAKE_REF_ERR: replies.refErr ?? '',
        FAKE_PEEL: replies.peel ?? '',
        FAKE_PEEL_ERR: replies.peelErr ?? '',
      });
      return { result, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
    });
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
  }
}

test('release-check publishes when there is no release and the tag does not exist yet', () => {
  const { result } = runReleaseCheck({ releaseErr: 'release not found', refErr: 'gh: Not Found (HTTP 404)' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'publish');
});

test('release-check publishes when the existing tag names the built commit', () => {
  const { result } = runReleaseCheck({ ref: `commit ${SHA}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'publish');
});

test('release-check skips a release that already has the archive without looking at the tag', () => {
  const { result, calls } = runReleaseCheck({ release: ARCHIVE_JSON });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'skip');
  assert.doesNotMatch(calls, /git\/ref/);
});

test('release-check publishes when an annotated tag peels to the built commit', () => {
  const { result, calls } = runReleaseCheck({ ref: 'tag tag-object', peel: SHA });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'publish');
  assert.match(calls, /git\/tags\/tag-object/);
});

test('release-check refuses when the annotated tag cannot be read', () => {
  const { result } = runReleaseCheck({ ref: 'tag tag-object', peelErr: 'gh: HTTP 500 (HTTP 500)' });
  assertRefused(result);
  assert.match(result.stderr, /could not read annotated tag v0\.0\.2/);
});

const REAL_BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

/** A PATH that can run bash and the named tools, so command -v reports real absences. */
function runWithTools(
  tools: readonly string[],
  repo: string | null = 'Studapart/stud-vsx-extension',
  version = '0.0.2',
  sha = SHA,
): SpawnSyncReturns<string> {
  const bin = join(mkdtempSync(join(tmpdir(), 'release-tools-')), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'bash'), `#!/bin/sh\nexec ${JSON.stringify(REAL_BASH)} "$@"\n`, { mode: 0o755 });
  for (const tool of tools) {
    writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const env = testEnv({
    PATH: bin,
    GH_TOKEN: 'test-token',
    ...(repo === null ? {} : { GH_REPO: repo }),
  });
  if (repo === null) {
    delete env.GH_REPO;
  }
  try {
    return spawnSync('bash', [join('scripts', 'release-check.sh'), version, sha], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
    });
  } finally {
    rmSync(resolve(bin, '..'), { recursive: true, force: true });
  }
}

test('release-check refuses when gh is missing', () => {
  const result = runWithTools([]);
  assertRefused(result);
  assert.match(result.stderr, /gh is required/);
});

test('release-check refuses when jq is missing', () => {
  const result = runWithTools(['gh']);
  assertRefused(result);
  assert.match(result.stderr, /jq is required/);
});

test('release-check refuses when GH_REPO is unset', () => {
  const result = runWithTools(['gh', 'jq'], null);
  assertRefused(result);
  assert.match(result.stderr, /GH_REPO is required/);
});

test('release-check refuses when GH_REPO is empty', () => {
  const result = runWithTools(['gh', 'jq'], '');
  assertRefused(result);
  assert.match(result.stderr, /GH_REPO is required/);
});

test('release-check refuses a version that is not X.Y.Z', () => {
  const result = runWithTools(['gh', 'jq'], 'Studapart/stud-vsx-extension', '1.2');
  assertRefused(result);
  assert.match(result.stderr, /version '1\.2' is not X\.Y\.Z/);
});

test('release-check refuses a sha that is not a commit', () => {
  const result = runWithTools(['gh', 'jq'], 'Studapart/stud-vsx-extension', '0.0.2', 'abc');
  assertRefused(result);
  assert.match(result.stderr, /'abc' is not a commit SHA/);
});

test('release-check refuses a release lookup error that only contains Not Found', () => {
  const { result } = runReleaseCheck({ releaseErr: 'gh: Not Found (HTTP 404)' });
  assertRefused(result);
  assert.match(result.stderr, /could not look up release v0\.0\.2/);
});

test('release-check refuses a release that exists without the archive', () => {
  const { result } = runReleaseCheck({ release: JSON.stringify({ isDraft: false, assets: [{ name: 'other.txt' }] }) });
  assertRefused(result);
  assert.match(result.stderr, /exists without stud-0\.0\.2\.vsix/);
});

test('release-check refuses a draft release', () => {
  const { result } = runReleaseCheck({ release: JSON.stringify({ isDraft: true, assets: [] }) });
  assertRefused(result);
  assert.match(result.stderr, /v0\.0\.2 is a draft/);
});

test('release-check refuses when the release lookup fails for another reason', () => {
  const { result } = runReleaseCheck({ releaseErr: 'gh: HTTP 500 (HTTP 500)' });
  assertRefused(result);
  assert.match(result.stderr, /could not look up release v0\.0\.2/);
});

test('release-check refuses a tag that points at another commit', () => {
  const { result } = runReleaseCheck({ ref: 'tag tag-object', peel: OTHER_SHA });
  assertRefused(result);
  assert.match(result.stderr, new RegExp(`tag v0\\.0\\.2 points at ${OTHER_SHA}, not ${SHA}`));
});

test('release-check refuses a lightweight tag that points at another commit', () => {
  const { result, calls } = runReleaseCheck({ ref: `commit ${OTHER_SHA}` });
  assertRefused(result);
  assert.match(result.stderr, new RegExp(`tag v0\\.0\\.2 points at ${OTHER_SHA}, not ${SHA}`));
  assert.doesNotMatch(calls, /git\/tags\//);
});

test('release-check refuses when the tag lookup fails for another reason', () => {
  const { result } = runReleaseCheck({ refErr: 'gh: HTTP 500 (HTTP 500)' });
  assertRefused(result);
  assert.match(result.stderr, /could not look up tag v0\.0\.2/);
});

test('cut-release patch by default bumps the version, moves Unreleased notes under the new heading, and commits', () => {
  withRepo(({ work }) => {
    cutReleaseBranch(work);
    assert.equal(git(work, 'branch', '--show-current'), 'release/v0.0.2');
    assert.equal(readVersion(work), '0.0.2');
    const changelog = readFileSync(join(work, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.0\.2\] - 2026-11-06\n\n- First change\./);
    assert.equal(runScript(work, 'changelog-section.sh', ['CHANGELOG.md', 'Unreleased']).stdout.trim(), '');
    assert.equal(git(work, 'log', '-1', '--format=%s'), 'chore(release): bump version to 0.0.2');
  });
});

test('cut-release bumps the lockfile version along with the manifest', () => {
  withRepo(({ work }) => {
    cutReleaseBranch(work);
    const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, '0.0.2');
    assert.equal(lock.packages[''].version, '0.0.2');
  });
});

test('cut-release inserts the version heading when Unreleased has a trailing space', () => {
  withRepo(({ work }) => {
    writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG.replace('## [Unreleased]', '## [Unreleased] '));
    git(work, 'commit', '-am', 'chore: trailing space');
    git(work, 'push', 'origin', 'develop');
    cutReleaseBranch(work);
    assert.match(readFileSync(join(work, 'CHANGELOG.md'), 'utf8'), /## \[0\.0\.2\] - 2026-11-06/);
  });
});

test('cut-release bumps major and minor from the current version', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['major', '1.0.0'],
    ['minor', '0.1.0'],
  ];
  for (const [bump, expected] of cases) {
    withRepo(({ work }) => {
      const result = runScript(work, 'cut-release.sh', [bump]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readVersion(work), expected);
      assert.equal(git(work, 'branch', '--show-current'), `release/v${expected}`);
    });
  }
});

test('cut-release accepts an explicit version equal to the current one', () => {
  withRepo(({ work }) => {
    const result = runScript(work, 'cut-release.sh', ['0.0.1']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(work, 'branch', '--show-current'), 'release/v0.0.1');
    assert.equal(readVersion(work), '0.0.1');
  });
});

test('cut-release refuses an argument that is not a bump or X.Y.Z', () => {
  withRepo(({ work }) => {
    assertRefused(runScript(work, 'cut-release.sh', ['banana']));
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when the tag already exists locally', () => {
  withRepo(({ work }) => {
    git(work, 'tag', 'v0.0.2');
    const result = runScript(work, 'cut-release.sh');
    assertRefused(result);
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when the tag already exists on origin', () => {
  withRepo(({ work }) => {
    git(work, 'tag', 'v0.0.2');
    git(work, 'push', 'origin', 'v0.0.2');
    git(work, 'tag', '-d', 'v0.0.2');
    const result = runScript(work, 'cut-release.sh');
    assertRefused(result);
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when Unreleased has no notes', () => {
  withRepo(({ work }) => {
    writeFileSync(join(work, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [0.0.0] - 2026-01-01\n\n- Earlier.\n');
    git(work, 'commit', '-am', 'chore: empty unreleased');
    git(work, 'push', 'origin', 'develop');
    const result = runScript(work, 'cut-release.sh');
    assertRefused(result);
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when develop is ahead of origin/develop', () => {
  withRepo(({ work }) => {
    git(work, 'commit', '--allow-empty', '-m', 'chore: local only');
    const result = runScript(work, 'cut-release.sh');
    assertRefused(result);
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses a dirty working tree', () => {
  withRepo(({ work }) => {
    writeFileSync(join(work, 'scratch.txt'), 'untracked\n');
    const result = runScript(work, 'cut-release.sh');
    assertRefused(result);
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when develop is behind origin/develop', () => {
  withRepo(({ work }) => {
    git(work, 'commit', '--allow-empty', '-m', 'chore: remote only');
    git(work, 'push', 'origin', 'develop');
    git(work, 'reset', '--hard', 'HEAD~1');
    assertRefused(runScript(work, 'cut-release.sh'));
    assert.equal(git(work, 'branch', '--show-current'), 'develop');
  });
});

test('cut-release refuses when run from a branch other than develop', () => {
  withRepo(({ work }) => {
    git(work, 'checkout', '-b', 'feature/other');
    assertRefused(runScript(work, 'cut-release.sh'));
    assert.equal(git(work, 'branch', '--show-current'), 'feature/other');
  });
});

test('deploy-release merges into master, tags it, rebases develop, and pushes all three', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    const result = runScript(work, 'deploy-release.sh');
    assert.equal(result.status, 0, result.stderr);

    const masterSha = git(origin, 'rev-parse', 'master');
    assert.equal(git(origin, 'rev-parse', 'develop'), masterSha);
    assert.equal(git(origin, 'rev-parse', 'v0.0.2^{commit}'), masterSha);
    assert.equal(git(origin, 'rev-list', '--parents', '-n1', 'master').split(' ').length, 3);
    assert.match(git(origin, 'show', 'master:package.json'), /"version": "0\.0\.2"/);
    assert.equal(git(work, 'branch', '--list', 'release/v0.0.2'), '');
  });
});

test('deploy-release refuses when not run from a release branch', () => {
  withRepo(({ work, origin }) => {
    const before = git(origin, 'rev-parse', 'master');
    assertRefused(runScript(work, 'deploy-release.sh'));
    assert.equal(git(origin, 'rev-parse', 'master'), before);
  });
});

test('deploy-release refuses when local master has commits origin does not have', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    const releaseBranch = git(work, 'branch', '--show-current');
    git(work, 'checkout', 'master');
    git(work, 'commit', '--allow-empty', '-m', 'chore: local only');
    git(work, 'checkout', releaseBranch);

    const masterBefore = git(origin, 'rev-parse', 'master');
    assertRefused(runScript(work, 'deploy-release.sh'));
    assert.equal(git(origin, 'rev-parse', 'master'), masterBefore);
    assert.equal(git(work, 'ls-remote', '--tags', 'origin', 'v0.0.2'), '');
  });
});

test('deploy-release stops at a rebase conflict and publishes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    const releaseBranch = git(work, 'branch', '--show-current');
    git(work, 'checkout', 'develop');
    writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG.replace('- First change.', '- First change, reworded.'));
    git(work, 'commit', '-am', 'docs: reword first change');
    git(work, 'push', 'origin', 'develop');
    git(work, 'checkout', releaseBranch);

    const masterBefore = git(origin, 'rev-parse', 'master');
    const developBefore = git(origin, 'rev-parse', 'develop');
    const result = runScript(work, 'deploy-release.sh');
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(join(work, '.git', 'rebase-merge')), 'the failure is a rebase in progress');
    assert.equal(git(origin, 'rev-parse', 'master'), masterBefore);
    assert.equal(git(origin, 'rev-parse', 'develop'), developBefore);
    assert.equal(git(work, 'ls-remote', '--tags', 'origin', 'v0.0.2'), '');
  });
});

function rejectRefOnOrigin(origin: string, ref: string): void {
  writeFileSync(join(origin, 'hooks', 'update'), `#!/bin/sh\n[ "$1" = ${ref} ] && exit 1\nexit 0\n`, { mode: 0o755 });
}

test('deploy-release publishes neither the tag nor master when the master push is rejected', () => {
  withRepo(({ work, origin }) => {
    rejectRefOnOrigin(origin, 'refs/heads/master');
    cutReleaseBranch(work);
    const masterBefore = git(origin, 'rev-parse', 'master');
    const developBefore = git(origin, 'rev-parse', 'develop');
    const result = runScript(work, 'deploy-release.sh');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rejected/);
    assert.equal(git(origin, 'rev-parse', 'master'), masterBefore);
    assert.equal(git(origin, 'rev-parse', 'develop'), developBefore);
    assert.equal(git(work, 'ls-remote', '--tags', 'origin', 'v0.0.2'), '');
  });
});

test('deploy-release keeps master and the tag when the develop push is rejected', () => {
  withRepo(({ work, origin }) => {
    rejectRefOnOrigin(origin, 'refs/heads/develop');
    cutReleaseBranch(work);
    const developBefore = git(origin, 'rev-parse', 'develop');
    const result = runScript(work, 'deploy-release.sh');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rejected/);
    assert.match(git(origin, 'show', 'master:package.json'), /"version": "0\.0\.2"/);
    assert.equal(git(origin, 'rev-parse', 'v0.0.2^{commit}'), git(origin, 'rev-parse', 'master'));
    assert.equal(git(origin, 'rev-parse', 'develop'), developBefore);
  });
});

test('deploy-release deletes the release branch from origin after a successful deploy', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    git(work, 'push', 'origin', 'release/v0.0.2');
    assert.equal(runScript(work, 'deploy-release.sh').status, 0);
    assert.equal(git(origin, 'branch', '--list', 'release/v0.0.2'), '');
  });
});

test('deploy-release still succeeds when the release branch cannot be deleted on origin', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    git(work, 'push', 'origin', 'release/v0.0.2');
    rejectRefOnOrigin(origin, 'refs/heads/release/v0.0.2');
    const result = runScript(work, 'deploy-release.sh');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /warning: deployed v0\.0\.2, but could not remove release\/v0\.0\.2/);
    assert.match(git(origin, 'show', 'master:package.json'), /"version": "0\.0\.2"/);
    assert.equal(git(origin, 'rev-parse', 'v0.0.2^{commit}'), git(origin, 'rev-parse', 'master'));
    assert.equal(git(origin, 'rev-parse', 'develop'), git(origin, 'rev-parse', 'master'));
    assert.notEqual(git(origin, 'branch', '--list', 'release/v0.0.2'), '');
  });
});

test('deploy-release refuses a clone without a local master', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    git(work, 'checkout', 'release/v0.0.2');
    git(work, 'branch', '-D', 'master');
    const masterBefore = git(origin, 'rev-parse', 'master');
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /no local master/);
    assert.equal(git(origin, 'rev-parse', 'master'), masterBefore);
  });
});

test('deploy-release refuses when the release notes fail and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    const changelog = readFileSync(join(work, 'CHANGELOG.md'), 'utf8');
    writeFileSync(join(work, 'CHANGELOG.md'), changelog.replace('## [Unreleased]', '## [Unreleased]\n\n- Late change.'));
    git(work, 'commit', '-am', 'docs: late change');
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /release notes check failed; nothing was pushed/);
    assert.equal(remoteRefs(origin), before);
  });
});

test('deploy-release refuses when npm ci fails and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    writeFileSync(join(work, 'package-lock.json'), '{\n');
    git(work, 'commit', '-am', 'chore: break the lock');
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /npm ci failed; nothing was pushed/);
    assert.equal(remoteRefs(origin), before);
  });
});

test('deploy-release refuses when npm test fails and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    writeFileSync(join(work, 'package.json'), fixturePackage('0.0.2', 'exit 1'));
    git(work, 'commit', '-am', 'chore: break the tests');
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /npm test failed; nothing was pushed/);
    assert.equal(remoteRefs(origin), before);
  });
});

test('deploy-release refuses a package.json version that differs from the branch and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    writeFileSync(join(work, 'package.json'), fixturePackage('0.0.9'));
    git(work, 'commit', '-am', 'chore: wrong version');
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /package\.json version is not 0\.0\.2/);
    assert.equal(remoteRefs(origin), before);
  });
});

test('deploy-release refuses uncommitted changes and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    writeFileSync(join(work, 'scratch.txt'), 'untracked\n');
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /working tree is not clean/);
    assert.equal(remoteRefs(origin), before);
  });
});

test('deploy-release refuses when origin/master has commits the release branch lacks and pushes nothing', () => {
  withRepo(({ work, origin }) => {
    cutReleaseBranch(work);
    const releaseBranch = git(work, 'branch', '--show-current');
    git(work, 'checkout', 'master');
    git(work, 'commit', '--allow-empty', '-m', 'chore: master only');
    git(work, 'push', 'origin', 'master');
    git(work, 'checkout', releaseBranch);
    const before = remoteRefs(origin);
    const result = runScript(work, 'deploy-release.sh');
    assertRefused(result);
    assert.match(result.stderr, /origin\/master has commits/);
    assert.equal(remoteRefs(origin), before);
  });
});

function assertActionsPinned(workflow: string): void {
  for (const [, ref] of workflow.matchAll(/uses: (\S+)/g)) {
    assert.match(ref, /@[0-9a-f]{40}$/, `action is not pinned to a full commit SHA: ${ref}`);
  }
}

test('release workflow builds with a read-only token and publishes from its own job', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const build = workflow.slice(workflow.indexOf('\n  build:\n'), workflow.indexOf('\n  publish:\n'));
  const publish = workflow.slice(workflow.indexOf('\n  publish:\n'));
  const at = (text: string, needle: string): number => {
    const index = text.indexOf(needle);
    assert.notEqual(index, -1, `missing ${needle}`);
    return index;
  };

  assert.match(workflow, /on:\n {2}push:\n {4}branches:\n {6}- master\n/);
  assert.doesNotMatch(workflow, /tags:/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(workflow, /concurrency:\n {2}group: release-master\n {2}cancel-in-progress: false/);
  assert.match(workflow, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.doesNotMatch(build, /contents: write/);
  assert.match(publish, /permissions:\n {6}contents: write/);
  assert.equal(publish.match(/GH_TOKEN: /g)?.length, 2);
  assert.doesNotMatch(publish, /npm|setup-node/);
  assert.ok(at(build, 'release-check.sh') < at(build, 'npm ci'));
  assert.ok(at(build, 'release-notes.sh') < at(build, 'npm ci'));
  assert.equal(build.match(/if: steps\.check\.outputs\.decision == 'publish'/g)?.length, 5);
  assert.ok(at(publish, 'release-check.sh') < at(publish, 'gh release create'));
  assert.ok(at(publish, 'download-artifact') < at(publish, 'gh release create'));
  assert.equal(workflow.match(/with:\n {10}name: release\n/g)?.length, 2);
  assert.match(
    publish,
    /gh release create "v\$VERSION" "\$RUNNER_TEMP\/release\/stud-\$VERSION\.vsix" --target "\$TARGET_SHA" --title "v\$VERSION" --notes-file "\$RUNNER_TEMP\/release\/release-notes\.md"/,
  );
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, workflow.match(/actions\/checkout@/g)?.length);
  assertActionsPinned(workflow);
});

test('package-vsix builds from the locked packaging tree and does not write the version', () => {
  const script = readFileSync(join(ROOT, 'scripts/package-vsix.sh'), 'utf8');
  assert.doesNotMatch(script, /npm version|npx/);
  assert.match(script, /npm ci --prefix scripts\/vsce --ignore-scripts/);
  assert.match(script, /scripts\/vsce\/node_modules\/\.bin\/vsce package --out "stud-\$version\.vsix"/);
});

test('the packaging lock pins @vscode/vsce 4.1.0 exactly', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/vsce/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'scripts/vsce/package-lock.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { '@vscode/vsce': '4.1.0' });
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '4.1.0');
});

test('pull requests into develop run the tests and linters and never publish', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /on:\n {2}pull_request:\n {4}branches:\n {6}- develop\n/);
  assert.doesNotMatch(ci, /\n {2}push:/);
  assert.match(ci, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(ci, /contents: write|gh release|upload-artifact|download-artifact/);
  assert.match(ci, /node-version: 18/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run package/);
  assert.match(ci, /rhysd\/actionlint@sha256:[0-9a-f]{64}/);
  assert.match(ci, /--entrypoint shellcheck/);
  assert.equal(ci.match(/persist-credentials: false/g)?.length, ci.match(/actions\/checkout@/g)?.length);
  assertActionsPinned(ci);
});

test('release tooling stays out of the VSIX', () => {
  const ignore = readFileSync(join(ROOT, '.vscodeignore'), 'utf8').split('\n');
  assert.ok(ignore.includes('scripts/**'));
  assert.ok(ignore.includes('.github/**'));
});

test('manifest and lockfile carry one X.Y.Z version and the release scripts', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(manifest.scripts.release, 'scripts/cut-release.sh');
  assert.equal(manifest.scripts.deploy, 'scripts/deploy-release.sh');
});
