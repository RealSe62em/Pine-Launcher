const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { MINECRAFT_DESKTOP_ID, ensureLinuxGameIntegration, linuxDataHome, readMinecraftIcon } = require('../lib/linux-game-integration');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fixture(root, version = '1.21.11') {
  const assets = path.join(root, 'assets');
  const hash = crypto.createHash('sha1').update(PNG).digest('hex');
  const object = path.join(assets, 'objects', hash.slice(0, 2), hash);
  fs.mkdirSync(path.dirname(object), { recursive: true });
  fs.writeFileSync(object, PNG);
  fs.mkdirSync(path.join(assets, 'indexes'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'indexes', `${version}.json`), JSON.stringify({
    objects: { 'icons/icon_32x32.png': { hash, size: PNG.length } },
  }));
  return assets;
}

test('registers Minecraft game windows with their downloaded grass-block icon', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-linux-game-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = fixture(root);
  const dataHome = path.join(root, 'data home');
  const result = ensureLinuxGameIntegration({
    homeDir: path.join(root, 'home'),
    env: { XDG_DATA_HOME: dataHome },
    assetRoot: assets,
    gameVersion: '1.21.11',
  });

  assert.equal(result.changed, true);
  assert.deepEqual(fs.readFileSync(result.iconFile), PNG);
  const desktop = fs.readFileSync(result.desktopFile, 'utf8');
  assert.match(desktop, new RegExp(`StartupWMClass=${MINECRAFT_DESKTOP_ID}`));
  assert.match(desktop, /Name=Minecraft/);
  assert.match(desktop, /NoDisplay=true/);
  assert.match(desktop, /Icon=.*data\\shome.*minecraft\.png/);
  assert.equal(ensureLinuxGameIntegration({ homeDir: root, env: { XDG_DATA_HOME: dataHome }, assetRoot: assets, gameVersion: '1.21.11' }).changed, false);

  const validator = spawnSync('desktop-file-validate', [result.desktopFile], { encoding: 'utf8' });
  if (!validator.error) assert.equal(validator.status, 0, validator.stderr);
});

test('uses the standard games icon until Minecraft assets are available', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-linux-game-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = ensureLinuxGameIntegration({ homeDir: root, env: {}, assetRoot: path.join(root, 'assets'), gameVersion: 'missing' });
  assert.equal(result.iconFile, null);
  assert.match(fs.readFileSync(result.desktopFile, 'utf8'), /^Icon=applications-games$/m);
});

test('resolves XDG data home and reads the preferred Minecraft asset index', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-linux-game-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = fixture(root, 'preferred');
  assert.deepEqual(readMinecraftIcon(assets, 'preferred'), PNG);
  assert.equal(linuxDataHome('/home/player', {}), path.join('/home/player', '.local', 'share'));
  assert.equal(linuxDataHome('/home/player', { XDG_DATA_HOME: '/custom/data' }), '/custom/data');
});
