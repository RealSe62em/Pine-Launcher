'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareNeoForgeVersions,
  isNeoForgeVersionForMinecraft,
  isStableNeoForgeVersion,
  minecraftNeoForgeLine,
  validateNeoForgeProfile,
} = require('../lib/neoforge');

test('maps each Minecraft patch to one exact NeoForge release line', () => {
  assert.equal(minecraftNeoForgeLine('1.20.2'), '20.2');
  assert.equal(minecraftNeoForgeLine('1.21'), '21.0');
  assert.equal(minecraftNeoForgeLine('1.21.1'), '21.1');
  assert.equal(minecraftNeoForgeLine('26.1.1'), '26.1');
  assert.equal(isNeoForgeVersionForMinecraft('21.0.167', '1.21'), true);
  assert.equal(isNeoForgeVersionForMinecraft('21.1.167', '1.21'), false);
  assert.equal(isNeoForgeVersionForMinecraft('21.10.12', '1.21.1'), false);
  for (const [minecraft, loader] of [
    ['1.20.2', '20.2.93'], ['1.20.4', '20.4.250'], ['1.21', '21.0.167'], ['1.21.4', '21.4.150'],
    ['1.21.10', '21.10.63'], ['1.21.11', '21.11.12'], ['26.1', '26.1.4'], ['26.1.1', '26.1.4'],
  ]) assert.equal(isNeoForgeVersionForMinecraft(loader, minecraft), true, `${minecraft} -> ${loader}`);
});

test('sorts stable NeoForge versions after previews', () => {
  assert.ok(compareNeoForgeVersions('21.1.200', '21.1.20') > 0);
  assert.ok(compareNeoForgeVersions('21.1.20', '21.1.20-beta') > 0);
  assert.equal(isStableNeoForgeVersion('21.1.20'), true);
  assert.equal(isStableNeoForgeVersion('21.1.20-beta'), false);
  assert.equal(isStableNeoForgeVersion('26.2-pre-1'), false);
});

test('accepts only a complete profile for the requested Minecraft and NeoForge versions', () => {
  const profile = {
    id: 'neoforge-21.1.200', inheritsFrom: '1.21.1', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    arguments: { game: [], jvm: [] }, libraries: [{ name: 'net.neoforged:neoforge:21.1.200' }],
  };
  assert.equal(validateNeoForgeProfile(profile, '1.21.1', '21.1.200').valid, true);
  assert.match(validateNeoForgeProfile(profile, '1.21', '21.0.200').errors.join(' '), /does not inherit|not 21\.0\.200/);
  assert.equal(validateNeoForgeProfile({ ...profile, mainClass: '' }, '1.21.1', '21.1.200').valid, false);
});
