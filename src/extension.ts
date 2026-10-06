import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
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
import { installPortable, resolvePortableRoot, updatePortable } from './portableInstallRunner';
import {
  INSTALL_PORTABLE_COMMAND,
  UPDATE_PORTABLE_COMMAND,
  classifyLink,
  planInstall,
  planUpdate,
  portableLocations,
  type LinkState,
} from './portableInstall';
import {
  SHOW_CONFIG_COMMAND,
  SHOW_PULL_REQUEST_COMMENTS_COMMAND,
  COMMIT_COMMAND,
  PUSH_COMMAND,
  SHOW_WORK_ITEM_COMMAND,
  SUBMIT_COMMAND,
  SYNC_COMMAND,
  VALIDATE_CONFIG_COMMAND,
  interpretAgentRun,
  planAgentWorkspace,
  planAllowlistedRun,
  AGENT_ALREADY_RUNNING,
  AGENT_WORKSPACE_PICK_CANCELLED,
  planWorkflow,
  type AgentRunPlan,
  type WorkflowPlan,
} from './agentRun';
import { planCommandPrompt, promptStdin, type PromptAnswer, type PromptStep } from './commandPrompt';
import {
  CHECK_VERSION_COMMAND,
  EXECUTABLE_PATH_SETTING,
  VERSION_ARGS,
  formatVersionResult,
} from './versionCheck';

const OUTPUT_CHANNEL_NAME = 'stud';
let agentBusy = false;
const COMMAND_TIMEOUT_MS = 10_000;
const AGENT_RUN_TIMEOUT_MS = 90_000;
const MAX_AGENT_OUTPUT_BYTES = 1_048_576;

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
    vscode.commands.registerCommand(SHOW_CONFIG_COMMAND, () => runAllowlisted(output, SHOW_CONFIG_COMMAND)),
    vscode.commands.registerCommand(VALIDATE_CONFIG_COMMAND, () => runPrompted(output, VALIDATE_CONFIG_COMMAND)),
    vscode.commands.registerCommand(SHOW_PULL_REQUEST_COMMENTS_COMMAND, () => runAllowlisted(output, SHOW_PULL_REQUEST_COMMENTS_COMMAND)),
    vscode.commands.registerCommand(SHOW_WORK_ITEM_COMMAND, () => runPrompted(output, SHOW_WORK_ITEM_COMMAND)),
    vscode.commands.registerCommand(SYNC_COMMAND, () => runPrompted(output, SYNC_COMMAND)),
    vscode.commands.registerCommand(COMMIT_COMMAND, () => runPrompted(output, COMMIT_COMMAND)),
    vscode.commands.registerCommand(PUSH_COMMAND, () => runPrompted(output, PUSH_COMMAND)),
    vscode.commands.registerCommand(SUBMIT_COMMAND, () => runPrompted(output, SUBMIT_COMMAND)),
    vscode.commands.registerCommand(INSTALL_PORTABLE_COMMAND, () => runInstallPortable(output)),
    vscode.commands.registerCommand(UPDATE_PORTABLE_COMMAND, () => runUpdatePortable(output)),
  );
}

export function deactivate(): void {}

function runInstallPortable(output: vscode.OutputChannel): Promise<void> {
  if (refuseWhenBusy(output)) {
    return Promise.resolve();
  }
  agentBusy = true;
  const home = homeDirectory();
  const work = home === ''
    ? Promise.resolve(report(output, 'Home directory is unavailable.', 'warning', 'Home directory is unavailable.'))
    : installFacts(home).then((facts) => confirmInstall(output, facts, home));
  return work.finally(() => {
    agentBusy = false;
  });
}

function confirmInstall(
  output: vscode.OutputChannel,
  facts: Parameters<typeof planInstall>[0],
  home: string,
): Promise<void> {
  const plan = planInstall(facts);
  if (plan.kind === 'refuse') {
    report(output, plan.summary, 'warning', plan.summary);
    return Promise.resolve();
  }
  return Promise.resolve(vscode.window.showWarningMessage(plan.confirmation, { modal: true }, 'Install')).then((choice) => {
    if (choice !== 'Install') {
      return;
    }
    output.appendLine(`Downloading portable stud (${plan.artifact}).`);
    return installPortable({ artifact: plan.artifact, separator: sep, locations: portableLocations(home, sep) })
      .then((result) => report(output, result.detail, result.ok ? 'info' : 'error', result.summary));
  });
}

