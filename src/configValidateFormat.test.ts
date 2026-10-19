import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatConfigValidateLines,
  formatConfigValidateRun,
  gitHostStatus,
  presentationStatus,
} from './configValidateFormat.js';

test('presentationStatus maps stud connectivity statuses', () => {
  assert.equal(presentationStatus('ok', null), 'OK');
  assert.equal(presentationStatus('skipped', null), 'None');
  assert.equal(presentationStatus('fail', 'Linear connection failed'), 'Connection failed');
  assert.equal(presentationStatus('fail', 'Git provider is not configured.'), 'None');
});

test('gitHostStatus attributes git checks to the active provider', () => {
  assert.equal(gitHostStatus('github', 'github', 'ok', null), 'OK');
  assert.equal(gitHostStatus('gitlab', 'github', 'ok', null), 'None');
  assert.equal(gitHostStatus('gitlab', 'gitlab', 'fail', 'bad token'), 'Connection failed');
  assert.equal(gitHostStatus('github', 'gitlab', 'skipped', null), 'None');
});

test('formatConfigValidateLines lists Jira, Linear, GitHub, and GitLab', () => {
  const lines = formatConfigValidateLines({
    jiraStatus: 'ok',
    linearStatus: 'fail',
    linearMessage: 'Linear connection failed',
    gitStatus: 'ok',
    gitProvider: 'github',
  });
  assert.deepEqual(lines, ['Jira: OK', 'Linear: Connection failed', 'GitHub: OK', 'GitLab: None']);
});

test('formatConfigValidateRun builds summary and detail from agent JSON', () => {
  const stdout = JSON.stringify({
    success: false,
    error: 'Validation failed',
    data: {
      jiraStatus: 'ok',
      gitStatus: 'ok',
      gitProvider: 'github',
      linearStatus: 'fail',
      linearMessage: 'Linear GraphQL request failed.',
    },
  });
  const result = formatConfigValidateRun({ stdout, stderr: '' });
  assert.notEqual(result, null);
  assert.equal(result?.ok, false);
  assert.match(result?.summary ?? '', /Linear/);
  assert.match(result?.detail ?? '', /Jira: OK/);
  assert.match(result?.detail ?? '', /Linear: Connection failed/);
  assert.match(result?.detail ?? '', /GitHub: OK/);
  assert.match(result?.detail ?? '', /GitLab: None/);
  assert.match(result?.detail ?? '', /Linear GraphQL request failed/);
});

test('formatConfigValidateRun returns null without validate data', () => {
  assert.equal(formatConfigValidateRun({ stdout: '{"success":false,"error":"nope"}', stderr: '' }), null);
});
