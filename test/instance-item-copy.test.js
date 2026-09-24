const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyInstanceItems, resolveInside, safeRelative } = require('../lib/instance-item-copy');

test('copies split-view files and folders without removing their sources', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-split-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(path.join(source, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(source, 'saves', 'World One', 'region'), { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, 'mods', 'example.jar'), 'mod');
  fs.writeFileSync(path.join(source, 'saves', 'World One', 'level.dat'), 'level');
  fs.writeFileSync(path.join(source, 'saves', 'World One', 'region', 'r.0.0.mca'), 'region');

  const result = copyInstanceItems({ sourceRoot: source, destinationRoot: destination, items: [
    { kind: 'content', type: 'mod', relative: 'mods/example.jar' },
    { kind: 'world', identifier: 'World One', relative: 'saves/World One' },
  ] });

  assert.equal(result.copied.length, 2);
  assert.equal(fs.readFileSync(path.join(source, 'mods', 'example.jar'), 'utf8'), 'mod');
  assert.equal(fs.readFileSync(path.join(destination, 'mods', 'example.jar'), 'utf8'), 'mod');
  assert.equal(fs.readFileSync(path.join(destination, 'saves', 'World One', 'region', 'r.0.0.mca'), 'utf8'), 'region');
});

test('skips content conflicts and creates independent names for worlds and screenshots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-split-conflict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  for (const base of [source, destination]) {
    fs.mkdirSync(path.join(base, 'mods'), { recursive: true });
    fs.mkdirSync(path.join(base, 'screenshots'), { recursive: true });
  }
  fs.writeFileSync(path.join(source, 'mods', 'same.jar'), 'source');
  fs.writeFileSync(path.join(destination, 'mods', 'same.jar'), 'destination');
  fs.writeFileSync(path.join(source, 'screenshots', 'shot.png'), 'source image');
  fs.writeFileSync(path.join(destination, 'screenshots', 'shot.png'), 'destination image');

  const result = copyInstanceItems({ sourceRoot: source, destinationRoot: destination, items: [
    { kind: 'content', relative: 'mods/same.jar' },
    { kind: 'screenshot', relative: 'screenshots/shot.png' },
  ] });
  assert.equal(result.skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(destination, 'mods', 'same.jar'), 'utf8'), 'destination');
  assert.equal(fs.readFileSync(path.join(destination, 'screenshots', 'shot - Copy.png'), 'utf8'), 'source image');
});

test('rejects traversal and filesystem links', t => {
  assert.throws(() => safeRelative('../outside'), /escapes/);
  assert.throws(() => resolveInside('/tmp/instance', '/etc/passwd'), /Invalid/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-split-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'destination'), { recursive: true });
  fs.symlinkSync('/tmp', path.join(root, 'source', 'linked'));
  assert.throws(() => copyInstanceItems({ sourceRoot: path.join(root, 'source'), destinationRoot: path.join(root, 'destination'), items: [{ kind: 'world', relative: 'linked' }] }), /links/);
});
