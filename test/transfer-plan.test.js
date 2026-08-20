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
