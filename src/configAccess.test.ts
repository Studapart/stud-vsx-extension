import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  OPEN_GLOBAL_CONFIG_COMMAND,
  OPEN_PROJECT_CONFIG_COMMAND,
  REVEAL_CONFIG_LOCATIONS_COMMAND,
  classifyAccess,
  describeConfigLocations,
  describeUnreadable,
  globalConfigPath,
  planGlobalOpen,
  planProjectOpen,
  projectConfigPath,
  selectWorkspace,
} from './configAccess';

test('global and project config paths follow the stud-cli locations', () => {
  assert.equal(globalConfigPath('/home/dev', '/'), '/home/dev/.config/stud/config.yml');
  assert.equal(globalConfigPath('/home/dev/', '/'), '/home/dev/.config/stud/config.yml');
  assert.equal(globalConfigPath('C:\\Users\\dev\\', '\\'), 'C:\\Users\\dev\\.config\\stud\\config.yml');
  assert.equal(globalConfigPath('C:', '\\'), 'C:\\.config\\stud\\config.yml');
  assert.equal(projectConfigPath('/work/repo', '/'), '/work/repo/.git/stud.config');
  assert.equal(projectConfigPath('D:\\repo', '\\'), 'D:\\repo\\.git\\stud.config');
});

test('a blank home or workspace does not invent a config path', () => {
  for (const homeDir of ['', '   ', undefined, null]) {
    const plan = planGlobalOpen({ homeDir, separator: '/', presence: 'present' });
    assert.equal(plan.kind, 'missing');
    assert.equal(plan.path, '');
    assert.match(plan.summary, /home directory/i);
  }
  for (const workspaceDir of ['', '   ', undefined, null]) {
    const plan = planProjectOpen({ workspaceDir, separator: '/', presence: 'present' });
    assert.equal(plan.kind, 'missing');
    assert.match(plan.summary, /workspace/i);
  }
});

test('an existing config opens and a missing config points at the CLI', () => {
  const present = planGlobalOpen({ homeDir: '/home/dev', separator: '/', presence: 'present' });
  assert.equal(present.kind, 'open');
  assert.equal(present.path, '/home/dev/.config/stud/config.yml');

  const missingGlobal = planGlobalOpen({ homeDir: '/home/dev', separator: '/', presence: 'missing' });
  assert.equal(missingGlobal.kind, 'missing');
  assert.match(missingGlobal.summary, /stud init/);
  assert.doesNotMatch(missingGlobal.summary, /token|secret|password/i);

  const presentProject = planProjectOpen({ workspaceDir: '/work/repo', separator: '/', presence: 'present' });
  assert.equal(presentProject.kind, 'open');
  assert.equal(presentProject.path, '/work/repo/.git/stud.config');

  const missingProject = planProjectOpen({ workspaceDir: '/work/repo', separator: '/', presence: 'missing' });
  assert.equal(missingProject.kind, 'missing');
  assert.match(missingProject.summary, /config:project-init/);
  assert.match(missingProject.summary, /does not write config/);
});

test('workspace selection handles none, one, and several folders', () => {
  const none = selectWorkspace(['', '  ', undefined, null]);
  assert.equal(none.kind, 'none');
  assert.match(none.kind === 'none' ? none.summary : '', /workspace/i);

  const one = selectWorkspace([' /work/repo ', '/work/repo']);
  assert.deepEqual(one, { kind: 'one', folder: '/work/repo' });

  const many = selectWorkspace(['/work/a', '/work/b']);
  assert.equal(many.kind, 'many');
  assert.deepEqual(many.kind === 'many' ? many.folders : [], ['/work/a', '/work/b']);
});

test('access errors stay distinct from a missing config file', () => {
  assert.deepEqual(classifyAccess('ENOENT'), { kind: 'missing' });
  assert.deepEqual(classifyAccess('ENOTDIR'), { kind: 'missing' });
  assert.deepEqual(classifyAccess(undefined), { kind: 'unreadable', code: 'unknown' });
  assert.equal(classifyAccess('EACCES').kind, 'unreadable');
  const described = describeUnreadable('/home/dev/.config/stud/config.yml', 'EACCES');
  assert.match(described.summary, /could not check/i);
  assert.match(described.detail, /EACCES/);
  assert.doesNotMatch(described.detail, /stud init|config:project-init/);
});

test('location text lists paths and guidance without config contents', () => {
  const described = describeConfigLocations({
    workspaceOpen: true,
    locations: [
      { role: 'global', path: '/home/dev/.config/stud/config.yml', presence: 'missing' },
      { role: 'project', path: '/work/repo/.git/stud.config', presence: 'present' },
      { role: 'project', path: '/work/other/.git/stud.config', presence: 'unreadable' },
    ],
  });
  assert.match(described.summary, /not shown/);
  assert.match(described.detail, /global: \/home\/dev\/\.config\/stud\/config\.yml \(missing\)/);
  assert.match(described.detail, /stud init/);
  assert.match(described.detail, /project: \/work\/repo\/\.git\/stud\.config \(present\)/);
  assert.match(described.detail, /unreadable/);
  assert.doesNotMatch(described.detail, /unreadable.*stud init/);
  assert.doesNotMatch(described.detail, /API_TOKEN|secret|password|[A-Z][A-Z0-9_]+:/);

  const closed = describeConfigLocations({ workspaceOpen: false, locations: [] });
  assert.match(closed.detail, /no workspace folder is open/i);
});

test('manifest exposes the config access commands', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: { commands: Array<{ command: string; category: string }> };
  };
  const commands = manifest.contributes.commands.map((command) => command.command);
  assert.ok(commands.includes(OPEN_GLOBAL_CONFIG_COMMAND));
  assert.ok(commands.includes(OPEN_PROJECT_CONFIG_COMMAND));
  assert.ok(commands.includes(REVEAL_CONFIG_LOCATIONS_COMMAND));
  assert.ok(manifest.activationEvents.includes(`onCommand:${OPEN_GLOBAL_CONFIG_COMMAND}`));
  assert.ok(manifest.activationEvents.includes(`onCommand:${OPEN_PROJECT_CONFIG_COMMAND}`));
  assert.ok(manifest.activationEvents.includes(`onCommand:${REVEAL_CONFIG_LOCATIONS_COMMAND}`));
  assert.ok(manifest.contributes.commands.every((command) => command.category === 'stud'));
});
