'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

test('release uses the planned updater-visible version', () => {
  assert.equal(pkg.version, '1.2.3');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
});

test('Windows builds publish GitHub updater metadata and differential packages', () => {
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*RealSe62em/);
  assert.match(builder, /repo:\s*Pine-Launcher/);
  assert.match(builder, /target:\s*nsis/);
  assert.match(pkg.scripts['build:installer:x64'], /--x64/);
  assert.match(pkg.scripts['build:installer:arm64'], /--arm64/);
  assert.match(workflow, /dist-native\/latest\.yml/);
  assert.match(workflow, /dist-native\/latest-arm64\.yml/);
  assert.match(workflow, /PineLauncherSetup-x64\.exe\.blockmap/);
  assert.match(workflow, /PineLauncherSetup-arm64\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml' -Pattern '\^path: PineLauncherSetup-x64\\\.exe\$'/);
  assert.match(workflow, /latest-arm64\.yml' -Pattern '\^path: PineLauncherSetup-arm64\\\.exe\$'/);
});
