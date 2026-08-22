'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  knownModrinthIncompatibility,
  findDuplicateModIds,
  findLoaderIncompatibleMods,
  quarantineKnownBrokenMods,
  detectJarLoaders,
  jarLoaderCompatibilityIssue,
  quarantineLoaderIncompatibleMods,
  quarantineDuplicateModIds,
  readModIds,
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

test('quarantines older jars that provide the same undeclared mod id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-duplicate-id-'));
  const older = path.join(dir, 'older.jar');
  const newer = path.join(dir, 'newer.jar');
  try {
    writeFabricJar(older, { id: 'same_mod', version: '1' });
    fs.utimesSync(older, new Date(1), new Date(1));
    writeFabricJar(newer, { id: 'same_mod', version: '2' });
    fs.utimesSync(newer, new Date(2), new Date(2));
    const result = quarantineDuplicateModIds(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].filename, 'older.jar');
    assert.equal(fs.existsSync(older + '.disabled'), true);
    assert.equal(fs.existsSync(newer), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('does not mistake Fabric dependency keys for mod IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-fabric-dependencies-'));
  const infiniteTrading = path.join(dir, 'infinitetrading.jar');
  const fullBrightness = path.join(dir, 'fullbrightnesstoggle.jar');
  const collective = path.join(dir, 'collective.jar');
  try {
    writeFabricJar(infiniteTrading, { id: 'infinitetrading', version: '5.0', depends: { collective: '>=8.29', minecraft: '26.2' } });
    writeFabricJar(fullBrightness, { id: 'fullbrightnesstoggle', version: '4.5', depends: { collective: '>=8.29', minecraft: '26.2' } });
    writeFabricJar(collective, { id: 'collective', version: '8.39', depends: { minecraft: '26.2' } });

    assert.deepEqual(readModIds(infiniteTrading), ['infinitetrading']);
    assert.deepEqual(findDuplicateModIds(dir), []);
    assert.equal(fs.existsSync(infiniteTrading), true);
    assert.equal(fs.existsSync(fullBrightness), true);
    assert.equal(fs.existsSync(collective), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('keeps a maximal compatible set when one jar provides multiple IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-overlapping-ids-'));
  const newestX = path.join(dir, 'newest-x.jar');
  const bridge = path.join(dir, 'bridge.jar');
  const oldestY = path.join(dir, 'oldest-y.jar');
  try {
    writeFabricJar(newestX, { id: 'newest_x', provides: ['shared_x'], version: '1' });
    fs.utimesSync(newestX, new Date(3), new Date(3));
    writeFabricJar(bridge, { id: 'bridge', provides: ['shared_x', 'shared_y'], version: '1' });
    fs.utimesSync(bridge, new Date(2), new Date(2));
    writeFabricJar(oldestY, { id: 'oldest_y', provides: ['shared_y'], version: '1' });
    fs.utimesSync(oldestY, new Date(1), new Date(1));

    const result = quarantineDuplicateModIds(dir);
    assert.deepEqual(result.map(item => item.filename), ['bridge.jar']);
    assert.equal(fs.existsSync(newestX), true);
    assert.equal(fs.existsSync(oldestY), true);
    assert.equal(fs.existsSync(bridge + '.disabled'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

test('identifies wrong-loader jars without flagging multi-loader jars', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-loader-check-'));
  const forgeJar = path.join(dir, 'example-forge.jar');
  const multiJar = path.join(dir, 'example-multi.jar');
  try {
    const forge = new AdmZip();
    forge.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"'));
    forge.writeZip(forgeJar);
    const multi = new AdmZip();
    multi.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"'));
    multi.addFile('fabric.mod.json', Buffer.from('{"id":"example","version":"1"}'));
    multi.writeZip(multiJar);
    assert.deepEqual(detectJarLoaders(forgeJar), ['forge']);
    assert.match(jarLoaderCompatibilityIssue(forgeJar, 'example-forge.jar', 'fabric'), /Built for Forge/);
    assert.equal(jarLoaderCompatibilityIssue(multiJar, 'example-multi.jar', 'fabric'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quarantines a wrong-loader jar before launch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-wrong-loader-'));
  const jar = path.join(dir, 'forge-only.jar');
  try {
    const archive = new AdmZip();
    archive.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"'));
    archive.writeZip(jar);
    const result = quarantineLoaderIncompatibleMods(dir, 'fabric');
    assert.equal(result.length, 1);
    assert.equal(fs.existsSync(jar), false);
    assert.equal(fs.existsSync(jar + '.disabled'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loader compatibility inspection does not mutate mod files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-loader-advisory-'));
  const jar = path.join(dir, 'forge-only.jar');
  try {
    const archive = new AdmZip();
    archive.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"'));
    archive.writeZip(jar);
    const result = findLoaderIncompatibleMods(dir, 'fabric');
    assert.equal(result.length, 1);
    assert.equal(fs.existsSync(jar), true);
    assert.equal(fs.existsSync(jar + '.disabled'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
