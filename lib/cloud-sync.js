// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { resolveSafePath, safeRemoteFilename } = require('./safety');

const MANIFEST_REMOTE_PATH = 'manifest.json';

/** @type {Readonly<import('../types').CloudSyncScopes>} */
const DEFAULT_SYNC_SCOPES = Object.freeze({
  settings: true,
  themes: true,
  servers: true,
  instances: true,
  worlds: false,
});

const SYNCABLE_SETTING_KEYS = Object.freeze([
  'minMemory',
  'maxMemory',
  'launchBehavior',
  'dlLimit',
  'windowWidth',
  'windowHeight',
  'jvmArgs',
  'reducedMotion',
  'discordPresence',
  'discordShowInstance',
  'discordShowServer',
  'compactLibrary',
  'gayMode',
]);

/**
 * Compute deterministic SHA-256 hex digest.
 * @param {Buffer | string} input
 * @returns {string}
 */
function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Normalize Cloud Sync user config with safe defaults.
 * @param {any} raw
 * @returns {import('../types').CloudSyncConfig}
 */
function normalizeCloudSyncConfig(raw = {}) {
  const allowedProviders = new Set(['google-drive', 'onedrive', 'dropbox', 'local-folder']);
  const activeProvider = allowedProviders.has(raw?.activeProvider) ? raw.activeProvider : null;
  const rawScopes = raw?.scopes && typeof raw.scopes === 'object' ? raw.scopes : {};
  return {
    activeProvider,
    autoSyncOnExit: Boolean(raw?.autoSyncOnExit),
    scopes: {
      settings: rawScopes.settings !== false,
      themes: rawScopes.themes !== false,
      servers: rawScopes.servers !== false,
      instances: rawScopes.instances !== false,
      worlds: Boolean(rawScopes.worlds),
    },
    localFolderPath: typeof raw?.localFolderPath === 'string' ? raw.localFolderPath.trim().slice(0, 1024) : '',
    maxWorldSizeMb: Math.min(500, Math.max(10, Number.parseInt(raw?.maxWorldSizeMb, 10) || 100)),
    lastSyncAt: typeof raw?.lastSyncAt === 'string' ? raw.lastSyncAt : null,
    lastSyncSummary: typeof raw?.lastSyncSummary === 'string' ? raw.lastSyncSummary.slice(0, 240) : null,
    deviceId: typeof raw?.deviceId === 'string' && raw.deviceId.trim() ? raw.deviceId.trim().slice(0, 80) : crypto.randomUUID(),
    deviceName: typeof raw?.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName.trim().slice(0, 80) : os.hostname(),
  };
}

/**
 * Strip machine-specific paths and any sensitive fields before syncing launcher settings.
 * @param {Record<string, any>} settings
 */
function sanitizeSettingsForSync(settings = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of SYNCABLE_SETTING_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

/**
 * Extract theme & Theme Studio settings for independent syncing.
 * @param {Record<string, any>} settings
 */
function extractThemesForSync(settings = {}) {
  return {
    theme: settings.theme || 'pine-dark',
    uiStyle: settings.uiStyle || 'pine-island',
    accentColor: settings.accentColor || '#ff5cb9',
    activeCustomThemeId: settings.activeCustomThemeId || null,
    customThemes: Array.isArray(settings.customThemes) ? settings.customThemes : [],
  };
}

/**
 * Build a portable, lightweight JSON sync recipe for one Minecraft instance.
 * Includes loader/version, memory, launch automation hooks, and mod/content metadata
 * while excluding bulky JARs, libraries, assets, logs, and credentials.
 * @param {import('../types').InstanceRecord} instance
 * @param {string} instanceDir
 */
function buildInstanceSyncRecipe(instance, instanceDir) {
  /** @param {string} filename */
  const readLocalJson = (filename) => {
    try {
      const target = path.join(instanceDir, filename);
      if (!fs.existsSync(target)) return {};
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      return {};
    }
  };
  return {
    format: 1,
    name: instance.name,
    gameVersion: instance.gameVersion,
    profile: instance.profile || 'custom',
    loader: instance.loader || 'vanilla',
    loaderVersion: instance.loaderVersion || null,
    minMemory: instance.minMemory || null,
    maxMemory: instance.maxMemory || null,
    memoryOverride: Boolean(instance.memoryOverride),
    jvmArgs: instance.jvmArgs || '',
    hooks: instance.hooks && typeof instance.hooks === 'object' ? {
      preLaunch: String(instance.hooks.preLaunch || ''),
      postExit: String(instance.hooks.postExit || ''),
      env: String(instance.hooks.env || ''),
    } : null,
    group: instance.group || '',
    favorite: Boolean(instance.favorite),
    bannerBlurDir: instance.bannerBlurDir || 'left',
    modpack: instance.modpack ? {
      source: instance.modpack.source || null,
      projectId: instance.modpack.projectId || null,
      installedVersion: instance.modpack.installedVersion || null,
      versionName: instance.modpack.versionName || null,
    } : null,
    modsMeta: readLocalJson('mods_meta.json'),
    contentMeta: readLocalJson('content_meta.json'),
  };
}

/**
 * Create a safe key segment from an instance or world name.
 * @param {string} value
 * @returns {string}
 */
function safeSyncSlug(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `item_${sha256Hex(String(value || '')).slice(0, 8)}`;
  }
  return cleaned;
}

