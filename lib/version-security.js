// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_MANIFEST_V2_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const VERSION_MANIFEST_V2_FALLBACK_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

/**
 * Compute SHA-1 hex digest of a Buffer or file on disk.
 * @param {Buffer | string} input
 * @returns {string}
 */
function sha1Hex(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * Compute SHA-1 of a file if it exists, otherwise null.
 * @param {string} filePath
 * @returns {string | null}
 */
function fileSha1OrNull(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return sha1Hex(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

/**
 * Find any LWJGL FreeType library coordinates declared in a version metadata object.
 * @param {any} metadata
 * @returns {string[]}
 */
function extractFreetypeLibraries(metadata) {
  if (!metadata || !Array.isArray(metadata.libraries)) return [];
  const found = [];
  for (const lib of metadata.libraries) {
    const name = String(lib?.name || '');
    if (/org\.lwjgl:lwjgl-freetype:/i.test(name)) {
      found.push(name);
    }
  }
  return [...new Set(found)];
}

/**
 * Fetch Mojang's official version_manifest_v2.json (includes per-version SHA-1s).
 * @param {{ fetchImpl?: typeof globalThis.fetch, timeoutMs?: number }} [options]
 */
async function fetchVersionManifestV2({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  let lastError;
  for (const url of [VERSION_MANIFEST_V2_URL, VERSION_MANIFEST_V2_FALLBACK_URL]) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && Array.isArray(data.versions)) return data;
      throw new Error('Malformed version_manifest_v2.json');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Could not reach Mojang version manifest');
}

/**
 * Locate all cached copies of a vanilla version JSON for an instance (shared + per-instance).
 * @param {{ versionId: string, globalVersionsDir: string, instanceDir?: string | null }} options
 * @returns {string[]}
 */
function findCachedVersionJsonPaths({ versionId, globalVersionsDir, instanceDir = null }) {
  const candidates = [];
  if (globalVersionsDir) {
    candidates.push(path.join(globalVersionsDir, `${versionId}.json`));
  }
  if (instanceDir) {
    candidates.push(path.join(instanceDir, 'versions', versionId, `${versionId}.json`));
    candidates.push(path.join(instanceDir, 'versions', `${versionId}.json`));
  }
  return [...new Set(candidates)].filter(p => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
  });
}

/**
 * Inspect whether an existing instance's cached vanilla version metadata is stale
 * compared to Mojang's official version_manifest_v2.json SHA-1.
 * @param {{
 *   versionId: string,
 *   globalVersionsDir: string,
 *   instanceDir?: string | null,
 *   manifest?: { versions?: Array<{ id: string, url: string, sha1?: string }> } | null,
 *   fetchImpl?: typeof globalThis.fetch,
 *   timeoutMs?: number,
 * }} options
 */
async function checkVersionSecurityUpdate({
  versionId,
  globalVersionsDir,
  instanceDir = null,
  manifest = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 6000,
}) {
  const cachedPaths = findCachedVersionJsonPaths({ versionId, globalVersionsDir, instanceDir });
  if (cachedPaths.length === 0) {
    return {
      needsUpdate: false,
      reason: /** @type {'not-cached'} */ ('not-cached'),
      versionId,
      cachedPaths: [],
      expectedSha1: null,
      freetypeAffected: false,
      freetypeLibraries: [],
      manifestEntry: null,
    };
  }

  let resolvedManifest = manifest;
  if (!resolvedManifest) {
    try {
      resolvedManifest = await fetchVersionManifestV2({ fetchImpl, timeoutMs });
    } catch {
      return {
        needsUpdate: false,
        reason: /** @type {'offline'} */ ('offline'),
        versionId,
        cachedPaths,
        expectedSha1: null,
        freetypeAffected: false,
        freetypeLibraries: [],
        manifestEntry: null,
      };
    }
  }

  const entry = resolvedManifest.versions?.find(v => v.id === versionId) || null;
  if (!entry?.url || !entry?.sha1) {
    return {
      needsUpdate: false,
      reason: /** @type {'up-to-date'} */ ('up-to-date'),
      versionId,
      cachedPaths,
      expectedSha1: null,
      freetypeAffected: false,
      freetypeLibraries: [],
      manifestEntry: entry,
    };
  }

  const expectedSha1 = String(entry.sha1).toLowerCase();
  const stalePaths = [];
  const freetypeSet = new Set();

  for (const filePath of cachedPaths) {
    const actualSha1 = fileSha1OrNull(filePath);
    if (!actualSha1 || actualSha1.toLowerCase() !== expectedSha1) {
      stalePaths.push(filePath);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const lib of extractFreetypeLibraries(parsed)) freetypeSet.add(lib);
      } catch {}
    }
  }

  if (stalePaths.length === 0) {
    return {
      needsUpdate: false,
      reason: /** @type {'up-to-date'} */ ('up-to-date'),
      versionId,
      cachedPaths,
      expectedSha1,
      freetypeAffected: false,
      freetypeLibraries: [],
      manifestEntry: entry,
    };
  }

  const freetypeLibraries = [...freetypeSet];
  const freetypeAffected = freetypeLibraries.length > 0;

  return {
    needsUpdate: true,
    reason: /** @type {'freetype-rce' | 'manifest-updated'} */ (freetypeAffected ? 'freetype-rce' : 'manifest-updated'),
    versionId,
    cachedPaths: stalePaths,
    expectedSha1,
    freetypeAffected,
    freetypeLibraries,
    manifestEntry: entry,
  };
}

