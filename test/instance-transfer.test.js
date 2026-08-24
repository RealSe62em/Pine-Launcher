'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyInstanceTransactional, createDuplicationFilter, inspectTree } = require('../lib/instance-transfer');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pine-transfer-'));
}

test('duplicates a complete instance transactionally', async t => {
  const root = temporaryRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Original');
  const destination = path.join(root, 'Original Copy');
  fs.mkdirSync(path.join(source, 'saves', 'World One'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.writeFileSync(path.join(source, 'saves', 'World One', 'level.dat'), 'world');
  fs.writeFileSync(path.join(source, 'servers.dat'), 'servers');
  fs.writeFileSync(path.join(source, 'config', 'mod.json'), '{"enabled":true}');

  const result = await copyInstanceTransactional({ source, destination });
  assert.equal(result.files, 3);
  assert.equal(fs.readFileSync(path.join(destination, 'servers.dat'), 'utf8'), 'servers');
  assert.equal(fs.readFileSync(path.join(destination, 'saves', 'World One', 'level.dat'), 'utf8'), 'world');
});

test('refuses links and never leaves a visible partial destination', async t => {
  const root = temporaryRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Original');
  const destination = path.join(root, 'Copy');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(root, 'outside.txt'), 'private');
  try {
    fs.symlinkSync(path.join(root, 'outside.txt'), path.join(source, 'linked.txt'));
  } catch {
    return;
  }
  assert.throws(() => inspectTree(source), /filesystem link/);
  await assert.rejects(copyInstanceTransactional({ source, destination }), /filesystem link/);
  assert.equal(fs.existsSync(destination), false);
});

test('selective duplication keeps requested content and starts with fresh activity', () => {
  const include = createDuplicationFilter({ worlds: true, mods: false, settings: true, servers: false, screenshots: false, resourcepacks: true, shaderpacks: false });
  assert.equal(include(path.join('saves', 'My World', 'level.dat')), true);
  assert.equal(include(path.join('mods', 'example.jar')), false);
  assert.equal(include(path.join('config', 'example.toml')), false);
  assert.equal(include('options.txt'), true);
  assert.equal(include('servers.dat'), false);
  assert.equal(include(path.join('resourcepacks', 'pretty.zip')), true);
  assert.equal(include('.pine-activity.json'), false);
  assert.equal(include(path.join('logs', 'latest.log')), false);
});

test('cancelled copies remove staging and never publish a destination', async t => {
  const root = temporaryRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Original');
  const destination = path.join(root, 'Copy');
  fs.mkdirSync(source);
  for (let index = 0; index < 12; index += 1) fs.writeFileSync(path.join(source, `${index}.bin`), Buffer.alloc(128 * 1024, index));
  const controller = new AbortController();
  await assert.rejects(copyInstanceTransactional({ source, destination, signal: controller.signal, onProgress: () => controller.abort() }), /Transfer cancelled/);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.readdirSync(root).some(name => name.includes('.pine-copy-')), false);
});

test('safe imports skip links and cryptographically verify copied gameplay data', async t => {
  const root = temporaryRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Prism', '.minecraft');
  const destination = path.join(root, 'Pine', 'Imported');
  fs.mkdirSync(path.join(source, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.writeFileSync(path.join(source, 'mods', 'sodium.jar'), 'sodium');
  fs.writeFileSync(path.join(source, 'config', 'sodium-options.json'), '{"clouds":false}');
  try { fs.symlinkSync(path.join(root, 'private'), path.join(source, 'outside-link')); } catch {}
  const result = await copyInstanceTransactional({ source, destination, skipSymlinks: true, verifyContents: true });
  assert.equal(result.files, 2);
  assert.equal(fs.readFileSync(path.join(destination, 'config', 'sodium-options.json'), 'utf8'), '{"clouds":false}');
  assert.equal(fs.existsSync(path.join(destination, 'outside-link')), false);
});
