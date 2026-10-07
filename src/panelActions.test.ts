import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { COMMIT_COMMAND, PUSH_COMMAND, SUBMIT_COMMAND, SYNC_COMMAND, planWorkflow } from './agentRun';
import { INSTALL_PORTABLE_COMMAND, UPDATE_PORTABLE_COMMAND } from './portableInstall';
import {
  CONFIG_VIEW,
  DOWNLOAD_COMMAND,
  FLATTEN_COMMAND,
  GIT_VIEW,
  PANEL_VIEW_CONTAINER,
  PROJECT_FIELD_COMMAND,
  REFRESH_WORK_ITEMS_COMMAND,
  START_COMMAND,
  WORK_ITEMS_VIEW,
  WORKFLOW_COMMAND,
  contributedPanelCommands,
  fillsWorkItemList,
  showsWorkItemRows,
  panelButtons,
  panelStdinMode,
  planPanelAction,
  planProjectFieldStdin,
  presetForStep,
  projectFieldChoices,
  projectFieldIsSecret,
  redactSecret,
  readPanelInvocation,
  refuseBlankWorkItemKey,
  rowCommands,
  switchMatchSummary,
  workItemRows,
} from './panelActions';

test('planPanelAction accepts panel controls and rejects everything else', () => {
  const flatten = planPanelAction(FLATTEN_COMMAND);
  assert.equal(flatten.kind, 'run');
  if (flatten.kind === 'run') {
    assert.deepEqual(flatten.args, ['flatten', '--agent']);
    assert.match(flatten.confirmation ?? '', /flatten/i);
  }

  for (const commandId of [SYNC_COMMAND, COMMIT_COMMAND, PUSH_COMMAND, SUBMIT_COMMAND]) {
    const panel = planPanelAction(commandId);
    const palette = planWorkflow(commandId);
    assert.equal(panel.kind, 'run');
    assert.equal(palette.kind, 'run');
    if (panel.kind === 'run' && palette.kind === 'run') {
      assert.equal(panel.confirmation, palette.confirmation);
      assert.deepEqual(panel.args, palette.args);
    }
  }

  const version = planPanelAction('stud.checkVersion');
  assert.equal(version.kind, 'run');
  if (version.kind === 'run') {
    assert.deepEqual(version.args, []);
    assert.equal(version.confirmation, null);
  }

  for (const commandId of ['', '   ', INSTALL_PORTABLE_COMMAND, UPDATE_PORTABLE_COMMAND, 'config:init', 'items:transition', 'items:upload', 'confluence:push', 'update', 'deploy', 'release', 'docs:check', 'docs:generate', 'cache:clear']) {
    const rejected = planPanelAction(commandId);
    assert.equal(rejected.kind, 'rejected');
    assert.match(rejected.kind === 'rejected' ? rejected.summary : '', /not a stud panel action/i);
  }
});

test('panel buttons and contributed commands stay on the allowlist', () => {
  assert.ok(panelButtons('git').some((button) => button.command === FLATTEN_COMMAND));
  assert.ok(panelButtons('config').some((button) => button.command === WORKFLOW_COMMAND));
  assert.equal(panelButtons('').length, 0);
  for (const button of [...panelButtons('work-items'), ...panelButtons('git'), ...panelButtons('config')]) {
    assert.equal(planPanelAction(button.command).kind, 'run');
    assert.notEqual(button.command, INSTALL_PORTABLE_COMMAND);
  }
  assert.ok(rowCommands().includes(START_COMMAND));
  assert.ok(rowCommands().includes(DOWNLOAD_COMMAND));
  assert.equal(rowCommands().includes(''), false);
  assert.equal(rowCommands().includes(INSTALL_PORTABLE_COMMAND), false);
  assert.ok(contributedPanelCommands().length > 0);
  assert.equal(contributedPanelCommands().some((button) => button.command === INSTALL_PORTABLE_COMMAND), false);
});

