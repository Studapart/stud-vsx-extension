export const SEARCH_PATH_SETTING = 'stud.searchPath';
export const VALIDATE_COMMAND = 'stud.validate';
export const AGENT_HELP_ARGS = ['help', '--agent'] as const;
export const AGENT_HELP_STDIN = '{}';

const SEARCH_DISABLED_MESSAGE =
  'stud.executablePath is not set, and PATH search is disabled. Set the path to the user-installed stud executable.';

const NOT_FOUND_MESSAGE =
  'stud was not found on PATH or at ~/.local/bin/stud. Set stud.executablePath, or run stud: Install Portable stud on Linux x64 or macOS Apple Silicon.';

export type DiscoveryRequest = {
  readonly configuredPath: string | undefined | null;
  readonly searchEnabled: boolean;
  readonly pathEnv: string | undefined;
  readonly homeDir: string | undefined;
  readonly pathDelimiter: string;
  readonly executableNames: readonly string[];
};

export type DiscoveryPlan =
  | { readonly kind: 'explicit'; readonly executable: string }
  | { readonly kind: 'search'; readonly candidates: readonly string[] }
  | { readonly kind: 'missing'; readonly message: string };

export function planDiscovery(request: DiscoveryRequest): DiscoveryPlan {
  const configured = request.configuredPath?.trim() ?? '';
  if (configured !== '') {
    return { kind: 'explicit', executable: configured };
  }
  if (!request.searchEnabled) {
    return { kind: 'missing', message: SEARCH_DISABLED_MESSAGE };
  }

  const candidates = unique([
    ...directoriesToExecutables(pathDirectories(request.pathEnv, request.pathDelimiter), request),
    ...directoriesToExecutables(homeBinDirectories(request.homeDir, request.pathDelimiter), request),
  ]);
  if (candidates.length === 0) {
    return { kind: 'missing', message: NOT_FOUND_MESSAGE };
  }
  return { kind: 'search', candidates };
}

export type CandidateState = 'missing' | 'not-executable' | 'executable';

export function chooseCandidate(
  states: readonly { readonly path: string; readonly state: CandidateState }[],
): { readonly path: string; readonly state: CandidateState } {
  const executable = states.find((candidate) => candidate.state === 'executable');
  if (executable !== undefined) {
    return executable;
  }
  const blocked = states.find((candidate) => candidate.state === 'not-executable');
  if (blocked !== undefined) {
    return blocked;
  }
  return { path: '', state: 'missing' };
}

export function describeUnresolved(input: {
  readonly source: 'explicit' | 'search';
  readonly state: Exclude<CandidateState, 'executable'>;
  readonly path: string;
}): { readonly summary: string; readonly detail: string } {
  if (input.state === 'not-executable') {
    const summary = `${input.path} exists but is not executable.`;
    return { summary, detail: summary };
  }
  if (input.source === 'explicit') {
    const summary = `No stud executable at ${input.path}. stud.executablePath is left unchanged. Portable install runs only when that setting is empty.`;
    return { summary, detail: summary };
  }
  return { summary: NOT_FOUND_MESSAGE, detail: NOT_FOUND_MESSAGE };
}

export type AgentHelpResult = {
  readonly ok: boolean;
  readonly summary: string;
  readonly detail: string;
};

export function interpretAgentHelp(input: {
  readonly stdout: string;
  readonly stderr: string;
  readonly errorMessage?: string;
}): AgentHelpResult {
  const stdout = input.stdout.trim();
  const stderr = input.stderr.trim();
  const parsed = parseAgentEnvelope(stdout);
  if (parsed.kind === 'ok') {
    return { ok: true, summary: 'stud agent help succeeded.', detail: stdout };
  }
  if (parsed.kind === 'failed') {
    return { ok: false, summary: parsed.summary, detail: joinDetail(parsed.summary, stderr, stdout) };
  }
  if (parsed.kind === 'too-old') {
    const summary = 'This stud build does not return agent help data. It is too old for this extension.';
    return { ok: false, summary, detail: joinDetail(summary, stderr, stdout) };
  }
  if (input.errorMessage !== undefined) {
    const summary = 'stud help --agent failed.';
    return { ok: false, summary, detail: joinDetail(input.errorMessage, stderr, stdout) };
  }
  const summary = 'stud help --agent did not return JSON.';
  return { ok: false, summary, detail: joinDetail(summary, stderr, stdout) };
}

type Envelope =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly summary: string }
  | { readonly kind: 'too-old' }
  | { readonly kind: 'not-json' };

function parseAgentEnvelope(stdout: string): Envelope {
  if (stdout === '') {
    return { kind: 'not-json' };
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { kind: 'not-json' };
  }
  if (typeof value !== 'object' || value === null) {
    return { kind: 'too-old' };
  }
  const record = value as { success?: unknown; error?: unknown; data?: unknown };
  if (record.success === false) {
    const error = typeof record.error === 'string' && record.error !== '' ? record.error : 'stud help --agent failed.';
    return { kind: 'failed', summary: error };
  }
  if (record.success === true && typeof record.data === 'object' && record.data !== null) {
    return { kind: 'ok' };
  }
  return { kind: 'too-old' };
}

function pathDirectories(pathEnv: string | undefined, delimiter: string): readonly string[] {
  if (pathEnv === undefined || pathEnv.trim() === '') {
    return [];
  }
  return pathEnv.split(delimiter).map((entry) => entry.trim()).filter((entry) => entry !== '');
}

function homeBinDirectories(homeDir: string | undefined, delimiter: string): readonly string[] {
  if (homeDir === undefined || homeDir.trim() === '') {
    return [];
  }
  const separator = delimiter === ';' ? '\\' : '/';
  return [`${trimSeparator(homeDir.trim(), separator)}${separator}.local${separator}bin`];
}

function directoriesToExecutables(directories: readonly string[], request: DiscoveryRequest): readonly string[] {
  const separator = request.pathDelimiter === ';' ? '\\' : '/';
  const paths: string[] = [];
  for (const directory of directories) {
    for (const name of request.executableNames) {
      paths.push(`${trimSeparator(directory, separator)}${separator}${name}`);
    }
  }
  return paths;
}

function trimSeparator(value: string, separator: string): string {
  return value.endsWith(separator) ? value.slice(0, -separator.length) : value;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function joinDetail(summary: string, stderr: string, stdout: string): string {
  return [summary, stderr, stdout].filter((part) => part !== '').join('\n');
}
