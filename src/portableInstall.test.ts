import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  INSTALL_PORTABLE_COMMAND,
  LATEST_RELEASE_URL,
  UPDATE_ARGS,
  UPDATE_PORTABLE_COMMAND,
  allowedDownloadUrl,
  classifyLink,
  macosQuarantineNotice,
  matchChecksum,
  parseReleaseTag,
  planInstall,
  planUpdate,
  portableLocations,
  releaseAssetUrls,
  versionDirectory,
  type InstallPlan,
} from './portableInstall';

function refusal(plan: InstallPlan): string {
  return plan.kind === 'refuse' ? plan.summary : '';
}

const offer = {
  configuredPath: '',
  searchEnabled: true,
  states: [] as const,
  platform: 'linux',
  arch: 'x64',
  link: 'absent' as const,
};

test('install is offered only when nothing executable is available on a supported host', () => {
  const plan = planInstall(offer);
  assert.equal(plan.kind, 'confirm');
  if (plan.kind === 'confirm') {
    assert.equal(plan.artifact, 'linux-amd64');
    assert.match(plan.confirmation, /linux-amd64/);
  }
  assert.equal(planInstall({ ...offer, platform: 'darwin', arch: 'arm64', states: ['missing'] }).kind, 'confirm');
});

test('blank or conflicting install input refuses before a download', () => {
  assert.equal(planInstall({ ...offer, configuredPath: '   ' }).kind, 'confirm');
  assert.match(refusal(planInstall({ ...offer, configuredPath: '/opt/stud' })), /executablePath/);
  assert.match(refusal(planInstall({ ...offer, searchEnabled: false })), /search/i);
  assert.match(refusal(planInstall({ ...offer, states: ['not-executable', 'executable'] })), /Nothing was installed/);
  assert.match(refusal(planInstall({ ...offer, link: 'blocked' })), /managed/);
  for (const host of [
    { platform: 'win32', arch: 'x64' },
    { platform: 'darwin', arch: 'x64' },
    { platform: 'linux', arch: 'arm64' },
    { platform: '', arch: '' },
  ]) {
    assert.equal(planInstall({ ...offer, ...host }).kind, 'refuse');
  }
});

test('a release tag yields asset urls and rejects blank or unexpected bodies', () => {
  assert.deepEqual(parseReleaseTag('{"tag_name":"v4.1.0","draft":false}'), { kind: 'ok', version: '4.1.0' });
  assert.equal(parseReleaseTag('{"tag_name":"4.1.0"}').kind, 'ok');
  for (const body of ['', '   ', 'not-json', '[]', '{}', '{"tag_name":"latest"}', '{"tag_name":""}']) {
    assert.equal(parseReleaseTag(body).kind, 'error');
  }
  const urls = releaseAssetUrls('4.1.0', 'linux-amd64');
  assert.equal(urls.archiveName, 'stud-portable-4.1.0-linux-amd64.tar.gz');
  assert.match(urls.archiveUrl, /^https:\/\/github\.com\/Studapart\/stud-cli\/releases\/download\/v4\.1\.0\//);
  assert.match(urls.checksumUrl, /\/checksums\.txt$/);
});

test('checksum lines match the archive name and reject a missing or different digest', () => {
  const name = 'stud-portable-4.1.0-linux-amd64.tar.gz';
  const hex = 'a'.repeat(64);
  const file = `ffff  other.tar.gz\n${hex.toUpperCase()}  ${name}\n`;
  assert.equal(matchChecksum(file, name, hex).kind, 'ok');
  assert.equal(matchChecksum('', name, hex).kind, 'missing');
  assert.equal(matchChecksum(file, '', hex).kind, 'missing');
  assert.equal(matchChecksum(file, name, 'b'.repeat(64)).kind, 'mismatch');
  assert.equal(matchChecksum('not a checksum line', name, hex).kind, 'missing');
});

test('update runs only for a managed link and never uses agent mode', () => {
  const run = planUpdate('managed');
  assert.equal(run.kind, 'run');
  if (run.kind === 'run') {
    assert.deepEqual(run.args, UPDATE_ARGS);
    assert.equal(UPDATE_ARGS.join(' ').includes('agent'), false);
  }
  assert.equal(planUpdate('absent').kind, 'refuse');
  assert.equal(planUpdate('blocked').kind, 'refuse');
});

test('link classification and download hosts stay inside the portable tree', () => {
  const locations = portableLocations('/home/dev', '/');
  assert.equal(locations.root, '/home/dev/.local/share/stud-portable');
  assert.equal(locations.bin, '/home/dev/.local/bin/stud');
  assert.equal(portableLocations('  ', '/').root, '');
  assert.equal(versionDirectory(locations.root, 'linux-amd64', '4.1.0', '/'), `${locations.root}/linux-amd64/4.1.0`);
  const managed = {
    exists: true,
    isSymlink: true,
    resolvedTarget: `${locations.root}/linux-amd64/4.1.0/stud`,
    portableRoot: locations.root,
    separator: '/',
  };
  assert.equal(classifyLink(managed), 'managed');
  assert.equal(classifyLink({ ...managed, exists: false, isSymlink: false, resolvedTarget: '' }), 'absent');
  assert.equal(classifyLink({ ...managed, isSymlink: false }), 'blocked');
  assert.equal(classifyLink({ ...managed, resolvedTarget: '/usr/bin/stud' }), 'blocked');
  assert.equal(classifyLink({ ...managed, portableRoot: '' }), 'blocked');
  assert.equal(classifyLink({ ...managed, resolvedTarget: `${locations.root}-other/stud` }), 'blocked');
  assert.equal(planInstall({ ...offer, link: 'managed', states: ['missing'] }).kind, 'confirm');
  assert.equal(allowedDownloadUrl(LATEST_RELEASE_URL), true);
  assert.equal(allowedDownloadUrl('https://api.github.com/repos/other/releases/latest'), false);
  assert.equal(allowedDownloadUrl('https://release-assets.githubusercontent.com/asset'), true);
  assert.equal(allowedDownloadUrl('http://github.com/Studapart/stud-cli'), false);
  assert.equal(allowedDownloadUrl('https://example.com/stud'), false);
  assert.equal(allowedDownloadUrl(''), false);
});

test('macos guidance names the quarantine clear and does not claim the build is signed', () => {
  assert.match(macosQuarantineNotice('4.1.0'), /xattr -dr com\.apple\.quarantine/);
  assert.match(macosQuarantineNotice(''), /darwin-arm64\//);
});

test('manifest exposes the portable install and update commands', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    publisher: string;
    name: string;
    activationEvents: string[];
    contributes: { commands: { command: string }[] };
  };
  const commands = manifest.contributes.commands.map((command) => command.command);
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'studapart.stud');
  assert.equal(commands.includes(INSTALL_PORTABLE_COMMAND), true);
  assert.equal(commands.includes(UPDATE_PORTABLE_COMMAND), true);
  assert.equal(manifest.activationEvents.includes(`onCommand:${INSTALL_PORTABLE_COMMAND}`), true);
  assert.equal(manifest.activationEvents.includes(`onCommand:${UPDATE_PORTABLE_COMMAND}`), true);
});
