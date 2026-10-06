import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  LATEST_RELEASE_URL,
  UPDATE_ARGS,
  allowedDownloadUrl,
  classifyLink,
  macosQuarantineNotice,
  matchChecksum,
  parseReleaseTag,
  releaseAssetUrls,
  versionDirectory,
  type Artifact,
} from './portableInstall';

const exec = promisify(execFile);
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_ARCHIVE_BYTES = 120_000_000;
const MAX_TEXT_BYTES = 1_048_576;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type RunnerResult = { readonly ok: boolean; readonly summary: string; readonly detail: string };
type Download = { readonly kind: 'bytes'; readonly bytes: Buffer } | { readonly kind: 'error'; readonly summary: string };
type Locations = { readonly root: string; readonly bin: string };

export function installPortable(input: {
  readonly artifact: Artifact;
  readonly separator: string;
  readonly locations: Locations;
}): Promise<RunnerResult> {
  return mkdtemp(join(tmpdir(), 'stud-portable-')).then((temp) => installIn(temp, input)
    .finally(() => rm(temp, { recursive: true, force: true }).catch(() => undefined)))
    .catch((error: unknown) => processFailure(error, 'Portable install failed.'));
}

export function updatePortable(binPath: string): Promise<RunnerResult> {
  return exec(binPath, [...UPDATE_ARGS], { windowsHide: true, timeout: 90_000, encoding: 'utf8' }).then(
    (result) => ({ ok: true, summary: 'Portable stud update finished.', detail: textOf(result.stdout, result.stderr) }),
    (error: unknown) => processFailure(error, 'stud update failed.'),
  );
}

export function resolvePortableRoot(root: string): Promise<string> {
  if (root.trim() === '') {
    return Promise.resolve('');
  }
  return realpath(root).catch(() => root);
}

function installIn(temp: string, input: { readonly artifact: Artifact; readonly separator: string; readonly locations: Locations }): Promise<RunnerResult> {
  return download(LATEST_RELEASE_URL, MAX_TEXT_BYTES).then((release) => {
    if (release.kind === 'error') {
      return refused(release.summary);
    }
    const parsed = parseReleaseTag(release.bytes.toString('utf8'));
    return parsed.kind === 'error' ? refused(parsed.summary) : downloadBundle(temp, input, parsed.version);
  });
}

function downloadBundle(
  temp: string,
  input: { readonly artifact: Artifact; readonly separator: string; readonly locations: Locations },
  version: string,
): Promise<RunnerResult> {
  const assets = releaseAssetUrls(version, input.artifact);
  const archivePath = join(temp, assets.archiveName);
  return download(assets.archiveUrl, MAX_ARCHIVE_BYTES).then((archive) => {
    if (archive.kind === 'error') {
      return refused(archive.summary);
    }
    return download(assets.checksumUrl, MAX_TEXT_BYTES).then((checksum) => {
      if (checksum.kind === 'error') {
        return refused(checksum.summary);
      }
      const checked = matchChecksum(checksum.bytes.toString('utf8'), assets.archiveName, createHash('sha256').update(archive.bytes).digest('hex'));
      if (checked.kind !== 'ok') {
        return refused(checked.summary);
      }
      return writeFile(archivePath, archive.bytes).then(() => extractAndInstall(temp, archivePath, input, version));
    });
  });
}

function extractAndInstall(
  temp: string,
  archivePath: string,
  input: { readonly artifact: Artifact; readonly separator: string; readonly locations: Locations },
  version: string,
): Promise<RunnerResult> {
  const extracted = join(temp, archivePath.slice(archivePath.lastIndexOf(input.separator) + 1).replace(/\.tar\.gz$/, ''));
  return exec('tar', ['-xzf', archivePath, '-C', temp], { windowsHide: true, timeout: 60_000 }).then(
    () => smokeAndMove(extracted, input, version),
    (error: unknown) => processFailure(error, commandMessage(error, 'tar is required to extract portable stud.')),
  );
}

function smokeAndMove(
  extracted: string,
  input: { readonly artifact: Artifact; readonly separator: string; readonly locations: Locations },
  version: string,
): Promise<RunnerResult> {
  const launcher = join(extracted, 'stud');
  return regularExecutable(launcher).then((executable) => {
    if (!executable) {
      return refused('The archive did not contain an executable stud launcher.');
    }
    return exec(launcher, ['--version'], { windowsHide: true, timeout: 10_000 }).then(
      () => moveBundle(extracted, input, version),
      (error: unknown) => processFailure(error, 'The downloaded stud launcher did not run.'),
    );
  });
}

function moveBundle(
  extracted: string,
  input: { readonly artifact: Artifact; readonly separator: string; readonly locations: Locations },
  version: string,
): Promise<RunnerResult> {
  const versionRoot = versionDirectory(input.locations.root, input.artifact, version, input.separator);
  const parent = join(versionRoot, '..');
  const staging = join(parent, `.incoming-${version}`);
  const previous = join(parent, `.previous-${version}`);
  return linkIsReplaceable(input.locations.bin, input.locations.root, input.separator).then((replaceable) => {
    if (!replaceable) {
      return refused('~/.local/bin/stud changed during the download and was left unchanged.');
    }
    return mkdir(parent, { recursive: true })
      .then(() => rm(staging, { recursive: true, force: true }))
      .then(() => placeOnSameDevice(extracted, staging))
      .then(() => publishTree(staging, versionRoot, previous, input.locations.bin))
      .then(() => installed(input.artifact, version));
  });
}

