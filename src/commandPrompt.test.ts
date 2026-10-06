import assert from 'node:assert/strict';
import test from 'node:test';
import { planCommandPrompt, promptStdin, type PromptAnswer, type PromptStep } from './commandPrompt';

function help(properties: Record<string, unknown>): string {
  return JSON.stringify({ success: true, data: { input: { properties } } });
}

const commitHelp = help({
  compact: { type: 'bool', default: true },
  stageAll: { type: 'bool', default: false },
  message: { type: 'string|null', default: null },
  provider: { type: 'string|null', default: null, enum: ['jira', 'linear'] },
  quiet: { type: 'bool', default: false },
  help: { type: 'bool', default: false },
});

test('help inputs become steps with reported defaults and hidden names omitted', () => {
  const plan = planCommandPrompt({ command: 'commit', stdout: commitHelp });
  assert.equal(plan.kind, 'prompt');
  if (plan.kind !== 'prompt') {
    return;
  }
  assert.deepEqual(
    plan.steps.map((step) => step.name),
    ['stageAll', 'message', 'provider'],
  );
  const stageAll = plan.steps[0];
  const message = plan.steps[1];
  const provider = plan.steps[2];
  assert.equal(stageAll?.kind, 'bool');
  assert.equal(stageAll?.kind === 'bool' ? stageAll.default : undefined, false);
  assert.equal(message?.kind, 'text');
  assert.equal(message?.kind === 'text' ? message.value : undefined, '');
  assert.equal(message?.kind === 'text' ? message.nullable : undefined, true);
  assert.equal(provider?.kind, 'choice');
  if (provider?.kind === 'choice') {
    assert.equal(provider.active, null);
    assert.ok(provider.choices.some((choice) => choice.value === null && /none/i.test(choice.label)));
    assert.ok(provider.choices.some((choice) => choice.value === 'jira'));
  }
});

test('blank, failed, and schema-less help stops before a prompt', () => {
  for (const stdout of ['', '   ', 'not-json', '{"success":false,"error":"nope"}', '{"success":true,"data":{}}']) {
    const plan = planCommandPrompt({ command: 'sync', stdout });
    assert.equal(plan.kind, 'stop');
    assert.match(plan.kind === 'stop' ? plan.summary : '', /did not describe inputs/i);
    assert.match(plan.kind === 'stop' ? plan.summary : '', /sync/);
  }
});

test('sync skips the prompt when only hidden inputs remain', () => {
  const plan = planCommandPrompt({
    command: 'sync',
    stdout: help({ compact: { type: 'array', default: [] }, quiet: { type: 'int', default: 1 } }),
  });
  assert.equal(plan.kind, 'prompt');
  assert.deepEqual(plan.kind === 'prompt' ? plan.steps : undefined, []);
});

test('an unsupported input stops and does not plan later fields', () => {
  const plan = planCommandPrompt({
    command: 'commit',
    stdout: help({
      count: { type: 'int|null', default: null },
      stageAll: { type: 'bool', default: true },
    }),
  });
  assert.equal(plan.kind, 'stop');
  assert.match(plan.kind === 'stop' ? plan.summary : '', /cannot prompt/i);
  assert.match(plan.kind === 'stop' ? plan.summary : '', /commit/);
  assert.match(plan.kind === 'stop' ? plan.summary : '', /count/);

  const kept = planCommandPrompt({
    command: 'commit',
    stdout: help({ message: { type: 'string', default: 'keep' }, stageAll: { type: 'bool', default: true } }),
  });
  assert.equal(kept.kind, 'prompt');
  const message = kept.kind === 'prompt' ? kept.steps[0] : undefined;
  const stageAll = kept.kind === 'prompt' ? kept.steps[1] : undefined;
  assert.equal(message?.kind === 'text' ? message.value : '', 'keep');
  assert.equal(message?.kind === 'text' ? message.nullable : true, false);
  assert.equal(stageAll?.kind === 'bool' ? stageAll.default : false, true);
});

