'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  knownModrinthIncompatibility,
  inspectModSet,
  analyzeFabricRelations,
  findDuplicateModIds,
  findLoaderIncompatibleMods,
  quarantineKnownBrokenMods,
  detectJarLoaders,
  jarLoaderCompatibilityIssue,
  quarantineLoaderIncompatibleMods,
  quarantineDuplicateModIds,
  readModIds,
  versionPredicateSatisfies,
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

test('Forge duplicate checks ignore dependency modIds in mods.toml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-forge-dependencies-'));
  const writeForgeJar = (filename, modId, dependencies = []) => {
    const dependencyTables = dependencies.map(dependency => `\n[[dependencies.${modId}]]\nmodId="${dependency}"\nmandatory=true`).join('');
    const archive = new AdmZip();
    archive.addFile('META-INF/mods.toml', Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${modId}"\nversion="1"${dependencyTables}`));
    archive.writeZip(path.join(dir, filename));
  };
  try {
    writeForgeJar('yet_another_config_lib_v3.jar', 'yet_another_config_lib_v3', ['forge', 'minecraft']);
    writeForgeJar('geckolib.jar', 'geckolib', ['forge', 'minecraft']);
    writeForgeJar('verity.jar', 'verity', ['forge', 'minecraft', 'geckolib', 'yet_another_config_lib_v3']);

    assert.deepEqual(readModIds(path.join(dir, 'verity.jar')), ['verity']);
    assert.deepEqual(findDuplicateModIds(dir), []);
    assert.deepEqual(inspectModSet(dir, 'forge', '1.20.1').duplicates, []);
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

test('consolidated inspection finds broken, duplicate, and wrong-loader mods in one pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-consolidated-mod-scan-'));
  try {
    writeFabricJar(path.join(dir, 'viafabric.jar'), { id: 'viafabric', provides: ['shared_api'], version: '0.4.21+173-1.14-1.21' });
    writeFabricJar(path.join(dir, 'duplicate.jar'), { id: 'duplicate', provides: ['shared_api'], version: '1' });
    const forge = new AdmZip();
    forge.addFile('META-INF/mods.toml', Buffer.from('modLoader="javafml"\n[[mods]]\nmodId="forge_only"'));
    forge.writeZip(path.join(dir, 'forge-only.jar'));
    const result = inspectModSet(dir, 'fabric', '1.21.11');
    assert.equal(result.knownBroken[0].id, 'viafabric');
    assert.equal(result.duplicates[0].id, 'shared_api');
    assert.match(result.incompatible.find(item => item.filename === 'forge-only.jar').reason, /Forge/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Fabric dependency checks explain missing, wrong-version, and conflicting mods', () => {
  const records = [
    { filename: 'iris.jar', fabricMetadata: { id: 'iris', name: 'Iris', version: '1.11.2+mc26.2', depends: { sodium: '[0.9.1,0.10.0)' } } },
    { filename: 'sodium.jar', fabricMetadata: { id: 'sodium', name: 'Sodium', version: '0.9.2-beta.1+mc26.2', breaks: { iris: '<=1.11.2' }, depends: { fabric_api: '*' } } },
  ];
  const issues = analyzeFabricRelations(records, { minecraft: '26.2' });
  assert.equal(issues.some(issue => issue.code === 'DEPENDENCY_VERSION' && issue.targetId === 'sodium'), true);
  assert.equal(issues.some(issue => issue.code === 'DECLARED_CONFLICT' && issue.targetId === 'iris'), true);
  assert.equal(issues.some(issue => issue.code === 'MISSING_DEPENDENCY' && issue.targetId === 'fabric_api'), true);
});

test('Fabric predicates support intervals, comparator sets, alternatives, and prereleases', () => {
  assert.equal(versionPredicateSatisfies('0.9.1', '[0.9.1,0.10.0)'), true);
  assert.equal(versionPredicateSatisfies('0.9.2-beta.1+mc26.2', '[0.9.1,0.10.0)'), false);
  assert.equal(versionPredicateSatisfies('1.11.2+mc26.2', '<=1.11.2'), true);
  assert.equal(versionPredicateSatisfies('2.5.0', ['<2', '>=2.4 <3']), true);
});

test('Fabric checks recognize nested API modules without treating them as duplicate top-level mods', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-nested-fabric-api-'));
  try {
    const nested = new AdmZip();
    nested.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'fabric-resource-loader-v0', version: '3.0.0' })));
    const api = new AdmZip();
    api.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'fabric-api', version: '1', jars: [{ file: 'META-INF/jars/resource-loader.jar' }] })));
    api.addFile('META-INF/jars/resource-loader.jar', nested.toBuffer());
    api.writeZip(path.join(dir, 'fabric-api.jar'));
    writeFabricJar(path.join(dir, 'consumer.jar'), { id: 'consumer', version: '1', depends: { 'fabric-resource-loader-v0': '>=2' } });
    const result = inspectModSet(dir, 'fabric', '1.21.11');
    assert.equal(result.relations.length, 0);
    assert.equal(result.duplicates.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Fabric duplicate checks ignore Forge metadata carried by a multi-loader jar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-multiloader-metadata-'));
  try {
    writeFabricJar(path.join(dir, 'architectury.jar'), { id: 'architectury', version: '19.0.1' });
    const multi = new AdmZip();
    multi.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'healthindicators', version: '21.11.1', depends: { architectury: '>=19' } })));
    multi.addFile('META-INF/mods.toml', Buffer.from('[[mods]]\nmodId="architectury"'));
    multi.writeZip(path.join(dir, 'healthindicators.jar'));
    assert.equal(inspectModSet(dir, 'fabric', '1.21.11').duplicates.length, 0);
    assert.deepEqual(readModIds(path.join(dir, 'healthindicators.jar')), ['healthindicators']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('consolidated inspection marks damaged JAR files as unreadable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-damaged-mod-'));
  try {
    fs.writeFileSync(path.join(dir, 'broken.jar'), 'not a zip');
    const result = inspectModSet(dir, 'fabric', '1.21.11');
    assert.equal(result.records[0].readable, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