function runUpdatePortable(output: vscode.OutputChannel): Promise<void> {
  if (refuseWhenBusy(output)) {
    return Promise.resolve();
  }
  agentBusy = true;
  const home = homeDirectory();
  const bin = portableLocations(home, sep).bin;
  const work = home === ''
    ? Promise.resolve(report(output, 'Home directory is unavailable.', 'warning', 'Home directory is unavailable.'))
    : readLinkState(home).then((link) => {
      const plan = planUpdate(link);
      if (plan.kind === 'refuse') {
        report(output, plan.summary, 'warning', plan.summary);
        return;
      }
      output.appendLine(`Running ${bin} ${plan.args.join(' ')}`);
      return updatePortable(bin).then((result) => {
        report(output, result.detail === '' ? result.summary : result.detail, result.ok ? 'info' : 'error', result.summary);
      });
    });
  return work.finally(() => {
    agentBusy = false;
  });
}

function refuseWhenBusy(output: vscode.OutputChannel): boolean {
  if (!agentBusy) {
    return false;
  }
  report(output, AGENT_ALREADY_RUNNING, 'warning', AGENT_ALREADY_RUNNING);
  return true;
}

function installFacts(home: string): Promise<{
  readonly configuredPath: string;
  readonly searchEnabled: boolean;
  readonly states: CandidateState[];
  readonly platform: string;
  readonly arch: string;
  readonly link: LinkState;
}> {
  const configuredPath = vscode.workspace.getConfiguration().get<string>(EXECUTABLE_PATH_SETTING) ?? '';
  const searchEnabled = vscode.workspace.getConfiguration().get<boolean>(SEARCH_PATH_SETTING) !== false;
  const plan = planDiscovery({
    configuredPath,
    searchEnabled,
    pathEnv: process.env.PATH,
    homeDir: home,
    pathDelimiter: delimiter,
    executableNames: process.platform === 'win32' ? ['stud.exe', 'stud'] : ['stud'],
  });
  const states = plan.kind === 'search' ? Promise.all(plan.candidates.map((candidate) => fileState(candidate))) : Promise.resolve([]);
  return states.then((resolved) => readLinkState(home).then((link) => ({
    configuredPath,
    searchEnabled,
    states: resolved,
    platform: process.platform,
    arch: process.arch,
    link,
  })));
}

function readLinkState(home: string): Promise<LinkState> {
  const locations = portableLocations(home, sep);
  if (locations.bin === '') {
    return Promise.resolve('blocked');
  }
  return resolvePortableRoot(locations.root).then((portableRoot) => lstat(locations.bin).then(
    (info) => (info.isSymbolicLink()
      ? realpath(locations.bin).then(
        (target) => classifyLink({ exists: true, isSymlink: true, resolvedTarget: target, portableRoot, separator: sep }),
        () => 'blocked' as const,
      )
      : 'blocked'),
    (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? 'absent' : 'blocked'),
  ));
}

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
    return runAgent(executable, AGENT_HELP_ARGS, AGENT_HELP_STDIN, COMMAND_TIMEOUT_MS).then((result) => {
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

type WorkflowRun = Extract<WorkflowPlan, { kind: 'run' }>;
type EncodedItem = vscode.QuickPickItem & { readonly encoded: boolean | string | null };

function runPrompted(output: vscode.OutputChannel, commandId: string): Promise<void> {
  if (refuseWhenBusy(output)) {
    return Promise.resolve();
  }
  const plan = planWorkflow(commandId);
  if (plan.kind === 'rejected') {
    report(output, plan.summary, 'warning', plan.summary);
    return Promise.resolve();
  }
  return chooseAgentWorkspace(output).then((folder) => {
    if (folder === undefined || refuseWhenBusy(output)) {
      return;
    }
    agentBusy = true;
    return Promise.resolve()
      .then(() => promptInWorkspace(output, plan, folder))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'The stud prompt stopped.';
        report(output, detail, 'error', 'The stud prompt stopped.');
      })
      .finally(() => {
        agentBusy = false;
      });
  });
}

function runAllowlisted(output: vscode.OutputChannel, commandId: string): Promise<void> {
  return runPlanned(output, planAllowlistedRun(commandId));
}

