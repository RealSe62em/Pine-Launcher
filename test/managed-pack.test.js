'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  inspectManagedState,
  managedFileRecord,
  normalizePackPath,
  removeManagedFiles,
  snapshotPackMetadata,
} = require('../lib/managed-pack');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-managed-pack-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'saves', 'world'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'managed.jar'), 'managed');
  fs.writeFileSync(path.join(root, 'mods', 'user-added.jar'), 'user');
  fs.writeFileSync(path.join(root, 'saves', 'world', 'level.dat'), 'world');
  return root;
}

test('managed pack ownership distinguishes curated and user-added files', () => {
  const root = fixture();
  try {
    const record = managedFileRecord(root, 'mods/managed.jar');
    const status = inspectManagedState(root, [record]);
    assert.equal(status.healthy, 1);
    assert.deepEqual(status.userAdded, ['mods/user-added.jar']);
    fs.writeFileSync(path.join(root, 'mods', 'managed.jar'), 'changed');
    assert.deepEqual(inspectManagedState(root, [record]).modified, ['mods/managed.jar']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('removing an old managed layer never removes saves or user-added files', () => {
  const root = fixture();
  try {
    const record = managedFileRecord(root, 'mods/managed.jar');
    assert.deepEqual(removeManagedFiles(root, [record]), ['mods/managed.jar']);
    assert.equal(fs.existsSync(path.join(root, 'mods', 'user-added.jar')), true);
    assert.equal(fs.existsSync(path.join(root, 'saves', 'world', 'level.dat')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed paths and history snapshots are safe and non-recursive', () => {
  assert.throws(() => normalizePackPath('../outside.jar'), /unsafe path/);
  const snapshot = snapshotPackMetadata({ source: 'modrinth', installedVersion: '1.0', history: [{ huge: true }], availableVersion: '2.0' });
  assert.deepEqual(snapshot, { source: 'modrinth', installedVersion: '1.0' });
});
