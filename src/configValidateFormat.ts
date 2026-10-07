import type { AgentRunResult } from './agentRun.js';

export type ConfigValidateDisplay = 'OK' | 'Connection failed' | 'None';

type IntegrationPing = { readonly status: unknown; readonly message: unknown };

type ProviderKey = 'jira' | 'linear' | 'github' | 'gitlab';

export type Integrations = Readonly<Partial<Record<ProviderKey, IntegrationPing>>>;

const PROVIDERS: readonly { readonly key: ProviderKey; readonly label: string }[] = [
  { key: 'jira', label: 'Jira' },
  { key: 'linear', label: 'Linear' },
  { key: 'github', label: 'GitHub' },
  { key: 'gitlab', label: 'GitLab' },
];

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

export function formatConfigValidateLines(integrations: Integrations): readonly string[] {
  return PROVIDERS.map(({ key, label }) => {
    const ping = integrations[key];
    return `${label}: ${presentationStatus(ping?.status, ping?.message)}`;
  });
}

export function formatConfigValidateRun(input: {
  readonly stdout: string;
  readonly stderr: string;
}): AgentRunResult | null {
  const parsed = parseConfigValidateEnvelope(input.stdout);
  if (parsed === null) {
    return null;
  }

  const lines = formatConfigValidateLines(parsed.integrations);
  const detail = buildDetail(lines, parsed.integrations, input.stdout, input.stderr);
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
  integrations: Integrations,
  stdout: string,
  stderr: string,
): string {
  const parts = [...lines];
  for (const { key, label } of PROVIDERS) {
    appendMessage(parts, label, integrations[key]);
  }
  if (stderr.trim() !== '') {
    parts.push(stderr.trim());
  }
  if (parts.length === lines.length) {
    parts.push(stdout.trim());
  }
  return parts.filter((part) => part !== '').join('\n');
}

function appendMessage(parts: string[], label: string, ping: IntegrationPing | undefined): void {
  if (ping?.status !== 'fail' || isNotConfiguredMessage(ping.message)) {
    return;
  }
  const text = typeof ping.message === 'string' ? ping.message.trim() : '';
  if (text !== '') {
    parts.push(`  ${label}: ${text}`);
  }
}

function parseConfigValidateEnvelope(stdout: string): { readonly success: boolean; readonly integrations: Integrations } | null {
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
  const integrations = (record.data as { integrations?: unknown }).integrations;
  if (typeof integrations !== 'object' || integrations === null || Array.isArray(integrations)) {
    return null;
  }
  return { success: record.success === true, integrations: integrations as Integrations };
}

function isNotConfiguredMessage(message: unknown): boolean {
  if (typeof message !== 'string') {
    return false;
  }
  return NOT_CONFIGURED.test(message);
}
