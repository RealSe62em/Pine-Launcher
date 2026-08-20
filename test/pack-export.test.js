'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLightweightManifest, buildModrinthIndex, hashDescriptor, modrinthDependencies } = require('../lib/pack-export');

test('builds a standards-shaped Modrinth index with portable paths', () => {
  const instance = { name: 'Pine Pack', gameVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.200' };
  const files = [{ path: 'mods\\example.jar', hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) }, downloads: ['https://cdn.example/mod.jar'], fileSize: 12 }];
  const index = buildModrinthIndex(instance, files);
  assert.equal(index.formatVersion, 1);
  assert.equal(index.game, 'minecraft');
  assert.equal(index.files[0].path, 'mods/example.jar');
  assert.deepEqual(index.dependencies, { minecraft: '1.21.1', neoforge: '21.1.200' });
  assert.deepEqual(modrinthDependencies({ gameVersion: '1.20.1', loader: 'vanilla' }), { minecraft: '1.20.1' });
});

test('lightweight manifests contain recipes and hashes without embedding private state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine export é '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'options.txt');
  fs.writeFileSync(file, 'fov:80');
  const descriptor = hashDescriptor(file);
  assert.equal(descriptor.size, 6);
  assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
  const manifest = buildLightweightManifest(
    { name: 'Portable', gameVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.16.14' },
    [{ path: 'mods/a.jar', hashes: { sha256: descriptor.sha256 }, downloads: ['https://example.invalid/a.jar'] }],
    [{ path: 'options.txt', ...descriptor }],
    ['mods/private.jar'],
  );
  assert.equal(manifest.kind, 'lightweight-manifest');
  assert.equal(manifest.instance.loader, 'fabric');
  assert.equal(manifest.content[0].path, 'mods/a.jar');
  assert.deepEqual(manifest.omitted, ['mods/private.jar']);
  assert.equal(JSON.stringify(manifest).includes('access_token'), false);
});
