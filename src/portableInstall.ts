import type { CandidateState } from './discovery';

export type { CandidateState };
export const INSTALL_PORTABLE_COMMAND = 'stud.installPortable';
export const UPDATE_PORTABLE_COMMAND = 'stud.updatePortable';
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Studapart/stud-cli/releases/latest';
export const UPDATE_ARGS = ['update', '--quiet'] as const;

const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);
const VERSION = /^\d+\.\d+\.\d+$/;
const CHECKSUM_LINE = /^([0-9a-fA-F]{64}) {2}(\S+)$/;

export type LinkState = 'absent' | 'managed' | 'blocked';
export type Artifact = 'linux-amd64' | 'darwin-arm64';

export type InstallPlan =
  | { readonly kind: 'confirm'; readonly artifact: Artifact; readonly confirmation: string }
  | { readonly kind: 'refuse'; readonly summary: string };

export function portableLocations(homeDir: string, separator: string): { readonly root: string; readonly bin: string } {
  return {
    root: joinUnder(homeDir, separator, ['.local', 'share', 'stud-portable']),
    bin: joinUnder(homeDir, separator, ['.local', 'bin', 'stud']),
  };
}

export function versionDirectory(root: string, artifact: Artifact, version: string, separator: string): string {
  return joinUnder(root, separator, [artifact, version]);
}

export function classifyLink(input: {
  readonly exists: boolean;
  readonly isSymlink: boolean;
  readonly resolvedTarget: string;
  readonly portableRoot: string;
  readonly separator: string;
}): LinkState {
  if (!input.exists) {
    return 'absent';
  }
  const root = input.portableRoot.trim();
  if (!input.isSymlink || root === '') {
    return 'blocked';
  }
  const prefix = root.endsWith(input.separator) ? root : `${root}${input.separator}`;
  if (input.resolvedTarget === root || input.resolvedTarget.startsWith(prefix)) {
    return 'managed';
  }
  return 'blocked';
}

export function planInstall(input: {
  readonly configuredPath: string;
  readonly searchEnabled: boolean;
  readonly states: readonly CandidateState[];
  readonly platform: string;
  readonly arch: string;
  readonly link: LinkState;
}): InstallPlan {
  const refused = installRefusal(input);
  if (refused !== null) {
    return refused;
  }
  const artifact = artifactFor(input.platform, input.arch);
  if (artifact === null) {
    return { kind: 'refuse', summary: 'Portable stud supports Linux x64 and macOS Apple Silicon only.' };
  }
  return {
    kind: 'confirm',
    artifact,
    confirmation: `Install portable stud (${artifact})? It downloads the latest release, checks SHA-256, and links ~/.local/bin/stud.`,
  };
}

export function parseReleaseTag(body: string): { readonly kind: 'ok'; readonly version: string } | { readonly kind: 'error'; readonly summary: string } {
  const tag = readTagName(body);
  if (tag === null) {
    return { kind: 'error', summary: 'The latest release did not include a version.' };
  }
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!VERSION.test(version)) {
    return { kind: 'error', summary: 'The latest release version was not a numeric version.' };
  }
  return { kind: 'ok', version };
}

export function releaseAssetUrls(version: string, artifact: Artifact): {
  readonly archiveName: string;
  readonly archiveUrl: string;
  readonly checksumUrl: string;
} {
  const archiveName = `stud-portable-${version}-${artifact}.tar.gz`;
  const base = `https://github.com/Studapart/stud-cli/releases/download/v${version}`;
  return { archiveName, archiveUrl: `${base}/${archiveName}`, checksumUrl: `${base}/checksums.txt` };
}

export function matchChecksum(
  checksums: string,
  archiveName: string,
  digestHex: string,
): { readonly kind: 'ok' } | { readonly kind: 'missing' | 'mismatch'; readonly summary: string } {
  const line = checksums.split(/\r?\n/).find((entry) => CHECKSUM_LINE.exec(entry)?.[2] === archiveName);
  if (line === undefined) {
    return { kind: 'missing', summary: 'checksums.txt has no line for this archive.' };
  }
  const hex = CHECKSUM_LINE.exec(line)?.[1] ?? '';
  if (hex.toLowerCase() !== digestHex.trim().toLowerCase()) {
    return { kind: 'mismatch', summary: 'The archive checksum does not match checksums.txt.' };
  }
  return { kind: 'ok' };
}

export function planUpdate(link: LinkState): { readonly kind: 'run'; readonly args: typeof UPDATE_ARGS } | { readonly kind: 'refuse'; readonly summary: string } {
  if (link !== 'managed') {
    return { kind: 'refuse', summary: 'Update Portable stud only updates a managed install at ~/.local/bin/stud.' };
  }
  return { kind: 'run', args: UPDATE_ARGS };
}

export function allowedDownloadUrl(url: string): boolean {
  if (url === LATEST_RELEASE_URL) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function macosQuarantineNotice(version: string): string {
  return `macOS may still block this unsigned build. If it does, run xattr -dr com.apple.quarantine on ~/.local/share/stud-portable/darwin-arm64/${version}, then approve it in System Settings.`;
}

function installRefusal(input: {
  readonly configuredPath: string;
  readonly searchEnabled: boolean;
  readonly states: readonly CandidateState[];
  readonly link: LinkState;
}): InstallPlan | null {
  if (input.configuredPath.trim() !== '') {
    return { kind: 'refuse', summary: 'stud.executablePath is set. This install does not replace that path.' };
  }
  if (!input.searchEnabled) {
    return { kind: 'refuse', summary: 'PATH search is off. This install does not run.' };
  }
  if (input.states.includes('executable')) {
    return { kind: 'refuse', summary: 'stud is already available. This extension will use it. Nothing was installed.' };
  }
  if (input.link === 'blocked') {
    return { kind: 'refuse', summary: '~/.local/bin/stud is not a managed portable symlink. This install does not replace it.' };
  }
  return null;
}

function artifactFor(platform: string, arch: string): Artifact | null {
  if (platform === 'linux' && arch === 'x64') {
    return 'linux-amd64';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64';
  }
  return null;
}

function readTagName(body: string): string | null {
  if (body.trim() === '') {
    return null;
  }
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const tag = (value as { readonly tag_name?: unknown }).tag_name;
    return typeof tag === 'string' && tag.trim() !== '' ? tag.trim() : null;
  } catch {
    return null;
  }
}

function joinUnder(root: string, separator: string, parts: readonly string[]): string {
  let base = root.trim();
  if (base === '') {
    return '';
  }
  if (base.endsWith(separator)) {
    base = base.slice(0, -separator.length);
  }
  return [base, ...parts].join(separator);
}
