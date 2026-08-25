'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { inspectLauncherMetadata, inspectRuntimeMetadata, resolveGameRoot, resolveMetadataRoot } = require('../lib/import-adapters');

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-adapter-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

test('recognizes Prism and MultiMC metadata from documented files', t => {
  const dir = root(t);
  fs.writeFileSync(path.join(dir, 'instance.cfg'), 'name=Portable Pack\n');
  fs.writeFileSync(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.9' }] }));
  const result = inspectLauncherMetadata(dir, dir, 'Prism Launcher');
  assert.equal(result.source, 'Prism Launcher');
  assert.equal(result.name, 'Portable Pack');
  assert.equal(result.gameVersion, '1.20.1');
  assert.equal(result.loader, 'fabric');
  assert.equal(result.confidence, 'high');
});

test('uses launcher hints and JSON evidence without assuming arbitrary folders', t => {
  const dir = root(t);
  fs.writeFileSync(path.join(dir, 'instance.json'), JSON.stringify({ instanceName: 'GD Pack', minecraftVersion: '1.21.1', loader: 'neoforge-21.1.90' }));
  const result = inspectLauncherMetadata(dir, dir, 'GDLauncher');
  assert.equal(result.source, 'GDLauncher');
  assert.equal(result.name, 'GD Pack');
  assert.equal(result.loader, 'neoforge');
  assert.equal(result.confidence, 'high');
});

test('resolves nested launcher game roots so metadata-only wrappers do not create empty imports', t => {
  const dir = root(t);
  const game = path.join(dir, '.minecraft');
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(game, 'saves', 'World'), { recursive: true });
  fs.writeFileSync(path.join(game, 'options.txt'), 'key_key.jump:key.keyboard.space');
  assert.equal(resolveGameRoot(dir), game);
});

test('recovers Prism metadata when the selected folder is the inner .minecraft directory', t => {
  const dir = root(t);
  const game = path.join(dir, '.minecraft');
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'instance.cfg'), 'name=Selected Inner Folder\n');
  fs.writeFileSync(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.4' }, { uid: 'net.fabricmc.fabric-loader', version: '0.15.11' }] }));
  const metadataRoot = resolveMetadataRoot(game, resolveGameRoot(game));
  const result = inspectLauncherMetadata(metadataRoot, game, 'Prism Launcher');
  assert.equal(metadataRoot, dir);
  assert.equal(result.gameVersion, '1.20.4');
  assert.equal(result.loader, 'fabric');
  assert.equal(result.loaderVersion, '0.15.11');
  assert.equal(result.loaderDetected, true);
});

test('recovers exact Minecraft and loader versions from a recent game log', t => {
  const dir = root(t);
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), '[main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.10\n');
  const result = inspectRuntimeMetadata(dir);
  assert.equal(result.gameVersion, '1.21.1');
  assert.equal(result.loader, 'fabric');
  assert.equal(result.loaderVersion, '0.16.10');
});

test('infers a missing loader from imported mod metadata instead of silently using vanilla', t => {
  const dir = root(t);
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  const archive = new AdmZip();
  archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'example', version: '1.0.0' })));
  archive.writeZip(path.join(dir, 'mods', 'example.jar'));
  const result = inspectLauncherMetadata(dir, dir, 'Minecraft folder');
  assert.equal(result.loader, 'fabric');
  assert.equal(result.loaderVersion, null);
  assert.equal(result.loaderDetected, true);
  assert.equal(result.versionDetected, false);
});

test('reads nested metadata used by additional launcher adapters', t => {
  const dir = root(t);
  fs.writeFileSync(path.join(dir, 'minecraftinstance.json'), JSON.stringify({ instance: { name: 'FTB Pack' }, minecraft: { version: '1.20.1', loader: 'forge-47.3.0' } }));
  const result = inspectLauncherMetadata(dir, dir, 'FTB App');
  assert.equal(result.source, 'FTB App');
  assert.equal(result.name, 'FTB Pack');
  assert.equal(result.gameVersion, '1.20.1');
  assert.equal(result.loader, 'forge');
  assert.equal(result.loaderVersion, '47.3.0');
});
