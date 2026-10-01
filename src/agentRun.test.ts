import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  SHOW_CONFIG_COMMAND,
  SHOW_PULL_REQUEST_COMMENTS_COMMAND,
  SHOW_WORK_ITEM_COMMAND,
  VALIDATE_CONFIG_COMMAND,
  COMMIT_COMMAND,
  PUSH_COMMAND,
  SUBMIT_COMMAND,
  SYNC_COMMAND,
  interpretAgentRun,
  planAgentWorkspace,
  planAllowlistedRun,
  planWorkflow,
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

test('palette workflows confirm mutations and leave staging to stud', () => {
  const validate = planWorkflow(VALIDATE_CONFIG_COMMAND);
  const sync = planWorkflow(SYNC_COMMAND);
  assert.equal(validate.kind, 'run');
  assert.equal(sync.kind, 'run');
  if (validate.kind === 'run' && sync.kind === 'run') {
    assert.deepEqual(validate.args, ['config:validate', '--agent']);
    assert.equal(validate.confirmation, null);
    assert.deepEqual(sync.args, ['sync', '--agent']);
    assert.match(sync.confirmation ?? '', /rebase/i);
    assert.equal(sync.stdin, '{}');
  }

  for (const [commandId, studCommand, name] of [
    [COMMIT_COMMAND, 'commit', /Commit with stud/],
    [PUSH_COMMAND, 'push', /Push with stud/],
    [SUBMIT_COMMAND, 'submit', /Submit with stud/],
  ] as const) {
    const plan = planWorkflow(commandId);
    assert.equal(plan.kind, 'run');
    if (plan.kind === 'run') {
      assert.deepEqual(plan.args, [studCommand, '--agent']);
      assert.equal(plan.stdin, '{}');
      assert.match(plan.confirmation ?? '', name);
    if (commandId === PUSH_COMMAND) {
      assert.match(plan.confirmation ?? '', /force-with-lease/);
    }
      assert.equal(Object.hasOwn(JSON.parse(plan.stdin) as object, 'provider'), false);
      assert.equal(Object.hasOwn(JSON.parse(plan.stdin) as object, 'message'), false);
      assert.equal(Object.hasOwn(JSON.parse(plan.stdin) as object, 'stageAll'), false);
    }
    assert.equal(planAllowlistedRun(commandId).kind, 'rejected');
  }

  const unknown = planWorkflow('stud.flatten');
  assert.equal(unknown.kind, 'rejected');
  assert.equal(planWorkflow('').kind, 'rejected');
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
  const warned = interpretAgentRun({
    label: 'commit',
    stdout: '{"success":true,"data":{},"diagnostics":{"warnings":[{"message":"nothing to commit"}]}}',
    stderr: '',
  });
  assert.equal(warned.ok, true);
  assert.equal(warned.level, 'warning');
  assert.match(warned.summary, /nothing to commit/);

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

  const compact = interpretAgentRun({ label: 'sync', stdout: '{"success":true}', stderr: '' });
  assert.equal(compact.ok, true);
  assert.equal(compact.level, 'info');

  const compactWarning = interpretAgentRun({
    label: 'commit',
    stdout: '{"success":true,"diagnostics":{"warnings":[{"message":"nothing to commit"}]}}',
    stderr: '',
  });
  assert.equal(compactWarning.level, 'warning');
  assert.match(compactWarning.summary, /nothing to commit/);

  const emptyWarnings = interpretAgentRun({
    label: 'sync',
    stdout: '{"success":true,"diagnostics":{"warnings":[]}}',
    stderr: '',
  });
  assert.equal(emptyWarnings.level, 'info');

  const unnamedWarning = interpretAgentRun({
    label: 'sync',
    stdout: '{"success":true,"diagnostics":{"warnings":[{"message":""}]}}',
    stderr: '',
  });
  assert.match(unnamedWarning.summary, /warning/);

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

test('manifest exposes the allowlisted reads and the palette workflows', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: { commands: Array<{ command: string; category: string }> };
  };
  const commands = manifest.contributes.commands.map((command) => command.command);
  for (const commandId of [
    SHOW_CONFIG_COMMAND,
    VALIDATE_CONFIG_COMMAND,
    SHOW_WORK_ITEM_COMMAND,
    SHOW_PULL_REQUEST_COMMENTS_COMMAND,
    SYNC_COMMAND,
    COMMIT_COMMAND,
    PUSH_COMMAND,
    SUBMIT_COMMAND,
  ]) {
    assert.ok(commands.includes(commandId));
    assert.ok(manifest.activationEvents.includes(`onCommand:${commandId}`));
  }
  assert.equal(commands.includes('stud.flatten'), false);
  assert.ok(manifest.contributes.commands.every((command) => command.category === 'stud'));
});
