import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import {
  CHECK_VERSION_COMMAND,
  EXECUTABLE_PATH_SETTING,
  formatVersionResult,
  planVersionCheck,
} from './versionCheck';

const OUTPUT_CHANNEL_NAME = 'stud';
const VERSION_CHECK_TIMEOUT_MS = 10_000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);
  output.appendLine('stud extension activated.');

  const command = vscode.commands.registerCommand(CHECK_VERSION_COMMAND, () => runCheckVersion(output));
  context.subscriptions.push(command);
}

export function deactivate(): void {}

function runCheckVersion(output: vscode.OutputChannel): Promise<void> {
  const configured = vscode.workspace.getConfiguration().get<string>(EXECUTABLE_PATH_SETTING);
  const plan = planVersionCheck(configured);
  if (plan.kind === 'missing-path') {
    report(output, plan.message, 'warning');
    return Promise.resolve();
  }

  output.appendLine(`Running ${plan.executable} ${plan.args.join(' ')}`);
  return runExecutable(plan.executable, plan.args).then((result) => {
    const formatted = formatVersionResult(result);
    report(output, formatted.detail, formatted.ok ? 'info' : 'error', formatted.summary);
  });
}

function runExecutable(
  executable: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; errorMessage?: string }> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      { timeout: VERSION_CHECK_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          errorMessage: error === null ? undefined : error.message,
        });
      },
    );
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
