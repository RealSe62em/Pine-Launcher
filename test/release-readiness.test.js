'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

test('maintenance release has a newer updater-visible version', () => {
  assert.equal(pkg.version, '1.1.14');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
});

test('Windows builds publish GitHub updater metadata and differential packages', () => {
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*RealSe62em/);
  assert.match(builder, /repo:\s*Pine-Launcher/);
  assert.match(builder, /target:\s*nsis/);
  assert.match(workflow, /dist-native\/latest\.yml/);
  assert.match(workflow, /PineLauncherSetup\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml' -Pattern '\^path: PineLauncherSetup\\\.exe\$'/);
});
