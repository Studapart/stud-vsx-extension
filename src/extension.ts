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
  CONFIG_VIEW,
  GIT_VIEW,
  PROJECT_FIELD_COMMAND,
  REFRESH_WORK_ITEMS_COMMAND,
  WORK_ITEMS_VIEW,
  contributedPanelCommands,
  fillsWorkItemList,
  panelButtons,
  panelStdinMode,
  planPanelAction,
  planProjectFieldStdin,
  presetForStep,
  projectFieldChoices,
  projectFieldIsSecret,
  redactSecret,
  readPanelInvocation,
  refuseBlankWorkItemKey,
  showsWorkItemRows,
  switchMatchSummary,
  workItemRows,
  type PanelPlan,
  type WorkItemRow,
} from './panelActions';
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

  registerPaletteOrPanel(context, output, CHECK_VERSION_COMMAND, () => runCheckVersion(output));
  registerPaletteOrPanel(context, output, VALIDATE_COMMAND, () => runValidate(output));
  registerPaletteOrPanel(context, output, OPEN_GLOBAL_CONFIG_COMMAND, () => runOpenGlobalConfig(output));
  registerPaletteOrPanel(context, output, OPEN_PROJECT_CONFIG_COMMAND, () => runOpenProjectConfig(output));
  registerPaletteOrPanel(context, output, REVEAL_CONFIG_LOCATIONS_COMMAND, () => runRevealConfigLocations(output));
  registerPaletteOrPanel(context, output, SHOW_CONFIG_COMMAND, () => runAllowlisted(output, SHOW_CONFIG_COMMAND));
  registerPaletteOrPanel(context, output, VALIDATE_CONFIG_COMMAND, () => runPrompted(output, VALIDATE_CONFIG_COMMAND));
  registerPaletteOrPanel(context, output, SHOW_PULL_REQUEST_COMMENTS_COMMAND, () => runAllowlisted(output, SHOW_PULL_REQUEST_COMMENTS_COMMAND));
  registerPaletteOrPanel(context, output, SHOW_WORK_ITEM_COMMAND, () => runPrompted(output, SHOW_WORK_ITEM_COMMAND));
  registerPaletteOrPanel(context, output, SYNC_COMMAND, () => runPrompted(output, SYNC_COMMAND));
  registerPaletteOrPanel(context, output, COMMIT_COMMAND, () => runPrompted(output, COMMIT_COMMAND));
  registerPaletteOrPanel(context, output, PUSH_COMMAND, () => runPrompted(output, PUSH_COMMAND));
  registerPaletteOrPanel(context, output, SUBMIT_COMMAND, () => runPrompted(output, SUBMIT_COMMAND));
  context.subscriptions.push(
    vscode.commands.registerCommand(INSTALL_PORTABLE_COMMAND, () => runInstallPortable(output)),
    vscode.commands.registerCommand(UPDATE_PORTABLE_COMMAND, () => runUpdatePortable(output)),
  );
  registerStudPanel(context, output);
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

type PanelRun = Extract<PanelPlan, { kind: 'run' }>;

let workItemModel: WorkItemModel | undefined;
let workItemsView: vscode.TreeView<WorkItemNode> | undefined;

function registerPaletteOrPanel(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  commandId: string,
  palette: () => Promise<void>,
): void {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, (origin?: unknown) => {
    if (!readPanelInvocation(origin).fromPanel) {
      return palette();
    }
    return runPanel(output, commandId, invocationFields(origin));
  }));
}

function registerStudPanel(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const model = new WorkItemModel();
  workItemModel = model;
  const work = vscode.window.createTreeView(WORK_ITEMS_VIEW, { treeDataProvider: model });
  workItemsView = work;
  const git = vscode.window.createTreeView(GIT_VIEW, { treeDataProvider: new ActionTree(panelButtons('git')) });
  const config = vscode.window.createTreeView(CONFIG_VIEW, { treeDataProvider: new ActionTree(panelButtons('config')) });
  context.subscriptions.push(model, work, git, config, work.onDidChangeVisibility((event) => {
    if (event.visible) {
      queueWorkItemLoad(output);
    }
  }));
  if (work.visible) {
    queueWorkItemLoad(output);
  }
  for (const button of contributedPanelCommands()) {
    context.subscriptions.push(vscode.commands.registerCommand(button.command, (origin?: unknown) => {
      return runPanel(output, button.command, invocationFields(origin === undefined ? { panel: true } : origin));
    }));
  }
}

let workItemLoadQueued = false;

function queueWorkItemLoad(output: vscode.OutputChannel): void {
  if (workItemLoadQueued) {
    return;
  }
  workItemLoadQueued = true;
  queueMicrotask(() => {
    workItemLoadQueued = false;
    void runPanel(output, REFRESH_WORK_ITEMS_COMMAND, {});
  });
}

function invocationFields(origin: unknown): Readonly<Record<string, string | null>> {
  const key = readPanelInvocation(origin).key;
  return key === undefined ? {} : { key };
}

