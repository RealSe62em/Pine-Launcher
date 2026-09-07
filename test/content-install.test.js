'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { beginContentInstall, queueContentInstall, applyContentInstalls } = require('../lib/content-install');
const instance = { gameVersion: '1.21.1', loader: 'fabric' };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'mods'));
  fs.writeFileSync(path.join(root, 'mods', 'old.jar'), 'original mod');
  return root;
}
function queue(root, filename = 'new.jar') {
  const staging = beginContentInstall(root);
  fs.mkdirSync(path.join(staging, 'mods'));
  fs.writeFileSync(path.join(staging, 'mods', filename), 'verified new mod');
  return queueContentInstall(root, staging, { ...instance, files: [`mods/${filename}`], disableFiles: ['mods/old.jar'], metadata: { 'mods_meta.json': { [filename]: { installedVersion: 'abc' } } } });
}

test('running-game downloads leave live files untouched and persist until the next launch', t => {
  const root = fixture(t);
  queue(root);
  assert.equal(fs.readFileSync(path.join(root, 'mods/old.jar'), 'utf8'), 'original mod');
  assert.equal(fs.existsSync(path.join(root, 'mods/new.jar')), false);
  // No in-memory transaction state is needed after a launcher restart.
  assert.equal(applyContentInstalls(root, instance), 1);
  assert.equal(fs.readFileSync(path.join(root, 'mods/new.jar'), 'utf8'), 'verified new mod');
  assert.equal(fs.existsSync(path.join(root, 'mods/old.jar.disabled')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mods_meta.json')))['new.jar'].installedVersion, 'abc');
  assert.equal(applyContentInstalls(root, instance), 0);
});

test('failed metadata commits roll back files and retain the queued installation for retry', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'content_meta.json'), '{broken');
  queue(root);
  assert.throws(() => applyContentInstalls(root, instance), SyntaxError);
  assert.equal(fs.existsSync(path.join(root, 'mods/new.jar')), false);
  assert.equal(fs.readFileSync(path.join(root, 'mods/old.jar'), 'utf8'), 'original mod');
  fs.writeFileSync(path.join(root, 'content_meta.json'), '{}');
  assert.equal(applyContentInstalls(root, instance), 1);
});

test('reinstalling the same filename leaves it enabled and replaces it as one transaction', t => {
  const root = fixture(t);
  queue(root, 'old.jar');
  applyContentInstalls(root, instance);
  assert.equal(fs.readFileSync(path.join(root, 'mods/old.jar'), 'utf8'), 'verified new mod');
  assert.equal(fs.existsSync(path.join(root, 'mods/old.jar.disabled')), false);
});

test('damaged queued files and changed loaders block launch without changing live mods', t => {
  const root = fixture(t);
  const ready = queue(root);
  assert.throws(() => applyContentInstalls(root, { ...instance, loader: 'forge' }), /different Minecraft/);
  fs.writeFileSync(path.join(ready, 'mods/new.jar'), 'truncated');
  assert.throws(() => applyContentInstalls(root, instance), /failed verification/);
  assert.equal(fs.readFileSync(path.join(root, 'mods/old.jar'), 'utf8'), 'original mod');
});

test('multiple queued installs merge metadata instead of losing previous entries', t => {
  const root = fixture(t);
  queue(root, 'one.jar');
  queue(root, 'two.jar');
  assert.equal(applyContentInstalls(root, instance), 2);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'mods_meta.json')))).sort(), ['one.jar', 'two.jar']);
});
