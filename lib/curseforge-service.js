// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const CURSEFORGE_GAME_ID = 432;
const CURSEFORGE_CONSOLE_URL = 'https://console.curseforge.com/#/api-keys';

const CURSEFORGE_CLASS_IDS = Object.freeze({
  mod: 6,
  resourcepack: 12,
  modpack: 4471,
  datapack: 6945,
  shader: 6552,
});

const CURSEFORGE_LOADER_TYPES = Object.freeze({
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
});

const CURSEFORGE_SORT_FIELDS = Object.freeze({
  relevance: '1',
  featured: '1',
  popularity: '2',
  follows: '2',
  updated: '3',
  downloads: '6',
  newest: '11',
});

const LOADER_SCOPED_TYPES = new Set(['mod', 'modpack']);

/**
 * Normalize a CurseForge content type to one of the supported Pine content categories.
 * @param {unknown} value
 * @returns {'mod' | 'resourcepack' | 'modpack' | 'datapack' | 'shader'}
 */
function normalizeCurseForgeType(value) {
  const key = String(value || 'mod').trim().toLowerCase();
  if (key === 'resourcepack' || key === 'modpack' || key === 'datapack' || key === 'shader') {
    return key;
  }
  return 'mod';
}

/**
 * Produce a safe, masked hint for an API key without exposing the secret.
 * @param {string} key
 * @returns {string | null}
 */
