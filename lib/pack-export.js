'use strict';

const crypto = require('crypto');
const fs = require('fs');

function loaderDependency(instance) {
  const loader = String(instance?.loader || 'vanilla').toLowerCase();
  if (loader === 'vanilla' || !instance?.loaderVersion) return {};
  const key = loader === 'fabric' ? 'fabric-loader' : loader === 'quilt' ? 'quilt-loader' : loader;
  return { [key]: String(instance.loaderVersion) };
}

function modrinthDependencies(instance) {
  return { minecraft: String(instance?.gameVersion || ''), ...loaderDependency(instance) };
}

function buildModrinthIndex(instance, files, options = {}) {
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: String(options.versionId || instance.name || 'pine-export').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64),
    name: String(options.name || instance.name || 'Pine export').slice(0, 160),
    summary: String(options.summary || `Exported from Pine Launcher`).slice(0, 250),
    files: (files || []).map(file => ({
      path: String(file.path).split('\\').join('/'),
      hashes: file.hashes,
      env: file.env || { client: 'required', server: 'unsupported' },
      downloads: file.downloads,
      fileSize: Number(file.fileSize) || undefined,
    })),
    dependencies: modrinthDependencies(instance),
  };
}

function hashDescriptor(file) {
  const data = fs.readFileSync(file);
  return { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

function verifiedRecipeFile(local, relative, remote, url) {
  const data = fs.readFileSync(local);
  const expected = Array.isArray(remote.hashes)
    ? Object.fromEntries(remote.hashes.filter(item => item.algo === 1 || item.algo === 2).map(item => [item.algo === 1 ? 'sha1' : 'md5', item.value]))
    : (remote.hashes || {});
  const algorithm = ['sha512', 'sha256', 'sha1', 'md5'].find(key => expected[key]);
  if (!algorithm) throw new Error('Provider verification hash is unavailable');
  if (crypto.createHash(algorithm).update(data).digest('hex').toLowerCase() !== String(expected[algorithm]).toLowerCase()) throw new Error('Local content differs from the provider build; use a full export to preserve it');
  return { path: relative + (local.endsWith('.disabled') ? '.disabled' : ''), hashes: { sha256: crypto.createHash('sha256').update(data).digest('hex') }, downloads: [url], fileSize: data.length, env: { client: 'required', server: 'unsupported' } };
}

function buildLightweightManifest(instance, content, overrides, omitted = []) {
  return {
    format: 1,
    product: 'Pine Launcher',
    kind: 'lightweight-manifest',
    createdAt: new Date().toISOString(),
    instance: {
      name: instance.name,
      gameVersion: instance.gameVersion,
      loader: instance.loader || 'vanilla',
      loaderVersion: instance.loaderVersion || null,
      minMemory: instance.minMemory || null,
      maxMemory: instance.maxMemory || null,
    },
    content: (content || []).map(file => ({ path: file.path, hashes: file.hashes, downloads: file.downloads, fileSize: file.fileSize || null })),
    overrides: overrides || [],
    omitted,
  };
}

module.exports = { verifiedRecipeFile, buildLightweightManifest, buildModrinthIndex, hashDescriptor, loaderDependency, modrinthDependencies };
