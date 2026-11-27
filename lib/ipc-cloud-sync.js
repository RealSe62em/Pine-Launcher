// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_OAUTH_PORT,
  OAUTH_PROVIDERS,
  isOAuthProvider,
  buildRedirectUri,
  startBrowserOAuthFlow,
  createCloudAuthStore,
} = require('./cloud-sync-oauth');
const {
  createGoogleDriveProvider,
  createOneDriveProvider,
  createDropboxProvider,
  createLocalFolderProvider,
} = require('./cloud-sync-providers');
const {
  MANIFEST_REMOTE_PATH,
  normalizeCloudSyncConfig,
  sanitizeSettingsForSync,
  extractThemesForSync,
  safeSyncSlug,
  extractWorldZipSafe,
  computeSyncPlan,
  collectLocalSyncBundle,
  buildRemoteManifest,
  parseRemoteManifest,
  filterItemsByScopes,
  uniqueWorldDuplicateName,
} = require('./cloud-sync');
const { sanitizeCustomThemes, sanitizeMemory } = require('./settings');
const { resolveSafePath, safeRemoteFilename } = require('./safety');

/**
 * Register Cloud Sync IPC handlers (Google Drive, OneDrive, Dropbox browser OAuth + Synced Folder).
 * @param {{
 *   ipcMain: Electron.IpcMain,
 *   app: Electron.App,
 *   dialog: Electron.Dialog,
 *   shell: Electron.Shell,
 *   safeStorage: Electron.SafeStorage,
 *   getMainWindow: () => Electron.BrowserWindow | null,
 *   isSecureStorageAvailable: () => boolean,
 *   portableFetch: typeof globalThis.fetch,
 *   readJSON: (file: string) => any,
 *   writeJSON: (file: string, data: any) => void,
 *   ensureDir: (dir: string) => void,
 *   SETTINGS_FILE: string,
 *   INSTANCES_FILE: string,
 *   INSTANCES_DIR: string,
 *   serverFile: string,
 *   getInstanceDir: (instance: any, ...sub: string[]) => string,
 *   getActiveInstanceName: () => string | null,
 *   sanitizeName: (value: string) => string,
 *   createAutomaticInstanceBackup?: (instance: any, reason: string) => Promise<any>,
 *   refreshDiscordPresence?: (settings: any) => void,
 * }} deps
 */
