'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { readEmbeddedModPresentation } = require('../lib/mod-presentation');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

function jarWith(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-mod-presentation-'));
  const file = path.join(root, 'mod.jar');
  const archive = new AdmZip();
  for (const [name, value] of Object.entries(entries)) archive.addFile(name, Buffer.isBuffer(value) ? value : Buffer.from(value));
  archive.writeZip(file);
  return { root, file };
}

test('reads Fabric mod names and embedded icons from manually copied JARs', t => {
  const fixture = jarWith({
    'fabric.mod.json': JSON.stringify({ id: 'example', name: 'Example Mod', icon: { 16: 'assets/icon-small.png', 128: 'assets/icon.png' } }),
    'assets/icon.png': PNG,
    'assets/icon-small.png': PNG,
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const presentation = readEmbeddedModPresentation(fixture.file);
  assert.equal(presentation.title, 'Example Mod');
  assert.match(presentation.iconUrl, /^data:image\/png;base64,/);
});

test('reads Forge display names and logo files', t => {
  const fixture = jarWith({
    'META-INF/mods.toml': '[[mods]]\nmodId="example"\ndisplayName="Forge Example"\nlogoFile="icon.png"\n',
    'icon.png': PNG,
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal(readEmbeddedModPresentation(fixture.file).title, 'Forge Example');
  assert.match(readEmbeddedModPresentation(fixture.file).iconUrl, /^data:image\/png;base64,/);
});

test('ignores unsafe or unsupported embedded artwork', t => {
  const fixture = jarWith({ 'fabric.mod.json': JSON.stringify({ id: 'example', name: 'Example', icon: '../icon.svg' }) });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal(readEmbeddedModPresentation(fixture.file).iconUrl, null);
});