/**
 * Compress a Minecraft world directory into an in-memory ZIP buffer, respecting a byte cap.
 * @param {string} worldDir
 * @param {number} maxBytes
 * @returns {{ buffer: Buffer | null, skippedReason: string | null }}
 */
function zipWorldDirectory(worldDir, maxBytes) {
  if (!fs.existsSync(worldDir) || !fs.statSync(worldDir).isDirectory()) {
    return { buffer: null, skippedReason: 'World directory not found' };
  }
  let totalRaw = 0;
  const zip = new AdmZip();

  /** @param {string} currentDir @param {string} relPrefix */
  function addDir(currentDir, relPrefix) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === 'session.lock') continue;
      const full = path.join(currentDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(full, rel);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        totalRaw += stat.size;
        if (totalRaw > maxBytes * 2) {
          throw new Error('WORLD_TOO_LARGE');
        }
        zip.addLocalFile(full, relPrefix);
      }
    }
  }

  try {
    addDir(worldDir, '');
  } catch (err) {
    if (err instanceof Error && err.message === 'WORLD_TOO_LARGE') {
      return { buffer: null, skippedReason: `Exceeds ${Math.round(maxBytes / (1024 * 1024))} MB world sync limit` };
    }
    throw err;
  }

  const buffer = zip.toBuffer();
  if (buffer.length > maxBytes) {
    return { buffer: null, skippedReason: `Compressed archive (${Math.round(buffer.length / (1024 * 1024))} MB) exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit` };
  }
  return { buffer, skippedReason: null };
}

/**
 * Safely extract a synced world ZIP buffer into a target world directory (no zip-slip).
 * @param {Buffer} zipBuffer
 * @param {string} destinationWorldDir
 */