function runPanel(
  output: vscode.OutputChannel,
  commandId: string,
  fields: Readonly<Record<string, string | null>>,
): Promise<void> {
  const plan = planPanelAction(commandId);
  if (plan.kind === 'rejected') {
    report(output, plan.summary, 'warning', plan.summary);
    return Promise.resolve();
  }
  if (refuseWhenBusy(output)) {
    return Promise.resolve();
  }
  if (plan.args.length === 0) {
    agentBusy = true;
    return dispatchExtension(output, commandId).finally(() => {
      agentBusy = false;
    });
  }
  return chooseAgentWorkspace(output).then((folder) => {
    if (folder === undefined || refuseWhenBusy(output)) {
      return;
    }
    agentBusy = true;
    const mode = panelStdinMode(commandId);
    const work = mode === 'project-field'
      ? runProjectField(output, plan, folder)
      : runPanelStud({ output, plan, folder, fields, emptyStdin: mode === 'empty' });
    return work.finally(() => {
      agentBusy = false;
    });
  });
}

function dispatchExtension(output: vscode.OutputChannel, commandId: string): Promise<void> {
  if (commandId === CHECK_VERSION_COMMAND) {
    return runCheckVersion(output);
  }
  if (commandId === VALIDATE_COMMAND) {
    return runValidate(output);
  }
  if (commandId === OPEN_GLOBAL_CONFIG_COMMAND) {
    return runOpenGlobalConfig(output);
  }
  if (commandId === OPEN_PROJECT_CONFIG_COMMAND) {
    return runOpenProjectConfig(output);
  }
  if (commandId === REVEAL_CONFIG_LOCATIONS_COMMAND) {
    return runRevealConfigLocations(output);
  }
  report(output, 'That action is not a stud panel action.', 'warning', 'That action is not a stud panel action.');
  return Promise.resolve();
}

function runPanelStud(input: {
  readonly output: vscode.OutputChannel;
  readonly plan: PanelRun;
  readonly folder: string;
  readonly fields: Readonly<Record<string, string | null>>;
  readonly emptyStdin: boolean;
}): Promise<void> {
  return withStud(input.output, (executable) => {
    if (input.emptyStdin) {
      return acceptPanelStdin({ ...input, executable, stdin: '{}' });
    }
    return loadCommandHelp(input.output, executable, input.plan.label, input.folder).then((stdout) => {
      return continuePanelHelp({ ...input, executable, stdout });
    });
  });
}

function continuePanelHelp(input: {
  readonly output: vscode.OutputChannel;
  readonly executable: string;
  readonly plan: PanelRun;
  readonly folder: string;
  readonly fields: Readonly<Record<string, string | null>>;
  readonly stdout: string | undefined;
}): Promise<void> {
  if (input.stdout === undefined) {
    return Promise.resolve();
  }
  const planned = planCommandPrompt({ command: input.plan.label, stdout: input.stdout });
  if (planned.kind === 'stop') {
    report(input.output, planned.summary, 'warning', planned.summary);
    return Promise.resolve();
  }
  return askPanelSteps(planned.steps, input.fields).then((answers) => {
    if (answers === undefined) {
      return;
    }
    return submitPanelAnswers({ ...input, steps: planned.steps, answers });
  });
}

function submitPanelAnswers(input: {
  readonly output: vscode.OutputChannel;
  readonly executable: string;
  readonly plan: PanelRun;
  readonly folder: string;
  readonly steps: readonly PromptStep[];
  readonly answers: readonly PromptAnswer[];
}): Promise<void> {
  const payload = promptStdin({ command: input.plan.label, steps: input.steps, answers: input.answers });
  if (payload.kind === 'stop') {
    report(input.output, payload.summary, 'warning', payload.summary);
    return Promise.resolve();
  }
  const blank = refuseBlankWorkItemKey({ command: input.plan.label, fields: stringFields(input.answers) });
  if (blank.kind === 'stop') {
    report(input.output, blank.summary, 'warning', blank.summary);
    return Promise.resolve();
  }
  return acceptPanelStdin({ ...input, stdin: payload.stdin, secret: undefined });
}

function acceptPanelStdin(input: {
  readonly output: vscode.OutputChannel;
  readonly executable: string;
  readonly plan: PanelRun;
  readonly folder: string;
  readonly stdin: string;
  readonly secret?: string;
}): Promise<void> {
  return confirmWorkflow(input.plan.confirmation, input.folder).then((accepted) => {
    if (!accepted) {
      return;
    }
    input.output.appendLine(`Running ${input.executable} ${input.plan.args.join(' ')} in ${input.folder}`);
    return runAgent(input.executable, input.plan.args, input.stdin, AGENT_RUN_TIMEOUT_MS, input.folder).then((result) => {
      presentPanelResult(input.output, input.plan.label, result, input.secret);
    });
  });
}