test('stdin mode, list fill, secrets, and invocation stay narrow', () => {
  assert.equal(panelStdinMode(REFRESH_WORK_ITEMS_COMMAND), 'empty');
  assert.equal(panelStdinMode(PROJECT_FIELD_COMMAND), 'project-field');
  assert.equal(panelStdinMode(''), 'help');
  assert.equal(panelStdinMode(FLATTEN_COMMAND), 'help');

  assert.equal(fillsWorkItemList('items:list'), true);
  assert.equal(fillsWorkItemList('items:search'), true);
  assert.equal(fillsWorkItemList('filters:show'), true);
  assert.equal(fillsWorkItemList(''), false);
  assert.equal(fillsWorkItemList('commit'), false);
  const listed = JSON.stringify({ success: true, data: { issues: [] } });
  assert.equal(showsWorkItemRows(listed), true);
  assert.equal(showsWorkItemRows(''), false);
  assert.equal(showsWorkItemRows(JSON.stringify({ success: false, error: 'nope' })), false);

  assert.equal(projectFieldIsSecret('githubToken'), true);
  assert.equal(projectFieldIsSecret(' gitlabToken '), true);
  assert.equal(projectFieldIsSecret(''), false);
  assert.equal(projectFieldIsSecret('projectKey'), false);
  assert.equal(redactSecret('token=abc123 value', 'abc123'), 'token=[redacted] value');
  assert.equal(redactSecret('unchanged', ''), 'unchanged');
  assert.equal(redactSecret('unchanged', 'missing'), 'unchanged');

  assert.deepEqual(readPanelInvocation({ panel: true, key: ' SCI-1 ' }), { fromPanel: true, key: 'SCI-1' });
  assert.deepEqual(readPanelInvocation(undefined), { fromPanel: false, key: undefined });
  assert.deepEqual(readPanelInvocation({ panel: false }), { fromPanel: false, key: undefined });
  assert.equal(presetForStep('issueKey', { key: ' SCI-9 ' }), 'SCI-9');
  assert.equal(presetForStep('path', { key: 'SCI-9' }), undefined);
  assert.equal(presetForStep('key', { key: '   ' }), undefined);
});

test('project field stdin is one string field', () => {
  const saved = planProjectFieldStdin({ field: ' projectKey ', value: ' SCI ' });
  assert.equal(saved.kind, 'stdin');
  if (saved.kind === 'stdin') {
    assert.deepEqual(JSON.parse(saved.stdin), { projectKey: 'SCI' });
  }
  const secret = planProjectFieldStdin({ field: 'githubToken', value: 'token-value' });
  assert.equal(secret.kind, 'stdin');
  if (secret.kind === 'stdin') {
    const parsed = JSON.parse(secret.stdin) as Record<string, string>;
    assert.deepEqual(Object.keys(parsed), ['githubToken']);
  }

  for (const input of [
    { field: '', value: '' },
    { field: 'projectKey', value: '   ' },
    { field: 'transitionId', value: '1' },
    { field: 'jiraApiToken', value: 'secret' },
    { field: 'linearApiKey', value: 'secret' },
    { field: 'linearTypeBranchPrefixes', value: '{}' },
  ]) {
    const stopped = planProjectFieldStdin(input);
    assert.equal(stopped.kind, 'stop');
  }

  const choices = projectFieldChoices();
  assert.equal(choices.find((choice) => choice.field === 'githubToken')?.kind, 'project');
  assert.equal(choices.find((choice) => choice.field === 'jiraApiToken')?.kind, 'global');
  assert.equal(choices.some((choice) => choice.field === ''), false);
  assert.equal(choices.some((choice) => choice.field === 'transitionId'), false);
});

test('blank work item keys stop before stud', () => {
  const stopped = refuseBlankWorkItemKey({ command: 'items:start', fields: { key: '  ' } });
  assert.equal(stopped.kind, 'stop');
  assert.match(stopped.kind === 'stop' ? stopped.summary : '', /work item key/i);

  assert.equal(refuseBlankWorkItemKey({ command: 'items:download', fields: { issueKey: 'SCI-2' } }).kind, 'ok');
  assert.equal(refuseBlankWorkItemKey({ command: 'items:show', fields: { key: null } }).kind, 'stop');
  assert.equal(refuseBlankWorkItemKey({ command: '', fields: {} }).kind, 'ok');
  assert.equal(refuseBlankWorkItemKey({ command: 'status', fields: { key: '' } }).kind, 'ok');

  const rename = refuseBlankWorkItemKey({ command: 'branch:rename', fields: { branch: '', key: null, explicitName: '  ' } });
  assert.equal(rename.kind, 'stop');
  assert.match(rename.kind === 'stop' ? rename.summary : '', /work item key/i);
  assert.equal(refuseBlankWorkItemKey({ command: 'branch:rename', fields: { explicitName: 'feature' } }).kind, 'ok');
});

