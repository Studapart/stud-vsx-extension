import assert from 'node:assert/strict';
import test from 'node:test';
import { formatConfigValidateLines, formatConfigValidateRun, presentationStatus } from './configValidateFormat.js';

test('presentationStatus maps stud connectivity statuses', () => {
  assert.equal(presentationStatus('ok', null), 'OK');
  assert.equal(presentationStatus('skipped', null), 'None');
  assert.equal(presentationStatus('fail', 'Linear connection failed'), 'Connection failed');
  assert.equal(presentationStatus('fail', 'Git provider is not configured.'), 'None');
});

test('formatConfigValidateLines reads every provider from integrations', () => {
  const lines = formatConfigValidateLines({
    jira: { status: 'ok', message: null },
    linear: { status: 'fail', message: 'Linear connection failed' },
    github: { status: 'ok', message: null },
  });
  assert.deepEqual(lines, ['Jira: OK', 'Linear: Connection failed', 'GitHub: OK', 'GitLab: None']);
});

test('formatConfigValidateRun builds summary and detail from agent JSON', () => {
  const stdout = JSON.stringify({
    success: false,
    error: 'Validation failed',
    data: {
      integrations: {
        jira: { status: 'ok', message: null },
        linear: { status: 'fail', message: 'Linear GraphQL request failed.' },
        github: { status: 'ok', message: null },
      },
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