function maskApiKey(key) {
  const clean = String(key || '').trim();
  if (!clean) return null;
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

/**
 * Create an encrypted key store backed by Electron safeStorage (refusing plaintext persistence).
 * @param {{ keyFile: string, safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (text: string) => Buffer, decryptString: (buf: Buffer) => string }, isSecureStorageAvailable: () => boolean, env?: NodeJS.ProcessEnv }} options
 */
function createCurseForgeKeyStore({ keyFile, safeStorage, isSecureStorageAvailable, env = process.env }) {
  /** @returns {string} */
  function readSavedKey() {
    try {
      if (!fs.existsSync(keyFile)) return '';
      if (!isSecureStorageAvailable()) return '';
      const raw = fs.readFileSync(keyFile);
      if (!raw.length) return '';
      return String(safeStorage.decryptString(raw) || '').trim();
    } catch {
      return '';
    }
  }

  /** @returns {string} */
  function getActiveKey() {
    const saved = readSavedKey();
    if (saved) return saved;
    return String(env.PINE_CURSEFORGE_API_KEY || '').trim();
  }

  /** @returns {import('../types').CurseForgeStatus} */
  function getStatus() {
    const secureStorageAvailable = Boolean(isSecureStorageAvailable());
    const saved = readSavedKey();
    if (saved) {
      return {
        configured: true,
        source: 'saved',
        secureStorageAvailable,
        keyHint: maskApiKey(saved),
      };
    }
    const envKey = String(env.PINE_CURSEFORGE_API_KEY || '').trim();
    if (envKey) {
      return {
        configured: true,
        source: 'env',
        secureStorageAvailable,
        keyHint: maskApiKey(envKey),
      };
    }
    return {
      configured: false,
      source: 'none',
      secureStorageAvailable,
      keyHint: null,
    };
  }

  /**
   * @param {string} rawKey
   * @returns {import('../types').CurseForgeStatus}
   */
  function saveKey(rawKey) {
    const clean = String(rawKey || '').trim();
    if (!clean) throw new Error('Enter a CurseForge API key first');
    if (clean.length < 12 || clean.length > 512) {
      throw new Error('That does not look like a valid CurseForge API key');
    }
    if (/[\r\n]/.test(clean)) {
      throw new Error('API key cannot contain line breaks');
    }
    if (!isSecureStorageAvailable()) {
      throw new Error(
        `${process.platform === 'linux' ? 'Linux Secret Service' : 'OS secure credential storage'} is unavailable, so Pine will not save API keys in plaintext`,
      );
    }
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    const encrypted = safeStorage.encryptString(clean);
    const tempFile = `${keyFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, encrypted, { mode: 0o600 });
    fs.renameSync(tempFile, keyFile);
    return getStatus();
  }

  /** @returns {import('../types').CurseForgeStatus} */
  function clearKey() {
    try {
      fs.rmSync(keyFile, { force: true });
    } catch {}
    return getStatus();
  }

  return {
    getActiveKey,
    getStatus,
    saveKey,
    clearKey,
  };
}

/**
 * Build query params for `/v1/mods/search`.
 * Only includes `modLoaderType` for loader-scoped content (`mod`, `modpack`) so
 * resource packs, shaders, and data packs are never filtered out.
 * @param {string} query
 * @param {{ type?: string, gameVersion?: string, loader?: string, offset?: number, limit?: number, sort?: string }} [options]
 * @returns {URLSearchParams}
 */
function buildCurseForgeSearchParams(query, options = {}) {
  const type = normalizeCurseForgeType(options.type);
  const sortKey = String(options.sort || 'relevance').trim().toLowerCase();
  const sortField = CURSEFORGE_SORT_FIELDS[/** @type {keyof typeof CURSEFORGE_SORT_FIELDS} */ (sortKey)] || '2';
  const params = new URLSearchParams({
    gameId: String(CURSEFORGE_GAME_ID),
    classId: String(CURSEFORGE_CLASS_IDS[type]),
    index: String(Math.max(0, Number(options.offset) || 0)),
    pageSize: String(Math.min(50, Math.max(1, Number(options.limit) || 20))),
    sortField,
    sortOrder: 'desc',
  });
  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery) params.set('searchFilter', trimmedQuery.slice(0, 200));
  if (options.gameVersion) params.set('gameVersion', String(options.gameVersion).trim().slice(0, 40));
  const loader = String(options.loader || '').trim().toLowerCase();
  if (LOADER_SCOPED_TYPES.has(type) && CURSEFORGE_LOADER_TYPES[/** @type {keyof typeof CURSEFORGE_LOADER_TYPES} */ (loader)]) {
    params.set('modLoaderType', String(CURSEFORGE_LOADER_TYPES[/** @type {keyof typeof CURSEFORGE_LOADER_TYPES} */ (loader)]));
  }
  return params;
}

/**
 * Build query params for `/v1/mods/:id/files`.
 * Skips `modLoaderType` for resource packs, shaders, and data packs.
 * @param {{ gameVersion?: string, loader?: string } | null} instance
 * @param {string} [contentType]
 * @returns {URLSearchParams}
 */
function buildCurseForgeFilesParams(instance, contentType = 'mod') {
  const type = normalizeCurseForgeType(contentType);
  const params = new URLSearchParams({ pageSize: '50' });
  if (instance?.gameVersion) {
    params.set('gameVersion', String(instance.gameVersion));
  }
  const loader = String(instance?.loader || '').trim().toLowerCase();
  if (instance && LOADER_SCOPED_TYPES.has(type) && CURSEFORGE_LOADER_TYPES[/** @type {keyof typeof CURSEFORGE_LOADER_TYPES} */ (loader)]) {
    params.set('modLoaderType', String(CURSEFORGE_LOADER_TYPES[/** @type {keyof typeof CURSEFORGE_LOADER_TYPES} */ (loader)]));
  }
  return params;
}

/**
 * Convert a CurseForge API project object into Pine's Discover hit format.
 * @param {any} project
 * @param {string} [type]
 * @returns {import('../types').CurseForgeHit}
 */
function normalizeCurseForgeHit(project, type = 'mod') {
  const normalizedType = normalizeCurseForgeType(type);
  return {
    source: 'curseforge',
    project_id: `curseforge:${project.id}`,
    curseforge_id: project.id,
    title: project.name || 'Untitled CurseForge Project',
    author: project.authors?.[0]?.name || 'unknown',
    description: project.summary || '',
    downloads: Number(project.downloadCount) || 0,
    icon_url: project.logo?.url || null,
    project_type: normalizedType,
    website_url: project.links?.websiteUrl || null,
    categories: Array.isArray(project.categories) ? project.categories.map(c => c?.name).filter(Boolean) : [],
    date_modified: project.dateModified || null,
  };
}

/**
 * Verify a downloaded CurseForge file against size and SHA-1/MD5 hashes.
 * @param {any} file
 * @param {string} destination
 * @returns {boolean}
 */
function verifyCurseForgeFile(file, destination) {
  const stat = fs.statSync(destination);
  if (!stat.isFile() || stat.size <= 0) throw new Error('CurseForge download was empty');
  if (Number(file?.fileLength) > 0 && stat.size !== Number(file.fileLength)) {
    throw new Error('CurseForge download size did not match');
  }
  const expected = (file?.hashes || []).find((/** @type {any} */ hash) => hash.algo === 1)
    || (file?.hashes || []).find((/** @type {any} */ hash) => hash.algo === 2);
  if (!expected?.value) return true;
  const algorithm = expected.algo === 1 ? 'sha1' : 'md5';
  const actual = crypto.createHash(algorithm).update(fs.readFileSync(destination)).digest('hex');
  if (actual.toLowerCase() !== String(expected.value).toLowerCase()) {
    throw new Error(`CurseForge ${algorithm.toUpperCase()} checksum did not match`);
  }
  return true;
}

/**
 * Validate whether an external URL is an allowed CurseForge web page.
 * @param {string} rawUrl
 * @returns {string}
 */
function assertAllowedCurseForgeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('Invalid CurseForge URL');
  }
  const allowedHosts = new Set(['console.curseforge.com', 'www.curseforge.com', 'curseforge.com']);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('Only official CurseForge HTTPS pages can be opened');
  }
  return parsed.href;
}

/**
 * Test a CurseForge API key against the Minecraft game metadata endpoint.
 * @param {string} apiKey
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ ok: boolean, game?: string, status: number, message: string }>}
 */
async function testCurseForgeApiKey(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const clean = String(apiKey || '').trim();
  if (!clean) {
    return { ok: false, status: 0, message: 'No CurseForge API key is configured' };
  }
  const response = await fetchImpl(`${CURSEFORGE_API}/games/${CURSEFORGE_GAME_ID}`, {
    headers: { Accept: 'application/json', 'x-api-key': clean },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 403 || response.status === 401) {
    return { ok: false, status: response.status, message: 'CurseForge rejected this API key (403 Forbidden). Check that you copied the full key from console.curseforge.com.' };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, message: `CurseForge returned HTTP ${response.status} (${response.statusText || 'Error'})` };
  }
  const body = await response.json().catch(() => null);
  const gameName = body?.data?.name || 'Minecraft';
  return { ok: true, game: gameName, status: response.status, message: `Connected to CurseForge (${gameName})` };
}

/**
 * Format a clear user-facing error when a CurseForge file disables third-party downloads.
 * @param {any} project
 * @param {any} file
 * @returns {Error & { manualDownloadUrl?: string }}
 */
function createDistributionBlockedError(project, file) {
  const baseUrl = project?.links?.websiteUrl ? String(project.links.websiteUrl).replace(/\/+$/, '') : null;
  const manualDownloadUrl = baseUrl && file?.id ? `${baseUrl}/files/${file.id}` : baseUrl;
  /** @type {Error & { manualDownloadUrl?: string }} */
  const error = new Error(
    manualDownloadUrl
      ? `This author disabled third-party launcher downloads for this file. Download it from CurseForge directly: ${manualDownloadUrl}`
      : 'This author does not allow third-party launcher downloads for this file',
  );
  if (manualDownloadUrl) error.manualDownloadUrl = manualDownloadUrl;
  return error;
}

module.exports = {
  CURSEFORGE_API,
  CURSEFORGE_GAME_ID,
  CURSEFORGE_CONSOLE_URL,
  CURSEFORGE_CLASS_IDS,
  CURSEFORGE_LOADER_TYPES,
  CURSEFORGE_SORT_FIELDS,
  normalizeCurseForgeType,
  maskApiKey,
  createCurseForgeKeyStore,
  buildCurseForgeSearchParams,
  buildCurseForgeFilesParams,
  normalizeCurseForgeHit,
  verifyCurseForgeFile,
  assertAllowedCurseForgeUrl,
  testCurseForgeApiKey,
  createDistributionBlockedError,
};
