// ── Diagnostics & Crash Assistance IPC ────────────────────────
// Instance health inspection, crash log analysis, support reports, and file repair.
// ─────────────────────────────────────────────────────────────

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { dialog } = require('electron');
const { collectInstanceDiagnostics, diagnoseCrash, redactSensitiveLog } = require('./crash-assistant');
const { inspectInstanceHealth } = require('./instance-health');
const { buildSupportReport } = require('./support-report');
const { memoryMegabytes, resolveLaunchMemory } = require('./settings');

function registerDiagnosticsIPC({
  ipcMain,
  app,
  getMainWindow,
  portableFetch,
  readJSON,
  cleanCorruptedJars,
  diagnosticLog,
  createAutomaticInstanceBackup,
  getRegisteredInstance,
  getInstanceDir,
  getInstanceModsList,
  pendingContentInstalls,
  resolveExportableContent,
  compareSemver,
  getJavaVersionAsync,
  getActiveInstanceName,
  SETTINGS_FILE,
  GLOBAL_VERSIONS_DIR,
  GLOBAL_LIBRARIES_DIR,
  MC_JAVA_MAP_FALLBACK,
}) {
  async function instanceHealth(name) {
    const { instance } = getRegisteredInstance(name);
    const settings = readJSON(SETTINGS_FILE) || {};
    const preferredJava = instance.javaPath || settings.javaPath;
    const metadata = readJSON(path.join(GLOBAL_VERSIONS_DIR, `${instance.gameVersion}.json`));
    const requiredJava = metadata?.javaVersion?.majorVersion || MC_JAVA_MAP_FALLBACK.find(entry => compareSemver(instance.gameVersion, entry.min) >= 0)?.java || 8;
    const javaMajor = preferredJava ? await getJavaVersionAsync(preferredJava) : null;
    const result = inspectInstanceHealth(getInstanceDir(instance), instance, settings, { javaMajor, requiredJava, totalMemory: os.totalmem() });
    if (preferredJava && !javaMajor) {
      result.issues.push({ code: 'java', title: 'Custom Java could not be started', detail: 'Clear the custom Java path in Settings to let Pine choose a runtime.', action: 'settings', severity: 'warning' });
    }
    result.pendingFiles = pendingContentInstalls(getInstanceDir(instance)).reduce((count, item) => count + item.files.length, 0);
    result.healthy = !result.issues.length;
    return result;
  }

  ipcMain.handle('get-instance-health', async (_, name) => instanceHealth(name));

  ipcMain.handle('get-support-report', async (_, name, log = '') => {
    const { instance } = getRegisteredInstance(name);
    const health = await instanceHealth(name);
    return buildSupportReport({
      launcherVersion: app.getVersion(),
      platform: `${process.platform} ${process.arch}`,
      instance,
      java: { major: health.javaMajor },
      memory: health.memory,
      mods: await getInstanceModsList(name),
      diagnostics: collectInstanceDiagnostics(getInstanceDir(instance), String(log).slice(-2 * 1024 * 1024)),
      health,
    });
  });

  ipcMain.handle('save-support-report', async (_, report) => {
    if (typeof report !== 'string' || report.length > 4 * 1024 * 1024) throw new Error('Invalid support report');
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save reviewed support report',
      defaultPath: 'Pine-support-report.txt',
      filters: [{ name: 'Text report', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, redactSensitiveLog(report), 'utf8');
    return { filePath: result.filePath };
  });

  ipcMain.handle('get-recipe-preview', async (_, name, resourcepackMatches = {}) => {
    const { instance } = getRegisteredInstance(name);
    const content = await resolveExportableContent(instance, getInstanceDir(instance), resourcepackMatches, true);
    return {
      name: instance.name,
      gameVersion: instance.gameVersion,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
      memory: resolveLaunchMemory(instance, readJSON(SETTINGS_FILE) || {}),
      files: content.files.map(item => item.path),
      omitted: content.omitted,
      suggestions: content.suggestions,
    };
  });

  ipcMain.handle('analyze-crash', async (_, instanceName, log) => {
    if (typeof log !== 'string' || log.length > 10 * 1024 * 1024) throw new Error('The selected log is too large to analyze');
    let instance = null;
    if (instanceName) {
      try { instance = getRegisteredInstance(instanceName).instance; } catch {}
    }
    let mods = [];
    if (instance) {
      try { mods = await getInstanceModsList(instance.name); } catch {}
    }
    const settings = readJSON(SETTINGS_FILE) || {};
    const currentMemoryMb = instance ? memoryMegabytes(resolveLaunchMemory(instance, settings).max) : 0;
    const safeSystemLimit = Math.max(4096, Math.floor((os.totalmem() / 1024 / 1024) * 0.7 / 1024) * 1024);
    const recommendedMemoryMb = currentMemoryMb ? Math.min(Math.max(currentMemoryMb + 2048, 4096), safeSystemLimit) : 0;
    const diagnostics = instance ? collectInstanceDiagnostics(getInstanceDir(instance), log) : { log, sources: [] };
    return {
      ...diagnoseCrash(diagnostics.log, {
        instance: instance?.name || '',
        gameVersion: instance?.gameVersion || '',
        loader: instance?.loader || '',
        mods,
        currentMemoryMb,
        recommendedMemoryMb,
      }),
      sources: diagnostics.sources,
    };
  });

  ipcMain.handle('upload-crash-log', async (_, instanceName, log, confirmed = false) => {
    if (confirmed !== true) throw new Error('Confirm the anonymized upload first');
    if (typeof log !== 'string' || !log.trim() || log.length > 10 * 1024 * 1024) throw new Error('The selected log cannot be uploaded');
    let instance = null;
    if (instanceName) {
      try { instance = getRegisteredInstance(instanceName).instance; } catch {}
    }
    const diagnostics = instance ? collectInstanceDiagnostics(getInstanceDir(instance), log) : { log };
    const content = redactSensitiveLog(diagnostics.log).split(/\r?\n/).slice(-25000).join('\n');
    const response = await portableFetch('https://api.mclo.gs/1/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `PineLauncher/${app.getVersion()}` },
      body: JSON.stringify({
        content,
        source: 'Pine Launcher',
        metadata: [
          { key: 'minecraft_version', label: 'Minecraft', value: instance?.gameVersion || 'Unknown', visible: true },
          { key: 'loader', label: 'Loader', value: instance?.loader || 'Unknown', visible: true },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !/^[A-Za-z0-9]+$/.test(result.id || '')) throw new Error(result.error || 'mclo.gs could not accept this log');
    return { id: result.id, url: `https://mclo.gs/${result.id}`, expires: Number(result.expires) || null };
  });

  ipcMain.handle('repair-instance-files', async (_, instanceName) => {
    const instance = getRegisteredInstance(instanceName).instance;
    const activeInstanceName = getActiveInstanceName();
    if (activeInstanceName) throw new Error('Close Minecraft before repairing instance files');
    const backup = await createAutomaticInstanceBackup(instance, 'Before repairing instance files');
    const removedShared = cleanCorruptedJars(GLOBAL_LIBRARIES_DIR) + cleanCorruptedJars(GLOBAL_VERSIONS_DIR);
    const removedMods = cleanCorruptedJars(path.join(getInstanceDir(instance), 'mods'));
    diagnosticLog('INFO', `Repaired ${instance.name}: removed ${removedShared} damaged game files and ${removedMods} damaged mod files`);
    return { backupId: backup.id, removedShared, removedMods };
  });

  return { instanceHealth };
}

module.exports = { registerDiagnosticsIPC };
