export const SHOW_CONFIG_COMMAND = 'stud.showConfig';
export const VALIDATE_CONFIG_COMMAND = 'stud.validateConfig';
export const SHOW_WORK_ITEM_COMMAND = 'stud.showWorkItem';
export const SHOW_PULL_REQUEST_COMMENTS_COMMAND = 'stud.showPullRequestComments';
export const SYNC_COMMAND = 'stud.sync';
export const COMMIT_COMMAND = 'stud.commit';
export const PUSH_COMMAND = 'stud.push';
export const SUBMIT_COMMAND = 'stud.submit';
export const AGENT_WORKSPACE_PICK_CANCELLED = 'No workspace folder was selected.';
export const AGENT_ALREADY_RUNNING = 'A stud command is already running.';

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

const WORKFLOWS: Readonly<Record<string, { readonly args: readonly string[]; readonly confirmation: string | null }>> = {
  [VALIDATE_CONFIG_COMMAND]: { args: ['config:validate', '--agent'], confirmation: null },
  [SYNC_COMMAND]: {
    args: ['sync', '--agent'],
    confirmation: 'Sync with stud? This fetches the base branch and rebases the current branch onto it.',
  },
  [COMMIT_COMMAND]: {
    args: ['commit', '--agent'],
    confirmation: 'Commit with stud? Stud decides what is staged and writes the commit message.',
  },
  [PUSH_COMMAND]: {
    args: ['push', '--agent'],
    confirmation: 'Push with stud? This can commit local changes, update the remote, and force-with-lease if that push is rejected.',
  },
  [SUBMIT_COMMAND]: {
    args: ['submit', '--agent'],
    confirmation: 'Submit with stud? This can push the branch and open a pull request.',
  },
};

export type WorkflowPlan =
  | {
      readonly kind: 'run';
      readonly label: string;
      readonly args: readonly string[];
      readonly stdin: string;
      readonly confirmation: string | null;
    }
  | { readonly kind: 'rejected'; readonly summary: string };

export function planWorkflow(commandId: string): WorkflowPlan {
  const workflow = WORKFLOWS[commandId];
  if (workflow === undefined) {
    return { kind: 'rejected', summary: 'That action is not a stud palette workflow.' };
  }
  return {
    kind: 'run',
    label: workflow.args[0] ?? commandId,
    args: workflow.args,
    stdin: AGENT_STDIN,
    confirmation: workflow.confirmation,
  };
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
    const warning = firstWarning(stdout);
    if (warning !== undefined) {
      return { ok: true, level: 'warning', summary: `${input.label} succeeded. ${warning}`, detail: stdout };
    }
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
  if (record.success === true && record.data === undefined) {
    return { kind: 'ok' };
  }
  if (record.success === true && typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)) {
    return { kind: 'ok' };
  }
  return { kind: 'unexpected' };
}

function firstWarning(stdout: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const diagnostics = (value as { diagnostics?: { warnings?: unknown } }).diagnostics;
  const warnings = diagnostics?.warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return undefined;
  }
  const first = warnings[0];
  if (typeof first === 'object' && first !== null && typeof (first as { message?: unknown }).message === 'string') {
    const message = (first as { message: string }).message.trim();
    if (message === '') {
      return `${warnings.length} warning(s) from stud. See the output channel.`;
    }
    return message.length > 160 ? `${message.slice(0, 157)}...` : message;
  }
  return `${warnings.length} warning(s) from stud. See the output channel.`;
}

function joinDetail(summary: string, stderr: string, stdout: string): string {
  return [summary, stderr, stdout].filter((part) => part !== '').join('\n');
}
