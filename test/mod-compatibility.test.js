'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  knownModrinthIncompatibility,
  quarantineKnownBrokenMods,
} = require('../lib/mod-compatibility');

function writeFabricJar(file, metadata) {
  const archive = new AdmZip();
  archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify(metadata)));
  archive.writeZip(file);
}

test('quarantines the confirmed broken ViaFabric 1.21.11 build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-viafabric-'));
  const jar = path.join(dir, 'ViaFabric.jar');
  try {
    writeFabricJar(jar, { id: 'viafabric', version: '0.4.21+173-1.14-1.21' });
    const result = quarantineKnownBrokenMods(dir, '1.21.11');
    assert.equal(result.length, 1);
    assert.equal(fs.existsSync(jar), false);
    assert.equal(fs.existsSync(jar + '.disabled'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('does not disable ViaFabric for an unconfirmed game or mod version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-viafabric-safe-'));
  const jar = path.join(dir, 'ViaFabric.jar');
  try {
    writeFabricJar(jar, { id: 'viafabric', version: '0.4.21+173-1.14-1.21' });
    assert.deepEqual(quarantineKnownBrokenMods(dir, '1.21.10'), []);
    assert.equal(fs.existsSync(jar), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('blocks the broken Modrinth release before installation', () => {
  const issue = knownModrinthIncompatibility('YlKdE5VK', 'U1uUiwCm', '1.21.11');
  assert.equal(issue.code, 'KNOWN_BROKEN_MOD_BUILD');
  assert.match(issue.detail, /ViaFabricPlus/);
  assert.equal(knownModrinthIncompatibility('YlKdE5VK', 'U1uUiwCm', '1.21.10'), null);
});