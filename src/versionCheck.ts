export const CHECK_VERSION_COMMAND = 'stud.checkVersion';
export const EXECUTABLE_PATH_SETTING = 'stud.executablePath';
export const VERSION_ARGS = ['--version'] as const;

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
