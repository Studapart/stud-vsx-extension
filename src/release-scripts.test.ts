import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(__dirname, '..');
const RELEASE_SCRIPTS = ['cut-release.sh', 'deploy-release.sh', 'changelog-section.sh'] as const;
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
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'stud', version: '0.0.1' }, null, 2)}\n`);
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG);
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'chore: initial');
  git(work, 'branch', 'master');
  git(work, 'push', 'origin', 'develop', 'master');
  return { base, work, origin };
}

function withRepo(run: (repo: Repo) => void): void {
  const repo = makeRepo();
  try {
    run(repo);
  } finally {
    rmSync(repo.base, { recursive: true, force: true });
  }
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

test('cut-release patch by default bumps the version, moves Unreleased notes under the new heading, and commits', () => {
  withRepo(({ work }) => {
    const result = runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(work, 'branch', '--show-current'), 'release/v0.0.2');
    assert.equal(readVersion(work), '0.0.2');
    const changelog = readFileSync(join(work, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.0\.2\] - 2026-11-06\n\n- First change\./);
    assert.equal(runScript(work, 'changelog-section.sh', ['CHANGELOG.md', 'Unreleased']).stdout.trim(), '');
    assert.equal(git(work, 'log', '-1', '--format=%s'), 'chore(release): bump version to 0.0.2');
  });
});

test('cut-release inserts the version heading when Unreleased has a trailing space', () => {
  withRepo(({ work }) => {
    writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG.replace('## [Unreleased]', '## [Unreleased] '));
    git(work, 'commit', '-am', 'chore: trailing space');
    git(work, 'push', 'origin', 'develop');
    const result = runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' });
    assert.equal(result.status, 0, result.stderr);
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

test('deploy-release merges into master, tags it, rebases develop, and pushes all three', () => {
  withRepo(({ work, origin }) => {
    assert.equal(runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' }).status, 0);
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
    assert.equal(runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' }).status, 0);
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
    assert.equal(runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' }).status, 0);
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

test('deploy-release publishes neither the tag nor master when the master push is rejected', () => {
  withRepo(({ work, origin }) => {
    writeFileSync(
      join(origin, 'hooks', 'pre-receive'),
      '#!/bin/sh\nwhile read old new ref; do\n  [ "$ref" = refs/heads/master ] && exit 1\ndone\nexit 0\n',
      { mode: 0o755 },
    );
    assert.equal(runScript(work, 'cut-release.sh', [], { RELEASE_DATE: '2026-11-06' }).status, 0);
    const masterBefore = git(origin, 'rev-parse', 'master');
    assert.notEqual(runScript(work, 'deploy-release.sh').status, 0);
    assert.equal(git(origin, 'rev-parse', 'master'), masterBefore);
    assert.equal(git(work, 'ls-remote', '--tags', 'origin', 'v0.0.2'), '');
  });
});

test('release workflow runs only on master and checks notes and archive before npm ci', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /on:\n {2}push:\n {4}branches:\n {6}- master\n/);
  assert.doesNotMatch(workflow, /tags:/);
  assert.match(workflow, /concurrency:\n {2}group: release-master\n {2}cancel-in-progress: false/);

  const at = (text: string): number => {
    const index = workflow.indexOf(text);
    assert.notEqual(index, -1, `missing ${text}`);
    return index;
  };
  assert.ok(at('gh release view') < at('npm ci'));
  assert.ok(at('changelog-section.sh CHANGELOG.md') < at('npm ci'));
  assert.ok(at('npm run package') < at('gh release create'));
  assert.match(workflow, /TARGET_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /gh release create[^\n]*--target "\$TARGET_SHA"/);
});

test('package-vsix names the archive from package.json and does not write the version', () => {
  const script = readFileSync(join(ROOT, 'scripts/package-vsix.sh'), 'utf8');
  assert.doesNotMatch(script, /npm version/);
  assert.match(script, /stud-\$version\.vsix/);
  assert.match(script, /@vscode\/vsce@4\.1\.0/);
});

test('release tooling stays out of the VSIX', () => {
  const ignore = readFileSync(join(ROOT, '.vscodeignore'), 'utf8').split('\n');
  assert.ok(ignore.includes('scripts/**'));
  assert.ok(ignore.includes('.github/**'));
});

test('manifest and lockfile carry version 0.0.1 and the release scripts', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.version, '0.0.1');
  assert.equal(lock.version, '0.0.1');
  assert.equal(lock.packages[''].version, '0.0.1');
  assert.equal(manifest.scripts.release, 'scripts/cut-release.sh');
  assert.equal(manifest.scripts.deploy, 'scripts/deploy-release.sh');
});
