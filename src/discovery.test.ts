import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  AGENT_HELP_ARGS,
  AGENT_HELP_STDIN,
  SEARCH_PATH_SETTING,
  VALIDATE_COMMAND,
  chooseCandidate,
  describeUnresolved,
  interpretAgentHelp,
  planDiscovery,
} from './discovery';

const unixRequest = {
  searchEnabled: true,
  pathEnv: '/usr/bin:/home/dev/.local/bin',
  homeDir: '/home/dev',
  pathDelimiter: ':',
  executableNames: ['stud'],
};

test('an explicit path is used alone and is not replaced by search', () => {
  for (const configuredPath of ['  /opt/stud  ', '/opt/stud']) {
    const plan = planDiscovery({ ...unixRequest, configuredPath, searchEnabled: false });
    assert.deepEqual(plan, { kind: 'explicit', executable: '/opt/stud' });
  }
});

test('blank settings search PATH and then the common install directory', () => {
  for (const configuredPath of [undefined, null, '', '   ']) {
    const plan = planDiscovery({ ...unixRequest, configuredPath });
    assert.equal(plan.kind, 'search');
    if (plan.kind === 'search') {
      assert.deepEqual(plan.candidates, ['/usr/bin/stud', '/home/dev/.local/bin/stud']);
    }
  }
});

test('Windows search names stud.exe and uses the home bin directory', () => {
  const plan = planDiscovery({
    configuredPath: '',
    searchEnabled: true,
    pathEnv: 'C:\\bin',
    homeDir: 'C:\\Users\\dev',
    pathDelimiter: ';',
    executableNames: ['stud.exe', 'stud'],
  });
  assert.deepEqual(plan, {
    kind: 'search',
    candidates: [
      'C:\\bin\\stud.exe',
      'C:\\bin\\stud',
      'C:\\Users\\dev\\.local\\bin\\stud.exe',
      'C:\\Users\\dev\\.local\\bin\\stud',
    ],
  });
});

test('search can be turned off and an empty PATH does not invent a binary', () => {
  const disabled = planDiscovery({ ...unixRequest, configuredPath: '', searchEnabled: false });
  assert.equal(disabled.kind, 'missing');
  if (disabled.kind === 'missing') {
    assert.match(disabled.message, /PATH search is disabled/);
  }

  const empty = planDiscovery({
    ...unixRequest,
    configuredPath: '',
    pathEnv: '  ',
    homeDir: '',
  });
  assert.equal(empty.kind, 'missing');
  if (empty.kind === 'missing') {
    assert.match(empty.message, /Install Portable stud/);
  }
});

test('search keeps going until an executable candidate', () => {
  const chosen = chooseCandidate([
    { path: '/usr/bin/stud', state: 'not-executable' },
    { path: '/home/dev/.local/bin/stud', state: 'executable' },
  ]);
  assert.equal(chosen.path, '/home/dev/.local/bin/stud');
  assert.equal(chosen.state, 'executable');

  const blocked = chooseCandidate([
    { path: '/usr/bin/stud', state: 'missing' },
    { path: '/opt/stud', state: 'not-executable' },
  ]);
  assert.equal(blocked.state, 'not-executable');

  const absent = chooseCandidate([{ path: '/usr/bin/stud', state: 'missing' }]);
  assert.equal(absent.state, 'missing');
});

test('unresolved candidates stay missing or not executable', () => {
  const missing = describeUnresolved({ source: 'explicit', state: 'missing', path: '/opt/stud' });
  assert.match(missing.summary, /No stud executable/);
  assert.match(missing.summary, /left unchanged/);

  const blocked = describeUnresolved({ source: 'search', state: 'not-executable', path: '/usr/bin/stud' });
  assert.match(blocked.summary, /not executable/);

  const absent = describeUnresolved({ source: 'search', state: 'missing', path: '/usr/bin/stud' });
  assert.match(absent.summary, /not found on PATH/);
});

test('agent help accepts a success envelope and classifies bad output', () => {
  assert.deepEqual(AGENT_HELP_ARGS, ['help', '--agent']);
  assert.equal(AGENT_HELP_STDIN, '{}');

  const ok = interpretAgentHelp({ stdout: '{"success":true,"data":{"commands":[]}}\n', stderr: '' });
  assert.equal(ok.ok, true);

  const failed = interpretAgentHelp({ stdout: '{"success":false,"error":"unknown command"}', stderr: '' });
  assert.equal(failed.ok, false);
  assert.match(failed.summary, /unknown command/);

  const tooOld = interpretAgentHelp({ stdout: '{"success":true}', stderr: '' });
  assert.equal(tooOld.ok, false);
  assert.match(tooOld.summary, /too old/);

  const notJson = interpretAgentHelp({ stdout: 'stud 1.0', stderr: '' });
  assert.equal(notJson.ok, false);
  assert.match(notJson.summary, /did not return JSON/);

  const crashed = interpretAgentHelp({ stdout: '', stderr: 'boom', errorMessage: 'exited with code 1' });
  assert.equal(crashed.ok, false);
  assert.match(crashed.summary, /failed/);
  assert.match(crashed.detail, /boom/);
});

test('manifest exposes discovery settings and the validate command', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string }>;
      configuration: { properties: Record<string, { default?: unknown }> };
    };
  };
  const commands = manifest.contributes.commands.map((command) => command.command);
  assert.ok(commands.includes(VALIDATE_COMMAND));
  assert.ok(manifest.activationEvents.includes(`onCommand:${VALIDATE_COMMAND}`));
  assert.equal(manifest.contributes.configuration.properties[SEARCH_PATH_SETTING]?.default, true);
});
