import type { AgentRunResult } from './agentRun.js';

export type ConfigValidateDisplay = 'OK' | 'Connection failed' | 'None';

export type ConfigValidateData = {
  readonly jiraStatus?: unknown;
  readonly jiraMessage?: unknown;
  readonly linearStatus?: unknown;
  readonly linearMessage?: unknown;
  readonly gitStatus?: unknown;
  readonly gitMessage?: unknown;
  readonly gitProvider?: unknown;
};

const NOT_CONFIGURED = /not configured/i;

export function presentationStatus(status: unknown, message: unknown): ConfigValidateDisplay {
  if (status === 'ok') {
    return 'OK';
  }
  if (status === 'skipped') {
    return 'None';
  }
  if (status === 'fail') {
    return isNotConfiguredMessage(message) ? 'None' : 'Connection failed';
  }
  return 'None';
}

export function gitHostStatus(
  host: 'github' | 'gitlab',
  gitProvider: unknown,
  gitStatus: unknown,
  gitMessage: unknown,
): ConfigValidateDisplay {
  if (gitStatus === 'skipped') {
    return 'None';
  }
  const active = normalizeGitProvider(gitProvider);
  if (active === null) {
    return host === 'github' ? presentationStatus(gitStatus, gitMessage) : 'None';
  }
  if (active !== host) {
    return 'None';
  }
  return presentationStatus(gitStatus, gitMessage);
}

export function formatConfigValidateLines(data: ConfigValidateData): readonly string[] {
  return [
    `Jira: ${presentationStatus(data.jiraStatus, data.jiraMessage)}`,
    `Linear: ${presentationStatus(data.linearStatus, data.linearMessage)}`,
    `GitHub: ${gitHostStatus('github', data.gitProvider, data.gitStatus, data.gitMessage)}`,
    `GitLab: ${gitHostStatus('gitlab', data.gitProvider, data.gitStatus, data.gitMessage)}`,
  ];
}

export function formatConfigValidateRun(input: {
  readonly stdout: string;
  readonly stderr: string;
}): AgentRunResult | null {
  const parsed = parseConfigValidateEnvelope(input.stdout);
  if (parsed === null) {
    return null;
  }

  const lines = formatConfigValidateLines(parsed.data);
  const detail = buildDetail(lines, parsed.data, input.stdout, input.stderr);
  const ok = parsed.success;
  const failed = lines.filter((line) => line.endsWith('Connection failed'));
  const summary = ok
    ? 'Config validation passed for all checked providers.'
    : failed.length === 0
      ? 'Config validation failed.'
      : `Config validation failed (${failed.map((line) => line.split(':')[0]?.trim() ?? 'provider').join(', ')}).`;

  return {
    ok,
    level: ok ? 'info' : 'error',
    summary,
    detail,
  };
}

function buildDetail(
  lines: readonly string[],
  data: ConfigValidateData,
  stdout: string,
  stderr: string,
): string {
  const parts = [...lines];
  appendMessage(parts, 'Jira', data.jiraStatus, data.jiraMessage);
  appendMessage(parts, 'Linear', data.linearStatus, data.linearMessage);
  appendGitMessage(parts, data);
  if (stderr.trim() !== '') {
    parts.push(stderr.trim());
  }
  if (parts.length === lines.length) {
    parts.push(stdout.trim());
  }
  return parts.filter((part) => part !== '').join('\n');
}

function appendGitMessage(parts: string[], data: ConfigValidateData): void {
  const provider = normalizeGitProvider(data.gitProvider);
  if (provider === 'github') {
    appendMessage(parts, 'GitHub', data.gitStatus, data.gitMessage);
    return;
  }
  if (provider === 'gitlab') {
    appendMessage(parts, 'GitLab', data.gitStatus, data.gitMessage);
    return;
  }
  appendMessage(parts, 'Git provider', data.gitStatus, data.gitMessage);
}

function appendMessage(parts: string[], label: string, status: unknown, message: unknown): void {
  if (status !== 'fail' || isNotConfiguredMessage(message)) {
    return;
  }
  const text = typeof message === 'string' ? message.trim() : '';
  if (text !== '') {
    parts.push(`  ${label}: ${text}`);
  }
}

function parseConfigValidateEnvelope(stdout: string): { readonly success: boolean; readonly data: ConfigValidateData } | null {
  const trimmed = stdout.trim();
  if (trimmed === '') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as { success?: unknown; data?: unknown };
  if (typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) {
    return null;
  }
  const data = record.data as ConfigValidateData;
  if (!('jiraStatus' in data) || !('gitStatus' in data) || !('linearStatus' in data)) {
    return null;
  }
  return { success: record.success === true, data };
}

function isNotConfiguredMessage(message: unknown): boolean {
  if (typeof message !== 'string') {
    return false;
  }
  return NOT_CONFIGURED.test(message);
}

function normalizeGitProvider(value: unknown): 'github' | 'gitlab' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'github') {
    return 'github';
  }
  if (normalized === 'gitlab') {
    return 'gitlab';
  }
  return null;
}
