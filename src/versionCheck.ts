export const CHECK_VERSION_COMMAND = 'stud.checkVersion';
export const EXECUTABLE_PATH_SETTING = 'stud.executablePath';
export const VERSION_ARGS = ['--version'] as const;

const MISSING_PATH_MESSAGE =
  'stud.executablePath is not set. Choose the user-installed stud executable in settings. This version does not discover stud on PATH.';

export type VersionCheckPlan =
  | { readonly kind: 'missing-path'; readonly message: string }
  | { readonly kind: 'run'; readonly executable: string; readonly args: typeof VERSION_ARGS };

export function planVersionCheck(executablePath: string | undefined | null): VersionCheckPlan {
  const executable = executablePath?.trim() ?? '';
  if (executable === '') {
    return { kind: 'missing-path', message: MISSING_PATH_MESSAGE };
  }

  return { kind: 'run', executable, args: VERSION_ARGS };
}

export type VersionCheckResult = {
  readonly ok: boolean;
  readonly summary: string;
  readonly detail: string;
};

export function formatVersionResult(input: {
  stdout: string;
  stderr: string;
  errorMessage?: string;
}): VersionCheckResult {
  const stdout = input.stdout.trim();
  const stderr = input.stderr.trim();
  if (input.errorMessage !== undefined) {
    const detail = [input.errorMessage, stderr, stdout].filter((part) => part !== '').join('\n');
    return {
      ok: false,
      summary: 'stud version check failed.',
      detail,
    };
  }

  return {
    ok: true,
    summary: stdout === '' ? 'stud reported an empty version.' : stdout,
    detail: stdout,
  };
}