function presentPanelResult(
  output: vscode.OutputChannel,
  label: string,
  result: { stdout: string; stderr: string; errorMessage?: string },
  secret?: string,
): void {
  const safe = secret === undefined ? result : {
    stdout: redactSecret(result.stdout, secret),
    stderr: redactSecret(result.stderr, secret),
    errorMessage: result.errorMessage,
  };
  const match = switchMatchSummary(safe.stdout);
  if (match.kind === 'choose') {
    report(output, safe.stdout, 'warning', match.summary);
    return;
  }
  if (fillsWorkItemList(label) && showsWorkItemRows(safe.stdout)) {
    const parsed = workItemRows(safe.stdout);
    showWorkItemRows(parsed.kind === 'rows' ? parsed.rows : []);
  }
  const formatted = interpretAgentRun({ label, ...safe });
  report(output, formatted.detail, formatted.level, formatted.summary);
}

function showWorkItemRows(rows: readonly WorkItemRow[]): void {
  workItemModel?.replace(rows);
  if (workItemsView !== undefined) {
    workItemsView.message = rows.length === 0 ? 'No work items.' : undefined;
  }
}

function runProjectField(output: vscode.OutputChannel, plan: PanelRun, folder: string): Promise<void> {
  return pickProjectField().then((choice) => {
    if (choice === undefined) {
      return;
    }
    if (choice.kind === 'global') {
      return runOpenGlobalConfig(output);
    }
    return askProjectValue(choice.field).then((value) => saveProjectField(output, plan, folder, choice.field, value));
  });
}

function saveProjectField(
  output: vscode.OutputChannel,
  plan: PanelRun,
  folder: string,
  field: string,
  value: string | undefined,
): Promise<void> {
  if (value === undefined) {
    return Promise.resolve();
  }
  const planned = planProjectFieldStdin({ field, value });
  if (planned.kind === 'stop') {
    report(output, planned.summary, 'warning', planned.summary);
    return Promise.resolve();
  }
  const secret = projectFieldIsSecret(field) ? value : undefined;
  return withStud(output, (executable) => acceptPanelStdin({
    output,
    executable,
    plan,
    folder,
    stdin: planned.stdin,
    secret,
  }));
}

function pickProjectField(): Promise<{ readonly field: string; readonly kind: 'project' | 'global' } | undefined> {
  const items = projectFieldChoices().map((choice) => ({ label: choice.label, description: choice.field, choice }));
  return Promise.resolve(vscode.window.showQuickPick(items, { title: 'Project setting' })).then((item) => item?.choice);
}

function askProjectValue(field: string): Promise<string | undefined> {
  return Promise.resolve(vscode.window.showInputBox({
    title: field,
    prompt: field,
    password: projectFieldIsSecret(field),
    ignoreFocusOut: true,
  }));
}

function askPanelSteps(
  steps: readonly PromptStep[],
  fields: Readonly<Record<string, string | null>>,
): Promise<readonly PromptAnswer[] | undefined> {
  return steps.reduce<Promise<readonly PromptAnswer[] | undefined>>((pending, step) => {
    return pending.then((collected) => {
      if (collected === undefined) {
        return undefined;
      }
      return answerForStep(step, fields).then((answer) => (answer === undefined ? undefined : [...collected, answer]));
    });
  }, Promise.resolve([]));
}

function answerForStep(
  step: PromptStep,
  fields: Readonly<Record<string, string | null>>,
): Promise<PromptAnswer | undefined> {
  const preset = presetForStep(step.name, fields);
  if (step.kind === 'text' && preset !== undefined) {
    return Promise.resolve({ name: step.name, value: preset });
  }
  return askOne(step);
}

function stringFields(answers: readonly PromptAnswer[]): Readonly<Record<string, string | null>> {
  const fields: Record<string, string | null> = {};
  for (const answer of answers) {
    fields[answer.name] = typeof answer.value === 'string' ? answer.value : null;
  }
  return fields;
}

class ActionTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly items: readonly vscode.TreeItem[];

  constructor(buttons: readonly { readonly command: string; readonly title: string }[]) {
    this.items = buttons.map((button) => actionItem(button.command, button.title));
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): vscode.TreeItem[] {
    return [...this.items];
  }
}

function actionItem(command: string, title: string): vscode.TreeItem {
  const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
  item.command = { command, title, arguments: [{ panel: true }] };
  return item;
}

class WorkItemModel implements vscode.TreeDataProvider<WorkItemNode>, vscode.Disposable {
  private rows: readonly WorkItemRow[] = [];
  private readonly changes = new vscode.EventEmitter<WorkItemNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  replace(rows: readonly WorkItemRow[]): void {
    this.rows = rows;
    this.changes.fire(undefined);
  }

  getTreeItem(node: WorkItemNode): vscode.TreeItem {
    return node;
  }

  getChildren(): WorkItemNode[] {
    return this.rows.map((row) => new WorkItemNode(row.key, row.title, row.status));
  }

  dispose(): void {
    this.changes.dispose();
  }
}

class WorkItemNode extends vscode.TreeItem {
  readonly panel = true;

  constructor(readonly key: string, title: string, status: string) {
    super(key, vscode.TreeItemCollapsibleState.None);
    this.description = title;
    this.tooltip = status;
    this.contextValue = 'workItem';
    this.command = { command: SHOW_WORK_ITEM_COMMAND, title: 'Show', arguments: [{ panel: true, key }] };
  }
}