/**
 * Download Mojang's verified updated <version>.json and atomically replace all stale cached copies.
 * @param {{
 *   versionId: string,
 *   globalVersionsDir: string,
 *   instanceDir?: string | null,
 *   manifest?: { versions?: Array<{ id: string, url: string, sha1?: string }> } | null,
 *   fetchImpl?: typeof globalThis.fetch,
 *   timeoutMs?: number,
 * }} options
 */
async function applyVersionSecurityUpdate({
  versionId,
  globalVersionsDir,
  instanceDir = null,
  manifest = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
}) {
  const resolvedManifest = manifest || await fetchVersionManifestV2({ fetchImpl, timeoutMs });
  const entry = resolvedManifest.versions?.find(v => v.id === versionId);
  if (!entry?.url) throw new Error(`Minecraft ${versionId} was not found in Mojang's version manifest`);

  const response = await fetchImpl(entry.url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Mojang version metadata returned HTTP ${response.status}`);
  const rawBuffer = Buffer.from(await response.arrayBuffer());

  if (entry.sha1) {
    const actualSha1 = sha1Hex(rawBuffer);
    if (actualSha1.toLowerCase() !== String(entry.sha1).toLowerCase()) {
      throw new Error(`Downloaded Minecraft ${versionId} metadata failed SHA-1 verification`);
    }
  }

  const parsed = JSON.parse(rawBuffer.toString('utf8'));
  if (!parsed || parsed.id !== versionId) {
    throw new Error(`Downloaded metadata does not match Minecraft ${versionId}`);
  }

  const targets = new Set(findCachedVersionJsonPaths({ versionId, globalVersionsDir, instanceDir }));
  if (globalVersionsDir) {
    targets.add(path.join(globalVersionsDir, `${versionId}.json`));
  }

  const updatedPaths = [];
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, rawBuffer);
    fs.renameSync(temp, target);
    updatedPaths.push(target);
  }

  return {
    versionId,
    sha1: entry.sha1 || sha1Hex(rawBuffer),
    updatedPaths,
    freetypeLibraries: extractFreetypeLibraries(parsed),
  };
}

module.exports = {
  VERSION_MANIFEST_V2_URL,
  VERSION_MANIFEST_V2_FALLBACK_URL,
  sha1Hex,
  fileSha1OrNull,
  extractFreetypeLibraries,
  fetchVersionManifestV2,
  findCachedVersionJsonPaths,
  checkVersionSecurityUpdate,
  applyVersionSecurityUpdate,
};