function registerCloudSyncIPC({
  ipcMain,
  app,
  dialog,
  shell,
  safeStorage,
  getMainWindow,
  isSecureStorageAvailable,
  portableFetch,
  readJSON,
  writeJSON,
  ensureDir,
  SETTINGS_FILE,
  INSTANCES_FILE,
  INSTANCES_DIR,
  serverFile,
  getInstanceDir,
  getActiveInstanceName,
  sanitizeName,
  createAutomaticInstanceBackup,
  refreshDiscordPresence,
}) {
  const userData = app.getPath('userData');
  const configFile = path.join(userData, 'cloud-sync-config.json');
  const stateFile = path.join(userData, 'cloud-sync-state.json');
  const authFile = path.join(userData, 'cloud-sync-auth.bin');

  const authStore = createCloudAuthStore({
    authFile,
    safeStorage,
    isSecureStorageAvailable,
  });

  /** @type {{ providerId: import('../types').CloudSyncOAuthProviderId, cancel: (reason?: string) => void } | null} */
  let pendingOAuth = null;
  let syncInProgress = false;

  /** @param {any} payload */
  function sendProgress(payload) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('cloud-sync-progress', payload);
    }
  }

  /** @returns {import('../types').CloudSyncConfig} */
  function readConfig() {
    const normalized = normalizeCloudSyncConfig(readJSON(configFile) || {});
    if (!fs.existsSync(configFile)) {
      writeJSON(configFile, normalized);
    }
    return normalized;
  }

  /** @param {import('../types').CloudSyncConfig} config */
  function writeConfig(config) {
    writeJSON(configFile, config);
  }

  /** @param {string} providerId */
  function readLastSynced(providerId) {
    const all = readJSON(stateFile) || {};
    return all[providerId] && typeof all[providerId] === 'object' ? all[providerId] : {};
  }

  /**
   * @param {string} providerId
   * @param {Record<string, import('../types').CloudSyncItemDescriptor>} items
   */
  function writeLastSynced(providerId, items) {
    const all = readJSON(stateFile) || {};
    all[providerId] = items;
    writeJSON(stateFile, all);
  }

  /** @returns {import('../types').CloudSyncStatus} */
  function buildStatus() {
    const config = readConfig();
    const secureStorageAvailable = Boolean(isSecureStorageAvailable());
    const redirectUri = buildRedirectUri(DEFAULT_OAUTH_PORT);
    /** @type {Record<import('../types').CloudSyncProviderId, import('../types').CloudSyncProviderState>} */
    const providers = /** @type {any} */ ({});

    for (const id of /** @type {const} */ (['google-drive', 'onedrive', 'dropbox'])) {
      const meta = OAUTH_PROVIDERS[id];
      const entry = authStore.getProviderEntry(id);
      const creds = authStore.resolveOAuthCredentials(id);
      const connected = Boolean(entry.accessToken || entry.refreshToken);
      providers[id] = {
        id,
        label: meta.label,
        connected,
        hasClientId: Boolean(creds.clientId),
        clientIdSource: creds.source,
        account: connected ? (entry.account || null) : null,
        redirectUri,
        consoleUrl: meta.consoleUrl,
        supportsClientSecret: meta.supportsClientSecret,
      };
    }

    providers['local-folder'] = {
      id: 'local-folder',
      label: 'Synced Folder (Drive / OneDrive / Dropbox App)',
      connected: Boolean(config.localFolderPath && fs.existsSync(config.localFolderPath)),
      hasClientId: true,
      clientIdSource: 'env',
      account: config.localFolderPath
        ? { email: null, name: config.localFolderPath }
        : null,
      redirectUri: null,
      consoleUrl: null,
      supportsClientSecret: false,
      folderPath: config.localFolderPath || null,
    };

    return {
      config,
      secureStorageAvailable,
      connectingProvider: pendingOAuth?.providerId || null,
      providers,
    };
  }

  /**
   * Instantiate the active provider adapter.
   * @param {import('../types').CloudSyncProviderId} providerId
   * @param {import('../types').CloudSyncConfig} config
   */
  function createProviderAdapter(providerId, config) {
    if (providerId === 'local-folder') {
      return createLocalFolderProvider({ rootDir: config.localFolderPath });
    }
    if (providerId === 'google-drive') {
      return createGoogleDriveProvider({
        getAccessToken: () => authStore.getValidAccessToken('google-drive', { fetchImpl: portableFetch }),
        fetchImpl: portableFetch,
      });
    }
    if (providerId === 'onedrive') {
      return createOneDriveProvider({
        getAccessToken: () => authStore.getValidAccessToken('onedrive', { fetchImpl: portableFetch }),
        fetchImpl: portableFetch,
      });
    }
    if (providerId === 'dropbox') {
      return createDropboxProvider({
        getAccessToken: () => authStore.getValidAccessToken('dropbox', { fetchImpl: portableFetch }),
        fetchImpl: portableFetch,
      });
    }
    throw new Error(`Unsupported cloud provider: ${providerId}`);
  }

  /**
   * Apply a downloaded remote item safely onto local Pine storage.
   * @param {import('../types').CloudSyncItemDescriptor} descriptor
   * @param {Buffer} buffer
   * @param {'remote' | 'duplicate'} [strategy]
   */
  async function applyRemoteItem(descriptor, buffer, strategy = 'remote') {
    if (descriptor.kind === 'settings') {
      const incoming = sanitizeSettingsForSync(JSON.parse(buffer.toString('utf8')));
      const current = readJSON(SETTINGS_FILE) || {};
      const merged = { ...current, ...incoming };
      writeJSON(SETTINGS_FILE, merged);
      refreshDiscordPresence?.(merged);
      return;
    }

    if (descriptor.kind === 'themes') {
      const incoming = JSON.parse(buffer.toString('utf8')) || {};
      const current = readJSON(SETTINGS_FILE) || {};
      const customThemes = sanitizeCustomThemes(incoming.customThemes);
      const activeCustomThemeId = customThemes.some(t => t.id === incoming.activeCustomThemeId)
        ? incoming.activeCustomThemeId
        : null;
      const merged = {
        ...current,
        theme: typeof incoming.theme === 'string' ? incoming.theme : (current.theme || 'pine-dark'),
        uiStyle: typeof incoming.uiStyle === 'string' ? incoming.uiStyle : (current.uiStyle || 'pine-island'),
        accentColor: /^#[0-9a-f]{6}$/i.test(incoming.accentColor || '') ? incoming.accentColor : (current.accentColor || '#ff5cb9'),
        customThemes,
        activeCustomThemeId,
      };
      writeJSON(SETTINGS_FILE, merged);
      return;
    }

    if (descriptor.kind === 'servers') {
      const incoming = JSON.parse(buffer.toString('utf8'));
      if (!Array.isArray(incoming)) return;
      writeJSON(serverFile, incoming.slice(0, 500));
      return;
    }

    if (descriptor.kind === 'instance') {
      const recipe = JSON.parse(buffer.toString('utf8')) || {};
      if (!recipe.name || !recipe.gameVersion) return;
      const cleanName = sanitizeName(recipe.name);
      const registry = readJSON(INSTANCES_FILE) || [];
      const existingIdx = registry.findIndex((/** @type {any} */ item) => item.name === cleanName);
      const defaults = readJSON(SETTINGS_FILE) || {};
      if (existingIdx >= 0) {
        const existing = registry[existingIdx];
        registry[existingIdx] = {
          ...existing,
          gameVersion: String(recipe.gameVersion),
          loader: String(recipe.loader || existing.loader || 'vanilla'),
          loaderVersion: recipe.loaderVersion ?? existing.loaderVersion ?? null,
          minMemory: sanitizeMemory(recipe.minMemory, existing.minMemory || '4G'),
          maxMemory: sanitizeMemory(recipe.maxMemory, existing.maxMemory || '4G'),
          memoryOverride: Boolean(recipe.memoryOverride),
          jvmArgs: typeof recipe.jvmArgs === 'string' ? recipe.jvmArgs.slice(0, 4096) : (existing.jvmArgs || ''),
          hooks: recipe.hooks && typeof recipe.hooks === 'object' ? {
            preLaunch: String(recipe.hooks.preLaunch || '').slice(0, 2048),
            postExit: String(recipe.hooks.postExit || '').slice(0, 2048),
            env: String(recipe.hooks.env || '').slice(0, 4096),
          } : (existing.hooks || undefined),
          group: typeof recipe.group === 'string' ? recipe.group.slice(0, 80) : (existing.group || ''),
          favorite: Boolean(recipe.favorite),
        };
        writeJSON(INSTANCES_FILE, registry);
        const dir = getInstanceDir(registry[existingIdx]);
        ensureDir(dir);
        if (recipe.modsMeta && typeof recipe.modsMeta === 'object' && Object.keys(recipe.modsMeta).length) {
          writeJSON(path.join(dir, 'mods_meta.json'), recipe.modsMeta);
        }
        if (recipe.contentMeta && typeof recipe.contentMeta === 'object' && Object.keys(recipe.contentMeta).length) {
          writeJSON(path.join(dir, 'content_meta.json'), recipe.contentMeta);
        }
      } else {
        const instanceDir = resolveSafePath(INSTANCES_DIR, cleanName);
        ensureDir(path.join(instanceDir, 'mods'));
        ensureDir(path.join(instanceDir, 'saves'));
        ensureDir(path.join(instanceDir, 'config'));
        const entry = {
          id: crypto.randomUUID(),
          name: cleanName,
          path: instanceDir,
          customRoot: '',
          gameVersion: String(recipe.gameVersion),
          profile: String(recipe.profile || 'custom'),
          loader: String(recipe.loader || 'vanilla'),
          loaderVersion: recipe.loaderVersion || null,
          created: new Date().toISOString(),
          lastPlayed: null,
          minMemory: sanitizeMemory(recipe.minMemory, defaults.minMemory || '4G'),
          maxMemory: sanitizeMemory(recipe.maxMemory, defaults.maxMemory || '4G'),
          memoryOverride: Boolean(recipe.memoryOverride),
          jvmArgs: typeof recipe.jvmArgs === 'string' ? recipe.jvmArgs.slice(0, 4096) : '',
          hooks: recipe.hooks && typeof recipe.hooks === 'object' ? {
            preLaunch: String(recipe.hooks.preLaunch || '').slice(0, 2048),
            postExit: String(recipe.hooks.postExit || '').slice(0, 2048),
            env: String(recipe.hooks.env || '').slice(0, 4096),
          } : undefined,
          group: typeof recipe.group === 'string' ? recipe.group.slice(0, 80) : '',
          favorite: Boolean(recipe.favorite),
          iconData: null,
          bannerData: null,
          bannerBlurDir: String(recipe.bannerBlurDir || 'left'),
          modpack: null,
        };
        registry.push(entry);
        writeJSON(INSTANCES_FILE, registry);
        if (recipe.modsMeta && typeof recipe.modsMeta === 'object') {
          writeJSON(path.join(instanceDir, 'mods_meta.json'), recipe.modsMeta);
        }
        if (recipe.contentMeta && typeof recipe.contentMeta === 'object') {
          writeJSON(path.join(instanceDir, 'content_meta.json'), recipe.contentMeta);
        }
      }
      return;
    }

    if (descriptor.kind === 'world') {
      // Key format: worlds/<instSlug>/<worldSlug>.zip
      const match = descriptor.key.match(/^worlds\/([^/]+)\/([^/]+)\.zip$/);
      if (!match) return;
      const [, instSlug, worldSlug] = match;
      const registry = readJSON(INSTANCES_FILE) || [];
      const instance = registry.find((/** @type {any} */ item) => safeSyncSlug(item.name) === instSlug);
      if (!instance) return;
      const savesDir = getInstanceDir(instance, 'saves');
      ensureDir(savesDir);
      const targetName = strategy === 'duplicate'
        ? uniqueWorldDuplicateName(savesDir, worldSlug)
        : safeRemoteFilename(worldSlug);
      const worldDir = resolveSafePath(savesDir, targetName);
      if (strategy === 'remote' && fs.existsSync(worldDir) && createAutomaticInstanceBackup) {
        await createAutomaticInstanceBackup(instance, `Before Cloud Sync pulled world ${targetName}`).catch(() => {});
      }
      extractWorldZipSafe(buffer, worldDir);
    }
  }

  /**
   * Preview sync differences against the active provider without modifying anything.
   * @param {import('../types').CloudSyncProviderId} [requestedProvider]
   */
  async function previewSync(requestedProvider) {
    const config = readConfig();
    const providerId = requestedProvider || config.activeProvider;
    if (!providerId) throw new Error('Choose and connect a Cloud Sync provider first');
    const provider = createProviderAdapter(providerId, config);
    const localBundle = collectLocalSyncBundle({
      scopes: config.scopes,
      settings: readJSON(SETTINGS_FILE) || {},
      savedServers: readJSON(serverFile) || [],
      instances: readJSON(INSTANCES_FILE) || [],
      getInstanceDir,
      maxWorldSizeMb: config.maxWorldSizeMb,
    });
    const remoteManifestRaw = await provider.downloadFile(MANIFEST_REMOTE_PATH);
    const remoteManifest = parseRemoteManifest(remoteManifestRaw);
    const remoteItems = filterItemsByScopes(remoteManifest?.items || {}, config.scopes);
    const lastSynced = filterItemsByScopes(readLastSynced(providerId), config.scopes);
    const plan = computeSyncPlan(localBundle.descriptors, remoteItems, lastSynced, localBundle.skipped);
    return {
      providerId,
      plan,
      remoteUpdatedAt: remoteManifest?.updatedAt || null,
      remoteDeviceName: remoteManifest?.deviceName || null,
      localBundle,
      remoteManifest,
      provider,
      config,
    };
  }

  /**
   * Execute a cloud sync operation (`smart`, `push`, or `pull`).
   * @param {{
   *   mode?: 'smart' | 'push' | 'pull',
   *   providerId?: import('../types').CloudSyncProviderId,
   *   resolutions?: Record<string, 'local' | 'remote' | 'duplicate'>,
   * }} [options]
   */
  async function runSync(options = {}) {
    if (syncInProgress) throw new Error('A Cloud Sync operation is already running');
    if (getActiveInstanceName()) {
      throw new Error('Close Minecraft before running Cloud Sync so worlds and configs stay consistent');
    }
    syncInProgress = true;
    try {
      const mode = options.mode === 'push' || options.mode === 'pull' ? options.mode : 'smart';
      const resolutions = options.resolutions && typeof options.resolutions === 'object' ? options.resolutions : {};

      sendProgress({ stage: 'scanning', message: 'Comparing local data with cloud…', percent: 10 });
      const { providerId, plan, localBundle, remoteManifest, provider, config } = await previewSync(options.providerId);

      /** @type {import('../types').CloudSyncItemDescriptor[]} */
      const pushQueue = [];
      /** @type {Array<{ item: import('../types').CloudSyncItemDescriptor, strategy: 'remote' | 'duplicate' }>} */
      const pullQueue = [];
      /** @type {import('../types').CloudSyncConflict[]} */
      const unresolvedConflicts = [];

      if (mode === 'push') {
        for (const item of [...plan.toPush, ...plan.conflicts.map(c => c.local)]) {
          pushQueue.push(item);
        }
      } else if (mode === 'pull') {
        for (const item of [...plan.toPull, ...plan.conflicts.map(c => c.remote)]) {
          pullQueue.push({ item, strategy: 'remote' });
        }
      } else {
        pushQueue.push(...plan.toPush);
        for (const item of plan.toPull) pullQueue.push({ item, strategy: 'remote' });
        for (const conflict of plan.conflicts) {
          const choice = resolutions[conflict.key];
          if (choice === 'local') pushQueue.push(conflict.local);
          else if (choice === 'remote') pullQueue.push({ item: conflict.remote, strategy: 'remote' });
          else if (choice === 'duplicate') {
            pullQueue.push({ item: conflict.remote, strategy: 'duplicate' });
            pushQueue.push(conflict.local);
          } else {
            unresolvedConflicts.push(conflict);
          }
        }
      }

      if (unresolvedConflicts.length > 0) {
        sendProgress({ stage: 'conflicts', message: `${unresolvedConflicts.length} conflict(s) need your choice`, percent: 100 });
        return {
          status: 'conflicts',
          pushed: 0,
          pulled: 0,
          conflicts: unresolvedConflicts,
          skipped: plan.skipped,
        };
      }

      const totalOps = Math.max(1, pushQueue.length + pullQueue.length);
      let completedOps = 0;

      /** @type {Record<string, import('../types').CloudSyncItemDescriptor>} */
      const nextManifestItems = { ...(remoteManifest?.items || {}) };

      for (const { item, strategy } of pullQueue) {
        completedOps += 1;
        sendProgress({
          stage: 'pulling',
          message: `Downloading ${item.label}…`,
          percent: 15 + Math.round((completedOps / totalOps) * 75),
        });
        const buf = await provider.downloadFile(item.key);
        if (buf) {
          await applyRemoteItem(item, buf, strategy);
          if (strategy === 'remote') {
            nextManifestItems[item.key] = item;
          }
        }
      }

      for (const item of pushQueue) {
        completedOps += 1;
        sendProgress({
          stage: 'pushing',
          message: `Uploading ${item.label}…`,
          percent: 15 + Math.round((completedOps / totalOps) * 75),
        });
        const payload = localBundle.payloads[item.key];
        if (!payload) continue;
        await provider.uploadFile(item.key, payload.buffer, payload.contentType);
        nextManifestItems[item.key] = item;
      }

      // Always keep unchanged items in manifest
      for (const item of plan.unchanged) {
        nextManifestItems[item.key] = item;
      }

      if (pushQueue.length > 0 || !remoteManifest) {
        sendProgress({ stage: 'finalizing', message: 'Updating cloud manifest…', percent: 95 });
        const nextManifest = buildRemoteManifest(config, nextManifestItems);
        await provider.uploadFile(
          MANIFEST_REMOTE_PATH,
          Buffer.from(JSON.stringify(nextManifest, null, 2), 'utf8'),
          'application/json',
        );
      }

      writeLastSynced(providerId, nextManifestItems);
      const summary = pushQueue.length === 0 && pullQueue.length === 0
        ? 'Already up to date'
        : `Uploaded ${pushQueue.length}, downloaded ${pullQueue.length}`;
      const updatedConfig = {
        ...config,
        activeProvider: providerId,
        lastSyncAt: new Date().toISOString(),
        lastSyncSummary: summary,
      };
      writeConfig(updatedConfig);
      sendProgress({ stage: 'done', message: summary, percent: 100 });

      return {
        status: 'synced',
        pushed: pushQueue.length,
        pulled: pullQueue.length,
        unchanged: plan.unchanged.length,
        conflicts: [],
        skipped: plan.skipped,
        summary,
        statusSnapshot: buildStatus(),
      };
    } finally {
      syncInProgress = false;
    }
  }

  // ── IPC Handler Registration ───────────────────────────────────

  ipcMain.handle('cloud-sync-get-status', async () => buildStatus());

  ipcMain.handle('cloud-sync-save-config', async (_, patch = {}) => {
    const current = readConfig();
    const next = normalizeCloudSyncConfig({
      ...current,
      ...patch,
      scopes: {
        ...current.scopes,
        ...(patch?.scopes && typeof patch.scopes === 'object' ? patch.scopes : {}),
      },
    });
    if (patch?.oauthCredentials && typeof patch.oauthCredentials === 'object') {
      for (const [providerId, creds] of Object.entries(patch.oauthCredentials)) {
        if (!isOAuthProvider(providerId) || !creds || typeof creds !== 'object') continue;
        authStore.saveOAuthCredentials(providerId, {
          clientId: String(creds.clientId || ''),
          clientSecret: String(creds.clientSecret || ''),
        });
      }
    }
    writeConfig(next);
    return buildStatus();
  });

  ipcMain.handle('cloud-sync-choose-folder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
      title: 'Choose a Google Drive, OneDrive, Dropbox, or Syncthing folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const folderPath = result.filePaths[0];
    const current = readConfig();
    writeConfig({
      ...current,
      localFolderPath: folderPath,
      activeProvider: 'local-folder',
    });
    return { canceled: false, folderPath, status: buildStatus() };
  });

  ipcMain.handle('cloud-sync-connect', async (_, options = {}) => {
    const providerId = String(options?.providerId || '');
    if (!isOAuthProvider(providerId)) {
      throw new Error('Choose Google Drive, OneDrive, or Dropbox to sign in with your browser');
    }
    if (!isSecureStorageAvailable()) {
      throw new Error(
        `${process.platform === 'linux' ? 'Linux Secret Service' : 'OS secure credential storage'} is unavailable, so Pine cannot safely store Cloud Sync tokens`,
      );
    }
    if (options?.clientId) {
      authStore.saveOAuthCredentials(providerId, {
        clientId: String(options.clientId),
        clientSecret: String(options.clientSecret || ''),
      });
    }
    const creds = authStore.resolveOAuthCredentials(providerId);
    const meta = OAUTH_PROVIDERS[providerId];
    if (!creds.clientId) {
      throw new Error(`Enter a ${meta.label} OAuth Client ID under OAuth App Setup first (free from ${meta.label} developer console)`);
    }

    if (pendingOAuth) {
      pendingOAuth.cancel('Replaced by a new Cloud Sync sign-in request');
      pendingOAuth = null;
    }

    const flow = startBrowserOAuthFlow({
      providerId,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      openExternal: (url) => shell.openExternal(url),
      fetchImpl: portableFetch,
    });
    pendingOAuth = { providerId, cancel: flow.cancel };

    try {
      const tokens = await flow.promise;
      authStore.saveProviderSession(providerId, { ...tokens, account: null });
      const config = readConfig();
      const adapter = createProviderAdapter(providerId, config);
      const account = await adapter.getAccountInfo().catch(() => ({ email: null, name: null }));
      authStore.saveProviderSession(providerId, { ...tokens, account });
      writeConfig({ ...config, activeProvider: providerId });
      return buildStatus();
    } finally {
      if (pendingOAuth?.providerId === providerId) pendingOAuth = null;
    }
  });

  ipcMain.handle('cloud-sync-cancel-connect', async () => {
    if (pendingOAuth) {
      pendingOAuth.cancel('Sign-in cancelled');
      pendingOAuth = null;
    }
    return buildStatus();
  });

  ipcMain.handle('cloud-sync-disconnect', async (_, providerId) => {
    const id = String(providerId || '');
    const config = readConfig();
    if (isOAuthProvider(id)) {
      authStore.clearProviderSession(id);
    } else if (id === 'local-folder') {
      config.localFolderPath = '';
    }
    if (config.activeProvider === id) {
      config.activeProvider = null;
    }
    writeConfig(config);
    return buildStatus();
  });

  ipcMain.handle('cloud-sync-preview', async (_, providerId) => {
    const res = await previewSync(providerId || undefined);
    return {
      providerId: res.providerId,
      plan: res.plan,
      remoteUpdatedAt: res.remoteUpdatedAt,
      remoteDeviceName: res.remoteDeviceName,
    };
  });

  ipcMain.handle('cloud-sync-run', async (_, options = {}) => runSync(options));

  ipcMain.handle('cloud-sync-open-console', async (_, providerId) => {
    if (!isOAuthProvider(providerId)) throw new Error('Unknown cloud provider');
    await shell.openExternal(OAUTH_PROVIDERS[providerId].consoleUrl);
    return true;
  });

  return {
    getStatus: buildStatus,
    runAutoSyncIfEnabled: async () => {
      const config = readConfig();
      if (!config.autoSyncOnExit || !config.activeProvider) return null;
      const status = buildStatus();
      if (!status.providers[config.activeProvider]?.connected) return null;
      return runSync({ mode: 'smart', providerId: config.activeProvider });
    },
  };
}

module.exports = { registerCloudSyncIPC };
