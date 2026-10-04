'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listScreenshots, parseMinecraftOptions, serializeMinecraftOptions, syncInstanceData, validateSkinPng } = require('../lib/pine-studio');

test('game options preserve colons inside values', () => {
  const rows = parseMinecraftOptions('lang:en_us\nlastServer:localhost:25565\n');
  assert.deepEqual(rows, [
    { key: 'lang', value: 'en_us', raw: false },
    { key: 'lastServer', value: 'localhost:25565', raw: false },
  ]);
  assert.equal(serializeMinecraftOptions(rows), 'lang:en_us\nlastServer:localhost:25565\n');
});

test('skin validation accepts Minecraft dimensions and rejects arbitrary PNG dimensions', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  assert.deepEqual(validateSkinPng(png), { width: 64, height: 64 });
  png.writeUInt32BE(128, 16);
  assert.throws(() => validateSkinPng(png), /64×64/);
});

test('instance sync copies only selected local gameplay data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(path.join(source, 'resourcepacks'), { recursive: true });
  fs.writeFileSync(path.join(source, 'options.txt'), 'fov:0.5\n');
  fs.writeFileSync(path.join(source, 'servers.dat'), 'private servers');
  fs.writeFileSync(path.join(source, 'resourcepacks', 'pack.zip'), 'pack');
  assert.deepEqual(await syncInstanceData(source, destination, { options: true, resourcepacks: true }), ['options', 'resourcepacks']);
  assert.equal(fs.readFileSync(path.join(destination, 'options.txt'), 'utf8'), 'fov:0.5\n');
  assert.equal(fs.existsSync(path.join(destination, 'servers.dat')), false);
  assert.equal(fs.readFileSync(path.join(destination, 'resourcepacks', 'pack.zip'), 'utf8'), 'pack');
});

test('screenshot listing ignores unsupported files and handles missing folders', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-screenshots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(await listScreenshots(root), []);

  const screenshots = path.join(root, 'screenshots');
  fs.mkdirSync(screenshots);
  fs.writeFileSync(path.join(screenshots, 'new.png'), 'new');
  fs.writeFileSync(path.join(screenshots, 'old.jpg'), 'old');
  fs.writeFileSync(path.join(screenshots, 'notes.txt'), 'ignored');
  const oldTime = new Date('2024-01-01T00:00:00Z');
  const newTime = new Date('2025-01-01T00:00:00Z');
  fs.utimesSync(path.join(screenshots, 'old.jpg'), oldTime, oldTime);
  fs.utimesSync(path.join(screenshots, 'new.png'), newTime, newTime);

  const result = await listScreenshots(root);
  assert.deepEqual(result.map(item => item.name), ['new.png', 'old.jpg']);
  assert.deepEqual(result.map(item => item.bytes), [3, 3]);
});
