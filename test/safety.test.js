const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveSafePath, safeRemoteFilename, safeInstanceName } = require('../lib/safety');

test('resolveSafePath accepts descendants', () => {
  const base = path.resolve('instances');
  assert.equal(resolveSafePath(base, 'Survival', 'mods'), path.join(base, 'Survival', 'mods'));
});

test('resolveSafePath rejects parent and sibling-prefix escapes', () => {
  const base = path.resolve('instances');
  assert.throws(() => resolveSafePath(base, '..', 'outside'));
  assert.throws(() => resolveSafePath(base, '..', 'instances-evil', 'file'));
});

test('safeRemoteFilename rejects paths and Windows metacharacters', () => {
  assert.equal(safeRemoteFilename('sodium-1.0.jar'), 'sodium-1.0.jar');
  assert.throws(() => safeRemoteFilename('../escape.jar'));
  assert.throws(() => safeRemoteFilename('bad:name.jar'));
});

test('instance names are portable across Windows filesystems', () => {
  assert.equal(safeInstanceName('My World'), 'My World');
  for (const name of ['CON', 'aux.txt', 'world.', '.', '..']) {
    assert.throws(() => safeInstanceName(name));
  }
});