function runPlanned(
  output: vscode.OutputChannel,
  plan: AgentRunPlan | ReturnType<typeof planWorkflow>,
  folder?: string,
): Promise<void> {
  if (plan.kind === 'rejected') {
    report(output, plan.summary, 'warning', plan.summary);
    return Promise.resolve();
  }
  if (agentBusy) {
    report(output, AGENT_ALREADY_RUNNING, 'warning', AGENT_ALREADY_RUNNING);
    return Promise.resolve();
  }
  if (folder !== undefined) {
    return startAllowlisted(output, plan, folder);
  }
  return chooseAgentWorkspace(output).then((workspace) => {
    if (workspace === undefined) {
      return;
    }
    return startAllowlisted(output, plan, workspace);
  });
}

function startAllowlisted(
  output: vscode.OutputChannel,
  plan: { readonly label: string; readonly args: readonly string[]; readonly stdin: string },
  workspace: string,
): Promise<void> {
  if (agentBusy) {
    report(output, AGENT_ALREADY_RUNNING, 'warning', AGENT_ALREADY_RUNNING);
    return Promise.resolve();
  }
  agentBusy = true;
  return Promise.resolve()
    .then(() =>
      withStud(output, (executable) => {
        output.appendLine(`Running ${executable} ${plan.args.join(' ')} in ${workspace}`);
        return runAgent(executable, plan.args, plan.stdin, AGENT_RUN_TIMEOUT_MS, workspace).then((result) => {
          const formatted = interpretAgentRun({ label: plan.label, ...result });
          report(output, formatted.detail, formatted.level, formatted.summary);
        });
      }),
    )
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'The stud command stopped.';
      report(output, detail, 'error', 'The stud command stopped.');
    })
    .finally(() => {
      agentBusy = false;
    });
}

function chooseAgentWorkspace(output: vscode.OutputChannel): Promise<string | undefined> {
  const selection = planAgentWorkspace(workspaceFolders());
  if (selection.kind === 'none') {
    report(output, selection.summary, 'warning', selection.summary);
    return Promise.resolve(undefined);
  }
  if (selection.kind === 'one') {
    return Promise.resolve(selection.folder);
  }
  return Promise.resolve(vscode.window.showQuickPick(selection.folders, { placeHolder: 'Workspace folder for stud' })).then(
    (picked) => {
      if (picked === undefined) {
        report(output, AGENT_WORKSPACE_PICK_CANCELLED, 'warning', AGENT_WORKSPACE_PICK_CANCELLED);
      }
      return picked;
    },
  );
}

function promptInWorkspace(output: vscode.OutputChannel, plan: WorkflowRun, folder: string): Promise<void> {
  return withStud(output, (executable) =>
    loadCommandHelp(output, executable, plan.label, folder).then((stdout) => {
      if (stdout === undefined) {
        return;
      }
      const planned = planCommandPrompt({ command: plan.label, stdout });
      if (planned.kind === 'stop') {
        report(output, planned.summary, 'warning', planned.summary);
        return;
      }
      return askSteps(planned.steps).then((answers) => {
        if (answers === undefined) {
          return;
        }
        return submitPrompt(output, {
          executable,
          plan,
          folder,
          steps: planned.steps,
          answers,
        });
      });
    }),
  );
}

function loadCommandHelp(
  output: vscode.OutputChannel,
  executable: string,
  command: string,
  folder: string,
): Promise<string | undefined> {
  output.appendLine(`Running ${executable} ${AGENT_HELP_ARGS.join(' ')} in ${folder}`);
  output.show(true);
  return runAgent(executable, AGENT_HELP_ARGS, JSON.stringify({ command }), COMMAND_TIMEOUT_MS, folder).then((result) => {
    const formatted = interpretAgentHelp(result);
    if (!formatted.ok) {
      report(output, formatted.detail, 'warning', formatted.summary);
      return undefined;
    }
    return result.stdout;
  });
}

