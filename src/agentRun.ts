export const SHOW_CONFIG_COMMAND = 'stud.showConfig';
export const VALIDATE_CONFIG_COMMAND = 'stud.validateConfig';
export const SHOW_WORK_ITEM_COMMAND = 'stud.showWorkItem';
export const SHOW_PULL_REQUEST_COMMENTS_COMMAND = 'stud.showPullRequestComments';

const AGENT_STDIN = '{}';

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  [SHOW_CONFIG_COMMAND]: ['config:show', '--agent'],
  [VALIDATE_CONFIG_COMMAND]: ['config:validate', '--agent'],
  [SHOW_PULL_REQUEST_COMMENTS_COMMAND]: ['pr:comments', '--agent'],
  [SHOW_WORK_ITEM_COMMAND]: ['items:show', '--agent'],
};

export type AgentWorkspacePlan =
  | { readonly kind: 'none'; readonly summary: string }
  | { readonly kind: 'one'; readonly folder: string }
  | { readonly kind: 'many'; readonly folders: readonly string[] };

export function planAgentWorkspace(folders: readonly (string | undefined | null)[]): AgentWorkspacePlan {
  const usable = [...new Set(folders.map((folder) => folder?.trim() ?? '').filter((folder) => folder !== ''))];
  if (usable.length === 0) {
    return {
      kind: 'none',
      summary: 'Open a workspace folder so stud can read .git/stud.config. This extension does not choose an issue tracker.',
    };
  }
  if (usable.length === 1) {
    return { kind: 'one', folder: usable[0] ?? '' };
  }
  return { kind: 'many', folders: usable };
}

export type AgentRunPlan =
  | { readonly kind: 'run'; readonly label: string; readonly args: readonly string[]; readonly stdin: string }
  | { readonly kind: 'rejected'; readonly summary: string };

export function planAllowlistedRun(commandId: string, key?: string | null): AgentRunPlan {
  const args = ALLOWED[commandId];
  if (args === undefined) {
    return { kind: 'rejected', summary: 'That action is not an allowlisted read-only stud command.' };
  }
  if (commandId !== SHOW_WORK_ITEM_COMMAND) {
    return { kind: 'run', label: args[0] ?? commandId, args, stdin: AGENT_STDIN };
  }
  const trimmed = key?.trim() ?? '';
  if (trimmed === '') {
    return { kind: 'rejected', summary: 'Enter a work item key. The extension does not choose an issue tracker.' };
  }
  return {
    kind: 'run',
    label: args[0] ?? commandId,
    args,
    stdin: JSON.stringify({ key: trimmed }),
  };
}

export type AgentRunResult = {
  readonly ok: boolean;
  readonly level: 'info' | 'warning' | 'error';
  readonly summary: string;
  readonly detail: string;
};

export function interpretAgentRun(input: {
  readonly label: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorMessage?: string;
}): AgentRunResult {
  const stdout = input.stdout.trim();
  const stderr = input.stderr.trim();
  const parsed = parseEnvelope(stdout);
  if (parsed.kind === 'ok') {
    return { ok: true, level: 'info', summary: `${input.label} succeeded.`, detail: stdout };
  }
  if (parsed.kind === 'failed') {
    return { ok: false, level: 'error', summary: parsed.summary, detail: joinDetail(parsed.summary, stderr, stdout) };
  }
  if (parsed.kind === 'unexpected') {
    const summary = `${input.label} returned an unexpected result.`;
    return { ok: false, level: 'error', summary, detail: joinDetail(summary, stderr, stdout) };
  }
  if (input.errorMessage !== undefined) {
    const summary = `${input.label} failed.`;
    return { ok: false, level: 'error', summary, detail: joinDetail(input.errorMessage, stderr, stdout) };
  }
  const summary = `${input.label} did not return JSON.`;
  return { ok: false, level: 'error', summary, detail: joinDetail(summary, stderr, stdout) };
}

type Envelope =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly summary: string }
  | { readonly kind: 'unexpected' }
  | { readonly kind: 'not-json' };

function parseEnvelope(stdout: string): Envelope {
  if (stdout === '') {
    return { kind: 'not-json' };
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { kind: 'not-json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'unexpected' };
  }
  const record = value as { success?: unknown; error?: unknown; data?: unknown };
  if (record.success === false) {
    const error = typeof record.error === 'string' && record.error.trim() !== '' ? record.error : 'stud reported a failure.';
    return { kind: 'failed', summary: error };
  }
  if (record.success === true && typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)) {
    return { kind: 'ok' };
  }
  return { kind: 'unexpected' };
}

function joinDetail(summary: string, stderr: string, stdout: string): string {
  return [summary, stderr, stdout].filter((part) => part !== '').join('\n');
}
