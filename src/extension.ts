import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import * as vscode from 'vscode';
import {
  AGENT_HELP_ARGS,
  AGENT_HELP_STDIN,
  SEARCH_PATH_SETTING,
  VALIDATE_COMMAND,
  chooseCandidate,
  describeUnresolved,
  interpretAgentHelp,
  planDiscovery,
  type CandidateState,
} from './discovery';
import {
  CHECK_VERSION_COMMAND,
  EXECUTABLE_PATH_SETTING,
  VERSION_ARGS,
  formatVersionResult,
} from './versionCheck';

const OUTPUT_CHANNEL_NAME = 'stud';
const COMMAND_TIMEOUT_MS = 10_000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);
  output.appendLine('stud extension activated.');

  context.subscriptions.push(
    vscode.commands.registerCommand(CHECK_VERSION_COMMAND, () => runCheckVersion(output)),
    vscode.commands.registerCommand(VALIDATE_COMMAND, () => runValidate(output)),
  );
}

export function deactivate(): void {}

function runCheckVersion(output: vscode.OutputChannel): Promise<void> {
  return withStud(output, (executable) => {
    output.appendLine(`Running ${executable} ${VERSION_ARGS.join(' ')}`);
    return runExecutable(executable, VERSION_ARGS).then((result) => {
      const formatted = formatVersionResult(result);
      report(output, formatted.detail, formatted.ok ? 'info' : 'error', formatted.summary);
    });
  });
}

function runValidate(output: vscode.OutputChannel): Promise<void> {
  return withStud(output, (executable) => {
    output.appendLine(`Running ${executable} ${AGENT_HELP_ARGS.join(' ')}`);
    return runAgentHelp(executable).then((result) => {
      const formatted = interpretAgentHelp(result);
      report(output, formatted.detail, formatted.ok ? 'info' : 'error', formatted.summary);
    });
  });
}

function withStud(output: vscode.OutputChannel, run: (executable: string) => Promise<void>): Promise<void> {
  return resolveStud().then((resolved) => {
    if (!resolved.ok) {
      report(output, resolved.detail, 'warning', resolved.summary);
      return;
    }
    return run(resolved.executable);
  });
}

function resolveStud(): Promise<{ ok: true; executable: string } | { ok: false; summary: string; detail: string }> {
  const plan = planDiscovery({
    configuredPath: vscode.workspace.getConfiguration().get<string>(EXECUTABLE_PATH_SETTING),
    searchEnabled: vscode.workspace.getConfiguration().get<boolean>(SEARCH_PATH_SETTING) !== false,
    pathEnv: process.env.PATH,
    homeDir: homedir(),
    pathDelimiter: delimiter,
    executableNames: process.platform === 'win32' ? ['stud.exe', 'stud'] : ['stud'],
  });
  if (plan.kind === 'missing') {
    return Promise.resolve({ ok: false, summary: plan.message, detail: plan.message });
  }
  if (plan.kind === 'explicit') {
    return judgeExplicit(plan.executable);
  }
  return judgeSearch(plan.candidates);
}

function judgeExplicit(executable: string): Promise<{ ok: true; executable: string } | { ok: false; summary: string; detail: string }> {
  return fileState(executable).then((state) => {
    if (state === 'executable') {
      return { ok: true as const, executable };
    }
    return { ok: false as const, ...describeUnresolved({ source: 'explicit', state, path: executable }) };
  });
}

function judgeSearch(candidates: readonly string[]): Promise<{ ok: true; executable: string } | { ok: false; summary: string; detail: string }> {
  return Promise.all(candidates.map((candidate) => fileState(candidate).then((state) => ({ path: candidate, state })))).then((states) => {
    const chosen = chooseCandidate(states);
    if (chosen.state === 'executable') {
      return { ok: true as const, executable: chosen.path };
    }
    return { ok: false as const, ...describeUnresolved({ source: 'search', state: chosen.state, path: chosen.path }) };
  });
}

function fileState(file: string): Promise<CandidateState> {
  return access(file, constants.X_OK).then(
    () => 'executable' as const,
    (error: NodeJS.ErrnoException) => (error.code === 'EACCES' || error.code === 'EPERM' ? 'not-executable' : 'missing'),
  );
}

function runExecutable(
  executable: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; errorMessage?: string }> {
  return new Promise((resolve) => {
    execFile(executable, [...args], { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        errorMessage: error === null ? undefined : error.message,
      });
    });
  });
}

function runAgentHelp(executable: string): Promise<{ stdout: string; stderr: string; errorMessage?: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...AGENT_HELP_ARGS], { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (errorMessage?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        errorMessage,
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish('stud help --agent timed out.');
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => finish(error.message));
    child.on('close', (code) => finish(code === 0 ? undefined : `stud help --agent exited with code ${code ?? 'unknown'}.`));
    child.stdin.write(AGENT_HELP_STDIN);
    child.stdin.end();
  });
}

function report(
  output: vscode.OutputChannel,
  detail: string,
  level: 'info' | 'warning' | 'error',
  summary: string = detail,
): void {
  output.appendLine(detail);
  output.show(true);
  if (level === 'info') {
    void vscode.window.showInformationMessage(summary);
    return;
  }
  if (level === 'warning') {
    void vscode.window.showWarningMessage(summary);
    return;
  }
  void vscode.window.showErrorMessage(summary);
}
