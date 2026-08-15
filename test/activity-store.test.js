'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { listWorlds, rankDestinations, readActivity, recordDestination, removeDestination, sanitizeDestination } = require('../lib/activity-store');

test('records destination frequency without allowing control characters', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-activity-'));
  const file = path.join(root, 'activity.json');
  try {
    recordDestination(file, { type: 'multiplayer', identifier: 'play.example.com', label: 'Example' }, new Date('2026-01-01'));
    recordDestination(file, { type: 'multiplayer', identifier: 'PLAY.EXAMPLE.COM', label: 'Example' }, new Date('2026-01-02'));
    const value = readActivity(file).destinations;
    assert.equal(value.length, 1);
    assert.equal(value[0].launches, 2);
    assert.equal(sanitizeDestination({ type: 'multiplayer', identifier: 'bad\nserver' }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ranks frequent destinations before equally recent one-offs', () => {
  const ranked = rankDestinations([
    { label: 'Recent', launches: 1, lastUsed: '2026-08-01' },
    { label: 'Frequent', launches: 4, lastUsed: '2026-07-01' },
  ]);
  assert.equal(ranked[0].label, 'Frequent');
});

test('removed destinations stay hidden until they are visited again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-hidden-activity-'));
  const file = path.join(root, 'activity.json');
  const server = { type: 'multiplayer', identifier: 'play.example.com:25565', address: 'play.example.com:25565', label: 'Example' };
  try {
    recordDestination(file, server, new Date('2026-01-01'));
    assert.equal(removeDestination(file, server), true);
    assert.deepEqual(readActivity(file).destinations, []);
    assert.deepEqual(readActivity(file).hiddenKeys, ['server:play.example.com']);
    recordDestination(file, server, new Date('2026-01-02'));
    assert.deepEqual(readActivity(file).hiddenKeys, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reads the real world name and icon without inventing placeholders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-world-metadata-'));
  const world = path.join(root, 'New World');
  const name = Buffer.from('Pine Valley', 'utf8');
  const dataTagName = Buffer.from('Data', 'utf8');
  const levelTagName = Buffer.from('LevelName', 'utf8');
  const nbt = Buffer.concat([
    Buffer.from([10, 0, 0, 10, 0, dataTagName.length]), dataTagName,
    Buffer.from([8, 0, levelTagName.length]), levelTagName,
    Buffer.from([0, name.length]), name,
    Buffer.from([0, 0]),
  ]);
  try {
    fs.mkdirSync(world);
    fs.writeFileSync(path.join(world, 'level.dat'), zlib.gzipSync(nbt));
    fs.writeFileSync(path.join(world, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    const worlds = listWorlds(root);
    assert.equal(worlds.length, 1);
    assert.equal(worlds[0].name, 'Pine Valley');
    assert.match(worlds[0].iconData, /^data:image\/png;base64,/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
