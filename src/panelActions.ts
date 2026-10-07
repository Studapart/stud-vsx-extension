import {
  COMMIT_COMMAND,
  PUSH_COMMAND,
  SHOW_CONFIG_COMMAND,
  SHOW_PULL_REQUEST_COMMENTS_COMMAND,
  SHOW_WORK_ITEM_COMMAND,
  SUBMIT_COMMAND,
  SYNC_COMMAND,
  VALIDATE_CONFIG_COMMAND,
} from './agentRun';
import {
  OPEN_GLOBAL_CONFIG_COMMAND,
  OPEN_PROJECT_CONFIG_COMMAND,
  REVEAL_CONFIG_LOCATIONS_COMMAND,
} from './configAccess';
import { VALIDATE_COMMAND } from './discovery';
import { CHECK_VERSION_COMMAND } from './versionCheck';

export const PANEL_VIEW_CONTAINER = 'stud.panel';
export const WORK_ITEMS_VIEW = 'stud.workItems';
export const GIT_VIEW = 'stud.git';
export const CONFIG_VIEW = 'stud.config';

export const FLATTEN_COMMAND = 'stud.flatten';
export const UNDO_COMMAND = 'stud.undo';
export const PLEASE_COMMAND = 'stud.please';
export const BRANCHES_LIST_COMMAND = 'stud.branchesList';
export const BRANCHES_CLEAN_COMMAND = 'stud.branchesClean';
export const COMMENT_COMMAND = 'stud.comment';
export const START_COMMAND = 'stud.start';
export const TAKEOVER_COMMAND = 'stud.takeover';
export const UPDATE_WORK_ITEM_COMMAND = 'stud.updateWorkItem';
export const DOWNLOAD_COMMAND = 'stud.download';
export const SWITCH_COMMAND = 'stud.switch';
export const RENAME_BRANCH_COMMAND = 'stud.renameBranch';
export const CREATE_WORK_ITEM_COMMAND = 'stud.createWorkItem';
export const PROJECTS_COMMAND = 'stud.projects';
export const WORKFLOW_COMMAND = 'stud.workflow';
export const LABELS_COMMAND = 'stud.labels';
export const FILTERS_COMMAND = 'stud.filters';
export const FILTER_ISSUES_COMMAND = 'stud.filterIssues';
export const SEARCH_WORK_ITEMS_COMMAND = 'stud.searchWorkItems';
export const LIST_WORK_ITEMS_COMMAND = 'stud.listWorkItems';
export const REFRESH_WORK_ITEMS_COMMAND = 'stud.refreshWorkItems';
export const CONFLUENCE_SHOW_COMMAND = 'stud.confluenceShow';
export const CONFLUENCE_LABELS_COMMAND = 'stud.confluenceLabels';
export const STATUS_COMMAND = 'stud.status';
export const PROJECT_FIELD_COMMAND = 'stud.projectField';

const SYNC_CONFIRMATION = 'Sync with stud? This fetches the base branch and rebases the current branch onto it.';
const COMMIT_CONFIRMATION = 'Commit with stud? Stud decides what is staged and writes the commit message.';
const PUSH_CONFIRMATION = 'Push with stud? This can commit local changes, update the remote, and force-with-lease if that push is rejected.';
const SUBMIT_CONFIRMATION = 'Submit with stud? This can push the branch and open a pull request.';

type PanelViewName = 'work-items' | 'git' | 'config' | 'row';

type PanelAction = {
  readonly title: string;
  readonly args: readonly string[];
  readonly confirmation: string | null;
  readonly view: PanelViewName;
  readonly contributed: boolean;
};

export type PanelButton = { readonly command: string; readonly title: string };

export type PanelPlan =
  | { readonly kind: 'run'; readonly label: string; readonly args: readonly string[]; readonly confirmation: string | null }
  | { readonly kind: 'rejected'; readonly summary: string };

export type ProjectFieldChoice = { readonly field: string; readonly kind: 'project' | 'global'; readonly label: string };

export type ProjectFieldPlan = { readonly kind: 'stdin'; readonly stdin: string } | { readonly kind: 'stop'; readonly summary: string };

export type BlankKeyPlan = { readonly kind: 'ok' } | { readonly kind: 'stop'; readonly summary: string };

export type WorkItemRow = { readonly key: string; readonly title: string; readonly status: string };

export type WorkItemRows = { readonly kind: 'rows'; readonly rows: readonly WorkItemRow[] } | { readonly kind: 'empty' };

