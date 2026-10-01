export const OPEN_GLOBAL_CONFIG_COMMAND = 'stud.openGlobalConfig';
export const OPEN_PROJECT_CONFIG_COMMAND = 'stud.openProjectConfig';
export const REVEAL_CONFIG_LOCATIONS_COMMAND = 'stud.revealConfigLocations';
export const WORKSPACE_PICK_CANCELLED = 'No workspace folder was selected.';

const GLOBAL_PARTS = ['.config', 'stud', 'config.yml'] as const;
const PROJECT_PARTS = ['.git', 'stud.config'] as const;

const GLOBAL_INIT_GUIDANCE = 'Create it with stud init. This extension does not write config files.';
const PROJECT_INIT_GUIDANCE = 'Create it with stud config:project-init. This extension does not write config files.';

export type FilePresence = 'present' | 'missing' | 'unreadable';

export type AccessClassification = { readonly kind: 'missing' } | { readonly kind: 'unreadable'; readonly code: string };

export type ConfigFilePlan =
  | { readonly kind: 'open'; readonly path: string; readonly summary: string }
  | { readonly kind: 'missing'; readonly path: string; readonly summary: string };

export function globalConfigPath(homeDir: string, separator: string): string {
  return joinUnder(homeDir, separator, GLOBAL_PARTS);
}

export function projectConfigPath(workspaceDir: string, separator: string): string {
  return joinUnder(workspaceDir, separator, PROJECT_PARTS);
}

export function planGlobalOpen(input: {
  readonly homeDir: string | undefined | null;
  readonly separator: string;
  readonly presence: 'present' | 'missing';
}): ConfigFilePlan {
  const path = globalConfigPath(input.homeDir ?? '', input.separator);
  if (path === '') {
    return { kind: 'missing', path: '', summary: 'Home directory is unavailable, so the global stud config cannot be opened.' };
  }
  return planExistingFile(path, input.presence, 'global');
}

export type WorkspaceSelection =
  | { readonly kind: 'none'; readonly summary: string }
  | { readonly kind: 'one'; readonly folder: string }
  | { readonly kind: 'many'; readonly folders: readonly string[] };

export function selectWorkspace(folders: readonly (string | undefined | null)[]): WorkspaceSelection {
  const usable = [...new Set(folders.map((folder) => folder?.trim() ?? '').filter((folder) => folder !== ''))];
  if (usable.length === 0) {
    return { kind: 'none', summary: 'No workspace folder is open, so the project stud config cannot be opened.' };
  }
  if (usable.length === 1) {
    return { kind: 'one', folder: usable[0] ?? '' };
  }
  return { kind: 'many', folders: usable };
}

export function planProjectOpen(input: {
  readonly workspaceDir: string | undefined | null;
  readonly separator: string;
  readonly presence: 'present' | 'missing';
}): ConfigFilePlan {
  const path = projectConfigPath(input.workspaceDir ?? '', input.separator);
  if (path === '') {
    return { kind: 'missing', path: '', summary: 'No workspace folder is open, so the project stud config cannot be opened.' };
  }
  return planExistingFile(path, input.presence, 'project');
}

export type ConfigLocation = {
  readonly role: 'global' | 'project';
  readonly path: string;
  readonly presence: FilePresence;
};

export function classifyAccess(code: string | undefined): AccessClassification {
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { kind: 'missing' };
  }
  return { kind: 'unreadable', code: code ?? 'unknown' };
}

export function describeUnreadable(path: string, code: string): { readonly summary: string; readonly detail: string } {
  const summary = `Could not check ${path}.`;
  return { summary, detail: `${summary} (${code}). The file was not opened and was not created.` };
}

export function describeConfigLocations(input: {
  readonly locations: readonly ConfigLocation[];
  readonly workspaceOpen: boolean;
}): { readonly summary: string; readonly detail: string } {
  const lines = input.locations.map((location) => {
    if (location.presence === 'unreadable') {
      return `${location.role}: ${location.path} (unreadable). Could not check this path.`;
    }
    const guidance = location.presence === 'missing' ? ` ${guidanceFor(location.role)}` : '';
    return `${location.role}: ${location.path} (${location.presence}).${guidance}`;
  });
  if (!input.workspaceOpen) {
    lines.push('No workspace folder is open, so no project stud config path was resolved.');
  }
  return {
    summary: 'stud config locations are in the output channel. Config contents are not shown.',
    detail: lines.join('\n'),
  };
}

function planExistingFile(path: string, presence: 'present' | 'missing', role: 'global' | 'project'): ConfigFilePlan {
  if (presence === 'missing') {
    return { kind: 'missing', path, summary: `No ${role} stud config at ${path}. ${guidanceFor(role)}` };
  }
  return { kind: 'open', path, summary: `Opening ${role} stud config.` };
}

function guidanceFor(role: 'global' | 'project'): string {
  return role === 'global' ? GLOBAL_INIT_GUIDANCE : PROJECT_INIT_GUIDANCE;
}

function joinUnder(root: string, separator: string, parts: readonly string[]): string {
  let base = root.trim();
  if (base === '') {
    return '';
  }
  if (base.endsWith(separator)) {
    base = base.slice(0, -separator.length);
  }
  if (base === '') {
    base = separator;
  }
  return [base, ...parts].join(separator);
}