test('a bool or enum whose default does not fit the control stops', () => {
  for (const properties of [
    { stageAll: { type: 'bool', default: null } },
    { provider: { type: 'string|null', default: 'github', enum: ['jira', 'linear'] } },
    { provider: { type: 'string', default: 'jira', enum: [] } },
  ]) {
    const plan = planCommandPrompt({ command: 'commit', stdout: help(properties) });
    assert.equal(plan.kind, 'stop');
    assert.match(plan.kind === 'stop' ? plan.summary : '', /cannot prompt/i);
  }
});

test('confirmed answers become stdin and empty nullable text is null', () => {
  const steps: readonly PromptStep[] = [
    { kind: 'bool', name: 'stageAll', default: false },
    { kind: 'text', name: 'message', nullable: true, value: '' },
    { kind: 'text', name: 'label', nullable: false, value: '' },
  ];
  const answers: readonly PromptAnswer[] = [
    { name: 'stageAll', value: true },
    { name: 'message', value: '   ' },
    { name: 'label', value: '' },
  ];
  const payload = promptStdin({ command: 'commit', steps, answers });
  assert.equal(payload.kind, 'stdin');
  if (payload.kind === 'stdin') {
    assert.deepEqual(JSON.parse(payload.stdin), { stageAll: true, message: null, label: '' });
  }

  const trimmed = promptStdin({
    command: 'commit',
    steps: [{ kind: 'text', name: 'message', nullable: true, value: '' }],
    answers: [{ name: 'message', value: '  hello  ' }],
  });
  assert.deepEqual(trimmed.kind === 'stdin' ? JSON.parse(trimmed.stdin) : {}, { message: 'hello' });
});

test('a skipped prompt sends an empty object and mismatched answers stop', () => {
  const empty = promptStdin({ command: 'sync', steps: [], answers: [] });
  assert.equal(empty.kind, 'stdin');
  assert.equal(empty.kind === 'stdin' ? empty.stdin : '', '{}');

  for (const answers of [[], [{ name: 'other', value: false }]] as const) {
    const payload = promptStdin({
      command: 'commit',
      steps: [{ kind: 'bool', name: 'stageAll', default: false }],
      answers,
    });
    assert.equal(payload.kind, 'stop');
    assert.match(payload.kind === 'stop' ? payload.summary : '', /do not match/i);
  }
});

test('an empty show work item key stops and a padded key is trimmed', () => {
  const steps: readonly PromptStep[] = [
    { kind: 'text', name: 'key', nullable: true, value: '' },
    {
      kind: 'choice',
      name: 'provider',
      nullable: true,
      active: null,
      choices: [
        { value: 'jira', label: 'jira' },
        { value: null, label: '(none)' },
      ],
    },
  ];
  for (const key of ['', '   ']) {
    const payload = promptStdin({
      command: 'items:show',
      steps,
      answers: [
        { name: 'key', value: key },
        { name: 'provider', value: null },
      ],
    });
    assert.equal(payload.kind, 'stop');
    assert.match(payload.kind === 'stop' ? payload.summary : '', /work item key/i);
    assert.match(payload.kind === 'stop' ? payload.summary : '', /issue tracker/i);
  }

  const payload = promptStdin({
    command: 'items:show',
    steps,
    answers: [
      { name: 'key', value: '  SCI-111  ' },
      { name: 'provider', value: 'jira' },
    ],
  });
  assert.equal(payload.kind, 'stdin');
  assert.deepEqual(payload.kind === 'stdin' ? JSON.parse(payload.stdin) : {}, {
    key: 'SCI-111',
    provider: 'jira',
  });

  const emptyProvider = promptStdin({
    command: 'items:show',
    steps,
    answers: [
      { name: 'key', value: 'SCI-111' },
      { name: 'provider', value: null },
    ],
  });
  assert.deepEqual(emptyProvider.kind === 'stdin' ? JSON.parse(emptyProvider.stdin) : {}, {
    key: 'SCI-111',
    provider: null,
  });

  const emptyLabel = promptStdin({
    command: 'commit',
    steps: [
      {
        kind: 'choice',
        name: 'label',
        nullable: false,
        active: '',
        choices: [
          { value: 'keep', label: 'keep' },
          { value: '', label: '(none)' },
        ],
      },
    ],
    answers: [{ name: 'label', value: '' }],
  });
  assert.deepEqual(emptyLabel.kind === 'stdin' ? JSON.parse(emptyLabel.stdin) : {}, { label: '' });
});
