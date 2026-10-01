import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, sep } from 'node:path';
import * as vscode from 'vscode';
import {
  OPEN_GLOBAL_CONFIG_COMMAND,
  OPEN_PROJECT_CONFIG_COMMAND,
  REVEAL_CONFIG_LOCATIONS_COMMAND,
  WORKSPACE_PICK_CANCELLED,
  classifyAccess,
  describeConfigLocations,
  describeUnreadable,
  globalConfigPath,
  planGlobalOpen,
  planProjectOpen,
  projectConfigPath,
  selectWorkspace,
  type AccessClassification,
  type ConfigFilePlan,
  type FilePresence,
} from './configAccess';
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
    vscode.commands.registerCommand(OPEN_GLOBAL_CONFIG_COMMAND, () => runOpenGlobalConfig(output)),
    vscode.commands.registerCommand(OPEN_PROJECT_CONFIG_COMMAND, () => runOpenProjectConfig(output)),
    vscode.commands.registerCommand(REVEAL_CONFIG_LOCATIONS_COMMAND, () => runRevealConfigLocations(output)),
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

function runOpenGlobalConfig(output: vscode.OutputChannel): Promise<void> {
  const home = homeDirectory();
  const path = globalConfigPath(home, sep);
  return filePresence(path).then((check) => {
    if (check.kind === 'unreadable') {
      return reportUnreadable(output, path, check.code);
    }
    return applyConfigPlan(output, planGlobalOpen({ homeDir: home, separator: sep, presence: check.kind }));
  });
}

function runOpenProjectConfig(output: vscode.OutputChannel): Promise<void> {
  const selection = selectWorkspace(workspaceFolders());
  if (selection.kind === 'none') {
    report(output, selection.summary, 'warning', selection.summary);
    return Promise.resolve();
  }
  if (selection.kind === 'one') {
    return openProjectConfig(output, selection.folder);
  }
  return Promise.resolve(vscode.window.showQuickPick(selection.folders, { placeHolder: 'Select a workspace folder' })).then((picked) => {
    if (picked === undefined) {
      report(output, WORKSPACE_PICK_CANCELLED, 'warning', WORKSPACE_PICK_CANCELLED);
      return;
    }
    return openProjectConfig(output, picked);
  });
}

function openProjectConfig(output: vscode.OutputChannel, folder: string): Promise<void> {
  const path = projectConfigPath(folder, sep);
  return filePresence(path).then((check) => {
    if (check.kind === 'unreadable') {
      return reportUnreadable(output, path, check.code);
    }
    return applyConfigPlan(output, planProjectOpen({ workspaceDir: folder, separator: sep, presence: check.kind }));
  });
}

function runRevealConfigLocations(output: vscode.OutputChannel): Promise<void> {
  const folders = workspaceFolders();
  const home = homeDirectory();
  const globalPath = globalConfigPath(home, sep);
  const projectPaths = folders.map((folder) => projectConfigPath(folder, sep));
  return Promise.all([filePresence(globalPath), ...projectPaths.map((path) => filePresence(path))]).then((checks) => {
    const described = describeConfigLocations({
      workspaceOpen: folders.length > 0,
      locations: [
        { role: 'global', path: globalPath, presence: presenceOf(checks[0]) },
        ...projectPaths.map((path, index) => ({ role: 'project' as const, path, presence: presenceOf(checks[index + 1]) })),
      ],
    });
    report(output, described.detail, 'info', described.summary);
  });
}

function homeDirectory(): string {
  try {
    return homedir();
  } catch {
    return '';
  }
}

function presenceOf(check: AccessClassification | { readonly kind: 'present' } | undefined): FilePresence {
  if (check === undefined || check.kind === 'missing') {
    return 'missing';
  }
  return check.kind === 'present' ? 'present' : 'unreadable';
}

function workspaceFolders(): string[] {
  return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
}

function applyConfigPlan(output: vscode.OutputChannel, plan: ConfigFilePlan): Promise<void> {
  if (plan.kind === 'missing') {
    report(output, plan.summary, 'warning', plan.summary);
    return Promise.resolve();
  }
  return Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.file(plan.path)))
    .then((document) => vscode.window.showTextDocument(document))
    .then(
      () => {
        report(output, plan.path, 'info', plan.summary);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown error';
        report(output, message, 'error', `Could not open ${plan.path}.`);
      },
    );
}

function reportUnreadable(output: vscode.OutputChannel, path: string, code: string): void {
  const described = describeUnreadable(path, code);
  report(output, described.detail, 'error', described.summary);
}

function filePresence(file: string): Promise<AccessClassification | { readonly kind: 'present' }> {
  if (file === '') {
    return Promise.resolve({ kind: 'missing' });
  }
  return access(file, constants.F_OK).then(
    () => ({ kind: 'present' as const }),
    (error: NodeJS.ErrnoException) => classifyAccess(error.code),
  );
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