function publishTree(staging: string, versionRoot: string, previous: string, binPath: string): Promise<void> {
  return moveAside(versionRoot, previous)
    .then(() => rename(staging, versionRoot).catch((error: unknown) => rm(staging, { recursive: true, force: true })
      .then(() => rename(previous, versionRoot).catch(ignoreMissing))
      .then(() => {
        throw error;
      })))
    .then(() => pointBin(binPath, join(versionRoot, 'stud')))
    .then(() => rm(previous, { recursive: true, force: true }));
}

function placeOnSameDevice(source: string, destination: string): Promise<void> {
  return rename(source, destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    return cp(source, destination, { recursive: true, verbatimSymlinks: true });
  });
}

function moveAside(from: string, to: string): Promise<void> {
  return rm(to, { recursive: true, force: true }).then(() => rename(from, to).catch(ignoreMissing));
}

function regularExecutable(path: string): Promise<boolean> {
  return lstat(path).then(
    (info) => info.isFile() ? access(path, constants.X_OK).then(() => true, () => false) : false,
    () => false,
  );
}

function installed(artifact: Artifact, version: string): RunnerResult {
  const summary = `Portable stud ${version} is linked at ~/.local/bin/stud.`;
  if (artifact !== 'darwin-arm64') {
    return { ok: true, summary, detail: summary };
  }
  const notice = macosQuarantineNotice(version);
  return { ok: true, summary: `${summary} ${notice}`, detail: `${summary}\n${notice}` };
}

function linkIsReplaceable(binPath: string, portableRoot: string, separator: string): Promise<boolean> {
  return lstat(binPath).then(
    (info) => {
      if (!info.isSymbolicLink()) {
        return false;
      }
      return resolvePortableRoot(portableRoot).then((root) => realpath(binPath).then(
        (target) => classifyLink({ exists: true, isSymlink: true, resolvedTarget: target, portableRoot: root, separator }) === 'managed',
        () => false,
      ));
    },
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
}

function pointBin(binPath: string, target: string): Promise<void> {
  const temporary = `${binPath}.new`;
  return mkdir(join(binPath, '..'), { recursive: true })
    .then(() => unlink(temporary).catch(ignoreMissing))
    .then(() => symlink(target, temporary))
    .then(() => rename(temporary, binPath));
}

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

function download(url: string, maxBytes: number): Promise<Download> {
  if (!allowedDownloadUrl(url)) {
    return Promise.resolve({ kind: 'error', summary: 'The download URL is not an allowed stud release URL.' });
  }
  return follow(url, maxBytes, 0);
}

function follow(url: string, maxBytes: number, hop: number): Promise<Download> {
  if (hop > 4) {
    return Promise.resolve({ kind: 'error', summary: 'The download redirected too many times.' });
  }
  return fetchWithDeadline(url).then(
    (response) => readDownload(response, url, maxBytes, hop),
    (error: unknown) => ({ kind: 'error', summary: downloadFailure(error) }),
  );
}

function fetchWithDeadline(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  return fetch(url, { redirect: 'manual', signal: controller.signal }).finally(() => clearTimeout(timer));
}

function downloadFailure(error: unknown): string {
  const name = (error as { readonly name?: string }).name;
  return name === 'AbortError' ? 'The download timed out.' : 'The download failed before a response.';
}

function readDownload(response: Response, url: string, maxBytes: number, hop: number): Promise<Download> {
  if (REDIRECT.has(response.status)) {
    const next = nextUrl(url, response.headers.get('location'));
    return next === null
      ? Promise.resolve({ kind: 'error', summary: 'The download redirected to a host that is not allowed.' })
      : follow(next, maxBytes, hop + 1);
  }
  if (!response.ok) {
    return Promise.resolve({ kind: 'error', summary: `The download failed (${response.status}).` });
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.resolve({ kind: 'error', summary: 'The download was larger than expected.' });
  }
  return readBody(response, maxBytes);
}

function readBody(response: Response, maxBytes: number): Promise<Download> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return Promise.resolve({ kind: 'error', summary: 'The download had no body.' });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const pump = (): Promise<Download> => reader.read().then(({ done, value }) => {
    if (done) {
      return { kind: 'bytes', bytes: Buffer.concat(chunks, total) };
    }
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      return reader.cancel().then(() => ({ kind: 'error', summary: 'The download was larger than expected.' }));
    }
    chunks.push(chunk);
    return pump();
  });
  return pump();
}

function nextUrl(current: string, location: string | null): string | null {
  if (location === null || location.trim() === '') {
    return null;
  }
  try {
    const next = new URL(location, current).toString();
    return allowedDownloadUrl(next) ? next : null;
  } catch {
    return null;
  }
}

function commandMessage(error: unknown, missing: string): string {
  return (error as NodeJS.ErrnoException).code === 'ENOENT' ? missing : 'Could not extract portable stud.';
}

function processFailure(error: unknown, summary: string): RunnerResult {
  const coded = error as { readonly stdout?: string | Buffer; readonly stderr?: string | Buffer; readonly message?: string };
  const detail = [summary, textOf(coded.stdout ?? '', coded.stderr ?? ''), coded.message ?? ''].filter((part) => part !== '').join('\n');
  return { ok: false, summary, detail };
}

function textOf(stdout: string | Buffer, stderr: string | Buffer): string {
  return [String(stdout).trim(), String(stderr).trim()].filter((part) => part !== '').join('\n');
}

function refused(summary: string): RunnerResult {
  return { ok: false, summary, detail: summary };
}