test('work item rows and switch matches parse stud envelopes', () => {
  const listed = workItemRows(JSON.stringify({
    success: true,
    data: { issues: [{ key: ' SCI-1 ', title: 'Panel', status: 'Open' }, { key: 1 }, { title: 'Missing' }] },
  }));
  assert.equal(listed.kind, 'rows');
  if (listed.kind === 'rows') {
    assert.deepEqual(listed.rows, [{ key: 'SCI-1', title: 'Panel', status: 'Open' }]);
  }
  assert.equal(workItemRows('').kind, 'empty');
  assert.equal(workItemRows(JSON.stringify({ success: true, data: {} })).kind, 'empty');
  assert.equal(workItemRows(JSON.stringify({ success: true, data: { issues: [] } })).kind, 'empty');
  assert.equal(workItemRows('{').kind, 'empty');

  const choose = switchMatchSummary(JSON.stringify({
    success: false,
    data: { needsSelection: true, matches: ['feature/SCI-1-a', 'feature/SCI-1-b'] },
  }));
  assert.equal(choose.kind, 'choose');
  if (choose.kind === 'choose') {
    assert.match(choose.summary, /feature\/SCI-1-a/);
    assert.match(choose.summary, /work item key/i);
  }
  assert.equal(switchMatchSummary('').kind, 'done');
  assert.equal(switchMatchSummary(JSON.stringify({ success: true, data: { needsSelection: false, matches: [] } })).kind, 'done');
  assert.equal(switchMatchSummary('{').kind, 'done');
});

test('manifest contributes the stud side panel', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string; title: string; category: string }>;
      viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
      views?: Record<string, Array<{ id: string; name: string }>>;
      menus?: Record<string, Array<{ command: string; when?: string }>>;
    };
  };
  const commands = manifest.contributes.commands;
  const byId = new Map(commands.map((command) => [command.command, command]));

  for (const button of contributedPanelCommands()) {
    const command = byId.get(button.command);
    assert.ok(command, button.command);
    assert.equal(command?.title, button.title);
    assert.equal(command?.category, 'stud');
    assert.ok(manifest.activationEvents.includes(`onCommand:${button.command}`));
  }

  for (const command of commands) {
    const plan = planPanelAction(command.command);
    if (command.command === INSTALL_PORTABLE_COMMAND || command.command === UPDATE_PORTABLE_COMMAND) {
      assert.equal(plan.kind, 'rejected');
      continue;
    }
    assert.equal(plan.kind, 'run');
  }

  const container = manifest.contributes.viewsContainers?.activitybar?.find((entry) => entry.id === PANEL_VIEW_CONTAINER);
  assert.equal(container?.title, 'stud');
  assert.equal(container?.icon, 'resources/icon.png');
  const views = manifest.contributes.views?.[PANEL_VIEW_CONTAINER] ?? [];
  assert.deepEqual(views.map((view) => view.id), [WORK_ITEMS_VIEW, GIT_VIEW, CONFIG_VIEW]);
  for (const view of [WORK_ITEMS_VIEW, GIT_VIEW, CONFIG_VIEW]) {
    assert.ok(manifest.activationEvents.includes(`onView:${view}`));
  }

  const menuCommands = Object.values(manifest.contributes.menus ?? {}).flat().map((item) => item.command);
  assert.equal(menuCommands.includes(INSTALL_PORTABLE_COMMAND), false);
  assert.equal(menuCommands.includes(UPDATE_PORTABLE_COMMAND), false);
  assert.ok(menuCommands.includes(REFRESH_WORK_ITEMS_COMMAND));
  assert.ok(menuCommands.includes(START_COMMAND));
  assert.equal(commands.every((command) => command.category === 'stud'), true);
});
