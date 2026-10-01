import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  SHOW_CONFIG_COMMAND,
  SHOW_PULL_REQUEST_COMMENTS_COMMAND,
  SHOW_WORK_ITEM_COMMAND,
  VALIDATE_CONFIG_COMMAND,
  interpretAgentRun,
  planAgentWorkspace,
  planAllowlistedRun,
} from './agentRun';

test('read-only commands are allowlisted and mutations fail closed', () => {
  for (const commandId of [SHOW_CONFIG_COMMAND, VALIDATE_CONFIG_COMMAND, SHOW_PULL_REQUEST_COMMENTS_COMMAND]) {
    const plan = planAllowlistedRun(commandId);
    assert.equal(plan.kind, 'run');
    if (plan.kind === 'run') {
      assert.deepEqual(plan.stdin, '{}');
      assert.ok(plan.args.includes('--agent'));
    }
  }

  const show = planAllowlistedRun(SHOW_CONFIG_COMMAND);
  assert.deepEqual(show.kind === 'run' ? show.args : [], ['config:show', '--agent']);
  const validate = planAllowlistedRun(VALIDATE_CONFIG_COMMAND);
  const comments = planAllowlistedRun(SHOW_PULL_REQUEST_COMMENTS_COMMAND);
  assert.deepEqual(validate.kind === 'run' ? validate.args : [], ['config:validate', '--agent']);
  assert.deepEqual(comments.kind === 'run' ? comments.args : [], ['pr:comments', '--agent']);

  for (const commandId of ['stud.commit', 'stud.push', 'stud.submit', '', 'config:show']) {
    const plan = planAllowlistedRun(commandId);
    assert.equal(plan.kind, 'rejected');
    assert.match(plan.kind === 'rejected' ? plan.summary : '', /allowlist/i);
  }
});

test('a work item read sends only the key and a blank key is rejected', () => {
  for (const key of ['', '   ', undefined, null]) {
    const plan = planAllowlistedRun(SHOW_WORK_ITEM_COMMAND, key);
    assert.equal(plan.kind, 'rejected');
    assert.match(plan.kind === 'rejected' ? plan.summary : '', /work item key/i);
    assert.match(plan.kind === 'rejected' ? plan.summary : '', /issue tracker/i);
  }

  const plan = planAllowlistedRun(SHOW_WORK_ITEM_COMMAND, '  SCI-111  ');
  assert.equal(plan.kind, 'run');
  if (plan.kind === 'run') {
    assert.deepEqual(plan.args, ['items:show', '--agent']);
    assert.deepEqual(JSON.parse(plan.stdin), { key: 'SCI-111' });
    assert.equal(Object.hasOwn(JSON.parse(plan.stdin) as object, 'provider'), false);
  }
});

test('agent commands need the workspace that holds project config', () => {
  const none = planAgentWorkspace(['', undefined, null]);
  assert.equal(none.kind, 'none');
  assert.match(none.kind === 'none' ? none.summary : '', /\.git\/stud\.config/);

  assert.deepEqual(planAgentWorkspace([' /work/repo ', '/work/repo']), { kind: 'one', folder: '/work/repo' });
  const many = planAgentWorkspace(['/work/a', '/work/b']);
  assert.deepEqual(many.kind === 'many' ? many.folders : [], ['/work/a', '/work/b']);
});

test('agent results cover success, structured errors, and bad output', () => {
  const ok = interpretAgentRun({
    label: 'config:show',
    stdout: '{"success":true,"data":{"globalConfig":[]}}',
    stderr: '',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.level, 'info');
  assert.match(ok.summary, /config:show succeeded/);

  const failed = interpretAgentRun({
    label: 'items:show',
    stdout: '{"success":false,"error":"issue not found"}',
    stderr: '',
  });
  assert.equal(failed.ok, false);
  assert.match(failed.summary, /issue not found/);

  const emptyError = interpretAgentRun({
    label: 'items:show',
    stdout: '{"success":false,"error":"  "}',
    stderr: '',
  });
  assert.match(emptyError.summary, /failure/i);

  const malformed = interpretAgentRun({ label: 'config:show', stdout: 'not json', stderr: 'boom' });
  assert.match(malformed.summary, /did not return JSON/);
  assert.match(malformed.detail, /boom/);

  const unexpected = interpretAgentRun({ label: 'config:show', stdout: '{"success":true}', stderr: '' });
  assert.match(unexpected.summary, /unexpected/);

  const arrayData = interpretAgentRun({ label: 'config:show', stdout: '{"success":true,"data":[]}', stderr: '' });
  assert.match(arrayData.summary, /unexpected/);

  const silent = interpretAgentRun({ label: 'config:show', stdout: '', stderr: '' });
  assert.equal(silent.ok, false);
  assert.match(silent.summary, /did not return JSON/);

  const crashed = interpretAgentRun({
    label: 'config:validate',
    stdout: '',
    stderr: '',
    errorMessage: 'spawn ENOENT',
  });
  assert.match(crashed.summary, /failed/);
  assert.match(crashed.detail, /ENOENT/);
});

test('manifest exposes only the allowlisted agent commands', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: { commands: Array<{ command: string; category: string }> };
  };
  const commands = manifest.contributes.commands.map((command) => command.command);
  for (const commandId of [SHOW_CONFIG_COMMAND, VALIDATE_CONFIG_COMMAND, SHOW_WORK_ITEM_COMMAND, SHOW_PULL_REQUEST_COMMENTS_COMMAND]) {
    assert.ok(commands.includes(commandId));
    assert.ok(manifest.activationEvents.includes(`onCommand:${commandId}`));
  }
  assert.equal(commands.includes('stud.commit'), false);
  assert.equal(commands.includes('stud.push'), false);
  assert.ok(manifest.contributes.commands.every((command) => command.category === 'stud'));
});