export type SwitchMatchSummary = { readonly kind: 'choose'; readonly summary: string } | { readonly kind: 'done' };

export type PanelInvocation = { readonly fromPanel: boolean; readonly key: string | undefined };

export type PanelStdinMode = 'help' | 'empty' | 'project-field';

const PROJECT_FIELDS: readonly ProjectFieldChoice[] = [
  { field: 'projectKey', kind: 'project', label: 'Project key' },
  { field: 'baseBranch', kind: 'project', label: 'Base branch' },
  { field: 'gitProvider', kind: 'project', label: 'Git provider' },
  { field: 'githubToken', kind: 'project', label: 'GitHub token' },
  { field: 'gitlabToken', kind: 'project', label: 'GitLab token' },
  { field: 'gitlabInstanceUrl', kind: 'project', label: 'GitLab instance URL' },
  { field: 'jiraDefaultProject', kind: 'project', label: 'Jira default project' },
  { field: 'confluenceDefaultSpace', kind: 'project', label: 'Confluence default space' },
  { field: 'issueTrackerProvider', kind: 'project', label: 'Issue tracker' },
  { field: 'linearTeamKey', kind: 'project', label: 'Linear team key' },
  { field: 'linearStartStateId', kind: 'project', label: 'Linear start state id' },
  { field: 'linearTypeLabelGroupId', kind: 'project', label: 'Linear type label group' },
  { field: 'jiraApiToken', kind: 'global', label: 'Jira API token' },
  { field: 'linearApiKey', kind: 'global', label: 'Linear API key' },
];

const PROJECT_STRING_FIELDS = new Set(PROJECT_FIELDS.filter((choice) => choice.kind === 'project').map((choice) => choice.field));

const KEYED_COMMANDS = new Set(['items:show', 'items:start', 'items:takeover', 'items:update', 'items:download', 'switch']);

const LIST_LABELS = new Set(['items:list', 'items:search', 'filters:show']);

function stud(title: string, name: string, confirmation: string | null, view: PanelViewName, contributed = true): PanelAction {
  return { title, args: [name, '--agent'], confirmation, view, contributed };
}

function local(title: string, view: PanelViewName): PanelAction {
  return { title, args: [], confirmation: null, view, contributed: false };
}

