'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shortcutArgument, createDesktopShortcut, readDesktopShortcut, pngToIco, windowsQuote } = require('../lib/desktop-shortcuts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-shortcuts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { desktop: path.join(root, 'Desktop'), storage: path.join(root, 'icons with spaces'), executable: '/opt/Pine Launcher/pine-launcher', platform: 'linux', instance: { id: 'stable-instance-id', name: 'Modded' }, destination: { type: 'multiplayer', identifier: 'play.example.test:25565', label: 'My server' }, png };
}
test('Linux shortcuts preserve destination identity and use the saved server image', t => {
  const options = fixture(t);
  const result = createDesktopShortcut(options);
  const text = fs.readFileSync(result.path, 'utf8');
  assert.match(text, /Exec="\/opt\/Pine Launcher\/pine-launcher" "--pine-shortcut=[a-f0-9]{32}"/);
  const expectedIcon = path.join(options.storage, result.id + '.png').replaceAll('\\', '\\\\');
  assert.ok(text.includes(`Icon=${expectedIcon}`));
  assert.equal(fs.statSync(result.path).mode & 0o111, 0o111);
  assert.deepEqual(fs.readFileSync(path.join(options.storage, result.id + '.png')), png);
  assert.equal(readDesktopShortcut(options.storage, result.id, [options.instance]).destination.identifier, 'play.example.test:25565');
  const validator = spawnSync('desktop-file-validate', [result.path], { encoding: 'utf8' });
  if (!validator.error) assert.equal(validator.status, 0, validator.stdout + validator.stderr);
});
test('Windows links target Pine with a private shortcut ID and a PNG-backed ICO', t => {
  const options = fixture(t);
  let link;
  const result = createDesktopShortcut({ ...options, platform: 'win32', executable: 'C:\\Apps\\Pine Launcher.exe', writeShortcutLink: (...args) => { link = args; return true; } });
  assert.equal(link[1], 'create');
  assert.equal(link[2].target, 'C:\\Apps\\Pine Launcher.exe');
  assert.equal(link[2].args, `"--pine-shortcut=${result.id}"`);
  const ico = fs.readFileSync(link[2].icon);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.deepEqual(ico.subarray(22), png);
  assert.equal(windowsQuote('C:\\Pine\\'), '"C:\\Pine\\\\"');
});
test('shortcuts survive instance renaming but never launch a replacement with the same name', t => {
  const options = fixture(t);
  const { id } = createDesktopShortcut(options);
  assert.equal(readDesktopShortcut(options.storage, id, [{ ...options.instance, name: 'Renamed' }]).instanceName, 'Renamed');
  assert.throws(() => readDesktopShortcut(options.storage, id, [{ id: 'different-id', name: 'Modded' }]), /deleted/);
  assert.equal(shortcutArgument(['pine', `--pine-shortcut=${id}`]), id);
  assert.equal(shortcutArgument(['--pine-shortcut=../../auth.json']), null);
  assert.throws(() => readDesktopShortcut(options.storage, '../auth', []), /Invalid/);
});
test('world names are data in the manifest, never executable command arguments', t => {
  const options = fixture(t);
  const label = 'World "name" $HOME %U';
  const result = createDesktopShortcut({ ...options, destination: { type: 'singleplayer', identifier: label, label }, appPath: '/home/player/Pine $foo "bar" %U' });
  const text = fs.readFileSync(result.path, 'utf8');
  assert.equal(readDesktopShortcut(options.storage, result.id, [options.instance]).destination.identifier, label);
  assert.ok(!text.split('\n').find(line => line.startsWith('Exec=')).includes('World'));
  const validator = spawnSync('desktop-file-validate', [result.path], { encoding: 'utf8' });
  if (!validator.error) assert.equal(validator.status, 0, validator.stdout + validator.stderr);
  assert.deepEqual(pngToIco(png, 256).subarray(6, 8), Buffer.from([0, 0]));
});
