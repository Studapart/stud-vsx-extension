const HIDDEN = new Set(['compact', 'quiet', 'help']);

export type PromptChoice = { readonly value: string | null; readonly label: string };

export type PromptStep =
  | { readonly kind: 'bool'; readonly name: string; readonly default: boolean }
  | {
      readonly kind: 'choice';
      readonly name: string;
      readonly nullable: boolean;
      readonly choices: readonly PromptChoice[];
      readonly active: string | null;
    }
  | { readonly kind: 'text'; readonly name: string; readonly nullable: boolean; readonly value: string };

export type PromptPlan =
  | { readonly kind: 'prompt'; readonly steps: readonly PromptStep[] }
  | { readonly kind: 'stop'; readonly summary: string };

export type PromptAnswer = { readonly name: string; readonly value: boolean | string | null };

export type PromptPayload =
  | { readonly kind: 'stdin'; readonly stdin: string }
  | { readonly kind: 'stop'; readonly summary: string };

type PlannedProperty =
  | { readonly kind: 'step'; readonly step: PromptStep }
  | { readonly kind: 'stop'; readonly summary: string };

type Property = { readonly type?: unknown; readonly default?: unknown; readonly enum?: unknown };

export function planCommandPrompt(input: { readonly command: string; readonly stdout: string }): PromptPlan {
  const properties = readProperties(input.stdout);
  if (properties === undefined) {
    return { kind: 'stop', summary: `stud help --agent did not describe inputs for ${input.command}.` };
  }
  const steps: PromptStep[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (HIDDEN.has(name)) {
      continue;
    }
    const planned = planProperty(input.command, name, property);
    if (planned.kind === 'stop') {
      return planned;
    }
    steps.push(planned.step);
  }
  return { kind: 'prompt', steps };
}

export function promptStdin(input: {
  readonly command: string;
  readonly steps: readonly PromptStep[];
  readonly answers: readonly PromptAnswer[];
}): PromptPayload {
  if (input.answers.length !== input.steps.length) {
    return { kind: 'stop', summary: 'The stud prompt answers do not match the help inputs.' };
  }
  const payload: Record<string, boolean | string | null> = {};
  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    const answer = input.answers[index];
    if (step === undefined || answer === undefined) {
      return { kind: 'stop', summary: 'The stud prompt answers do not match the help inputs.' };
    }
    const value = encodeAnswer(step, answer);
    if (value === undefined) {
      return { kind: 'stop', summary: 'The stud prompt answers do not match the help inputs.' };
    }
    if (input.command === 'items:show' && step.name === 'key' && (value === null || value === '')) {
      return {
        kind: 'stop',
        summary: 'Enter a work item key. The extension does not choose an issue tracker.',
      };
    }
    payload[step.name] = value;
  }
  return { kind: 'stdin', stdin: JSON.stringify(payload) };
}

function planProperty(command: string, name: string, property: unknown): PlannedProperty {
  if (!isProperty(property) || !Object.hasOwn(property, 'default')) {
    return unsupported(command, name);
  }
  if (Array.isArray(property.enum)) {
    return planChoice(command, name, property);
  }
  if (property.enum !== undefined && property.enum !== null) {
    return unsupported(command, name);
  }
  if (property.type === 'bool') {
    return typeof property.default === 'boolean'
      ? { kind: 'step', step: { kind: 'bool', name, default: property.default } }
      : unsupported(command, name);
  }
  if (property.type === 'string' || property.type === 'string|null') {
    return planText(command, name, property);
  }
  return unsupported(command, name);
}

function planChoice(command: string, name: string, property: Property): PlannedProperty {
  const entries = property.enum;
  if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== 'string')) {
    return unsupported(command, name);
  }
  const typeNullable = typeof property.type === 'string' && property.type.split('|').some((segment) => segment.trim() === 'null');
  const emptyValue: string | null = typeNullable ? null : '';
  const choices: PromptChoice[] = entries.map((entry) => ({ value: entry, label: entry }));
  if (typeNullable || property.default === null) {
    choices.push({ value: emptyValue, label: '(none)' });
  }
  const active = property.default === null ? emptyValue : property.default;
  if (typeof active !== 'string' && active !== null) {
    return unsupported(command, name);
  }
  if (!choices.some((choice) => choice.value === active)) {
    return unsupported(command, name);
  }
  return { kind: 'step', step: { kind: 'choice', name, nullable: typeNullable, choices, active } };
}

function planText(command: string, name: string, property: Property): PlannedProperty {
  if (typeof property.default !== 'string' && property.default !== null) {
    return unsupported(command, name);
  }
  return {
    kind: 'step',
    step: {
      kind: 'text',
      name,
      nullable: property.type === 'string|null',
      value: typeof property.default === 'string' ? property.default : '',
    },
  };
}

function encodeAnswer(step: PromptStep, answer: PromptAnswer): boolean | string | null | undefined {
  if (answer.name !== step.name) {
    return undefined;
  }
  if (step.kind === 'bool') {
    return typeof answer.value === 'boolean' ? answer.value : undefined;
  }
  if (step.kind === 'choice') {
    return step.choices.some((choice) => choice.value === answer.value) ? answer.value : undefined;
  }
  if (typeof answer.value !== 'string') {
    return undefined;
  }
  const trimmed = answer.value.trim();
  if (trimmed === '') {
    return step.nullable ? null : '';
  }
  return trimmed;
}

function readProperties(stdout: string): Record<string, unknown> | undefined {
  const parsed = parseRecord(stdout.trim());
  if (parsed === undefined || parsed.success !== true) {
    return undefined;
  }
  const data = parseRecord(parsed.data);
  const input = data === undefined ? undefined : parseRecord(data.input);
  const properties = input === undefined ? undefined : input.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return undefined;
  }
  return properties as Record<string, unknown>;
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isProperty(value: unknown): value is Property {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(command: string, name: string): { readonly kind: 'stop'; readonly summary: string } {
  return { kind: 'stop', summary: `Cannot prompt for ${command} input "${name}".` };
}