const ACTIONS: Readonly<Record<string, PanelAction>> = {
  [SEARCH_WORK_ITEMS_COMMAND]: stud('Search work items', 'items:search', null, 'work-items'),
  [FILTER_ISSUES_COMMAND]: stud('Show filter issues', 'filters:show', null, 'work-items'),
  [LIST_WORK_ITEMS_COMMAND]: stud('List work items', 'items:list', null, 'work-items'),
  [REFRESH_WORK_ITEMS_COMMAND]: stud('Refresh work items', 'items:list', null, 'work-items'),
  [SHOW_WORK_ITEM_COMMAND]: stud('Show Work Item', 'items:show', null, 'row', false),
  [START_COMMAND]: stud('Start work item', 'items:start', 'Start this work item with stud? This creates a branch and can change the work item state.', 'row'),
  [TAKEOVER_COMMAND]: stud('Take over work item', 'items:takeover', 'Take over this work item with stud? This can move the branch to you.', 'row'),
  [UPDATE_WORK_ITEM_COMMAND]: stud('Update work item', 'items:update', 'Update this work item with stud? This writes the fields you confirm.', 'row'),
  [DOWNLOAD_COMMAND]: stud('Download work item', 'items:download', null, 'row'),
  [SWITCH_COMMAND]: stud('Switch branch', 'switch', 'Switch with stud? This checks out a branch for the work item.', 'row'),
  [RENAME_BRANCH_COMMAND]: stud('Rename branch', 'branch:rename', 'Rename the branch with stud? This changes the branch name.', 'row'),
  [FLATTEN_COMMAND]: stud('Flatten', 'flatten', 'Flatten with stud? This rebases the branch to squash fixup commits and rewrites history.', 'git'),
  [SYNC_COMMAND]: stud('Sync', 'sync', SYNC_CONFIRMATION, 'git', false),
  [COMMIT_COMMAND]: stud('Commit', 'commit', COMMIT_CONFIRMATION, 'git', false),
  [UNDO_COMMAND]: stud('Undo commit', 'commit:undo', 'Undo the last commit with stud? Stud decides how that commit is removed.', 'git'),
  [PUSH_COMMAND]: stud('Push', 'push', PUSH_CONFIRMATION, 'git', false),
  [SUBMIT_COMMAND]: stud('Submit', 'submit', SUBMIT_CONFIRMATION, 'git', false),
  [PLEASE_COMMAND]: stud('Safe force-push', 'please', 'Force-push with stud? Stud uses a safe force-with-lease when it updates the remote.', 'git'),
  [BRANCHES_LIST_COMMAND]: stud('List branches', 'branches:list', null, 'git'),
  [BRANCHES_CLEAN_COMMAND]: stud('Clean merged branches', 'branches:clean', 'Clean merged branches with stud? This deletes local branches that are already merged.', 'git'),
  [SHOW_PULL_REQUEST_COMMENTS_COMMAND]: stud('Show Pull Request Comments', 'pr:comments', null, 'git', false),
  [COMMENT_COMMAND]: stud('Comment on pull request', 'pr:comment', 'Comment with stud? This posts the text you confirm to the pull request.', 'git'),
  [SHOW_CONFIG_COMMAND]: stud('Show Config', 'config:show', null, 'config', false),
  [VALIDATE_CONFIG_COMMAND]: stud('Validate Config', 'config:validate', null, 'config', false),
  [PROJECT_FIELD_COMMAND]: stud('Set project field', 'config:project-init', 'Save this project setting with stud? Only the one field you entered is sent.', 'config'),
  [STATUS_COMMAND]: stud('Show status', 'status', null, 'config'),
  [CHECK_VERSION_COMMAND]: local('Check Version', 'config'),
  [VALIDATE_COMMAND]: local('Validate stud', 'config'),
  [OPEN_GLOBAL_CONFIG_COMMAND]: local('Open Global Config', 'config'),
  [OPEN_PROJECT_CONFIG_COMMAND]: local('Open Project Config', 'config'),
  [REVEAL_CONFIG_LOCATIONS_COMMAND]: local('Reveal Config Locations', 'config'),
  [CREATE_WORK_ITEM_COMMAND]: stud('Create work item', 'items:create', 'Create a work item with stud? This opens a new issue in the tracker.', 'config'),
  [PROJECTS_COMMAND]: stud('List projects', 'projects:list', null, 'config'),
  [WORKFLOW_COMMAND]: stud('Show project workflow', 'projects:workflow', null, 'config'),
  [LABELS_COMMAND]: stud('Show project labels', 'projects:labels', null, 'config'),
  [FILTERS_COMMAND]: stud('List filters', 'filters:list', null, 'config'),
  [CONFLUENCE_SHOW_COMMAND]: stud('Show Confluence page', 'confluence:show', null, 'config'),
  [CONFLUENCE_LABELS_COMMAND]: stud('Show Confluence page labels', 'confluence:page-labels', null, 'config'),
};

function buttonsFor(view: PanelViewName): readonly PanelButton[] {
  return Object.entries(ACTIONS)
    .filter(([, action]) => action.view === view)
    .map(([command, action]) => ({ command, title: action.title }));
}

export function planPanelAction(commandId: string): PanelPlan {
  const action = ACTIONS[commandId.trim()];
  if (action === undefined) {
    return { kind: 'rejected', summary: 'That action is not a stud panel action.' };
  }
  return { kind: 'run', label: action.args[0] ?? commandId.trim(), args: action.args, confirmation: action.confirmation };
}

export function contributedPanelCommands(): readonly PanelButton[] {
  return Object.entries(ACTIONS)
    .filter(([, action]) => action.contributed)
    .map(([command, action]) => ({ command, title: action.title }));
}

export function panelButtons(view: string): readonly PanelButton[] {
  if (view !== 'work-items' && view !== 'git' && view !== 'config') {
    return [];
  }
  return buttonsFor(view);
}

export function rowCommands(): readonly string[] {
  return buttonsFor('row').map((button) => button.command);
}

export function panelStdinMode(commandId: string): PanelStdinMode {
  const id = commandId.trim();
  if (id === REFRESH_WORK_ITEMS_COMMAND) {
    return 'empty';
  }
  if (id === PROJECT_FIELD_COMMAND) {
    return 'project-field';
  }
  return 'help';
}

export function fillsWorkItemList(label: string): boolean {
  return LIST_LABELS.has(label.trim());
}

export function showsWorkItemRows(stdout: string): boolean {
  return readIssues(stdout) !== undefined;
}

export function projectFieldChoices(): readonly ProjectFieldChoice[] {
  return PROJECT_FIELDS;
}

export function projectFieldIsSecret(field: string): boolean {
  return field.trim() === 'githubToken' || field.trim() === 'gitlabToken';
}

