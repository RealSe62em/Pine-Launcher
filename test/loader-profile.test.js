'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expectedLoaderProfileId, isSafePathSegment, isMatchingLoaderProfile, writeJsonAtomic } = require('../lib/loader-profile');

function profile(loader, loaderVersion, gameVersion) {
  return {
    id: expectedLoaderProfileId(loader, loaderVersion, gameVersion),
    inheritsFrom: gameVersion,
    mainClass: 'example.Main',
    libraries: [],
  };
}

test('matches only the exact requested loader profile', () => {
  const fabric = profile('fabric', '0.19.3', '1.21.11');
  assert.equal(isMatchingLoaderProfile(fabric, 'fabric', '0.19.3', '1.21.11'), true);
  assert.equal(isMatchingLoaderProfile(fabric, 'fabric', '0.19.2', '1.21.11'), false);
  assert.equal(isMatchingLoaderProfile(fabric, 'fabric', '0.19.3', '1.21.1'), false);
  assert.equal(isMatchingLoaderProfile(fabric, 'quilt', '0.19.3', '1.21.11'), false);
});

test('rejects unsafe loader profile path segments', () => {
  for (const value of ['../profile', 'folder/profile', 'folder\\profile', 'bad:name', '.', '..']) {
    assert.equal(isSafePathSegment(value), false);
  }
});

test('writes a complete profile atomically in paths with spaces and Unicode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine profile \u26cf '));
  const target = path.join(root, 'versions', 'fabric-loader-0.19.3-1.21.11.json');
  const value = profile('fabric', '0.19.3', '1.21.11');
  try {
    await writeJsonAtomic(target, value);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), value);
    assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.endsWith('.tmp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});