function submitPrompt(
  output: vscode.OutputChannel,
  input: {
    readonly executable: string;
    readonly plan: WorkflowRun;
    readonly folder: string;
    readonly steps: readonly PromptStep[];
    readonly answers: readonly PromptAnswer[];
  },
): Promise<void> {
  const payload = promptStdin({ command: input.plan.label, steps: input.steps, answers: input.answers });
  if (payload.kind === 'stop') {
    report(output, payload.summary, 'warning', payload.summary);
    return Promise.resolve();
  }
  return confirmWorkflow(input.plan.confirmation, input.folder).then((accepted) => {
    if (!accepted) {
      return;
    }
    output.appendLine(`Running ${input.executable} ${input.plan.args.join(' ')} in ${input.folder}`);
    return runAgent(input.executable, input.plan.args, payload.stdin, AGENT_RUN_TIMEOUT_MS, input.folder).then(
      (result) => {
        const formatted = interpretAgentRun({ label: input.plan.label, ...result });
        report(output, formatted.detail, formatted.level, formatted.summary);
      },
    );
  });
}

function confirmWorkflow(confirmation: string | null, folder: string): Promise<boolean> {
  if (confirmation === null) {
    return Promise.resolve(true);
  }
  const message = `${confirmation} Folder: ${folder}`;
  return Promise.resolve(vscode.window.showWarningMessage(message, { modal: true }, 'Run')).then(
    (choice) => choice === 'Run',
  );
}

function askSteps(steps: readonly PromptStep[]): Promise<readonly PromptAnswer[] | undefined> {
  return steps.reduce<Promise<readonly PromptAnswer[] | undefined>>((pending, step) => {
    return pending.then((collected) => {
      if (collected === undefined) {
        return undefined;
      }
      return askOne(step).then((answer) => (answer === undefined ? undefined : [...collected, answer]));
    });
  }, Promise.resolve([]));
}

function askOne(step: PromptStep): Promise<PromptAnswer | undefined> {
  if (step.kind === 'text') {
    return Promise.resolve(vscode.window.showInputBox({ title: step.name, prompt: step.name, value: step.value })).then(
      (value) => (value === undefined ? undefined : { name: step.name, value }),
    );
  }
  const items: readonly EncodedItem[] =
    step.kind === 'bool'
      ? [
          { label: 'Yes', encoded: true },
          { label: 'No', encoded: false },
        ]
      : step.choices.map((choice) => ({ label: choice.label, encoded: choice.value }));
  const wanted = step.kind === 'bool' ? step.default : step.active;
  const active = items.find((item) => item.encoded === wanted);
  if (active === undefined) {
    return Promise.reject(new Error('The stud prompt stopped.'));
  }
  return pickItem(step.name, items, active).then((item) =>
    item === undefined ? undefined : { name: step.name, value: item.encoded },
  );
}

function pickItem(title: string, items: readonly EncodedItem[], active: EncodedItem): Promise<EncodedItem | undefined> {
  const pick = vscode.window.createQuickPick<EncodedItem>();
  pick.title = title;
  pick.items = items;
  pick.activeItems = [active];
  pick.selectedItems = [active];
  return new Promise((resolve) => {
    let settled = false;
    let accepted = false;
    let chosen: EncodedItem | undefined;
    const finish = (item: EncodedItem | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      pick.dispose();
      resolve(item);
    };
    pick.onDidAccept(() => {
      accepted = true;
      chosen = pick.activeItems[0] ?? pick.selectedItems[0];
      pick.hide();
    });
    pick.onDidHide(() => finish(accepted ? chosen : undefined));
    pick.show();
    pick.activeItems = [active];
    pick.selectedItems = [active];
  });
}

function runAgent(
  executable: string,
  args: readonly string[],
  stdin: string,
  timeoutMs: number,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; errorMessage?: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], { windowsHide: true, cwd });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (errorMessage?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        errorMessage,
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      finish(`${args.join(' ')} timed out.`);
    }, timeoutMs);
    const take = (chunks: Buffer[], seen: number, chunk: Buffer): number => {
      if (settled) {
        return seen;
      }
      const next = seen + chunk.length;
      if (next > MAX_AGENT_OUTPUT_BYTES) {
        child.kill();
        finish(`${args.join(' ')} output exceeded ${MAX_AGENT_OUTPUT_BYTES} bytes.`);
        return next;
      }
      chunks.push(chunk);
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes = take(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes = take(stderr, stderrBytes, chunk);
    });
    child.stdin.on('error', () => undefined);
    child.stdout.on('error', () => undefined);
    child.stderr.on('error', () => undefined);
    child.on('error', (error) => finish(error.message));
    child.on('close', (code) => finish(code === 0 ? undefined : `${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    child.stdin.write(stdin);
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
