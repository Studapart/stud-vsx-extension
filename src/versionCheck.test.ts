import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  CHECK_VERSION_COMMAND,
  EXECUTABLE_PATH_SETTING,
  VERSION_ARGS,
  formatVersionResult,
  planVersionCheck,
} from './versionCheck';

test('missing or blank executable path stays unresolved', () => {
  for (const value of [undefined, null, '', '   ']) {
    const plan = planVersionCheck(value);
    assert.equal(plan.kind, 'missing-path');
    if (plan.kind === 'missing-path') {
      assert.match(plan.message, /stud\.executablePath/);
      assert.match(plan.message, /does not discover/);
    }
  }
});

test('configured path runs stud --version without a shell', () => {
  const plan = planVersionCheck('  /home/dev/.local/bin/stud  ');
  assert.deepEqual(plan, {
    kind: 'run',
    executable: '/home/dev/.local/bin/stud',
    args: VERSION_ARGS,
  });
  assert.deepEqual(VERSION_ARGS, ['--version']);
});

test('version output is success text and spawn errors stay failures', () => {
  const success = formatVersionResult({ stdout: ' stud 1.2.3 \n', stderr: '' });
  assert.equal(success.ok, true);
  assert.equal(success.summary, 'stud 1.2.3');

  const failure = formatVersionResult({
    stdout: '',
    stderr: 'not found',
    errorMessage: 'spawn ENOENT',
  });
  assert.equal(failure.ok, false);
  assert.match(failure.detail, /ENOENT/);
  assert.match(failure.detail, /not found/);
});

test('extension host launch config targets this workspace', () => {
  const launch = JSON.parse(readFileSync(join(__dirname, '..', '.vscode', 'launch.json'), 'utf8')) as {
    configurations: Array<{ type: string; args: string[] }>;
  };
  const configuration = launch.configurations[0];
  assert.equal(configuration?.type, 'extensionHost');
  assert.ok(configuration?.args.some((arg) => arg.includes('--extensionDevelopmentPath=')));
});

test('manifest matches the SCI-107 extension identity and SCI-108 command', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    name: string;
    displayName: string;
    publisher: string;
    contributes: {
      commands: Array<{ command: string }>;
      configuration: { properties: Record<string, unknown> };
    };
  };

  assert.equal(`${manifest.publisher}.${manifest.name}`, 'studapart.stud');
  assert.equal(manifest.displayName, 'stud');
  assert.equal(manifest.contributes.commands[0]?.command, CHECK_VERSION_COMMAND);
  assert.ok(manifest.contributes.configuration.properties[EXECUTABLE_PATH_SETTING]);
});