export function redactSecret(text: string, secret: string): string {
  const value = secret.trim();
  if (value === '') {
    return text;
  }
  return text.split(value).join('[redacted]');
}

export function planProjectFieldStdin(input: { readonly field: string; readonly value: string }): ProjectFieldPlan {
  const field = input.field.trim();
  const value = input.value.trim();
  if (!PROJECT_STRING_FIELDS.has(field) || value === '') {
    return { kind: 'stop', summary: 'Enter one project setting. The extension does not write config files itself.' };
  }
  return { kind: 'stdin', stdin: JSON.stringify({ [field]: value }) };
}

export function refuseBlankWorkItemKey(input: {
  readonly command: string;
  readonly fields: Readonly<Record<string, string | null>>;
}): BlankKeyPlan {
  const command = input.command.trim();
  if (command === 'branch:rename') {
    return renameReady(input.fields);
  }
  if (!KEYED_COMMANDS.has(command)) {
    return { kind: 'ok' };
  }
  const key = fieldText(input.fields.key) || fieldText(input.fields.issueKey);
  if (key === '') {
    return { kind: 'stop', summary: 'Enter a work item key. The extension does not choose an issue tracker.' };
  }
  return { kind: 'ok' };
}

export function presetForStep(stepName: string, fields: Readonly<Record<string, string | null>>): string | undefined {
  const direct = fieldText(fields[stepName.trim()]);
  if (direct !== '') {
    return direct;
  }
  if (stepName.trim() === 'issueKey') {
    const key = fieldText(fields.key);
    return key === '' ? undefined : key;
  }
  return undefined;
}

export function readPanelInvocation(value: unknown): PanelInvocation {
  if (typeof value !== 'object' || value === null) {
    return { fromPanel: false, key: undefined };
  }
  const record = value as { readonly panel?: unknown; readonly key?: unknown };
  const key = typeof record.key === 'string' && record.key.trim() !== '' ? record.key.trim() : undefined;
  if (record.panel === true || key !== undefined) {
    return { fromPanel: true, key };
  }
  return { fromPanel: false, key: undefined };
}

export function workItemRows(stdout: string): WorkItemRows {
  const issues = readIssues(stdout);
  if (issues === undefined) {
    return { kind: 'empty' };
  }
  const rows = issues.flatMap((issue) => {
    const row = toRow(issue);
    return row === undefined ? [] : [row];
  });
  return rows.length === 0 ? { kind: 'empty' } : { kind: 'rows', rows };
}

export function switchMatchSummary(stdout: string): SwitchMatchSummary {
  const data = readData(stdout);
  if (data === undefined || data.needsSelection !== true) {
    return { kind: 'done' };
  }
  const matches = Array.isArray(data.matches)
    ? data.matches.filter((match): match is string => typeof match === 'string' && match.trim() !== '')
    : [];
  const listed = matches.length === 0 ? 'none' : matches.join(', ');
  return { kind: 'choose', summary: `Several branches match this work item key: ${listed}. The extension does not pick one.` };
}

function renameReady(fields: Readonly<Record<string, string | null>>): BlankKeyPlan {
  if (fieldText(fields.branch) !== '' || fieldText(fields.key) !== '' || fieldText(fields.explicitName) !== '') {
    return { kind: 'ok' };
  }
  return { kind: 'stop', summary: 'Enter a work item key, branch, or explicit name.' };
}

function fieldText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function readIssues(stdout: string): readonly unknown[] | undefined {
  const data = readData(stdout);
  if (data === undefined || !Array.isArray(data.issues)) {
    return undefined;
  }
  return data.issues;
}

function readData(stdout: string): { readonly issues?: unknown; readonly needsSelection?: unknown; readonly matches?: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null || !('data' in parsed)) {
      return undefined;
    }
    const data = (parsed as { readonly data?: unknown }).data;
    if (typeof data !== 'object' || data === null) {
      return undefined;
    }
    return data as { readonly issues?: unknown; readonly needsSelection?: unknown; readonly matches?: unknown };
  } catch {
    return undefined;
  }
}

function toRow(value: unknown): WorkItemRow | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as { readonly key?: unknown; readonly title?: unknown; readonly status?: unknown };
  if (typeof record.key !== 'string' || typeof record.title !== 'string' || typeof record.status !== 'string') {
    return undefined;
  }
  const key = record.key.trim();
  if (key === '') {
    return undefined;
  }
  return { key, title: record.title, status: record.status };
}
