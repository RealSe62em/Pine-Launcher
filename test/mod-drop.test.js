'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { copyDroppedMods } = require('../lib/mod-drop');

function writeJar(file, id) {
  const archive = new AdmZip();
  archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id, version: '1.0.0' })));
  archive.writeZip(file);
}

function validJar(file) {
  try { return new AdmZip(file).getEntries().length > 0; } catch { return false; }
}

test('dropped mods are copied into the instance and leave their source untouched', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-mod-drop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const instanceDir = path.join(root, 'instance');
  const sourceDir = path.join(root, 'downloads');
  fs.mkdirSync(sourceDir, { recursive: true });
  const source = path.join(sourceDir, 'example.jar');
  writeJar(source, 'example');

  const result = copyDroppedMods({
    instanceDir,
    filePaths: [source],
    loader: 'fabric',
    isValidJar: validJar,
    compatibilityIssue: () => null,
  });

  assert.deepEqual(result.rejected, []);
  assert.equal(result.copied[0].filename, 'example.jar');
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(path.join(instanceDir, 'mods', 'example.jar')), true);
  assert.equal(fs.readFileSync(source).equals(fs.readFileSync(path.join(instanceDir, 'mods', 'example.jar'))), true);

  const repeated = copyDroppedMods({ instanceDir, filePaths: [source], isValidJar: validJar });
  assert.deepEqual(repeated.copied, []);
  assert.equal(repeated.skipped[0].reason, 'Already installed');
});

test('dropped mod validation rejects non-JARs, broken archives, and filename collisions without overwriting', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-mod-drop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const instanceDir = path.join(root, 'instance');
  const firstDir = path.join(root, 'first');
  const secondDir = path.join(root, 'second');
  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });
  const installed = path.join(firstDir, 'collision.jar');
  const conflicting = path.join(secondDir, 'collision.jar');
  const broken = path.join(firstDir, 'broken.jar');
  const text = path.join(firstDir, 'notes.txt');
  writeJar(installed, 'first');
  writeJar(conflicting, 'second');
  fs.writeFileSync(broken, 'not a zip');
  fs.writeFileSync(text, 'not a mod');

  copyDroppedMods({ instanceDir, filePaths: [installed], isValidJar: validJar });
  const before = fs.readFileSync(path.join(instanceDir, 'mods', 'collision.jar'));
  const result = copyDroppedMods({ instanceDir, filePaths: [conflicting, broken, text], isValidJar: validJar });

  assert.equal(result.copied.length, 0);
  assert.equal(result.rejected.length, 3);
  assert.match(result.rejected[0].reason, /different mod/i);
  assert.match(result.rejected[1].reason, /valid JAR/i);
  assert.match(result.rejected[2].reason, /Only \.jar/i);
  assert.equal(fs.readFileSync(path.join(instanceDir, 'mods', 'collision.jar')).equals(before), true);
});
