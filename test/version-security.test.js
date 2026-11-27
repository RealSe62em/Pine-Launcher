'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  sha1Hex,
  extractFreetypeLibraries,
  fetchVersionManifestV2,
  checkVersionSecurityUpdate,
  applyVersionSecurityUpdate,
} = require('../lib/version-security');

test('checkVersionSecurityUpdate detects stale cached FreeType metadata and flags freetype-rce', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-versec-'));
  try {
    const globalVersions = path.join(dir, 'shared', 'versions');
    const instanceDir = path.join(dir, 'instances', 'Survival');
    fs.mkdirSync(globalVersions, { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'versions', '1.21.4'), { recursive: true });

    const oldMeta = JSON.stringify({
      id: '1.21.4',
      libraries: [{ name: 'org.lwjgl:lwjgl-freetype:3.3.3' }],
    });
    const newMeta = JSON.stringify({
      id: '1.21.4',
      libraries: [{ name: 'org.lwjgl:lwjgl-freetype:3.4.3-mojang-2.15.0' }],
    });
    const newSha1 = sha1Hex(newMeta);

    const globalJson = path.join(globalVersions, '1.21.4.json');
    const instJson = path.join(instanceDir, 'versions', '1.21.4', '1.21.4.json');
    fs.writeFileSync(globalJson, oldMeta);
    fs.writeFileSync(instJson, oldMeta);

    const manifest = {
      versions: [{ id: '1.21.4', url: 'https://piston-meta.mojang.com/1.21.4.json', sha1: newSha1 }],
    };

    const check = await checkVersionSecurityUpdate({
      versionId: '1.21.4',
      globalVersionsDir: globalVersions,
      instanceDir,
      manifest,
    });
    assert.equal(check.needsUpdate, true);
    assert.equal(check.reason, 'freetype-rce');
    assert.equal(check.freetypeAffected, true);
    assert.equal(check.cachedPaths.length, 2);
    assert.deepEqual(extractFreetypeLibraries(JSON.parse(oldMeta)), ['org.lwjgl:lwjgl-freetype:3.3.3']);

    // Applying update verifies SHA-1 and updates both global & per-instance copies
    const applied = await applyVersionSecurityUpdate({
      versionId: '1.21.4',
      globalVersionsDir: globalVersions,
      instanceDir,
      manifest,
      fetchImpl: async () => new Response(newMeta, { status: 200 }),
    });
    assert.equal(applied.sha1, newSha1);
    assert.equal(applied.updatedPaths.length, 2);
    assert.equal(fs.readFileSync(globalJson, 'utf8'), newMeta);
    assert.equal(fs.readFileSync(instJson, 'utf8'), newMeta);

    // Re-checking now reports up-to-date
    const after = await checkVersionSecurityUpdate({
      versionId: '1.21.4',
      globalVersionsDir: globalVersions,
      instanceDir,
      manifest,
    });
    assert.equal(after.needsUpdate, false);
    assert.equal(after.reason, 'up-to-date');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('version security checks handle fresh instances, offline fallback, and SHA-1 mismatch rejections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-versec-edge-'));
  try {
    const globalVersions = path.join(dir, 'versions');
    fs.mkdirSync(globalVersions, { recursive: true });

    // Fresh instance (no cached JSON yet) does not warn
    const fresh = await checkVersionSecurityUpdate({
      versionId: '1.21.4',
      globalVersionsDir: globalVersions,
    });
    assert.equal(fresh.needsUpdate, false);
    assert.equal(fresh.reason, 'not-cached');

    // Offline fallback never blocks launching
    fs.writeFileSync(path.join(globalVersions, '1.21.4.json'), JSON.stringify({ id: '1.21.4', libraries: [] }));
    const offline = await checkVersionSecurityUpdate({
      versionId: '1.21.4',
      globalVersionsDir: globalVersions,
      fetchImpl: async () => { throw new Error('ENETUNREACH'); },
    });
    assert.equal(offline.needsUpdate, false);
    assert.equal(offline.reason, 'offline');

    // Mismatched SHA-1 is rejected without corrupting cached JSON
    await assert.rejects(
      () => applyVersionSecurityUpdate({
        versionId: '1.21.4',
        globalVersionsDir: globalVersions,
        manifest: { versions: [{ id: '1.21.4', url: 'https://piston-meta.mojang.com/1.21.4.json', sha1: 'deadbeef' }] },
        fetchImpl: async () => new Response(JSON.stringify({ id: '1.21.4' }), { status: 200 }),
      }),
      /SHA-1 verification/,
    );

    // fetchVersionManifestV2 falls back to second mirror if primary fails
    let calls = 0;
    const fetched = await fetchVersionManifestV2({
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response('', { status: 503 });
        return new Response(JSON.stringify({ versions: [{ id: '1.21.4' }] }), { status: 200 });
      },
    });
    assert.equal(calls, 2);
    assert.equal(fetched.versions[0].id, '1.21.4');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
