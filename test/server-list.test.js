'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { readSavedServers, readSavedServersStrict } = require('../lib/discord-presence');
const { addServerToInstance, encodeServersDat, recoverServerListFromBackup } = require('../lib/server-list');

test('adds, preserves, and deduplicates entries in an instance servers.dat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-server-list-'));
  try {
    const first = addServerToInstance(root, { name: 'Example', ip: 'play.example.com' });
    assert.equal(first.added, true);
    assert.deepEqual(readSavedServers(root).map(({ name, ip }) => ({ name, ip })), [{ name: 'Example', ip: 'play.example.com' }]);

    const beforeDuplicate = fs.readFileSync(path.join(root, 'servers.dat'));
    const second = addServerToInstance(root, { name: 'Renamed', ip: 'play.example.com:25565' });
    assert.equal(second.added, false);
    assert.deepEqual(fs.readFileSync(path.join(root, 'servers.dat')), beforeDuplicate);
    assert.deepEqual(readSavedServers(root).map(({ name, ip }) => ({ name, ip })), [{ name: 'Example', ip: 'play.example.com' }]);

    addServerToInstance(root, { name: 'Another', ip: 'mc.example.net:25570' });
    assert.deepEqual(readSavedServers(root).map(({ name, ip }) => ({ name, ip })), [
      { name: 'Example', ip: 'play.example.com' },
      { name: 'Another', ip: 'mc.example.net:25570' },
    ]);
    assert.equal(fs.existsSync(path.join(root, 'servers.dat.pine-backup')), true);
    assert.deepEqual(readSavedServersStrict(root, 'servers.dat.pine-backup').map(({ ip }) => ip), ['play.example.com']);
    assert.equal(fs.readdirSync(path.join(root, '.pine-server-backups')).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to replace an unreadable server list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-server-list-invalid-'));
  try {
    const file = path.join(root, 'servers.dat');
    const original = Buffer.from('not an nbt server list');
    fs.writeFileSync(file, original);
    assert.throws(() => addServerToInstance(root, { name: 'Safe', ip: 'safe.example.net' }), /NBT|server list|servers\.dat/i);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(fs.existsSync(`${file}.pine-backup`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('appends without discarding unknown existing NBT fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-server-list-future-'));
  const nbtString = value => {
    const body = Buffer.from(value);
    const size = Buffer.alloc(2);
    size.writeUInt16BE(body.length);
    return Buffer.concat([size, body]);
  };
  const named = (type, name, payload) => Buffer.concat([Buffer.from([type]), nbtString(name), payload]);
  try {
    const existingCompound = Buffer.concat([
      named(8, 'name', nbtString('Future server')),
      named(8, 'ip', nbtString('future.example.net')),
      named(8, 'futureField', nbtString('keep-this-byte-for-byte')),
      Buffer.from([0]),
    ]);
    const count = Buffer.alloc(4); count.writeInt32BE(1);
    const version = Buffer.alloc(4); version.writeInt32BE(9999);
    const raw = Buffer.concat([Buffer.from([10]), nbtString(''), named(3, 'DataVersion', version), named(9, 'servers', Buffer.concat([Buffer.from([10]), count, existingCompound])), Buffer.from([0])]);
    fs.writeFileSync(path.join(root, 'servers.dat'), zlib.gzipSync(raw));

    addServerToInstance(root, { name: 'New server', ip: 'new.example.net' });
    const updatedRaw = zlib.gunzipSync(fs.readFileSync(path.join(root, 'servers.dat')));
    assert.equal(updatedRaw.includes(existingCompound), true);
    assert.equal(updatedRaw.includes(Buffer.from('keep-this-byte-for-byte')), true);
    assert.deepEqual(readSavedServers(root).map(server => server.ip), ['future.example.net', 'new.example.net']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recovers a Pine backup while retaining current-only servers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-server-list-recovery-'));
  try {
    fs.writeFileSync(path.join(root, 'servers.dat.pine-backup'), encodeServersDat([
      { name: 'Old one', ip: 'old-one.example.net' },
      { name: 'Shared', ip: 'shared.example.net' },
    ]));
    fs.writeFileSync(path.join(root, 'servers.dat'), encodeServersDat([
      { name: 'Shared renamed', ip: 'shared.example.net' },
      { name: 'Current only', ip: 'current.example.net' },
    ]));
    const result = recoverServerListFromBackup(root);
    assert.equal(result.before, 2);
    assert.equal(result.recovered, 3);
    assert.deepEqual(readSavedServers(root).map(server => server.ip), ['old-one.example.net', 'shared.example.net', 'current.example.net']);
    assert.equal(fs.existsSync(result.preservedCurrent), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