function extractWorldZipSafe(zipBuffer, destinationWorldDir) {
  const archive = new AdmZip(zipBuffer);
  const staging = `${destinationWorldDir}.cloud-staging-${Date.now()}`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    let totalBytes = 0;
    let fileCount = 0;
    for (const entry of archive.getEntries()) {
      if (entry.isDirectory) continue;
      const normalized = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
      const parts = normalized.split('/').filter(Boolean);
      if (!parts.length || parts.some(p => p === '.' || p === '..')) {
        throw new Error('Synced world archive contains an unsafe path');
      }
      fileCount += 1;
      totalBytes += entry.header.size;
      if (fileCount > 25000 || totalBytes > 1024 * 1024 * 1024) {
        throw new Error('Synced world archive exceeds safety extraction limits');
      }
      const outPath = resolveSafePath(staging, ...parts);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }
    if (fs.existsSync(destinationWorldDir)) {
      fs.rmSync(destinationWorldDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(destinationWorldDir), { recursive: true });
    fs.renameSync(staging, destinationWorldDir);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * 3-way sync planner comparing local items, remote manifest items, and last-synced baseline.
 * Never silently overwrites when both sides diverged — emits explicit conflicts instead.
 * @param {Record<string, import('../types').CloudSyncItemDescriptor>} localItems
 * @param {Record<string, import('../types').CloudSyncItemDescriptor>} remoteItems
 * @param {Record<string, import('../types').CloudSyncItemDescriptor>} [lastSyncedItems]
 * @param {Array<{ key: string, label: string, reason: string }>} [skipped]
 * @returns {import('../types').CloudSyncPlan}
 */
function computeSyncPlan(localItems, remoteItems, lastSyncedItems = {}, skipped = []) {
  /** @type {import('../types').CloudSyncItemDescriptor[]} */
  const toPush = [];
  /** @type {import('../types').CloudSyncItemDescriptor[]} */
  const toPull = [];
  /** @type {import('../types').CloudSyncConflict[]} */
  const conflicts = [];
  /** @type {import('../types').CloudSyncItemDescriptor[]} */
  const unchanged = [];

  const allKeys = new Set([
    ...Object.keys(localItems || {}),
    ...Object.keys(remoteItems || {}),
  ]);

  for (const key of [...allKeys].sort()) {
    const local = localItems[key] || null;
    const remote = remoteItems[key] || null;
    const base = lastSyncedItems[key] || null;

    if (local && remote) {
      if (local.hash === remote.hash) {
        unchanged.push(local);
        continue;
      }
      const localChanged = !base || base.hash !== local.hash;
      const remoteChanged = !base || base.hash !== remote.hash;
      if (localChanged && !remoteChanged) {
        toPush.push(local);
      } else if (!localChanged && remoteChanged) {
        toPull.push(remote);
      } else {
        conflicts.push({
          key,
          kind: local.kind,
          label: local.label || remote.label,
          local,
          remote,
        });
      }
    } else if (local && !remote) {
      // Push local item (even if previously synced and deleted remotely, prefer safety over auto-deleting local user data)
      toPush.push(local);
    } else if (!local && remote) {
      toPull.push(remote);
    }
  }

  return { toPush, toPull, conflicts, unchanged, skipped: [...skipped] };
}

/**
 * Collect local syncable payloads and descriptors according to the user's selected scopes.
 * @param {{
 *   scopes: import('../types').CloudSyncScopes,
 *   settings: Record<string, any>,
 *   savedServers: any[],
 *   instances: import('../types').InstanceRecord[],
 *   getInstanceDir: (instance: import('../types').InstanceRecord) => string,
 *   maxWorldSizeMb?: number,
 * }} options
 */
function collectLocalSyncBundle({ scopes, settings, savedServers, instances, getInstanceDir, maxWorldSizeMb = 100 }) {
  /** @type {Record<string, import('../types').CloudSyncItemDescriptor>} */
  const descriptors = {};
  /** @type {Record<string, { buffer: Buffer, contentType: string }>} */
  const payloads = {};
  /** @type {Array<{ key: string, label: string, reason: string }>} */
  const skipped = [];
  const nowIso = new Date().toISOString();

  /**
   * @param {string} key
   * @param {import('../types').CloudSyncItemDescriptor['kind']} kind
   * @param {string} label
   * @param {any} data
   */
  function addJson(key, kind, label, data) {
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    descriptors[key] = {
      key,
      kind,
      label,
      hash: sha256Hex(buffer),
      size: buffer.length,
      modifiedAt: nowIso,
    };
    payloads[key] = { buffer, contentType: 'application/json' };
  }

  if (scopes.settings) {
    addJson('settings.json', 'settings', 'Launcher settings', sanitizeSettingsForSync(settings));
  }

  if (scopes.themes) {
    addJson('themes.json', 'themes', 'Themes & Theme Studio presets', extractThemesForSync(settings));
  }

  if (scopes.servers) {
    addJson('servers.json', 'servers', 'Saved servers', Array.isArray(savedServers) ? savedServers : []);
  }

  if (scopes.instances) {
    for (const instance of instances || []) {
      let dir = '';
      try { dir = getInstanceDir(instance); } catch { continue; }
      const recipe = buildInstanceSyncRecipe(instance, dir);
      const slug = safeSyncSlug(instance.name);
      addJson(`instances/${slug}.json`, 'instance', `Instance: ${instance.name}`, recipe);
    }
  }

  if (scopes.worlds) {
    const maxBytes = Math.max(10, Number(maxWorldSizeMb) || 100) * 1024 * 1024;
    for (const instance of instances || []) {
      let dir = '';
      try { dir = getInstanceDir(instance); } catch { continue; }
      const savesDir = path.join(dir, 'saves');
      if (!fs.existsSync(savesDir)) continue;
      for (const entry of fs.readdirSync(savesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const worldDir = path.join(savesDir, entry.name);
        if (!fs.existsSync(path.join(worldDir, 'level.dat'))) continue;
        const instSlug = safeSyncSlug(instance.name);
        const worldSlug = safeSyncSlug(entry.name);
        const key = `worlds/${instSlug}/${worldSlug}.zip`;
        const label = `World: ${instance.name} / ${entry.name}`;
        const { buffer, skippedReason } = zipWorldDirectory(worldDir, maxBytes);
        if (!buffer) {
          skipped.push({ key, label, reason: skippedReason || 'Skipped' });
          continue;
        }
        const stat = fs.statSync(path.join(worldDir, 'level.dat'));
        descriptors[key] = {
          key,
          kind: 'world',
          label,
          hash: sha256Hex(buffer),
          size: buffer.length,
          modifiedAt: stat.mtime.toISOString(),
        };
        payloads[key] = { buffer, contentType: 'application/zip' };
      }
    }
  }

  return { descriptors, payloads, skipped };
}

/**
 * Build a manifest object to upload as `manifest.json`.
 * @param {import('../types').CloudSyncConfig} config
 * @param {Record<string, import('../types').CloudSyncItemDescriptor>} items
 * @returns {import('../types').CloudSyncManifest}
 */
function buildRemoteManifest(config, items) {
  return {
    format: 1,
    product: 'Pine Launcher',
    updatedAt: new Date().toISOString(),
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    items,
  };
}

/**
 * Parse a remote `manifest.json` buffer safely.
 * @param {Buffer | null} buffer
 * @returns {import('../types').CloudSyncManifest | null}
 */
function parseRemoteManifest(buffer) {
  if (!buffer || !buffer.length) return null;
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (!parsed || parsed.format !== 1 || typeof parsed.items !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Filter a manifest's items map to only the scopes the user enabled.
 * @param {Record<string, import('../types').CloudSyncItemDescriptor>} items
 * @param {import('../types').CloudSyncScopes} scopes
 */
function filterItemsByScopes(items, scopes) {
  /** @type {Record<string, import('../types').CloudSyncItemDescriptor>} */
  const out = {};
  for (const [key, item] of Object.entries(items || {})) {
    if (!item) continue;
    if (item.kind === 'settings' && !scopes.settings) continue;
    if (item.kind === 'themes' && !scopes.themes) continue;
    if (item.kind === 'servers' && !scopes.servers) continue;
    if (item.kind === 'instance' && !scopes.instances) continue;
    if (item.kind === 'world' && !scopes.worlds) continue;
    out[key] = item;
  }
  return out;
}

/**
 * Pick a safe non-colliding duplicate folder name for a world conflict copy.
 * @param {string} savesDir
 * @param {string} baseName
 */
function uniqueWorldDuplicateName(savesDir, baseName) {
  const clean = safeRemoteFilename(baseName);
  let candidate = `${clean} (Cloud Copy)`;
  let counter = 2;
  while (fs.existsSync(path.join(savesDir, candidate))) {
    candidate = `${clean} (Cloud Copy ${counter})`;
    counter += 1;
  }
  return candidate;
}

module.exports = {
  MANIFEST_REMOTE_PATH,
  DEFAULT_SYNC_SCOPES,
  SYNCABLE_SETTING_KEYS,
  sha256Hex,
  normalizeCloudSyncConfig,
  sanitizeSettingsForSync,
  extractThemesForSync,
  buildInstanceSyncRecipe,
  safeSyncSlug,
  zipWorldDirectory,
  extractWorldZipSafe,
  computeSyncPlan,
  collectLocalSyncBundle,
  buildRemoteManifest,
  parseRemoteManifest,
  filterItemsByScopes,
  uniqueWorldDuplicateName,
};
