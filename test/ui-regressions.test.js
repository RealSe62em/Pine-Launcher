'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const renderer = read('renderer/script.js');
const html = read('renderer/index.html');
const styles = read('renderer/style.css');
const components = read('renderer/styles/components.css');
const preload = read('preload.js');
const main = read('main.js');

test('custom install location keeps browse controls visually separate from the path field', () => {
  assert.match(html, /class="instance-location-actions"/);
  assert.match(styles, /\.instance-location-row\s*\{[^}]*gap:\s*14px/s);
});

test('loader selection retries failures and requests versions when a profile changes', () => {
  assert.match(renderer, /Could not load — click to retry/);
  assert.match(renderer, /function selectProfile[\s\S]*?loadLoaderVersions\(\);\s*\n\}/);
  assert.match(renderer, /selectedIdx = stableIdx >= 0 \? stableIdx : 0/);
  assert.match(main, /const loaderVersionCache = new Map\(\)/);
});

test('performance preset excludes SmoothBoot and Indium', () => {
  const preset = renderer.match(/const PERFORMANCE_MODS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(preset, /smoothboot/i);
  assert.doesNotMatch(preset, /indium/i);
});

test('missing account errors reopen the account chooser with a detailed fallback', () => {
  assert.match(renderer, /isAccountRequiredError/);
  assert.match(renderer, /openAccountRequiredModal\(name\)/);
  assert.match(renderer, /toast\('Launch failed: ' \+ message/);
});

test('instance folder provides themed open and verified copy actions', () => {
  assert.match(html, /id="edit-open-folder"[\s\S]*?<svg/);
  assert.match(components, /#edit-open-folder\s*\{\s*margin-left:\s*auto/);
  assert.match(preload, /openInstanceFolder/);
  assert.match(main, /ipcMain\.handle\('open-instance-folder'/);
  assert.match(main, /clipboard\.readText\('clipboard'\)/);
});

test('updates section hides the unrelated settings save button', () => {
  assert.match(renderer, /syncSettingsHeaderSave\(btn\.dataset\.cat\)/);
  assert.match(renderer, /headerSave\.hidden = category === 'updates'/);
});
