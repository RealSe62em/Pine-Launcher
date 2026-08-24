'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildTransferPlan, categoryFor, createTransferInclude, transferPlanSummary } = require('../lib/transfer-plan');

test('normalized transfer plans classify categories and exclude account data on any host path style', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'saves', 'World'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(root, 'saves', 'World', 'level.dat'), 'world');
  fs.writeFileSync(path.join(root, 'mods', 'example.jar'), 'mod');
  fs.writeFileSync(path.join(root, 'options.txt'), 'fov:0.5');
  fs.writeFileSync(path.join(root, 'launcher_accounts.json'), '{"accessToken":"secret"}');
  const plan = buildTransferPlan({ source: root, selection: { mods: false } });
  const summary = transferPlanSummary(plan);
  assert.equal(summary.categories.worlds.files, 1);
  assert.equal(summary.categories.mods.files, 1);
  assert.equal(summary.categories.mods.selected, false);
  assert.equal(summary.rejectedCount, 1);
  assert.equal(plan.files.some(file => file.path === 'launcher_accounts.json'), false);
  assert.match(summary.fingerprint, /^[a-f0-9]{64}$/);
});

test('transfer category filters use portable relative paths', () => {
  assert.equal(categoryFor('resourcepacks/pack.zip'), 'resourcepacks');
  assert.equal(categoryFor(path.join('saves', 'World', 'datapacks', 'pack.zip')), 'worlds');
  const include = createTransferInclude({ screenshots: false, mods: true });
  assert.equal(include(path.join('mods', 'example.jar')), true);
  assert.equal(include(path.join('screenshots', 'shot.png')), false);
  assert.equal(include('auth.json'), false);
});

test('launcher imports select complete gameplay state by default', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-complete-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['mods', 'config', 'defaultconfigs', 'saves/World', 'resourcepacks', 'shaderpacks']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'sodium.jar'), 'mod');
  fs.writeFileSync(path.join(root, 'config', 'sodium-options.json'), '{"quality":"high"}');
  fs.writeFileSync(path.join(root, 'options.txt'), 'key_key.jump:key.keyboard.space');
  fs.writeFileSync(path.join(root, 'servers.dat'), 'servers');
  fs.writeFileSync(path.join(root, 'saves', 'World', 'level.dat'), 'world');
  fs.writeFileSync(path.join(root, 'custom-mod-state.json'), 'custom');
  const summary = transferPlanSummary(buildTransferPlan({ source: root }));
  for (const category of ['mods', 'configuration', 'settings', 'servers', 'worlds', 'custom']) {
    assert.equal(summary.categories[category].selected, true, `${category} should be selected`);
  }
  assert.equal(summary.totalFiles, 6);
});

test('source fingerprints change when previewed files are modified', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-fingerprint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = path.join(root, 'options.txt');
  fs.writeFileSync(options, 'first');
  const before = buildTransferPlan({ source: root }).fingerprint;
  fs.writeFileSync(options, 'a different size');
  const after = buildTransferPlan({ source: root }).fingerprint;
  assert.notEqual(after, before);
});
