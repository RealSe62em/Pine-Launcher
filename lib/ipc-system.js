// ── System & Window IPC ──────────────────────────────────────
// Window controls, onboarding, system diagnostics, clipboard, and cache management.
// ─────────────────────────────────────────────────────────────

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { BrowserWindow, shell, clipboard } = require('electron');
const { directorySize, storageUsage } = require('./storage-usage');
const { claimOnboarding, finishOnboarding, recommendedMemory } = require('./onboarding');

function registerSystemIPC({
  ipcMain,
  app,
  readJSON,
  writeJSON,
  readAuth,
  ensureDir,
  DISCORD_SERVER_URL,
  INSTANCES_FILE,
  SETTINGS_FILE,
  GLOBAL_DIR,
  MANAGED_JAVA_DIR,
  BACKUPS_DIR,
  LOG_DIR,
  MOD_CACHE_DIR,
  MANAGED_PACK_CACHE_DIR,
  getInstanceDir,
  getMcClient,
  getActiveInstanceName,
  getActiveTransfers,
  getDownloadManager,
  curseForgeResponseCache,
  clearModrinthResponseCache,
}) {
  const onboardingFile = path.join(app.getPath('userData'), 'onboarding.json');

  ipcMain.handle('open-discord-server', async () => {
    await shell.openExternal(DISCORD_SERVER_URL);
    return true;
  });

  ipcMain.handle('window-control', (event, action) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || target.isDestroyed()) throw new Error('Launcher window is unavailable');
    if (action === 'minimize') target.minimize();
    else if (action === 'maximize') target.isMaximized() ? target.unmaximize() : target.maximize();
    else if (action === 'close') target.close();
    else throw new Error('Invalid window control');
    return { maximized: !target.isDestroyed() && (target.isMaximized() || target.isFullScreen()) };
  });

  ipcMain.handle('claim-onboarding', async () => {
    const hasHistory = (readJSON(INSTANCES_FILE) || []).length > 0 || Boolean(readAuth()?.profile);
    const show = claimOnboarding(onboardingFile, hasHistory);
    if (show) {
      const settings = readJSON(SETTINGS_FILE) || {};
      settings.minMemory = '1G';
      settings.maxMemory = recommendedMemory(os.totalmem());
      writeJSON(SETTINGS_FILE, settings);
    }
    return { show, recommendedMemory: recommendedMemory(os.totalmem()) };
  });

  ipcMain.handle('finish-onboarding', async (_, status) => {
    finishOnboarding(onboardingFile, status);
    return true;
  });

  ipcMain.handle('copy-text', async (_, value) => {
    if (typeof value !== 'string' || value.length > 10 * 1024 * 1024) throw new Error('Invalid clipboard text');
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        clipboard.writeText(value, 'clipboard');
        const copied = clipboard.readText('clipboard');
        const normalizeNewlines = text => text.replace(/\r\n/g, '\n');
        if (copied === value || normalizeNewlines(copied) === normalizeNewlines(value)) return true;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const detail = lastError?.message ? ` (${lastError.message})` : '';
    throw new Error(`${process.platform === 'linux' ? 'Linux' : 'Windows'} did not accept the copied text. Close other clipboard tools and try again.` + detail);
  });

  ipcMain.handle('open-support-log', async (_, url) => {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Invalid support-log link'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'mclo.gs' || !/^\/[A-Za-z0-9]+$/.test(parsed.pathname)) throw new Error('Invalid support-log link');
    await shell.openExternal(parsed.href);
    return true;
  });

  ipcMain.handle('get-system-memory-gb', () => Math.max(1, Math.round(os.totalmem() / (1024 ** 3))));

  ipcMain.handle('get-storage-usage', async () => {
    const base = app.getPath('userData');
    const usage = await storageUsage({
      shared: GLOBAL_DIR,
      runtimes: MANAGED_JAVA_DIR,
      backups: BACKUPS_DIR,
      cache: path.join(base, 'cache'),
      logs: LOG_DIR,
    });
    const roots = new Set((readJSON(INSTANCES_FILE) || []).map(instance => {
      try { return getInstanceDir(instance); } catch { return null; }
    }).filter(Boolean));
    usage.instances = 0;
    for (const root of roots) usage.instances += await directorySize(root);
    usage.total = Object.values(usage).reduce((sum, value) => sum + value, 0);
    return usage;
  });

  ipcMain.handle('clear-download-cache', async (_, confirmed = false) => {
    if (confirmed !== true) throw new Error('Confirmation is required');
    const mcClient = getMcClient();
    const activeInstanceName = getActiveInstanceName();
    const activeTransfers = getActiveTransfers();
    const downloadManager = getDownloadManager();
    if (mcClient || activeInstanceName || activeTransfers.size || downloadManager?.active) {
      throw new Error('Wait for running games and file operations to finish');
    }
    const cacheRoot = path.join(app.getPath('userData'), 'cache');
    await fs.promises.rm(cacheRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    ensureDir(MOD_CACHE_DIR);
    ensureDir(MANAGED_PACK_CACHE_DIR);
    curseForgeResponseCache?.clear();
    clearModrinthResponseCache?.();
    return { cleared: true };
  });
}

module.exports = { registerSystemIPC };
