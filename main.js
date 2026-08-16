const { app, BrowserWindow, ipcMain, shell, safeStorage, session, clipboard, net, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { Client } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');
const { resolveSafePath, safeRemoteFilename, safeInstanceName } = require('./lib/safety');
const { parseJavaMajor, javaMinimumFromRange, chooseCompatibleJava, versionSupports, normalizeProfileLoader, javaMajorFromClassVersion, javaRuntimeArchitectures } = require('./lib/compat');
const { sanitizeMemory, memoryMegabytes, resolveLaunchMemory } = require('./lib/settings');
const { installMclReliabilityPatches, rememberValidatedJava } = require('./lib/mcl-reliability');
const { ValidationCache } = require('./lib/validation-cache');
const { extractZipOnWindows } = require('./lib/runtime-extraction');
const { jarLoaderCompatibilityIssue, knownModrinthIncompatibility, quarantineDuplicateModIds, quarantineKnownBrokenMods, quarantineLoaderIncompatibleMods } = require('./lib/mod-compatibility');
const { expectedLoaderProfileId, isMatchingLoaderProfile, writeJsonAtomic } = require('./lib/loader-profile');
const { createUpdateManager } = require('./lib/updater');
const { DiscordPresence, isPrivateServerAddress, normalizeServerIcon, parseGamePresenceLine, readSavedServers, serverDisplayAddress } = require('./lib/discord-presence');
const { deleteAccount, normalizeAuthStore, publicAccounts, selectAccount, selectedAccount, upsertAccount } = require('./lib/account-store');
const { destinationKey, listWorlds, newestWorld, rankDestinations, readActivity, recordDestination, removeDestination, sanitizeDestination } = require('./lib/activity-store');
const portableFetch = (...args) => net.fetch(...args);
installMclReliabilityPatches({ fetchImpl: portableFetch, maxConcurrentDownloads: 3 });

let mainWindow;
let updateManager;
let mcClient = null;
let minecraftProcessStarted = false;
let activeInstanceName = null;
let sharedSeedPromise = null;
const DISCORD_APPLICATION_ID = '1536830830499078275';
const discordPresence = new DiscordPresence(DISCORD_APPLICATION_ID, { logger: diagnosticLog });
let presenceContext = { type: 'launcher' };

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ── Paths ──────────────────────────────────────────────────────────
const INSTANCES_DIR = path.join(app.getPath('userData'), 'instances');
const LEGACY_INSTANCES_DIR = path.join(__dirname, 'instances');
const GLOBAL_DIR = path.join(app.getPath('userData'), 'shared');
const GLOBAL_ASSETS_DIR = path.join(GLOBAL_DIR, 'assets');
const GLOBAL_LIBRARIES_DIR = path.join(GLOBAL_DIR, 'libraries');
const GLOBAL_VERSIONS_DIR = path.join(GLOBAL_DIR, 'versions');
const INSTANCES_FILE = path.join(INSTANCES_DIR, 'registry.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DESTINATION_CATALOG_FILE = path.join(app.getPath('userData'), 'recent-destinations.json');
function getAuthFile() { return path.join(app.getPath('userData'), 'auth.json'); }
const MOD_CACHE_DIR = path.join(app.getPath('userData'), 'cache', 'mods');
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'latest.log');
const LAUNCH_VALIDATION_CACHE_FILE = path.join(app.getPath('userData'), 'cache', 'launch-validation.json');
const launchValidationCache = new ValidationCache(LAUNCH_VALIDATION_CACHE_FILE);

function diagnosticLog(level, message) {
  ensureDir(LOG_DIR);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      const oldLog = path.join(LOG_DIR, 'previous.log');
      fs.rmSync(oldLog, { force: true });
      fs.renameSync(LOG_FILE, oldLog);
    }
  } catch {}
  const line = `[${new Date().toISOString()}] [${level}] ${String(message).replace(/[\r\n]+/g, ' ')}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
}

function loaderLabel(instance) {
  const loader = instance?.loader && instance.loader !== 'vanilla'
    ? instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1)
    : 'Vanilla';
  return `Minecraft ${instance?.gameVersion || ''} · ${loader}`.trim();
}

function refreshDiscordPresence(settings = readJSON(SETTINGS_FILE) || {}) {
  const enabled = settings.discordPresence !== false;
  discordPresence.setEnabled(enabled);
  if (!enabled) return;
  const context = presenceContext;
  if (context.type === 'launching') {
    discordPresence.setActivity({
      details: settings.discordShowInstance !== false ? `Launching ${context.instance.name}` : 'Launching Minecraft',
      state: loaderLabel(context.instance),
      startTimestamp: context.startTimestamp,
      largeImageKey: 'icon',
      largeImageText: 'Pine Launcher',
    });
  } else if (context.type === 'game') {
    let state = loaderLabel(context.instance);
    if (context.mode === 'singleplayer') state = 'Singleplayer world';
    if (context.mode === 'multiplayer' && settings.discordShowServer !== false) state = `On ${context.serverName}`;
    discordPresence.setActivity({
      details: settings.discordShowInstance !== false ? `Playing ${context.instance.name}` : 'Playing Minecraft',
      state,
      startTimestamp: context.startTimestamp,
      largeImageKey: 'icon',
      largeImageText: 'Pine Launcher',
    });
  } else {
    discordPresence.setActivity({
      details: 'Browsing instances',
      state: 'Ready to play',
      largeImageKey: 'icon',
      largeImageText: 'Pine Launcher',
    });
  }
}

function setPresenceContext(context, settings) {
  presenceContext = context;
  refreshDiscordPresence(settings);
}

function updatePresenceFromGameLine(line, instance, instanceDir, settings, startTimestamp) {
  const event = parseGamePresenceLine(line);
  if (!event) return null;
  if (event.type === 'multiplayer') {
    const serverName = serverDisplayAddress(event.address, event.port);
    setPresenceContext({ type: 'game', instance, mode: 'multiplayer', serverName, startTimestamp }, settings);
  } else if (event.type === 'singleplayer') {
    setPresenceContext({ type: 'game', instance, mode: 'singleplayer', startTimestamp }, settings);
  } else {
    setPresenceContext({ type: 'game', instance, mode: 'menu', startTimestamp }, settings);
  }
  return event;
}

// ── MC version → Java version map (fallback) ──────────────
const MC_JAVA_MAP_FALLBACK = [
  { min: '1.20.5', java: 21 }, { min: '1.18', java: 17 }, { min: '1.17', java: 16 }, { min: '1.16.5', java: 8 },
  { min: '1.12', java: 8 }, { min: '1.7.10', java: 8 },
];

async function getRequiredJava(mcVersion) {
  const cachedMetadata = readJSON(path.join(GLOBAL_VERSIONS_DIR, `${mcVersion}.json`));
  if (cachedMetadata?.id === mcVersion && cachedMetadata.javaVersion?.majorVersion) {
    return cachedMetadata.javaVersion.majorVersion;
  }
  try {
    const manifest = await fetchMinecraftVersions();
    const entry = manifest.versions?.find(v => v.id === mcVersion);
    if (entry?.url) {
      const response = await portableFetch(entry.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Minecraft metadata returned HTTP ${response.status}`);
      const verJson = await response.json();
      if (verJson.javaVersion?.majorVersion) return verJson.javaVersion.majorVersion;
    }
  } catch {}
  for (const entry of MC_JAVA_MAP_FALLBACK) {
    if (compareSemver(mcVersion, entry.min) >= 0) return entry.java;
  }
  return 8;
}

// ── Security helpers ────────────────────────────────────────────────
function sanitizeName(name) {
  return safeInstanceName(name);
}

// ── Helpers ─────────────────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function destinationCatalogId(value) {
  const instanceRef = String(value?.instanceId || value?.instanceName || '').trim();
  const key = String(value?.key || destinationKey(value)).trim();
  return instanceRef && key ? `${instanceRef}\0${key}` : '';
}

function readDestinationCatalog() {
  const value = readJSON(DESTINATION_CATALOG_FILE);
  return Array.isArray(value?.items) ? value.items.slice(0, 100) : [];
}

function writeDestinationCatalog(items) {
  writeJSON(DESTINATION_CATALOG_FILE, { version: 1, items: items.filter(Boolean).slice(0, 100) });
}

function syncDestinationCatalog(liveItems, registry) {
  const existing = readDestinationCatalog();
  const previous = new Map(existing.map(item => [destinationCatalogId(item), item]).filter(([id]) => id));
  const liveIds = new Set();
  const normalizedLive = liveItems.map(item => {
    const id = destinationCatalogId(item);
    const old = previous.get(id);
    liveIds.add(id);
    return {
      ...item,
      customLabel: old?.customLabel || item.customLabel || null,
      label: old?.customLabel || item.label,
      deletedInstance: false,
    };
  });
  const activeIds = new Set(registry.map(item => String(item.id || item.created || item.name)));
  const deleted = existing
    .filter(item => !liveIds.has(destinationCatalogId(item)) && !activeIds.has(String(item.instanceId || '')) && (Number(item.launches) || 0) > 0)
    .map(item => ({ ...item, deletedInstance: true, label: item.customLabel || item.label }));
  writeDestinationCatalog([...normalizedLive, ...deleted]);
  return [...normalizedLive, ...deleted];
}

function archiveDeletedInstance(instance) {
  const instanceDir = getInstanceDir(instance);
  const activity = readActivity(path.join(instanceDir, '.pine-activity.json'));
  const savedServers = readSavedServers(instanceDir);
  const worlds = new Map(listWorlds(path.join(instanceDir, 'saves')).map(world => [world.identifier.toLowerCase(), world]));
  const existing = readDestinationCatalog();
  const byId = new Map(existing.map(item => [destinationCatalogId(item), item]).filter(([id]) => id));
  for (const destination of activity.destinations || []) {
    if ((Number(destination.launches) || 0) < 1) continue;
    const clean = sanitizeDestination(destination);
    if (!clean) continue;
    const key = destinationKey(clean);
    const saved = clean.type === 'multiplayer'
      ? savedServers.find(server => destinationKey({ type: 'multiplayer', address: server.ip }) === key)
      : null;
    const world = clean.type === 'singleplayer' ? worlds.get(clean.identifier.toLowerCase()) : null;
    const savedName = String(saved?.name || '').replace(/[\r\n\0]+/g, ' ').trim();
    const usefulName = savedName && !/^(?:minecraft|multiplayer) server$/i.test(savedName);
    const item = {
      ...clean,
      key,
      instanceId: String(instance.id || instance.created || instance.name),
      instanceName: instance.name,
      gameVersion: instance.gameVersion,
      loader: instance.loader,
      label: clean.type === 'multiplayer' ? (usefulName ? savedName.slice(0, 128) : clean.identifier) : (world?.name || clean.label),
      folderName: world?.identifier,
      iconData: clean.type === 'multiplayer' ? normalizeServerIcon(saved?.icon) : world?.iconData,
      launches: Number(destination.launches) || 0,
      lastUsed: destination.lastUsed || instance.lastPlayed || instance.created,
      canFetchMetadata: clean.type === 'multiplayer' && !isPrivateServerAddress(clean.identifier),
      deletedInstance: true,
    };
    const id = destinationCatalogId(item);
    const old = byId.get(id);
    byId.set(id, { ...item, customLabel: old?.customLabel || null, label: old?.customLabel || item.label });
  }
  writeDestinationCatalog([...byId.values()]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeInstanceRoot(value, { create = false } = {}) {
  if (value == null || value === '') return INSTANCES_DIR;
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The custom instance location must be an absolute path');
  const root = path.resolve(value);
  if (root === path.parse(root).root) throw new Error('Choose a folder on the drive, not the drive root itself');
  if (create) {
    ensureDir(root);
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
  }
  return root;
}

function getInstanceDir(instance, ...segments) {
  if (!instance || typeof instance !== 'object') throw new Error('Instance not found');
  const safeName = sanitizeName(instance.name);
  const root = normalizeInstanceRoot(instance.customRoot || '');
  return resolveSafePath(root, safeName, ...segments);
}

function getInstanceDirByName(name, ...segments) {
  const safeName = sanitizeName(name);
  const registry = readJSON(INSTANCES_FILE) || [];
  const instance = registry.find(item => item.name === safeName);
  if (!instance) throw new Error('Instance not found');
  return getInstanceDir(instance, ...segments);
}

function safeImageData(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 8 * 1024 * 1024) return undefined;
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value) ? value : undefined;
}

function parseJvmArgs(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const args = value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return args.slice(0, 64).map(arg => arg.replace(/^"|"$/g, '')).filter(Boolean);
}

// ── Safe auth storage ───────────────────────────────────────
function writeAuthStore(store) {
  const normalized = normalizeAuthStore(store);
  if (!safeStorage.isEncryptionAvailable() && normalized.accounts.some(account => account.meta?.type !== 'offline')) {
    throw new Error('Windows secure credential storage is unavailable, so Pine will not save Microsoft refresh tokens on this PC');
  }
  const json = JSON.stringify(normalized);
  const file = getAuthFile();
  ensureDir(path.dirname(file));
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(file, encrypted);
  } else {
    fs.writeFileSync(file, json, 'utf8');
  }
}

function readAuthStore() {
  try {
    const file = getAuthFile();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return normalizeAuthStore(JSON.parse(decrypted));
    }
    return normalizeAuthStore(JSON.parse(raw.toString('utf8')));
  } catch {
    return normalizeAuthStore(null);
  }
}

function writeAuth(data) {
  const store = upsertAccount(readAuthStore(), data);
  writeAuthStore(store);
  return selectedAccount(store);
}

function readAuth() {
  return selectedAccount(readAuthStore());
}

// ── Offline (username-only) auth ────────────────────────────
const OFFLINE_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function sanitizeOfflineUsername(username) {
  if (typeof username !== 'string') throw new Error('Username is required');
  const name = username.trim();
  if (!OFFLINE_NAME_RE.test(name)) {
    throw new Error('Username must be 3-16 characters using letters, numbers, or underscores');
  }
  return name;
}

// Deterministic UUID matching the official launcher's offline UUID
// (MD5 of "OfflinePlayer:<name>", version 3, RFC 4122 variant).
function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isValidJar(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 22) return false;
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, 0);
    if (magic[0] !== 0x50 || magic[1] !== 0x4B) { fs.closeSync(fd); return false; }
    // ZIP comments may be up to 65,535 bytes, so the end record can be
    // much farther from EOF than the common 22-byte case.
    const searchSize = Math.min(65557, stat.size);
    const tail = Buffer.alloc(searchSize);
    fs.readSync(fd, tail, 0, searchSize, stat.size - searchSize);
    fs.closeSync(fd);
    for (let i = searchSize - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4B && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) return true;
    }
    return false;
  } catch { return false; }
}

// ── Semver helpers ─────────────────────────────────────────
function parseSemver(v) {
  const m = (v || '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]) || 0, parseInt(m[2]) || 0, parseInt(m[3]) || 0];
}

function compareSemver(a, b) {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

function semverSatisfies(version, range) {
  if (!range || range === '*') return true;
  const parts = range.split(',').map(s => s.trim());
  return parts.every(part => {
    const m = part.match(/^([<>=!]+)?\s*(\d+(?:\.\d+)*(?:-[\w.]+)?)/);
    if (!m) return true;
    const [, op, ver] = m;
    if (!op || op === '=') return compareSemver(version, ver) === 0;
    if (op === '>') return compareSemver(version, ver) > 0;
    if (op === '>=') return compareSemver(version, ver) >= 0;
    if (op === '<') return compareSemver(version, ver) < 0;
    if (op === '<=') return compareSemver(version, ver) <= 0;
    if (op === '!=') return compareSemver(version, ver) !== 0;
    if (op === '>=' && part.includes('<=')) {
      const inner = part.match(/>=\s*(\S+)\s*<=\s*(\S+)/);
      if (inner) return compareSemver(version, inner[1]) >= 0 && compareSemver(version, inner[2]) <= 0;
    }
    return true;
  });
}

// ── Disk space ─────────────────────────────────────────────
function checkDiskSpace(dir, neededBytes) {
  try {
    const stat = fs.statfsSync(dir);
    return stat.bsize * stat.bfree >= neededBytes;
  } catch {
    return true;
  }
}

function fmtBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// ── Java version detection ─────────────────────────────────
function getJavaVersionAsync(javaPath) {
  return new Promise(resolve => {
    let attempt = 0;
    const probe = () => {
      attempt += 1;
      execFile(javaPath, ['-version'], { timeout: 3000 + attempt * 2000, windowsHide: true, encoding: 'utf8' }, (_error, stdout, stderr) => {
        const major = parseJavaMajor(`${stderr || ''}${stdout || ''}`);
        if (major) return resolve(major);
        if (attempt < 3) return setTimeout(probe, attempt * 150);
        resolve(null);
      });
    };
    probe();
  });
}

// ── Windows Java discovery ────────────────────────────────
const WINDOWS_JAVA_ROOTS = (() => {
  const roots = [];
  const pf = process.env['ProgramFiles'];
  const pfx = process.env['ProgramFiles(x86)'];
  const lapp = process.env['LOCALAPPDATA'];
  const appData = process.env['APPDATA'];
  const vendors = ['Java', 'Eclipse Adoptium', 'Adoptium', 'Microsoft', 'Amazon Corretto', 'BellSoft', 'Zulu', 'AdoptOpenJDK'];
  for (const base of [pf, pfx].filter(Boolean)) {
    for (const vendor of vendors) roots.push(path.join(base, vendor));
    roots.push(path.join(base, 'Minecraft Launcher', 'runtime'));
  }
  if (lapp) {
    const programs = path.join(lapp, 'Programs');
    for (const vendor of vendors) roots.push(path.join(programs, vendor));
    roots.push(path.join(programs, 'Minecraft Launcher', 'runtime'));
  }
  // The official Minecraft Launcher commonly keeps its managed runtimes here.
  if (appData) roots.push(path.join(appData, '.minecraft', 'runtime'));
  return roots;
})();

function findJavaOnWindows() {
  if (process.platform !== 'win32') return [];
  const found = [];
  const seen = new Set();
  const add = (p) => { if (!seen.has(p)) { seen.add(p); found.push(p); } };
  if (process.env['JAVA_HOME']) {
    add(path.join(process.env['JAVA_HOME'], 'bin', 'java.exe'));
  }
  const scan = (dir, depth) => {
    if (found.length > 15) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      const bin = path.join(p, 'bin', 'java.exe');
      if (fs.existsSync(bin)) { add(bin); continue; }
      if (depth > 1) scan(p, depth - 1);
    }
  };
  for (const root of WINDOWS_JAVA_ROOTS) scan(root, 5);
  return found;
}


const MANAGED_JAVA_DIR = path.join(app.getPath('userData'), 'runtimes');

function findJavaExecutable(root, depth = 4) {
  if (depth < 0) return null;
  const direct = path.join(root, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(direct)) return direct;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findJavaExecutable(path.join(root, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

async function fetchAdoptiumAsset(javaMajor, imageType) {
  let lastStatus = null;
  for (const architecture of javaRuntimeArchitectures(process.arch)) {
    const url = `https://api.adoptium.net/v3/assets/latest/${javaMajor}/hotspot?architecture=${architecture}`
      + `&image_type=${imageType}&os=windows&vendor=eclipse`;
    const response = await portableFetch(url, { signal: AbortSignal.timeout(30000) });
    lastStatus = response.status;
    if (!response.ok) continue;
    const assets = await response.json();
    const runtimePackage = assets.find(asset => asset?.binary?.package?.link && asset?.binary?.package?.checksum)?.binary?.package;
    if (runtimePackage) {
      if (architecture !== 'aarch64' && process.arch === 'arm64') {
        diagnosticLog('INFO', `Using x64 Java ${javaMajor} under Windows ARM emulation because no ARM64 runtime is available`);
      }
      return runtimePackage;
    }
  }
  if (lastStatus && lastStatus >= 400) diagnosticLog('WARN', `Java runtime service returned HTTP ${lastStatus}`);
  return null;
}

async function provisionManagedJava(javaMajor, onProgress) {
  if (process.platform !== 'win32') throw new Error('Automatic Java installation is currently available on Windows only');
  ensureDir(MANAGED_JAVA_DIR);
  const runtimeDir = path.join(MANAGED_JAVA_DIR, `temurin-${javaMajor}-${process.arch}`);
  const existing = findJavaExecutable(runtimeDir);
  if (existing && await getJavaVersionAsync(existing) === javaMajor) return { path: existing, major: javaMajor, managed: true };

  const runtimePackage = await fetchAdoptiumAsset(javaMajor, 'jre') || await fetchAdoptiumAsset(javaMajor, 'jdk');
  if (!runtimePackage) throw new Error(`No Eclipse Temurin Java ${javaMajor} runtime is available for this PC`);
  const archive = path.join(MANAGED_JAVA_DIR, `temurin-${javaMajor}-${process.arch}.zip`);
  const staging = `${runtimeDir}.installing-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  onProgress?.({ percent: 0, label: `Downloading Java ${javaMajor}` });
  try {
    await fetchWithRetry(runtimePackage.link, archive, progress => onProgress?.({ ...progress, label: `Downloading Java ${javaMajor}` }));
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (actual.toLowerCase() !== runtimePackage.checksum.toLowerCase()) throw new Error('The Java runtime checksum did not match');
    ensureDir(staging);
    await extractZipOnWindows(archive, staging);
    const stagedJava = findJavaExecutable(staging);
    if (!stagedJava || await getJavaVersionAsync(stagedJava) !== javaMajor) throw new Error(`Downloaded runtime is not Java ${javaMajor}`);
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.renameSync(staging, runtimeDir);
    const installed = findJavaExecutable(runtimeDir);
    if (!installed) throw new Error('Java runtime extraction did not produce an executable');
    return { path: installed, major: javaMajor, managed: true };
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

let javaDiscoveryCache = null;
let javaDiscoveryCachedAt = 0;
const modJavaRequirementCache = new Map();
function getJavaCandidates() {
  if (!javaDiscoveryCache || Date.now() - javaDiscoveryCachedAt > 5 * 60 * 1000) {
    javaDiscoveryCache = findJavaOnWindows();
    javaDiscoveryCachedAt = Date.now();
  }
  return javaDiscoveryCache;
}

async function findCompatibleJava(requiredMajor, preferredPath = '') {
  const candidates = [preferredPath, 'java', ...getJavaCandidates()].filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const javaPath of candidates) {
    const key = javaPath.toLowerCase?.() || javaPath;
    if (seen.has(key)) continue;
    seen.add(key);
    if (javaPath !== 'java' && !(fs.existsSync(javaPath) && fs.statSync(javaPath).isFile())) continue;
    unique.push(javaPath);
  }
  const results = await Promise.all(unique.map(async javaPath => ({
    path: javaPath,
    major: await getJavaVersionAsync(javaPath),
    preferred: javaPath === preferredPath,
  })));
  const checked = results.filter(java => java.major);

  return { java: chooseCompatibleJava(checked, requiredMajor), checked };
}


async function resolveJavaForLaunch(requiredMajor, preferredPath, onProgress) {
  const result = await findCompatibleJava(requiredMajor, preferredPath);
  const exact = chooseCompatibleJava(result.checked.filter(java => java.major === requiredMajor), requiredMajor);
  if (exact) return { java: exact, checked: result.checked };
  try {
    const managed = await provisionManagedJava(requiredMajor, onProgress);
    return { java: managed, checked: [...result.checked, managed] };
  } catch (error) {
    if (result.java) {
      diagnosticLog('WARN', `Could not install exact Java ${requiredMajor}; using Java ${result.java.major}: ${error.message}`);
      return result;
    }
    const detected = result.checked.length
      ? ` Detected: ${result.checked.map(java => `Java ${java.major}`).join(', ')}.`
      : ' No Java installation was detected.';
    throw new Error(`Minecraft requires Java ${requiredMajor}. Pine could not install it automatically: ${error.message}.${detected}`);
  }
}

function getModJavaRequirement(instanceDir) {
  const modsDir = path.join(instanceDir, 'mods');
  let required = 0;
  const sources = [];
  let files = [];
  try { files = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar')); } catch { return { required, sources }; }
  const fingerprint = files.sort().map(filename => {
    try {
      const stat = fs.statSync(path.join(modsDir, filename));
      return `${filename}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${filename}:missing`;
    }
  }).join('|');
  const cached = modJavaRequirementCache.get(modsDir);
  if (cached?.fingerprint === fingerprint) return cached.result;
  for (const filename of files) {
    try {
      const zip = new AdmZip(path.join(modsDir, filename));
      const entry = zip.getEntry('fabric.mod.json');
      if (!entry) continue;
      const metadata = JSON.parse(entry.getData().toString('utf8'));
      const minimum = javaMinimumFromRange(metadata?.depends?.java);
      if (minimum > required) required = minimum;
      if (minimum) sources.push({ name: metadata.name || metadata.id || filename, required: minimum });
    } catch (e) {
      console.warn(`[Java] Could not inspect ${filename}:`, e.message);
    }
  }
  const result = { required, sources };
  modJavaRequirementCache.set(modsDir, { fingerprint, result });
  if (modJavaRequirementCache.size > 100) modJavaRequirementCache.delete(modJavaRequirementCache.keys().next().value);
  return result;
}

// ── Fetch with retry + resume ──────────────────────────────
async function fetchWithRetry(fileUrl, destPath, onProgress, retries = 3) {
  const parsedUrl = new URL(fileUrl);
  if (parsedUrl.protocol !== 'https:') throw new Error('Refusing an insecure download URL');
  const tmpPath = destPath + '.part';
  let downloaded = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));

    const headers = {};
    if (fs.existsSync(tmpPath)) {
      downloaded = fs.statSync(tmpPath).size;
      if (downloaded > 0) headers['Range'] = `bytes=${downloaded}-`;
    }

    try {
      const res = await portableFetch(fileUrl, { headers, signal: AbortSignal.timeout(5 * 60 * 1000) });
      const total = parseInt(res.headers.get('content-length') || '0') + (res.status === 206 ? downloaded : 0);

      if (res.status === 416) {
        fs.unlinkSync(tmpPath);
        downloaded = 0;
        continue;
      }
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

      const isPartial = res.status === 206;
      if (!isPartial && downloaded > 0) {
        fs.unlinkSync(tmpPath);
        downloaded = 0;
      }

      const stream = fs.createWriteStream(tmpPath, { flags: isPartial ? 'a' : 'w' });
      const reader = res.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!stream.write(Buffer.from(value))) {
            await new Promise((resolve, reject) => {
              stream.once('drain', resolve);
              stream.once('error', reject);
            });
          }
          downloaded += value.length;
          if (onProgress && total) {
            const pct = Math.min(100, Math.round((downloaded / total) * 100));
            onProgress({ percent: pct, bytes: downloaded, total });
          }
        }
        stream.end();
      };
      await pump();
      await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });

      if (total > 0 && downloaded < total) throw new Error(`Incomplete download: ${downloaded} / ${total} bytes`);

      if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
      fs.renameSync(tmpPath, destPath);
      return;
    } catch (e) {
      if (attempt === retries) throw e;
    }
  }
}

// ── Mod cache ──────────────────────────────────────────────
function getCachedPath(versionId, hash, hashType) {
  if (!hash || !hashType) return null;
  ensureDir(MOD_CACHE_DIR);
  const cacheFile = path.join(MOD_CACHE_DIR, `${hash}.jar`);
  if (fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      if (stat.size > 0 && isValidJar(cacheFile)) {
        const actual = crypto.createHash(hashType).update(fs.readFileSync(cacheFile)).digest('hex');
        if (actual === hash) return cacheFile;
      }
      console.warn('[Cache] Removing invalid cached mod:', cacheFile);
      fs.rmSync(cacheFile, { force: true });
    } catch { try { fs.rmSync(cacheFile, { force: true }); } catch {} }
  }
  return null;
}

function writeToCache(versionId, hash, hashType, srcPath) {
  if (!hash || !hashType) return;
  ensureDir(MOD_CACHE_DIR);
  const cacheFile = path.join(MOD_CACHE_DIR, `${hash}.jar`);
  if (!fs.existsSync(cacheFile)) {
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    fs.copyFileSync(srcPath, tmp);
    fs.renameSync(tmp, cacheFile);
  }
}

function cleanCorruptedJars(dir, nested = false) {
  let removed = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) removed += cleanCorruptedJars(fullPath, true);
      else if (entry.name.endsWith('.jar') && !launchValidationCache.isValid(fullPath, 'jar', isValidJar)) {
        console.warn('[Cleanup] Removing corrupted JAR:', fullPath);
        fs.unlinkSync(fullPath);
        launchValidationCache.forget(fullPath);
        removed++;
      }
    }
  } catch {}
  if (!nested) launchValidationCache.flush();
  return removed;
}

function isValidatedClientJar(jarPath, expected) {
  return launchValidationCache.isValid(jarPath, `client:${expected || 'zip-only'}`, file => {
    if (!isValidJar(file)) return false;
    return !expected || crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') === expected;
  });
}

function validateSharedVersionCache(versionId) {
  const jsonPath = path.join(GLOBAL_VERSIONS_DIR, `${versionId}.json`);
  const jarPath = path.join(GLOBAL_VERSIONS_DIR, `${versionId}.jar`);
  if (!fs.existsSync(jsonPath)) return;
  const metadata = readJSON(jsonPath);
  if (!metadata || metadata.id !== versionId || metadata.inheritsFrom) {
    fs.rmSync(jsonPath, { force: true });
    fs.rmSync(jarPath, { force: true });
    return;
  }
  if (fs.existsSync(jarPath)) {
    const expected = metadata.downloads?.client?.sha1;
    if (!isValidatedClientJar(jarPath, expected)) {
      fs.rmSync(jarPath, { force: true });
      launchValidationCache.forget(jarPath);
    }
  }
  launchValidationCache.flush();
}

// ── Create Window ───────────────────────────────────────────────────

async function ensureSharedMinecraftVersion(versionId, onProgress) {
  ensureDir(GLOBAL_VERSIONS_DIR);
  const jsonPath = path.join(GLOBAL_VERSIONS_DIR, `${versionId}.json`);
  const jarPath = path.join(GLOBAL_VERSIONS_DIR, `${versionId}.jar`);
  const cachedMetadata = readJSON(jsonPath);
  const cachedExpected = cachedMetadata?.downloads?.client?.sha1;
  if (cachedMetadata?.id === versionId && !cachedMetadata.inheritsFrom && isValidatedClientJar(jarPath, cachedExpected)) {
    launchValidationCache.flush();
    return cachedMetadata;
  }
  const manifest = await fetchMinecraftVersions();
  const entry = manifest.versions?.find(version => version.id === versionId);
  if (!entry?.url) throw new Error(`Minecraft ${versionId} is missing from the official version manifest`);
  const metadataResponse = await portableFetch(entry.url, { signal: AbortSignal.timeout(30000) });
  if (!metadataResponse.ok) throw new Error(`Minecraft ${versionId} metadata returned HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  writeJSON(jsonPath, metadata);
  const expected = metadata.downloads?.client?.sha1;
  let valid = isValidatedClientJar(jarPath, expected);
  if (!valid) {
    fs.rmSync(jarPath, { force: true });
    const url = metadata.downloads?.client?.url;
    if (!url) throw new Error(`Minecraft ${versionId} has no client download`);
    await fetchWithRetry(url, jarPath, progress => onProgress?.({ ...progress, label: `Downloading Minecraft ${versionId}` }));
    launchValidationCache.forget(jarPath);
    if (!isValidatedClientJar(jarPath, expected)) throw new Error(`Minecraft ${versionId} client download failed integrity validation`);
  }
  launchValidationCache.flush();
  return metadata;
}

function createWindow() {
  const { Menu } = require('electron');
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'Pine Launcher',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && (parsed.hostname === 'modrinth.com' || parsed.hostname.endsWith('.modrinth.com'))) shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show(); }, 3000);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

// ── Auth (Microsoft OAuth) ─────────────────────────────────────────
const CLIENT_ID = '00000000402b5328'; // Minecraft for Windows
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';

async function jsonResponse(res, label) {
  let data;
  try { data = await res.json(); } catch { throw new Error(`${label} returned an invalid response`); }
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${data.error_description || data.errorMessage || data.error || 'Unknown error'}`);
  return data;
}

async function minecraftAuthFromMicrosoft(msaToken, refreshToken) {
  const xblData = await jsonResponse(await portableFetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msaToken}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }),
    signal: AbortSignal.timeout(15000),
  }), 'Xbox Live authentication');
  const xstsData = await jsonResponse(await portableFetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xblData.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }),
    signal: AbortSignal.timeout(15000),
  }), 'Xbox security authentication');
  const userHash = xstsData.DisplayClaims?.xui?.[0]?.uhs;
  if (!userHash || !xstsData.Token) throw new Error('Xbox authentication response was incomplete');
  const mcData = await jsonResponse(await portableFetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsData.Token}` }),
    signal: AbortSignal.timeout(15000),
  }), 'Minecraft authentication');
  const profile = await jsonResponse(await portableFetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcData.access_token}` }, signal: AbortSignal.timeout(15000),
  }), 'Minecraft profile');
  if (!profile.name || !profile.id) throw new Error('This account does not have a usable Minecraft profile');
  return { access_token: mcData.access_token, refresh_token: refreshToken, profile: { name: profile.name, uuid: profile.id }, refreshedAt: Date.now() };
}

async function refreshMicrosoftAuth(authData) {
  if (!authData?.refresh_token || authData.meta?.type === 'offline') return authData;
  // Refresh proactively after 20 minutes; Minecraft access tokens are short-lived.
  if (authData.refreshedAt && Date.now() - authData.refreshedAt < 20 * 60 * 1000) return authData;
  try {
    const tokenData = await jsonResponse(await portableFetch('https://login.live.com/oauth20_token.srf', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, refresh_token: authData.refresh_token, redirect_uri: REDIRECT_URI, grant_type: 'refresh_token', scope: 'XboxLive.signin offline_access' }),
      signal: AbortSignal.timeout(15000),
    }), 'Microsoft token refresh');
    const refreshed = await minecraftAuthFromMicrosoft(tokenData.access_token, tokenData.refresh_token || authData.refresh_token);
    writeAuth(refreshed);
    return refreshed;
  } catch (error) {
    // A rejected refresh token is not a generic launch failure. Tell the
    // renderer to reopen the chooser so the player can repair this account,
    // switch to another saved account, or deliberately use offline mode.
    if (/Microsoft token refresh failed \((?:400|401|403)\)/i.test(error?.message || '')) {
      throw new Error('Your Microsoft session expired or was revoked. Sign in again, choose another saved account, or use an offline account.');
    }
    throw error;
  }
}

async function microsoftLogin() {
  // Step 1: Get auth code via browser
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const authUrl = `https://login.live.com/oauth20_authorize.srf`
    + `?client_id=${CLIENT_ID}`
    + `&response_type=code`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&scope=XboxLive.signin%20offline_access`
    + `&code_challenge=${codeChallenge}`
    + `&code_challenge_method=S256`;

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 600, height: 700, title: 'Microsoft Login',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    authWindow.loadURL(authUrl);

    let authHandled = false;

    async function processAuthCode(code) {
      if (authHandled) return;
      authHandled = true;
      authWindow.close();

      try {
        const tokenRes = await portableFetch('https://login.live.com/oauth20_token.srf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            code: code,
            code_verifier: codeVerifier,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
          signal: AbortSignal.timeout(30000),
        });
        const tokenData = await jsonResponse(tokenRes, 'Microsoft login');
        const authData = await minecraftAuthFromMicrosoft(tokenData.access_token, tokenData.refresh_token);
        writeAuth(authData);
        resolve(authData);
      } catch (e) {
        reject(e);
      }
    }

    function tryExtractCode(url) {
      const code = new URL(url).searchParams.get('code');
      if (code) processAuthCode(code);
    }

    authWindow.webContents.on('will-redirect', (event, url) => {
      const code = new URL(url).searchParams.get('code');
      if (!code) return;
      event.preventDefault();
      tryExtractCode(url);
    });

    authWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(REDIRECT_URI)) {
        event.preventDefault();
        tryExtractCode(url);
      }
    });

    authWindow.on('closed', () => {
      if (!authHandled) reject(new Error('Auth window closed'));
    });
  });
}

// ── Minecraft Version Fetching ──────────────────────────────────────
let versionCache = null;
async function fetchMinecraftVersions() {
  if (versionCache) return versionCache;
  const res = await portableFetch('https://launchermeta.mojang.com/mc/game/version_manifest.json', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Minecraft version service returned HTTP ${res.status}`);
  versionCache = await res.json();
  return versionCache;
}

// ── Loader Version Fetching ─────────────────────────────────────────
const loaderVersionCache = new Map();
const LOADER_VERSION_CACHE_MS = 15 * 60 * 1000;

async function fetchLoaderVersionsUncached(gameVersion, loader) {
  switch (loader) {
    case 'fabric': {
      const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`;
      const res = await portableFetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Fabric metadata returned HTTP ${res.status}`);
      const data = await res.json();
      return data.map(v => ({
        version: v.loader.version,
        name: `Fabric Loader ${v.loader.version}`,
        stable: v.loader.stable,
      }));
    }
    case 'quilt': {
      const res = await portableFetch(`https://meta.quiltmc.org/v3/versions/loader/${gameVersion}`, {
        headers: { 'User-Agent': 'PineLauncher/1.1' }, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Quilt metadata returned HTTP ${res.status}`);
      const data = await res.json();
      return data.map(v => {
        const version = v.loader?.version || v.version;
        return { version, name: `Quilt Loader ${version}`, stable: !String(version).includes('beta') };
      }).filter(v => v.version);
    }
    case 'forge': {
      const res = await portableFetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Forge metadata returned HTTP ${res.status}`);
      const xml = await res.text();
      const prefix = `${gameVersion}-`;
      return [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map(m => m[1]).filter(v => v.startsWith(prefix)).reverse()
        .map(v => ({ version: v.slice(prefix.length), name: `Forge ${v.slice(prefix.length)}`, stable: true }));
    }
    case 'neoforge': {
      const res = await portableFetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`NeoForge metadata returned HTTP ${res.status}`);
      const xml = await res.text();
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
      const prefix = gameVersion.replace(/^1\./, '') + '.';
      const filtered = versions.filter(v => v.startsWith(prefix));
      return filtered.map(v => ({ version: v, name: `NeoForge ${v}`, stable: !v.includes('-beta') }));
    }
    default:
      return [];
  }
}

async function fetchLoaderVersions(gameVersion, loader) {
  const key = `${loader}:${gameVersion}`;
  const cached = loaderVersionCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < LOADER_VERSION_CACHE_MS) return cached.versions;

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const versions = await fetchLoaderVersionsUncached(gameVersion, loader);
      if (loader !== 'vanilla' && !versions.length) {
        throw new Error(`No compatible ${loader} versions were found for Minecraft ${gameVersion}`);
      }
      loaderVersionCache.set(key, { fetchedAt: Date.now(), versions });
      return versions;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  // A previously successful result is safer than leaving the selector unusable
  // during a temporary metadata outage.
  if (cached?.versions?.length) return cached.versions;
  throw lastError;
}

// ── Modrinth API ────────────────────────────────────────────────────
const MODRINTH_API = 'https://api.modrinth.com/v2';
const modrinthResponseCache = new Map();
async function modrinthFetch(path) {
  const now = Date.now();
  const cached = modrinthResponseCache.get(path);
  if (cached && cached.expires > now) return cached.promise;
  const promise = (async () => {
    const res = await portableFetch(`${MODRINTH_API}${path}`, {
      headers: { 'User-Agent': 'PineLauncher/1.1' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Modrinth ${res.status}: ${res.statusText}`);
    return res.json();
  })();
  modrinthResponseCache.set(path, { expires: now + (path.startsWith('/search?') ? 10000 : 60000), promise });
  if (modrinthResponseCache.size > 500) modrinthResponseCache.delete(modrinthResponseCache.keys().next().value);
  try {
    return await promise;
  } catch (e) {
    modrinthResponseCache.delete(path);
    throw e;
  }
}

const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const CURSEFORGE_CLASS_IDS = Object.freeze({ mod: 6, resourcepack: 12, modpack: 4471, datapack: 6945, shader: 6552 });
const CURSEFORGE_LOADER_TYPES = Object.freeze({ forge: 1, fabric: 4, quilt: 5, neoforge: 6 });
const curseForgeResponseCache = new Map();
const serverMetadataCache = new Map();

function curseForgeApiKey() {
  const fromEnvironment = String(process.env.PINE_CURSEFORGE_API_KEY || '').trim();
  if (fromEnvironment) return fromEnvironment;
  return String(readJSON(SETTINGS_FILE)?.curseForgeApiKey || '').trim();
}

function verifyCurseForgeFile(file, destination) {
  const stat = fs.statSync(destination);
  if (!stat.isFile() || stat.size <= 0) throw new Error('CurseForge download was empty');
  if (Number(file?.fileLength) > 0 && stat.size !== Number(file.fileLength)) throw new Error('CurseForge download size did not match');
  const expected = (file?.hashes || []).find(hash => hash.algo === 1) || (file?.hashes || []).find(hash => hash.algo === 2);
  if (!expected?.value) return true;
  const algorithm = expected.algo === 1 ? 'sha1' : 'md5';
  const actual = crypto.createHash(algorithm).update(fs.readFileSync(destination)).digest('hex');
  if (actual.toLowerCase() !== String(expected.value).toLowerCase()) throw new Error(`CurseForge ${algorithm.toUpperCase()} checksum did not match`);
  return true;
}

async function curseForgeFetch(apiPath) {
  const apiKey = curseForgeApiKey();
  if (!apiKey) throw new Error('Add a CurseForge API key in Settings → Integrations to enable this catalog');
  const now = Date.now();
  const cached = curseForgeResponseCache.get(apiPath);
  if (cached && cached.expires > now) return cached.promise;
  const promise = (async () => {
    const response = await portableFetch(`${CURSEFORGE_API}${apiPath}`, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`CurseForge ${response.status}: ${response.statusText}`);
    const body = await response.json();
    return body;
  })();
  curseForgeResponseCache.set(apiPath, { expires: now + (apiPath.startsWith('/mods/search?') ? 10000 : 60000), promise });
  while (curseForgeResponseCache.size > 500) curseForgeResponseCache.delete(curseForgeResponseCache.keys().next().value);
  try { return await promise; }
  catch (error) { curseForgeResponseCache.delete(apiPath); throw error; }
}

async function fetchServerMetadata(address) {
  const displayAddress = serverDisplayAddress(address);
  if (!displayAddress || displayAddress === 'Minecraft server' || isPrivateServerAddress(displayAddress)) return null;
  const host = displayAddress.replace(/^\[|\](?::\d+)?$/g, '').replace(/:\d+$/, '');
  if (!host.includes('.') && !host.includes(':')) return null;
  const key = displayAddress.toLowerCase();
  const now = Date.now();
  const cached = serverMetadataCache.get(key);
  if (cached && cached.expires > now) return cached.promise;
  const promise = (async () => {
    try {
      const response = await portableFetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(displayAddress)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'PineLauncher/1.1 server-icon' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;
      const status = await response.json();
      if (!status?.online) return null;
      const cleanMotd = Array.isArray(status.motd?.clean) ? status.motd.clean : [];
      const name = cleanMotd.map(line => String(line || '').replace(/[\r\n\0]+/g, ' ').trim()).find(Boolean) || null;
      const resolvedAddress = status.ip ? serverDisplayAddress(status.ip, status.port) : null;
      return {
        iconData: normalizeServerIcon(status.icon),
        name: name?.slice(0, 128) || null,
        resolvedAddress: resolvedAddress && resolvedAddress.toLowerCase() !== displayAddress.toLowerCase() ? resolvedAddress : null,
      };
    } catch {
      return null;
    }
  })();
  serverMetadataCache.set(key, { expires: now + 5 * 60 * 1000, promise });
  while (serverMetadataCache.size > 100) serverMetadataCache.delete(serverMetadataCache.keys().next().value);
  return promise;
}

// ── Build MCLC Loader Profile ───────────────────────────────────────
async function buildLoaderUrl(instance, instanceDir) {
  const l = instance.loader;
  const lv = instance.loaderVersion;
  const mv = instance.gameVersion;
  if (!l || l === 'vanilla' || !lv || !mv) return null;

  let url;
  switch (l) {
    case 'fabric':
      url = `https://meta.fabricmc.net/v2/versions/loader/${mv}/${lv}/profile/json`;
      break;
    case 'quilt':
      url = `https://meta.quiltmc.org/v3/versions/loader/${mv}/${lv}/profile/json`;
      break;
    default:
      return null;
  }

  const expectedProfileId = expectedLoaderProfileId(l, lv, mv);
  const writeProfile = async (profile) => {
    if (!isMatchingLoaderProfile(profile, l, lv, mv)) {
      throw new Error(`The ${l} service returned a profile that does not match ${lv} on Minecraft ${mv}`);
    }
    const profileId = profile.id;
    const verDir = path.join(instanceDir, 'versions', profileId);
    ensureDir(verDir);
    const instanceProfile = path.join(verDir, `${profileId}.json`);
    await writeJsonAtomic(instanceProfile, profile);
    // Seed the client jar + vanilla version json from the shared cache so
    // custom-loader instances don't re-download the ~25MB client jar.
    const srcJar = path.join(GLOBAL_VERSIONS_DIR, `${mv}.jar`);
    const srcJson = path.join(GLOBAL_VERSIONS_DIR, `${mv}.json`);
    if (fs.existsSync(srcJar) && !fs.existsSync(path.join(verDir, `${profileId}.jar`))) {
      fs.copyFileSync(srcJar, path.join(verDir, `${profileId}.jar`));
    }
    if (fs.existsSync(srcJson) && !fs.existsSync(path.join(verDir, `${mv}.json`))) {
      fs.copyFileSync(srcJson, path.join(verDir, `${mv}.json`));
    }
    // Mirror the profile into the shared cache for offline fallback later.
    // Write from memory instead of copying the just-created instance file.
    // A cache failure is non-fatal: the instance profile above is the only
    // file required to launch, and antivirus/indexing software can briefly
    // interfere with newly created files on some Windows systems.
    const sharedProf = path.join(GLOBAL_VERSIONS_DIR, `${profileId}.json`);
    try {
      await writeJsonAtomic(sharedProf, profile);
    } catch (e) {
      console.warn(`[Loader] Could not cache ${profileId} globally:`, e.message);
    }
    return profileId;
  };

  // Reuse an already-downloaded loader profile for this loader + game version
  // if the network is unavailable: per-instance first, then shared cache.
  const findCached = () => {
    const scanDir = (dir, sub) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        let jf = null;
        if (sub) {
          if (!e.isDirectory()) continue;
          jf = path.join(dir, e.name, `${e.name}.json`);
        } else {
          if (e.isDirectory() || !e.name.endsWith('.json')) continue;
          jf = path.join(dir, e.name);
        }
        try {
          if (!fs.existsSync(jf)) continue;
          const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
          if (isMatchingLoaderProfile(j, l, lv, mv)) return j;
        } catch {}
      }
      return null;
    };
    return scanDir(path.join(instanceDir, 'versions'), true) || scanDir(GLOBAL_VERSIONS_DIR, false);
  };

  const cachedBeforeNetwork = findCached();
  if (cachedBeforeNetwork) return await writeProfile(cachedBeforeNetwork);

  try {
    const res = await portableFetch(url, { headers: { 'User-Agent': 'PineLauncher/1.1' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profile = await res.json();
    if (!isMatchingLoaderProfile(profile, l, lv, mv)) {
      throw new Error(`Profile ID did not match ${expectedProfileId}`);
    }
    return await writeProfile(profile);
  } catch (e) {
    console.warn(`[Loader] Failed to fetch ${l} profile (${lv} on ${mv}):`, e.message);
    const cached = findCached();
    if (cached) {
      console.warn('[Loader] Using cached loader profile:', cached.id);
      return await writeProfile(cached);
    }
    throw new Error(
      `Couldn't download the ${l} loader profile for Minecraft ${mv} (${lv}). ` +
      `Check your internet connection and try again.`
    );
  }
}

async function prepareForge(instance, instanceDir, onProgress) {
  if (instance.loader !== 'forge') return null;
  const artifact = `${instance.gameVersion}-${instance.loaderVersion}`;
  const forgeDir = resolveSafePath(instanceDir, 'installers');
  ensureDir(forgeDir);
  const installerPath = resolveSafePath(forgeDir, `forge-${artifact}-installer.jar`);
  if (!isValidJar(installerPath)) {
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${artifact}/forge-${artifact}-installer.jar`;
    await fetchWithRetry(url, installerPath, (p) => onProgress?.(p));
    if (!isValidJar(installerPath)) throw new Error('The Forge installer download is invalid');
  }
  return installerPath;
}

// ── IPC Handlers ────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-update-state', async () => updateManager?.getState());
  ipcMain.handle('check-for-updates', async () => updateManager?.checkForUpdates({ manual: true }));
  ipcMain.handle('download-update', async () => updateManager?.downloadUpdate());
  ipcMain.handle('install-update', async () => updateManager?.installUpdate());

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
    throw new Error('Windows did not accept the copied text. Close other clipboard tools and try again.' + detail);
  });

  ipcMain.handle('open-instance-folder', async (_, name) => {
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(item => item.name === safeName);
    if (!instance) throw new Error('Instance not found');
    const instanceDir = getInstanceDir(instance);
    if (!fs.existsSync(instanceDir)) {
      throw new Error('The instance folder is unavailable: ' + instanceDir);
    }
    const openError = await shell.openPath(instanceDir);
    if (openError) throw new Error(openError);
    return true;
  });

  ipcMain.handle('check-java', async () => {
    const { checked } = await findCompatibleJava(1);
    const best = checked.sort((a, b) => b.major - a.major)[0];
    return best ? { major: best.major, path: best.path } : false;
  });

  ipcMain.handle('open-java-download', async () => {
    shell.openExternal('https://adoptium.net/temurin/releases/?version=21');
  });

  ipcMain.handle('get-versions', async () => {
    const manifest = await fetchMinecraftVersions();
    return manifest.versions;
  });

  ipcMain.handle('get-loader-versions', async (_, gameVersion, loader) => {
    return fetchLoaderVersions(gameVersion, loader);
  });

  ipcMain.handle('microsoft-login', async () => {
    return microsoftLogin();
  });

  ipcMain.handle('offline-login', async (_, username) => {
    const name = sanitizeOfflineUsername(username);
    const authData = {
      access_token: '',
      profile: { name, uuid: offlineUUID(name) },
      meta: { type: 'offline', demo: false },
    };
    writeAuth(authData);
    return authData;
  });

  ipcMain.handle('get-auth', async () => {
    return readAuth();
  });

  ipcMain.handle('list-accounts', async () => publicAccounts(readAuthStore()));

  ipcMain.handle('select-account', async (_, key) => {
    if (typeof key !== 'string' || key.length > 200) throw new Error('Invalid account');
    const store = selectAccount(readAuthStore(), key);
    writeAuthStore(store);
    return selectedAccount(store);
  });

  ipcMain.handle('delete-account', async (_, key) => {
    if (typeof key !== 'string' || key.length > 200) throw new Error('Invalid account');
    const store = deleteAccount(readAuthStore(), key);
    if (store.accounts.length) writeAuthStore(store);
    else fs.rmSync(getAuthFile(), { force: true });
    return { ...publicAccounts(store), selected: selectedAccount(store) };
  });

  ipcMain.handle('sign-out', async () => {
    const store = readAuthStore();
    const next = store.selectedKey ? deleteAccount(store, store.selectedKey) : store;
    if (next.accounts.length) writeAuthStore(next);
    else fs.rmSync(getAuthFile(), { force: true });
    return true;
  });

  ipcMain.handle('create-instance', async (_, data) => {
    const safeName = sanitizeName(data.name);
    const normalized = normalizeProfileLoader(data.profile, data.loader, data.loaderVersion);
    const requestedProfile = normalized.profile;
    const loader = normalized.loader;
    const loaderVersion = normalized.loaderVersion;
    if (loader !== 'vanilla' && !loaderVersion) throw new Error(`Select a ${loader} loader version`);
    const manifest = await fetchMinecraftVersions();
    if (!manifest.versions?.some(v => v.id === data.gameVersion)) throw new Error('Select a valid Minecraft version');
    if (loader !== 'vanilla') {
      const available = await fetchLoaderVersions(data.gameVersion, loader);
      if (!available.some(v => v.version === loaderVersion)) throw new Error(`The selected ${loader} version is not compatible with Minecraft ${data.gameVersion}`);
    }
    const defaults = readJSON(SETTINGS_FILE) || {};
    const minMemory = sanitizeMemory(data.minMemory, sanitizeMemory(defaults.minMemory, '2G'));
    const maxMemory = sanitizeMemory(data.maxMemory, sanitizeMemory(defaults.maxMemory, '4G'));
    if (memoryMegabytes(minMemory) > memoryMegabytes(maxMemory)) throw new Error('Minimum memory cannot exceed maximum memory');
    ensureDir(INSTANCES_DIR);
    const registry = readJSON(INSTANCES_FILE) || [];
    const existing = registry.find(i => i.name === safeName);
    if (existing) throw new Error(`Instance "${safeName}" already exists`);

    const customRoot = data.customRoot ? normalizeInstanceRoot(data.customRoot, { create: true }) : '';
    const instanceDir = resolveSafePath(customRoot || INSTANCES_DIR, safeName);
    if (fs.existsSync(instanceDir) && fs.readdirSync(instanceDir).length) {
      throw new Error('The selected location already contains a non-empty folder named "' + safeName + '"');
    }
    ensureDir(instanceDir);
    ensureDir(path.join(instanceDir, 'mods'));
    ensureDir(path.join(instanceDir, 'saves'));
    ensureDir(path.join(instanceDir, 'config'));
    const entry = {
      id: crypto.randomUUID(),
      name: safeName,
      path: instanceDir,
      customRoot,
      gameVersion: data.gameVersion,
      profile: requestedProfile,
      loader,
      loaderVersion,
      created: new Date().toISOString(),
      lastPlayed: null,
      javaPath: typeof data.javaPath === 'string' ? data.javaPath.slice(0, 1024) : null,
      minMemory,
      maxMemory,
      memoryOverride: false,
      iconData: null,
      bannerData: null,
      bannerBlurDir: 'left',
    };

    const iconData = safeImageData(data.iconData);
    const bannerData = safeImageData(data.bannerData);
    if (iconData) entry.iconData = iconData;
    if (bannerData) entry.bannerData = bannerData;
    entry.bannerBlurDir = ['left', 'right', 'center', 'none'].includes(data.bannerBlurDir) ? data.bannerBlurDir : 'left';

    registry.push(entry);
    writeJSON(INSTANCES_FILE, registry);
    return entry;
  });

  ipcMain.handle('get-instances-dir', async () => INSTANCES_DIR);

  ipcMain.handle('choose-instance-location', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where instances will be installed',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return normalizeInstanceRoot(result.filePaths[0], { create: true });
  });

  ipcMain.handle('list-instances', async () => {
    let registry = readJSON(INSTANCES_FILE) || [];
    let changed = false;
    registry = registry.filter(inst => {
      try { sanitizeName(inst?.name); return true; } catch { changed = true; return false; }
    });
    for (const inst of registry) {
      if (!inst.id) {
        inst.id = crypto.randomUUID();
        changed = true;
      }
      const canonicalPath = getInstanceDir(inst);
      if (inst.path !== canonicalPath) {
        inst.path = canonicalPath;
        changed = true;
      }
    }
    if (changed) writeJSON(INSTANCES_FILE, registry);
    return registry;
  });

  ipcMain.handle('get-recent-destinations', async () => {
    const registry = readJSON(INSTANCES_FILE) || [];
    const destinations = [];
    for (const instance of registry) {
      try {
        const instanceDir = getInstanceDir(instance);
        const activity = readActivity(path.join(instanceDir, '.pine-activity.json'));
        const savedServers = readSavedServers(instanceDir);
        const activityByKey = new Map((activity.destinations || []).map(item => [destinationKey(item), item]));
        const hidden = new Set(activity.hiddenKeys || []);
        const included = new Set();
        const baseFor = destination => ({
          ...destination,
          key: destinationKey(destination),
          instanceId: String(instance.id || instance.created || instance.name),
          instanceName: instance.name,
          gameVersion: instance.gameVersion,
          loader: instance.loader,
          deletedInstance: false,
        });

        const serversFile = path.join(instanceDir, 'servers.dat');
        const serversModified = fs.existsSync(serversFile) ? fs.statSync(serversFile).mtime.toISOString() : instance.lastPlayed || instance.created;
        for (const saved of savedServers) {
          const address = serverDisplayAddress(saved.ip);
          const key = destinationKey({ type: 'multiplayer', address });
          if (!address || hidden.has(key) || included.has(key)) continue;
          const recorded = activityByKey.get(key);
          const savedName = String(saved.name || '').replace(/[\r\n\0]+/g, ' ').trim();
          const usefulName = savedName && !/^(?:minecraft|multiplayer) server$/i.test(savedName);
          destinations.push({
            ...baseFor({ type: 'multiplayer', identifier: address, address, launches: Number(recorded?.launches) || 0, lastUsed: recorded?.lastUsed || serversModified }),
            label: usefulName ? savedName.slice(0, 128) : address,
            hasCustomName: Boolean(usefulName),
            iconData: normalizeServerIcon(saved.icon),
            canFetchMetadata: !isPrivateServerAddress(address),
          });
          included.add(key);
        }

        for (const world of listWorlds(path.join(instanceDir, 'saves'))) {
          const key = destinationKey({ type: 'singleplayer', identifier: world.identifier });
          if (hidden.has(key) || included.has(key)) continue;
          const recorded = activityByKey.get(key);
          destinations.push({
            ...baseFor({ type: 'singleplayer', identifier: world.identifier, launches: Number(recorded?.launches) || 0, lastUsed: recorded?.lastUsed || new Date(world.modified).toISOString() }),
            label: world.name,
            folderName: world.identifier,
            iconData: world.iconData,
            canFetchIcon: false,
          });
          included.add(key);
        }

        for (const destination of activity.destinations || []) {
          const key = destinationKey(destination);
          if ((Number(destination.launches) || 0) < 1 || hidden.has(key) || included.has(key)) continue;
          const base = {
            ...destination,
            key,
            instanceId: String(instance.id || instance.created || instance.name),
            instanceName: instance.name,
            gameVersion: instance.gameVersion,
            loader: instance.loader,
          };
          if (destination.type === 'multiplayer') {
            const address = serverDisplayAddress(destination.address || destination.identifier);
            const saved = savedServers.find(server => serverDisplayAddress(server.ip).toLowerCase() === address.toLowerCase());
            const savedName = String(saved?.name || '').replace(/[\r\n\0]+/g, ' ').trim();
            const usefulName = savedName && !/^(?:minecraft|multiplayer) server$/i.test(savedName);
            destinations.push({
              ...base,
              identifier: address,
              address,
              label: usefulName ? savedName.slice(0, 128) : address,
              hasCustomName: Boolean(usefulName),
              iconData: normalizeServerIcon(saved?.icon),
              canFetchMetadata: !isPrivateServerAddress(address),
            });
          }
        }
      } catch {}
    }
    return rankDestinations(syncDestinationCatalog(destinations, registry), 9);
  });

  ipcMain.handle('get-server-metadata', async (_, instanceName, address) => {
    const safeName = sanitizeName(instanceName);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(item => item.name === safeName);
    const clean = sanitizeDestination({ type: 'multiplayer', identifier: address, address });
    if (!clean) throw new Error('Invalid server address');
    const catalogItem = readDestinationCatalog().find(item => item.instanceName === safeName && destinationKey(item) === destinationKey(clean));
    const activity = instance ? readActivity(getInstanceDir(instance, '.pine-activity.json')) : { destinations: [] };
    const saved = instance ? readSavedServers(getInstanceDir(instance)).find(server => destinationKey({ type: 'multiplayer', address: server.ip }) === destinationKey(clean)) : null;
    const recorded = activity.destinations.some(item => item.type === 'multiplayer' && destinationKey(item) === destinationKey(clean));
    if (!saved && !recorded && !catalogItem) {
      throw new Error('Server is not in recent activity');
    }
    const remote = await fetchServerMetadata(clean.address);
    return {
      iconData: normalizeServerIcon(saved?.icon) || remote?.iconData || null,
      name: remote?.name || null,
      resolvedAddress: remote?.resolvedAddress || null,
    };
  });

  ipcMain.handle('remove-recent-destination', async (_, instanceName, destination) => {
    const safeName = sanitizeName(instanceName);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(item => item.name === safeName);
    const clean = sanitizeDestination(destination);
    if (!clean) throw new Error('Invalid destination');
    const catalog = readDestinationCatalog();
    const remaining = catalog.filter(item => !(item.instanceName === safeName && destinationKey(item) === destinationKey(clean)));
    writeDestinationCatalog(remaining);
    return instance ? removeDestination(getInstanceDir(instance, '.pine-activity.json'), clean) : true;
  });

  ipcMain.handle('rename-recent-destination', async (_, instanceName, destination, requestedName) => {
    const safeName = sanitizeName(instanceName);
    const clean = sanitizeDestination(destination);
    const label = String(requestedName || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 128);
    if (!clean || !label) throw new Error('Enter a destination name');
    const catalog = readDestinationCatalog();
    const item = catalog.find(entry => entry.instanceName === safeName && destinationKey(entry) === destinationKey(clean));
    if (!item) throw new Error('Destination not found');
    item.customLabel = label;
    item.label = label;
    writeDestinationCatalog(catalog);
    return { label };
  });

  ipcMain.handle('update-instance', async (_, name, data) => {
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const idx = registry.findIndex(i => i.name === safeName);
    if (idx < 0) throw new Error(`Instance "${safeName}" not found`);
    const clean = {};
    const newName = typeof data?.name === 'string' ? data.name : null;
    if (newName) {
      const safeNewName = sanitizeName(newName);
      if (safeNewName !== safeName) {
        if (activeInstanceName === safeName) throw new Error('Stop Minecraft before renaming this instance');
        const oldDir = getInstanceDir(registry[idx]);
        const newDir = resolveSafePath(normalizeInstanceRoot(registry[idx].customRoot || ''), safeNewName);
        if (fs.existsSync(newDir)) throw new Error(`An instance named "${safeNewName}" already exists`);
        if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
        registry[idx].path = newDir;
      }
      clean.name = safeNewName;
    }
    if (typeof data?.lastOpened === 'string') clean.lastOpened = data.lastOpened.slice(0, 64);
    if (typeof data?.javaPath === 'string') clean.javaPath = data.javaPath.slice(0, 1024);
    if (data?.minMemory !== undefined) clean.minMemory = sanitizeMemory(data.minMemory, registry[idx].minMemory || '2G');
    if (data?.maxMemory !== undefined) clean.maxMemory = sanitizeMemory(data.maxMemory, registry[idx].maxMemory || '4G');
    if (data?.minMemory !== undefined || data?.maxMemory !== undefined) clean.memoryOverride = true;
    if (typeof data?.jvmArgs === 'string') clean.jvmArgs = data.jvmArgs.slice(0, 4096);
    if (Number.isFinite(data?.windowWidth)) clean.windowWidth = Math.min(7680, Math.max(320, Math.round(data.windowWidth)));
    if (Number.isFinite(data?.windowHeight)) clean.windowHeight = Math.min(4320, Math.max(240, Math.round(data.windowHeight)));
    const iconData = safeImageData(data?.iconData);
    const bannerData = safeImageData(data?.bannerData);
    if (iconData !== undefined) clean.iconData = iconData;
    if (bannerData !== undefined) clean.bannerData = bannerData;
    if (['left', 'right', 'center', 'none'].includes(data?.bannerBlurDir)) clean.bannerBlurDir = data.bannerBlurDir;
    if (memoryMegabytes(clean.minMemory || registry[idx].minMemory || '2G') > memoryMegabytes(clean.maxMemory || registry[idx].maxMemory || '4G')) {
      throw new Error('Minimum memory cannot exceed maximum memory');
    }
    registry[idx] = { ...registry[idx], ...clean };
    writeJSON(INSTANCES_FILE, registry);
    return registry[idx];
  });

  ipcMain.handle('delete-instance', async (_, name) => {
    const safeName = sanitizeName(name);
    if (activeInstanceName === safeName) throw new Error('Stop Minecraft before deleting this instance');
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(i => i.name === safeName);
    if (!instance) throw new Error('Instance not found');
    const instanceDir = getInstanceDir(instance);
    try { archiveDeletedInstance(instance); }
    catch (error) { diagnosticLog('WARN', `Could not archive destinations for ${safeName}: ${error.message}`); }
    let deletionTarget = instanceDir;
    if (fs.existsSync(instanceDir)) {
      const root = normalizeInstanceRoot(instance.customRoot || '');
      const stagingName = `.pine-deleting-${safeName}-${Date.now()}`;
      const stagingPath = resolveSafePath(root, stagingName);
      try {
        await fs.promises.rename(instanceDir, stagingPath);
        deletionTarget = stagingPath;
      } catch (error) {
        diagnosticLog('WARN', `Could not stage ${safeName} for deletion: ${error.message}`);
      }
    }
    const filtered = registry.filter(i => i.name !== safeName);
    writeJSON(INSTANCES_FILE, filtered);
    if (fs.existsSync(deletionTarget)) {
      fs.promises.rm(deletionTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
        .catch(error => diagnosticLog('WARN', `Background cleanup failed for ${safeName}: ${error.message}`));
    }
    return { deleted: true, cleanupPending: fs.existsSync(deletionTarget) };
  });

  ipcMain.handle('launch-instance', async (_, name, requestedDestination = null) => {
    if (mcClient) throw new Error('Minecraft is already launching or running');
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(i => i.name === safeName);
    if (!instance) throw new Error(`Instance "${safeName}" not found`);

    let quickDestination = null;
    if (requestedDestination != null) {
      quickDestination = sanitizeDestination(requestedDestination);
      if (!quickDestination) throw new Error('The quick-connect destination is invalid');
      if (quickDestination.type === 'singleplayer' && compareSemver(instance.gameVersion, '1.20') < 0) {
        throw new Error('Auto-opening a world requires Minecraft 1.20 or newer');
      }
    }

    let authData = readAuth();
    if (!authData || !authData.profile) throw new Error('Please sign in with Microsoft or set up an offline account first');
    const isOffline = authData.meta?.type === 'offline';
    activeInstanceName = safeName;
    try {
      if (!isOffline) authData = await refreshMicrosoftAuth(authData);
    } catch (e) {
      activeInstanceName = null;
      throw e;
    }

    const instanceDir = getInstanceDir(instance);
    if (instance.customRoot && !fs.existsSync(instanceDir)) {
      activeInstanceName = null;
      throw new Error('This instance location is unavailable. Reconnect the drive or restore the folder: ' + instanceDir);
    }
    ensureDir(instanceDir);
    if (quickDestination) ensureDir(path.join(instanceDir, 'quickPlay'));
    if (quickDestination?.type === 'singleplayer') {
      const worldDir = resolveSafePath(instanceDir, 'saves', quickDestination.identifier);
      if (!fs.existsSync(worldDir) || !fs.statSync(worldDir).isDirectory()) {
        activeInstanceName = null;
        throw new Error('That world is no longer available in this instance');
      }
    }
    ensureDir(GLOBAL_DIR);
    const quarantinedMods = quarantineKnownBrokenMods(path.join(instanceDir, 'mods'), instance.gameVersion);
    for (const mod of quarantinedMods) {
      const warning = `${mod.filename} was disabled automatically: ${mod.reason} Use ${mod.replacement} instead.`;
      diagnosticLog('WARN', warning);
      mainWindow?.webContents.send('launch-log', '[Pine compatibility] ' + warning);
      mainWindow?.webContents.send('launch-warning', warning);
    }
    const incompatibleLoaderMods = quarantineLoaderIncompatibleMods(path.join(instanceDir, 'mods'), instance.loader);
    for (const mod of incompatibleLoaderMods) {
      const warning = `${mod.filename} was disabled automatically: ${mod.reason}`;
      diagnosticLog('WARN', warning);
      mainWindow?.webContents.send('launch-log', '[Pine compatibility] ' + warning);
      mainWindow?.webContents.send('launch-warning', warning);
    }
    const duplicateIdMods = quarantineDuplicateModIds(path.join(instanceDir, 'mods'));
    for (const mod of duplicateIdMods) {
      const warning = `${mod.filename} was disabled automatically: ${mod.reason}`;
      diagnosticLog('WARN', warning);
      mainWindow?.webContents.send('launch-log', '[Pine compatibility] ' + warning);
      mainWindow?.webContents.send('launch-warning', warning);
    }
    if (!checkDiskSpace(instanceDir, 512 * 1024 * 1024)) {
      activeInstanceName = null;
      throw new Error('Not enough free space in this instance location. Free at least 512 MB or choose another location.');
    }
    if (!checkDiskSpace(GLOBAL_DIR, 1024 * 1024 * 1024)) {
      activeInstanceName = null;
      throw new Error('Not enough free space in Pine Launcher shared storage. Free at least 1 GB on the Windows app-data drive.');
    }
    const settings = readJSON(SETTINGS_FILE) || {};
    const presenceStartTimestamp = Date.now();
    let presenceGameStarted = false;
    setPresenceContext({ type: 'launching', instance, startTimestamp: presenceStartTimestamp }, settings);

    mcClient = new Client();
    minecraftProcessStarted = false;

    let customLoader;
    let forgeInstaller;
    let selectedJava;
    try {
      const reportPreparation = update => mainWindow?.webContents.send('launch-metrics', { stage: 'downloading', progress: Math.min(20, Math.round((update.percent || 0) * 0.2)), currentFile: update.label });
      if (sharedSeedPromise) await sharedSeedPromise;
      validateSharedVersionCache(instance.gameVersion);
      const minecraftJava = await getRequiredJava(instance.gameVersion);
      const modJava = getModJavaRequirement(instanceDir);
      const requiredJava = Math.max(minecraftJava, modJava.required || 0);
      const configuredJava = instance.javaPath || settings.javaPath || '';
      const result = await resolveJavaForLaunch(requiredJava, configuredJava, reportPreparation);
      selectedJava = result.java;
      const verifiedMajor = await getJavaVersionAsync(selectedJava.path);
      if (verifiedMajor !== selectedJava.major || verifiedMajor < requiredJava) throw new Error(`Selected Java runtime failed verification (needed ${requiredJava}, got ${verifiedMajor || 'unknown'})`);
      rememberValidatedJava(selectedJava.path, verifiedMajor);
      if (configuredJava && selectedJava.path !== configuredJava) {
        console.warn(`[Java] Configured runtime is incompatible; using Java ${selectedJava.major} at ${selectedJava.path}`);
      }
      await ensureSharedMinecraftVersion(instance.gameVersion, reportPreparation);
      if (instance.loader === 'neoforge') {
        throw new Error('NeoForge launching is not available in this build yet. Create a Fabric, Quilt, Forge, or Vanilla instance.');
      }
      customLoader = await buildLoaderUrl(instance, instanceDir);
      forgeInstaller = await prepareForge(instance, instanceDir, (p) => {
        mainWindow?.webContents.send('launch-metrics', { stage: 'downloading', progress: Math.min(20, Math.round((p.percent || 0) * 0.2)), currentFile: 'Forge installer' });
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      mainWindow?.webContents.send('launch-error', new Error(msg));
      mainWindow?.webContents.send('launch-log', '[ERROR] ' + msg);
      mainWindow?.webContents.send('launch-metrics', { stage: 'error', progress: 0 });
      mcClient = null;
      activeInstanceName = null;
      setPresenceContext({ type: 'launcher' }, settings);
      throw e;
    }

    const opts = {
      authorization: {
        access_token: isOffline ? '' : authData.access_token,
        client_token: crypto.randomUUID(),
        uuid: authData.profile.uuid,
        name: authData.profile.name,
        user_properties: '{}',
        meta: isOffline ? { type: 'offline', demo: false } : { type: 'msa', demo: false },
      },
      root: instanceDir,
      version: {
        number: instance.gameVersion,
        type: 'release',
        custom: customLoader,
      },
      memory: resolveLaunchMemory(instance, settings),
      javaPath: selectedJava.path,
      window: {
        width: instance.windowWidth || settings.windowWidth || 1280,
        height: instance.windowHeight || settings.windowHeight || 720,
      },
      overrides: {
        assetRoot: GLOBAL_ASSETS_DIR,
        libraryRoot: GLOBAL_LIBRARIES_DIR,
        maxSockets: Math.max(2, parseInt(settings.dlLimit, 10) || 4),
      },
      cache: path.join(GLOBAL_DIR, 'cache'),
    };
    const customArgs = parseJvmArgs(instance.jvmArgs || settings.jvmArgs);
    if (customArgs.length) opts.customArgs = customArgs;
    if (forgeInstaller) opts.forge = forgeInstaller;
    if (quickDestination) {
      opts.quickPlay = {
        type: compareSemver(instance.gameVersion, '1.20') < 0 ? 'legacy' : quickDestination.type,
        identifier: quickDestination.identifier,
        path: path.join(instanceDir, 'quickPlay', `java-${Date.now()}.json`),
      };
    }

    // Vanilla versions share a global versions dir too; custom loader
    // profiles stay per-instance (MCLC resolves those against the
    // instance root).
    if (!customLoader) opts.overrides.directory = GLOBAL_VERSIONS_DIR;

    return new Promise((resolve, reject) => {
      let terminalEventHandled = false;
      let lastLauncherFailure = '';
      let runtimeMismatchMessage = '';
      const recordedDestinations = new Set();
      const saveDestination = destination => {
        const clean = sanitizeDestination(destination);
        if (!clean) return;
        const key = `${clean.type}:${clean.identifier.toLowerCase()}`;
        if (recordedDestinations.has(key)) return;
        recordedDestinations.add(key);
        try { recordDestination(path.join(instanceDir, '.pine-activity.json'), clean); }
        catch (error) { diagnosticLog('WARN', `Could not save recent destination: ${error.message}`); }
      };
      // ── Launch metrics tracker ────────────────────────────────
      const metrics = {
        stage: 'preparing',
        currentFile: null,
        bytesDownloaded: 0,
        bytesTotal: 0,
        bytesPerSec: 0,
        etaSec: null,
        progress: 0,
        eventsSeen: 0,
        progressLabel: null,
      };
      let lastEmit = 0;
      let launchBehaviorApplied = false;
      const emitMetrics = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 250) return;
        lastEmit = now;
        mainWindow?.webContents.send('launch-metrics', { ...metrics });
      };

      // All MCLC progress types and their weight.  We set fixed expected
      // ranges so the bar always moves forward and never jumps backward.
      // 0-85 covers all download phases; 85-100 covers building/launching.
      // Phases can fire in any order (e.g. natives fires first pre-1.19)
      // so we take the max of current progress and newly computed progress
      // to keep the bar monotonic.
      const PHASES = [
        { type: 'version-jar',            weight: 5,  label: 'libraries' },
        { type: 'asset-json',             weight: 2,  label: 'assets'    },
        { type: 'classes-maven-custom',   weight: 7,  label: 'libraries' },
        { type: 'classes-custom',         weight: 10, label: 'libraries' },
        { type: 'classes',                weight: 8,  label: 'libraries' },
        { type: 'assets',                 weight: 40, label: 'assets'    },
        { type: 'assets-copy',            weight: 8,  label: 'assets'    },
        { type: 'natives',                weight: 5,  label: 'natives'   },
      ];
      const DL_WEIGHT = PHASES.reduce((s, p) => s + p.weight, 0); // 85

      // Per-type: most recent { task, total } from progress events
      const phaseProg = {};

      // Single-file phases (version-jar, asset-json) emit download-status
      // but NOT progress events — track them separately.
      const SINGLE_FILE_TYPES = ['version-jar', 'asset-json'];

      // Ordered stage progression — once we've moved forward we never
      // regress, preventing stray output (e.g. "Native library loaded")
      // from bumping 'launching' back to 'natives'.
      const STAGE_ORDER = ['preparing', 'downloading', 'libraries', 'assets', 'natives', 'building', 'launching', 'done'];
      let stageIdx = 0;
      const advanceStage = (stage) => {
        const i = STAGE_ORDER.indexOf(stage);
        if (i >= 0 && i > stageIdx) {
          stageIdx = i;
          metrics.stage = stage;
          return true;
        }
        return false;
      };

      // Download-status state for speed / ETA
      const dlHistory = [];

      // Compute overall 0-85 from per-type progress.
      // Only counts phases that have been seen.  We take the max of the
      // previous and current value so the bar never shrinks, even when
      // phases fire out of order (natives before version-jar pre-1.19).
      let lastDownloadPct = 0;
      const computeProgress = () => {
        let sum = 0;
        let totalSeenWeight = 0;
        for (const p of PHASES) {
          const pp = phaseProg[p.type];
          if (pp) {
            totalSeenWeight += p.weight;
            const ratio = pp.total > 0 ? pp.task / pp.total : 0;
            sum += p.weight * Math.min(1, ratio);
          }
        }
        if (totalSeenWeight === 0) return lastDownloadPct;
        const pct = Math.round(Math.min(85, (sum / totalSeenWeight) * 85));
        lastDownloadPct = Math.max(lastDownloadPct, pct);
        return lastDownloadPct;
      };

      // ── debug: MCLC internal log — stage transitions ──────
      mcClient.on('debug', (e) => {
        console.log('[MCLC]', e);
        diagnosticLog('DEBUG', e);
        if (typeof e === 'string' && /failed|couldn't start/i.test(e)) lastLauncherFailure = e.replace(/^\[MCLC\]:?\s*/i, '');
        if (typeof e !== 'string') return;
        const t = e.toLowerCase();
        if (t.includes('launching with arguments')) {
          advanceStage('launching');
          metrics.progress = Math.max(metrics.progress || 0, 92);
        } else if (t.includes('set launch options') || t.includes('collected class paths')) {
          advanceStage('building');
          metrics.progress = Math.max(metrics.progress || 0, 85);
        } else if (t.includes('downloaded assets')) {
          advanceStage('assets');
        }
        emitMetrics();
      });

      // ── progress: { type, task, total } — per-file / per-phase ─
      mcClient.on('progress', (e) => {
        mainWindow?.webContents.send('launch-progress', e);
        if (!e || typeof e !== 'object' || typeof e.task !== 'number' || typeof e.total !== 'number') return;

        metrics.eventsSeen++;
        const { type, task, total } = e;
        phaseProg[type] = { task, total };

        // Map type to stage label
        if (type === 'natives') advanceStage('natives');
        else if (type.startsWith('classes')) advanceStage('libraries');
        else if (type === 'assets' || type === 'assets-copy') advanceStage('assets');
        else if (type === 'version-jar' || type === 'asset-json') advanceStage('downloading');

        metrics.currentFile = `${type} ${task}/${total}`;
        metrics.progress = computeProgress();
        emitMetrics();
      });

      // ── download-status: { name, type, current, total } — per-chunk bytes ─
      mcClient.on('download-status', (e) => {
        if (!e || typeof e !== 'object' || typeof e.current !== 'number') return;
        metrics.currentFile = e.name;
        metrics.bytesDownloaded = e.current;
        if (e.total > 0) metrics.bytesTotal = e.total;

        // Track progress for single-file phases (version-jar, asset-json)
        // that emit download-status but NOT progress events.
        if (e.type && e.total > 0 && SINGLE_FILE_TYPES.includes(e.type)) {
          phaseProg[e.type] = { task: Math.min(e.current, e.total), total: e.total };
          metrics.progress = computeProgress();
        }

        const now = Date.now();
        dlHistory.push({ time: now, bytes: e.current });
        while (dlHistory.length > 1 && dlHistory[0].time < now - 2000) {
          dlHistory.shift();
        }
        if (dlHistory.length >= 2) {
          const oldest = dlHistory[0];
          const elapsed = (now - oldest.time) / 1000;
          if (elapsed > 0.4) {
            const delta = e.current - oldest.bytes;
            if (delta > 0) {
              const inst = delta / elapsed;
              if (metrics.bytesPerSec === 0) {
                metrics.bytesPerSec = inst;
              } else {
                metrics.bytesPerSec = metrics.bytesPerSec * 0.85 + inst * 0.15;
              }
              if (e.total > 0 && metrics.bytesPerSec > 100) {
                const remaining = e.total - e.current;
                metrics.etaSec = Math.max(1, Math.round(remaining / metrics.bytesPerSec));
              }
            }
          }
        }
        emitMetrics();
      });

      // ── data: Minecraft stdout/stderr (post-Java-launch) ───
      mcClient.on('data', (e) => {
        minecraftProcessStarted = true;
        diagnosticLog('GAME', e);
        mainWindow?.webContents.send('launch-data', e);
        if (!presenceGameStarted) {
          presenceGameStarted = true;
          setPresenceContext({ type: 'game', instance, mode: 'menu', startTimestamp: presenceStartTimestamp }, settings);
        }
        if (typeof e === 'string') {
          const activity = updatePresenceFromGameLine(e, instance, instanceDir, settings, presenceStartTimestamp);
          if (activity?.type === 'multiplayer') {
            const address = serverDisplayAddress(activity.address, activity.port);
            saveDestination({ type: 'multiplayer', identifier: address, address, label: address });
          } else if (activity?.type === 'singleplayer') {
            const world = quickDestination?.type === 'singleplayer' ? quickDestination : newestWorld(path.join(instanceDir, 'saves'));
            if (world) saveDestination({ type: 'singleplayer', identifier: world.identifier, label: world.label });
          }
        }
        if (typeof e === 'string') {
          const classVersion = e.match(/class file version\s+(\d+(?:\.\d+)?)/i)?.[1];
          const needed = javaMajorFromClassVersion(classVersion);
          if (needed && needed > selectedJava.major) runtimeMismatchMessage = `Minecraft requires Java ${needed}, but Java ${selectedJava.major} was started. Pine will install the correct runtime on the next launch.`;
        }
        if (typeof e === 'string') {
          metrics.eventsSeen++;
          if (metrics.stage === 'launching') {
            // First data after launch — game process is running
            advanceStage('done');
            metrics.progress = 100;
            emitMetrics(true);
            if (!launchBehaviorApplied && settings.launchBehavior === 'Close on launch') {
              launchBehaviorApplied = true;
              mainWindow?.close();
            }
            return;
          }
          if (/Launching|Client thread|GL info|Loading native/i.test(e)) {
            if (advanceStage('launching')) metrics.progress = Math.max(metrics.progress || 0, 95);
          } else if (/Building|Forge|Installing forge/i.test(e)) advanceStage('building');
          else if (/Extracting|Extracted|native/i.test(e)) advanceStage('natives');
          emitMetrics();
        }
      });

      // ── error / close ──────────────────────────────────────
      mcClient.on('error', (e) => {
        if (terminalEventHandled) return;
        terminalEventHandled = true;
        diagnosticLog('ERROR', e?.stack || e);
        mainWindow?.webContents.send('launch-error', e);
        mainWindow?.webContents.send('launch-log', '[ERROR] ' + (e.message || e));
        mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'error' });
        const fixed = cleanCorruptedJars(GLOBAL_LIBRARIES_DIR)
                   + cleanCorruptedJars(GLOBAL_VERSIONS_DIR)
                   + cleanCorruptedJars(getInstanceDir(instance, 'mods'));
        if (fixed > 0) mainWindow?.webContents.send('launch-fixed', fixed);
        mcClient = null;
        minecraftProcessStarted = false;
        activeInstanceName = null;
        setPresenceContext({ type: 'launcher' }, settings);
        reject(e);
      });
      mcClient.on('close', (code) => {
        if (terminalEventHandled) return;
        terminalEventHandled = true;
        mcClient = null;
        minecraftProcessStarted = false;
        activeInstanceName = null;
        setPresenceContext({ type: 'launcher' }, settings);
        if (Number.isInteger(code) && code !== 0) {
          const error = new Error(runtimeMismatchMessage || `Minecraft crashed with exit code ${code}. Check the launcher logs at: ${LOG_FILE}`);
          diagnosticLog('ERROR', error.message);
          mainWindow?.webContents.send('launch-error', { message: error.message, exitCode: code });
          mainWindow?.webContents.send('launch-log', `[ERROR] ${error.message}`);
          mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'error' });
          reject(error);
        } else {
          mainWindow?.webContents.send('launch-log', '[Minecraft closed]');
          mainWindow?.webContents.send('launch-close');
          mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'closed' });
          resolve(true);
        }
      });

      const latestRegistry = readJSON(INSTANCES_FILE) || [];
      const latestInstance = latestRegistry.find(item => item.name === safeName);
      if (latestInstance) {
        latestInstance.lastPlayed = new Date().toISOString();
        try { writeJSON(INSTANCES_FILE, latestRegistry); } catch (e) { diagnosticLog('WARN', `Could not save last-played time: ${e.message}`); }
      }
      const cleaned = cleanCorruptedJars(GLOBAL_LIBRARIES_DIR)
                   + cleanCorruptedJars(GLOBAL_VERSIONS_DIR)
                   + cleanCorruptedJars(getInstanceDir(instance, 'mods'));
      if (cleaned > 0) mainWindow?.webContents.send('launch-fixed', cleaned);
      Promise.resolve(mcClient.launch(opts)).then((processHandle) => {
        if (!processHandle && !terminalEventHandled) {
          throw new Error(lastLauncherFailure || 'Minecraft preparation stopped before Java could start. Check the network and try again.');
        }
      }).catch((e) => {
        if (terminalEventHandled) return;
        terminalEventHandled = true;
        diagnosticLog('ERROR', e?.stack || e);
        mainWindow?.webContents.send('launch-error', e);
        mainWindow?.webContents.send('launch-log', '[ERROR] ' + (e.message || e));
        mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'error' });
        mcClient = null;
        minecraftProcessStarted = false;
        activeInstanceName = null;
        setPresenceContext({ type: 'launcher' }, settings);
        reject(e);
      });
    });
  });

  // ── Modrinth IPC ──────────────────────────────────────────────────
  ipcMain.handle('search-mods', async (_, query, facets, offset, limit, sort) => {
    const facetStr = facets ? `&facets=${encodeURIComponent(JSON.stringify(facets))}` : '';
    const allowedSorts = new Set(['relevance', 'downloads', 'updated', 'newest']);
    const index = sort === 'name' ? 'relevance' : (allowedSorts.has(sort) ? sort : 'relevance');
    return modrinthFetch(`/search?query=${encodeURIComponent(query || '')}&offset=${Math.max(0, Number(offset) || 0)}&limit=${Math.min(100, Math.max(1, Number(limit) || 20))}&index=${index}${facetStr}`);
  });

  ipcMain.handle('search-curseforge', async (_, query, options = {}) => {
    const type = Object.prototype.hasOwnProperty.call(CURSEFORGE_CLASS_IDS, options.type) ? options.type : 'mod';
    const params = new URLSearchParams({
      gameId: '432',
      classId: String(CURSEFORGE_CLASS_IDS[type]),
      index: String(Math.max(0, Number(options.offset) || 0)),
      pageSize: String(Math.min(50, Math.max(1, Number(options.limit) || 20))),
      sortField: options.sort === 'updated' || options.sort === 'newest' ? '3' : '2',
      sortOrder: 'desc',
    });
    if (query) params.set('searchFilter', String(query).slice(0, 200));
    if (options.gameVersion) params.set('gameVersion', String(options.gameVersion).slice(0, 40));
    if (CURSEFORGE_LOADER_TYPES[options.loader]) params.set('modLoaderType', String(CURSEFORGE_LOADER_TYPES[options.loader]));
    const response = await curseForgeFetch(`/mods/search?${params}`);
    return {
      hits: (response.data || []).map(project => ({
        source: 'curseforge',
        project_id: `curseforge:${project.id}`,
        curseforge_id: project.id,
        title: project.name,
        author: project.authors?.[0]?.name || 'unknown',
        description: project.summary || '',
        downloads: project.downloadCount || 0,
        icon_url: project.logo?.url || null,
        project_type: type,
        website_url: project.links?.websiteUrl || null,
      })),
      total_hits: response.pagination?.totalCount || 0,
      configured: true,
    };
  });

  ipcMain.handle('get-curseforge-project', async (_, projectId) => {
    const id = Number(String(projectId).replace(/^curseforge:/, ''));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid CurseForge project');
    return (await curseForgeFetch(`/mods/${id}`)).data;
  });

  ipcMain.handle('get-curseforge-files', async (_, projectId, instanceName) => {
    const id = Number(String(projectId).replace(/^curseforge:/, ''));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid CurseForge project');
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = instanceName ? registry.find(item => item.name === sanitizeName(instanceName)) : null;
    if (instanceName && !instance) throw new Error('Instance not found');
    const params = new URLSearchParams({ pageSize: '50' });
    if (instance) params.set('gameVersion', instance.gameVersion);
    if (instance && CURSEFORGE_LOADER_TYPES[instance.loader]) params.set('modLoaderType', String(CURSEFORGE_LOADER_TYPES[instance.loader]));
    return (await curseForgeFetch(`/mods/${id}/files?${params}`)).data || [];
  });

  ipcMain.handle('install-curseforge-content', async (_, instanceName, options = {}) => {
    const id = Number(String(options.projectId).replace(/^curseforge:/, ''));
    const fileId = Number(options.fileId);
    const type = Object.prototype.hasOwnProperty.call(CURSEFORGE_CLASS_IDS, options.type) ? options.type : 'mod';
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(fileId) || fileId <= 0) throw new Error('Invalid CurseForge file');
    if (type === 'modpack') throw new Error('Use the dedicated modpack importer');
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(item => item.name === sanitizeName(instanceName));
    if (!instance) throw new Error('Instance not found');
    const project = (await curseForgeFetch(`/mods/${id}`)).data;
    const file = (await curseForgeFetch(`/mods/${id}/files/${fileId}`)).data;
    if (!file || !Array.isArray(file.gameVersions) || !file.gameVersions.includes(instance.gameVersion)) {
      throw new Error(`This file does not support Minecraft ${instance.gameVersion}`);
    }
    const filename = safeRemoteFilename(file.fileName);
    const allowedExtension = type === 'mod' ? /\.jar$/i : /\.(?:zip|jar)$/i;
    if (!allowedExtension.test(filename)) throw new Error('CurseForge returned an unexpected file type');
    let url = file.downloadUrl;
    if (!url) {
      try { url = (await curseForgeFetch(`/mods/${id}/files/${fileId}/download-url`)).data; } catch {}
    }
    if (!url || new URL(url).protocol !== 'https:') throw new Error('This author does not allow third-party launcher downloads for this file');
    let destinationDir;
    if (type === 'mod') destinationDir = getInstanceDir(instance, 'mods');
    else if (type === 'resourcepack') destinationDir = getInstanceDir(instance, 'resourcepacks');
    else if (type === 'shader') destinationDir = getInstanceDir(instance, 'shaderpacks');
    else {
      const world = safeRemoteFilename(options.world || '');
      if (world === '.' || world === '..') throw new Error('Choose an existing world for this data pack');
      const worldDir = getInstanceDir(instance, 'saves', world);
      if (!fs.existsSync(worldDir) || !fs.statSync(worldDir).isDirectory()) throw new Error('Choose an existing world for this data pack');
      destinationDir = resolveSafePath(worldDir, 'datapacks');
    }
    ensureDir(destinationDir);
    const destination = resolveSafePath(destinationDir, filename);
    await fetchWithRetry(url, destination, progress => sendInstallProgress(instance.name, 'downloading', `Downloading ${filename}`, progress.percent));
    try { verifyCurseForgeFile(file, destination); } catch (error) { fs.rmSync(destination, { force: true }); throw error; }
    if (type === 'mod' && !isValidJar(destination)) { fs.rmSync(destination, { force: true }); throw new Error('The downloaded mod is not a valid JAR'); }
    if (type === 'mod' && options.replaceFilename) {
      const previous = safeRemoteFilename(options.replaceFilename);
      if (previous !== filename && /\.jar(?:\.disabled)?$/i.test(previous)) {
        fs.rmSync(resolveSafePath(destinationDir, previous), { force: true });
      }
    }
    const metaFile = getInstanceDir(instance, type === 'mod' ? 'mods_meta.json' : 'content_meta.json');
    const metadata = readJSON(metaFile) || {};
    const info = { projectId: `curseforge:${id}`, title: project.name || filename, iconUrl: project.logo?.url || null, installedVersion: String(fileId), installedAt: new Date().toISOString(), source: 'curseforge' };
    if (type === 'mod') {
      if (options.replaceFilename) delete metadata[safeRemoteFilename(options.replaceFilename).replace(/\.disabled$/i, '')];
      metadata[filename] = info;
    }
    else metadata[`${type}:${filename}`] = { ...info, projectType: type };
    writeJSON(metaFile, metadata);
    return { filename, projectId: `curseforge:${id}` };
  });

  ipcMain.handle('get-instance-worlds', async (_, instanceName) => {
    const savesDir = getInstanceDirByName(sanitizeName(instanceName), 'saves');
    try {
      return fs.readdirSync(savesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    } catch { return []; }
  });

  ipcMain.handle('import-curseforge-modpack', async (_, options = {}) => {
    const projectId = Number(String(options.projectId).replace(/^curseforge:/, ''));
    const fileId = Number(options.fileId);
    const name = sanitizeName(options.name);
    if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(fileId) || fileId <= 0) throw new Error('Invalid CurseForge modpack');
    const registry = readJSON(INSTANCES_FILE) || [];
    if (registry.some(item => item.name === name)) throw new Error(`Instance "${name}" already exists`);
    const file = (await curseForgeFetch(`/mods/${projectId}/files/${fileId}`)).data;
    let url = file?.downloadUrl;
    if (!url) {
      try { url = (await curseForgeFetch(`/mods/${projectId}/files/${fileId}/download-url`)).data; } catch {}
    }
    if (!url || new URL(url).protocol !== 'https:') throw new Error('This modpack cannot be downloaded by third-party launchers');
    const cacheDir = path.join(app.getPath('userData'), 'cache', 'modpacks');
    ensureDir(cacheDir);
    const archivePath = path.join(cacheDir, `${projectId}-${fileId}.zip`);
    await fetchWithRetry(url, archivePath, progress => sendInstallProgress(name, 'downloading', 'Downloading modpack', Math.round((progress.percent || 0) * 0.2)));
    try { verifyCurseForgeFile(file, archivePath); } catch (error) { fs.rmSync(archivePath, { force: true }); throw error; }
    let archive;
    let manifest;
    try {
      archive = new AdmZip(archivePath);
      const manifestEntry = archive.getEntry('manifest.json');
      if (!manifestEntry) throw new Error('The archive has no CurseForge manifest.json');
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch (error) {
      fs.rmSync(archivePath, { force: true });
      throw new Error(`Invalid CurseForge modpack: ${error.message}`);
    }
    const gameVersion = String(manifest.minecraft?.version || '');
    const primaryLoader = (manifest.minecraft?.modLoaders || []).find(item => item.primary) || manifest.minecraft?.modLoaders?.[0];
    const loaderMatch = String(primaryLoader?.id || '').match(/^(forge|fabric|quilt|neoforge)-(.+)$/i);
    const loader = loaderMatch ? loaderMatch[1].toLowerCase() : 'vanilla';
    const loaderVersion = loaderMatch ? loaderMatch[2] : null;
    const versions = await fetchMinecraftVersions();
    if (!versions.versions?.some(item => item.id === gameVersion)) throw new Error(`The modpack requests unknown Minecraft version ${gameVersion}`);
    if (!['vanilla', 'fabric', 'quilt', 'forge'].includes(loader)) throw new Error(`The modpack loader ${loader} is not supported yet`);
    const instanceDir = resolveSafePath(INSTANCES_DIR, name);
    if (fs.existsSync(instanceDir) && fs.readdirSync(instanceDir).length) throw new Error(`The instance folder ${name} is not empty`);
    ensureDir(instanceDir);
    const written = [];
    try {
      ensureDir(path.join(instanceDir, 'mods'));
      ensureDir(path.join(instanceDir, 'saves'));
      ensureDir(path.join(instanceDir, 'config'));
      const overridesPrefix = `${String(manifest.overrides || 'overrides').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/`;
      let extractedBytes = 0;
      let extractedFiles = 0;
      for (const entry of archive.getEntries()) {
        const normalized = entry.entryName.replace(/\\/g, '/');
        if (entry.isDirectory || !normalized.startsWith(overridesPrefix)) continue;
        const relative = normalized.slice(overridesPrefix.length);
        const parts = relative.split('/').filter(Boolean);
        if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error('The modpack contains an unsafe override path');
        extractedBytes += entry.header.size;
        extractedFiles += 1;
        if (extractedBytes > 1024 * 1024 * 1024 || extractedFiles > 10000) throw new Error('The modpack overrides exceed Pine safety limits');
        const destination = resolveSafePath(instanceDir, ...parts);
        ensureDir(path.dirname(destination));
        fs.writeFileSync(destination, entry.getData());
        written.push(destination);
      }
      const modsMeta = {};
      const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
      for (let index = 0; index < manifestFiles.length; index += 1) {
        const item = manifestFiles[index];
        if (!item.required) continue;
        const modId = Number(item.projectID);
        const modFileId = Number(item.fileID);
        if (!Number.isSafeInteger(modId) || !Number.isSafeInteger(modFileId)) throw new Error('The modpack contains an invalid file reference');
        const modFile = (await curseForgeFetch(`/mods/${modId}/files/${modFileId}`)).data;
        const project = (await curseForgeFetch(`/mods/${modId}`)).data;
        let modUrl = modFile?.downloadUrl;
        if (!modUrl) {
          try { modUrl = (await curseForgeFetch(`/mods/${modId}/files/${modFileId}/download-url`)).data; } catch {}
        }
        if (!modUrl || new URL(modUrl).protocol !== 'https:') throw new Error(`${project?.name || modId} does not allow third-party downloads`);
        const filename = safeRemoteFilename(modFile.fileName);
        const destination = resolveSafePath(instanceDir, 'mods', filename);
        await fetchWithRetry(modUrl, destination, progress => sendInstallProgress(name, 'downloading', `Installing ${index + 1} of ${manifestFiles.length}: ${filename}`, 20 + Math.round(((index + (progress.percent || 0) / 100) / Math.max(1, manifestFiles.length)) * 75)));
        try { verifyCurseForgeFile(modFile, destination); } catch (error) { fs.rmSync(destination, { force: true }); throw error; }
        written.push(destination);
        modsMeta[filename] = { projectId: `curseforge:${modId}`, title: project?.name || filename, iconUrl: project?.logo?.url || null, installedVersion: String(modFileId), installedAt: new Date().toISOString(), source: 'curseforge' };
      }
      writeJSON(path.join(instanceDir, 'mods_meta.json'), modsMeta);
      const defaults = readJSON(SETTINGS_FILE) || {};
      const entry = {
        name, path: instanceDir, customRoot: '', gameVersion, profile: loader === 'vanilla' ? 'vanilla' : 'custom', loader, loaderVersion,
        created: new Date().toISOString(), lastPlayed: null, minMemory: sanitizeMemory(defaults.minMemory, '2G'), maxMemory: sanitizeMemory(defaults.maxMemory, '4G'),
        memoryOverride: false, iconData: null, bannerData: null, bannerBlurDir: 'left', modpack: { source: 'curseforge', projectId, fileId },
      };
      registry.push(entry);
      writeJSON(INSTANCES_FILE, registry);
      sendInstallProgress(name, 'done', 'Modpack imported', 100);
      return entry;
    } catch (error) {
      fs.rmSync(instanceDir, { recursive: true, force: true });
      throw error;
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  });

  ipcMain.handle('get-project-versions', async (_, projectId, loaders, gameVersions) => {
    const params = new URLSearchParams();
    if (loaders?.length) params.set('loaders', JSON.stringify(loaders));
    if (gameVersions?.length) params.set('game_versions', JSON.stringify(gameVersions));
    return modrinthFetch(`/project/${encodeURIComponent(projectId)}/version?${params}`);
  });

  // ── Helper: resolve a dependency to its version ────────────────────
  async function resolveDepVersion(dep, loaders, gameVersion) {
    if (dep.version_id) {
      const version = await modrinthFetch(`/version/${dep.version_id}`);
      if (versionSupports(version, gameVersion, loaders)) return version;
      return null;
    }
    if (dep.project_id) {
      const versions = await modrinthFetch(`/project/${dep.project_id}/version`);
      const compatible = versions.filter(v => versionSupports(v, gameVersion, loaders));
      return compatible[0] || null;
    }
    return null;
  }

  // ── Helper: recursively resolve deps (N levels, dedup, cycle guard) ──
  async function resolveDepsRecursive(deps, loaders, gameVersion, visited = new Set(), results = [], unresolved = []) {
    for (const dep of deps) {
      if (!dep.project_id || visited.has(dep.project_id)) continue;
      visited.add(dep.project_id);
      const depVer = await resolveDepVersion(dep, loaders, gameVersion);
      if (depVer) {
        results.push(depVer);
        const subDeps = (depVer.dependencies || [])
          .filter(d => d.dependency_type === 'required' && d.project_id);
        if (subDeps.length) {
          await resolveDepsRecursive(subDeps, loaders, gameVersion, visited, results, unresolved);
        }
      } else unresolved.push(dep);
    }
    return results;
  }

  // ── Helper: validate loader version per loader type ────────────────
  async function checkLoaderVersion(loader, loaderVersion, gameVersion) {
    if (!loader || loader === 'vanilla' || !loaderVersion) return null;
    switch (loader) {
      case 'fabric': {
        const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}`;
        try { const r = await portableFetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return 'Installed Fabric Loader ' + loaderVersion + ' may not be compatible with MC ' + gameVersion; } catch { return 'Could not verify the Fabric loader version because the metadata service is unavailable'; }
        return null;
      }
      case 'quilt': {
        const url = `https://meta.quiltmc.org/v3/versions/loader/${gameVersion}/${loaderVersion}`;
        try { const r = await portableFetch(url, { headers: { 'User-Agent': 'PineLauncher/1.1' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) return 'Installed Quilt Loader ' + loaderVersion + ' may not be compatible with MC ' + gameVersion; } catch { return 'Could not verify the Quilt loader version because the metadata service is unavailable'; }
        return null;
      }
      case 'forge': {
        try {
          const r = await portableFetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', { signal: AbortSignal.timeout(15000) });
          if (r.ok) {
            const xml = await r.text();
            const known = xml.includes(`<version>${gameVersion}-${loaderVersion}</version>`);
            if (!known) return 'Installed Forge ' + loaderVersion + ' may not be compatible with MC ' + gameVersion;
          } else return `Forge metadata returned HTTP ${r.status}`;
        } catch { return 'Could not verify the Forge loader version because the metadata service is unavailable'; }
        return null;
      }
      case 'neoforge': {
        try {
          const r = await portableFetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { signal: AbortSignal.timeout(15000) });
          if (r.ok) {
            const xml = await r.text();
            const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
            const prefix = gameVersion.replace(/^1\./, '') + '.';
            const known = versions.some(v => v.startsWith(prefix) && v === loaderVersion);
            if (!known && !versions.some(v => v.startsWith(prefix))) return 'Installed NeoForge ' + loaderVersion + ' may not be compatible with MC ' + gameVersion;
          } else return `NeoForge metadata returned HTTP ${r.status}`;
        } catch { return 'Could not verify the NeoForge loader version because the metadata service is unavailable'; }
        return null;
      }
      default:
        return null;
    }
  }

  // ── Pre-flight install check ──────────────────────────────────────
  ipcMain.handle('check-install-feasibility', async (_, instanceName, projectId, versionId, loaders, gameVersion) => {
    const safeName = sanitizeName(instanceName);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(i => i.name === safeName);
    if (!instance) throw new Error('Instance not found');

    const version = await modrinthFetch(`/version/${versionId}`);
    const project = await modrinthFetch(`/project/${projectId}`);
    gameVersion = instance.gameVersion;
    loaders = instance.loader && instance.loader !== 'vanilla' ? [instance.loader] : [];

    const warnings = [];
    const errors = [];
    const knownIncompatibility = knownModrinthIncompatibility(project.id || projectId, version.id || versionId, gameVersion);
    if (knownIncompatibility) errors.push(knownIncompatibility);

    if (project.project_type === 'modpack') {
      errors.push({ code: 'UNSUPPORTED_PROJECT_TYPE', message: 'Modpack importing is not supported yet; installing an .mrpack file as a mod would break the instance.' });
    }
    if (project.project_type === 'datapack') {
      errors.push({ code: 'UNSUPPORTED_PROJECT_TYPE', message: 'Data packs must be installed into a specific world and cannot be installed at the instance level.' });
    }

    const versionGames = version.game_versions || [];
    const versionLoaders = version.loaders || [];
    if (!versionGames.includes(gameVersion)) {
      errors.push({ code: 'GAME_VERSION_MISMATCH', message: `${version.name || project.title} does not support Minecraft ${gameVersion}` });
    }
    if (project.project_type === 'mod' && instance.loader === 'vanilla') {
      errors.push({ code: 'LOADER_REQUIRED', message: 'Mods require a Fabric, Quilt, or Forge instance. Vanilla instances cannot load mod JARs.' });
    } else if (loaders.length && project.project_type === 'mod' && !loaders.some(l => versionLoaders.includes(l))) {
      errors.push({ code: 'LOADER_MISMATCH', message: `${version.name || project.title} does not support ${instance.loader}` });
    }
    if (errors.length) return { feasible: false, errors, warnings, version, project, instance };

    // 1. CurseForge distribution-disabled check
    const validFiles = (version.files || []).filter(f => f.url);
    if (!validFiles.length) {
      const slug = project.slug || projectId;
      errors.push({
        code: 'NO_DOWNLOAD_URL',
        message: `This mod isn't available for automatic download`,
        detail: `Install manually from https://modrinth.com/project/${slug}`,
        url: `https://modrinth.com/project/${slug}`,
      });
      return { feasible: false, errors, warnings, version, project, instance };
    }

    // 2. Loader version validation (loader-agnostic)
    const loaderWarning = await checkLoaderVersion(instance.loader, instance.loaderVersion, gameVersion);
    if (loaderWarning) {
      warnings.push({ code: 'LOADER_VERSION_MISMATCH', message: loaderWarning });
    }

    // 3. Java version check (from piston-meta, fallback to hardcoded map)
    const requiredJava = await getRequiredJava(gameVersion);
    const javaResult = await findCompatibleJava(requiredJava, instance.javaPath || readJSON(SETTINGS_FILE)?.javaPath || '');
    if (!javaResult.java) {
      const detected = javaResult.checked.map(java => java.major).join(', ') || 'none';
      warnings.push({
        code: 'OLD_JAVA',
        message: `MC ${gameVersion} needs Java ${requiredJava}+; detected Java versions: ${detected}`,
        detail: 'Install a compatible Java version or select it in Settings',
      });
    }

    // 4. Dependency analysis + resolve required dep versions (recursive)
    const deps = version.dependencies || [];
    const requiredDeps = deps.filter(d => d.dependency_type === 'required' && d.project_id);
    const optionalDeps = deps.filter(d => d.dependency_type === 'optional' && d.project_id);
    const incompatibleDeps = deps.filter(d => d.dependency_type === 'incompatible' && d.project_id);

    const visitedDeps = new Set([projectId]); // prevent self-reference
    const unresolvedRequired = [];
    const resolvedRequired = await resolveDepsRecursive(requiredDeps, loaders, gameVersion, visitedDeps, [], unresolvedRequired);
    if (unresolvedRequired.length) {
      errors.push({
        code: 'INCOMPATIBLE_DEPENDENCY',
        message: `${project.title || version.name} has ${unresolvedRequired.length} required dependency that is unavailable for Minecraft ${gameVersion} and ${instance.loader}`,
        detail: 'Pine refused to install an incompatible fallback version.',
      });
      return { feasible: false, errors, warnings, version, project, instance };
    }

    // 5. Disk space check (after dep resolution)
    const primarySize = validFiles[0].size || 0;
    const depSizes = resolvedRequired.reduce((s, v) => s + (v.files?.[0]?.size || 0), 0);
    const totalNeeded = Math.ceil((primarySize + depSizes) * 1.2);
    const modsDir = getInstanceDirByName(instanceName, 'mods');
    ensureDir(modsDir);
    if (!checkDiskSpace(modsDir, totalNeeded)) {
      try {
        const stat = fs.statfsSync(modsDir);
        const avail = stat.bsize * stat.bfree;
        errors.push({
          code: 'DISK_SPACE',
          message: `Not enough disk space`,
          detail: `Need ${fmtBytes(totalNeeded)}, only ${fmtBytes(avail)} available`,
        });
      } catch {
        errors.push({
          code: 'DISK_SPACE',
          message: `Not enough disk space`,
          detail: `Need ${fmtBytes(totalNeeded)}`,
        });
      }
      return { feasible: false, errors, warnings, version, project, instance };
    }

    // 6. Duplicate detection
    const existingMods = (await getInstanceModsList(instanceName));
    const duplicate = existingMods.find(m => m.projectId === projectId);
    if (duplicate) {
      warnings.push({
        code: 'DUPLICATE',
        message: `${duplicate.title} is already installed`,
        detail: `Existing: ${duplicate.filename} → will disable it and install the new version`,
        existingFile: duplicate.filename,
      });
    }

    // 7. Client/Server environment check
    if (project.server_side === 'required' && project.client_side === 'unsupported') {
      warnings.push({
        code: 'SERVER_ONLY',
        message: `${project.title} is a server-side mod`,
        detail: 'It may not function properly on a client',
      });
    }

    // 8. Incompatible already installed (bidirectional)
    for (const inc of incompatibleDeps) {
      const found = existingMods.find(m => m.projectId === inc.project_id);
      if (found) {
        warnings.push({
          code: 'INCOMPATIBLE_INSTALLED',
          message: `${found.title} is incompatible with ${version.name || project.title}`,
          detail: `Will disable ${found.filename}`,
          existingFile: found.filename,
        });
      }
    }
    for (const existing of existingMods) {
      if (!existing.projectId || !existing.installedVersion) continue;
      let depData = existing.depData;
      if (!depData) {
        try {
          const existingVer = await modrinthFetch(`/version/${existing.installedVersion}`);
          depData = existingVer.dependencies || [];
        } catch { continue; }
      }
      const declaresIncompatible = (depData)
        .some(d => d.dependency_type === 'incompatible' && d.project_id === projectId);
      if (declaresIncompatible) {
        const alreadyWarned = warnings.some(w => w.code === 'INCOMPATIBLE_INSTALLED' && w.existingFile === existing.filename);
        if (!alreadyWarned) {
          warnings.push({
            code: 'INCOMPATIBLE_INSTALLED',
            message: `${existing.title} declares ${project.title || version.name} as incompatible`,
            detail: `Will disable ${existing.filename}`,
            existingFile: existing.filename,
          });
        }
      }
    }

    const requiredDepSizes = {};
    for (const v of resolvedRequired) {
      if (v.id) requiredDepSizes[v.id] = v.files?.[0]?.size || 0;
    }

    return {
      feasible: true,
      errors,
      warnings,
      optionalDeps,
      requiredDepVersionIds: Object.keys(requiredDepSizes),
      requiredDepSizes,
      incompatibleDeps: incompatibleDeps.map(d => d.project_id),
      file: validFiles.find(f => f.primary) || validFiles[0],
      version,
      project,
      instance,
    };
  });

  // ── Helper: process a single version file through verify pipeline ──
  async function processSingleVersion(instance, versionId, writtenFiles) {
    const instanceName = instance.name;
    const version = await modrinthFetch(`/version/${versionId}`);
    const file = version.files?.find(f => f.primary) || version.files?.[0];
    if (!file) throw new Error(`No files in version ${versionId}`);

    // Route by project type: resource packs / shaders / datapacks go to
    // their own folders; everything else (mods, modpacks) goes to mods/.
    const project = await modrinthFetch(`/project/${version.project_id}`);
    const projectType = project.project_type || 'mod';
    if (projectType === 'modpack' || projectType === 'datapack') {
      throw new Error(`${projectType === 'modpack' ? 'Modpack importing' : 'Data-pack installation'} is not supported by this installer`);
    }

    if (!(version.game_versions || []).includes(instance.gameVersion)) {
      throw new Error(`${version.name || file.filename} does not support Minecraft ${instance.gameVersion}`);
    }
    if (projectType === 'mod') {
      if (instance.loader === 'vanilla') throw new Error('Vanilla instances cannot install mod JARs');
      if (!(version.loaders || []).includes(instance.loader)) {
        throw new Error(`${version.name || file.filename} does not support ${instance.loader}`);
      }
    }

    const sub = projectType === 'resourcepack' ? 'resourcepacks'
      : projectType === 'shader' ? 'shaderpacks'
      : projectType === 'datapack' ? 'datapacks' : 'mods';
    const targetDir = getInstanceDirByName(instanceName, sub);
    ensureDir(targetDir);
    const safeFilename = safeRemoteFilename(file.filename);
    const filePath = resolveSafePath(targetDir, safeFilename);

    // Never overwrite an existing user file. Updates explicitly disable the
    // previous file before this point; dependencies already present are kept.
    if (fs.existsSync(filePath)) return null;

    // Phase: try cache
    sendInstallProgress(instanceName, 'caching', `Checking cache for ${file.filename}…`, 0);
    const cached = getCachedPath(versionId, file.hashes?.sha512, 'sha512')
               || getCachedPath(versionId, file.hashes?.sha1, 'sha1');
    if (cached) {
      sendInstallProgress(instanceName, 'caching', `Copying ${file.filename} from cache…`, 50);
      fs.copyFileSync(cached, filePath);
    } else {
      sendInstallProgress(instanceName, 'downloading', `Downloading ${file.filename}…`, 0);
      await fetchWithRetry(file.url, filePath, (p) => {
        sendInstallProgress(instanceName, 'downloading', `Downloading ${file.filename}…`, p.percent);
      });
    }

    writtenFiles.push(filePath);

    // Phase: verify hash
    sendInstallProgress(instanceName, 'verifying', `Verifying ${file.filename}…`, 85);
    if (file.hashes?.sha512) {
      const hash = crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
      if (hash !== file.hashes.sha512) {
        throw new Error(`Hash mismatch for ${file.filename} (expected ${file.hashes.sha512})`);
      }
    } else if (file.hashes?.sha1) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
      if (hash !== file.hashes.sha1) {
        throw new Error(`Hash mismatch for ${file.filename}`);
      }
    }

    // Validate ZIP
    if (!isValidJar(filePath)) {
      throw new Error(`Downloaded file ${file.filename} is corrupted`);
    }

    // Save to cache
    writeToCache(versionId, file.hashes?.sha512 || file.hashes?.sha1,
      file.hashes?.sha512 ? 'sha512' : 'sha1', filePath);

    return { version, file, filePath, projectType, project };
  }

  // ── Install mod (download + verify + save) with batch rollback ────
  ipcMain.handle('install-mod', async (_, instanceName, options = {}) => {
    const { versionIds, disableFiles } = options;
    if (!versionIds?.length) throw new Error('No versions to install');
    const safeName = sanitizeName(instanceName);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(item => item.name === safeName);
    if (!instance) throw new Error('Instance not found');

    const modsDir = getInstanceDirByName(safeName, 'mods');
    ensureDir(modsDir);

    // Batch tracking for rollback
    const writtenFiles = [];
    const disabledBackup = []; // { original, backup }

    sendInstallProgress(instanceName, 'checking', 'Preparing…', 0);

    // ── Disk space check with full file list (incl. optional deps) ──
    const knownSizes = options.versionSizes || {};
    let totalSize = 0;
    for (const vid of versionIds) {
      const cached = knownSizes[vid];
      if (cached) {
        totalSize += cached;
      } else {
        try {
          const v = await modrinthFetch(`/version/${vid}`);
          totalSize += v.files?.[0]?.size || 0;
        } catch {}
      }
    }
    const needed = Math.ceil(totalSize * 1.2);
    if (!checkDiskSpace(modsDir, needed)) {
      let avail = 0;
      try { const s = fs.statfsSync(modsDir); avail = s.bsize * s.bfree; } catch {}
      const msg = 'Not enough disk space' + (avail ? ` — need ${fmtBytes(needed)}, only ${fmtBytes(avail)} available` : '');
      throw new Error(msg);
    }

    try {
      // Disable conflicting files before starting
      if (disableFiles?.length) {
      for (const f of disableFiles) {
          const safeFile = safeRemoteFilename(f);
          const fullPath = resolveSafePath(modsDir, safeFile);
          if (fs.existsSync(fullPath) && !fullPath.endsWith('.disabled')) {
            const backup = fullPath + '.disabled';
            fs.renameSync(fullPath, backup);
            disabledBackup.push({ original: fullPath, backup });
          }
        }
      }

      // Process each version through the full pipeline
      const installed = [];
      for (let i = 0; i < versionIds.length; i++) {
        const vid = versionIds[i];
        sendInstallProgress(instanceName, 'downloading',
          `Installing ${i + 1} of ${versionIds.length}…`, Math.round((i / versionIds.length) * 80));

        const result = await processSingleVersion(instance, vid, writtenFiles);
        if (result === null) continue; // already existed

        // Save metadata (mods only — resource packs etc. live in their own folders)
        const contentMetaFile = getInstanceDirByName(instanceName, 'content_meta.json');
        let contentMeta = {};
        try { contentMeta = JSON.parse(fs.readFileSync(contentMetaFile, 'utf8')); } catch {}
        contentMeta[`${result.projectType}:${result.file.filename}`] = {
          projectId: result.version.project_id,
          title: result.project?.title || result.version.name || result.file.filename,
          iconUrl: result.project?.icon_url || null,
          installedVersion: vid,
          installedAt: new Date().toISOString(),
          projectType: result.projectType,
        };
        fs.writeFileSync(contentMetaFile, JSON.stringify(contentMeta, null, 2));

        if (result.projectType === 'mod') {
          const metaFile = getInstanceDirByName(instanceName, 'mods_meta.json');
          let meta = {};
          try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
          meta[result.file.filename] = {
            projectId: result.version.project_id,
            title: result.version.name || result.file.filename,
            iconUrl: null,
            installedVersion: vid,
            installedAt: new Date().toISOString(),
            depData: result.version.dependencies || [],
          };
          if (result.project) {
            meta[result.file.filename].iconUrl = result.project.icon_url || null;
            meta[result.file.filename].title = result.project.title || result.version.name || result.file.filename;
          }
          fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
        }

        installed.push({ filename: result.file.filename, projectId: result.version.project_id });
      }

      sendInstallProgress(instanceName, 'done', `Installed ${installed.length} file${installed.length > 1 ? 's' : ''}`, 100);
      return { installed, primary: installed[0] || null };
    } catch (e) {
      // ── Batch rollback on failure ──
      for (const fp of writtenFiles) {
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
      }
      for (const { original, backup } of disabledBackup) {
        try {
          if (fs.existsSync(backup) && !fs.existsSync(original)) {
            fs.renameSync(backup, original);
          }
        } catch {}
      }
      // Clean metadata for partial installs
      const metaFile = getInstanceDirByName(instanceName, 'mods_meta.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        for (const fp of writtenFiles) {
          delete meta[path.basename(fp)];
        }
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
      } catch {}
      throw e;
    }
  });

  // ── Get optional dependencies for user selection ──────────────────
  ipcMain.handle('get-optional-deps', async (_, projectIds) => {
    const results = [];
    for (const pid of projectIds) {
      try {
        const p = await modrinthFetch(`/project/${pid}`);
        results.push({ projectId: pid, title: p.title || pid, iconUrl: p.icon_url || null });
      } catch {
        results.push({ projectId: pid, title: pid, iconUrl: null });
      }
    }
    return results;
  });

  // ── Disable mod (soft delete) ────────────────────────────────────
  ipcMain.handle('disable-mod', async (_, instanceName, filename) => {
    const safeName = sanitizeName(instanceName);
    const safeFile = path.basename(filename);
    if (!safeFile.endsWith('.jar') && !safeFile.endsWith('.jar.disabled')) {
      throw new Error('Invalid mod filename');
    }
    const modsDir = getInstanceDirByName(safeName, 'mods');
    const suppliedPath = resolveSafePath(modsDir, safeFile);
    const enabledPath = suppliedPath.endsWith('.disabled') ? suppliedPath.slice(0, -9) : suppliedPath;
    const disabledPath = `${enabledPath}.disabled`;
    if (fs.existsSync(enabledPath)) {
      if (fs.existsSync(disabledPath)) fs.rmSync(disabledPath, { force: true });
      fs.renameSync(enabledPath, disabledPath);
    } else if (fs.existsSync(disabledPath)) {
      // Already disabled — re-enable
      fs.renameSync(disabledPath, enabledPath);
    }
    return true;
  });

  // ── Check for updates ────────────────────────────────────────────
  ipcMain.handle('check-mod-updates', async (_, instanceName) => {
    const safeName = sanitizeName(instanceName);
    const mods = await getInstanceModsList(safeName);
    const updates = [];
    for (const mod of mods) {
      if (!mod.projectId) continue;
      try {
        const registry = readJSON(INSTANCES_FILE) || [];
        const instance = registry.find(i => i.name === instanceName);
        if (String(mod.projectId).startsWith('curseforge:')) {
          const id = Number(String(mod.projectId).slice('curseforge:'.length));
          const params = new URLSearchParams({ gameVersion: instance?.gameVersion || '', pageSize: '50' });
          if (CURSEFORGE_LOADER_TYPES[instance?.loader]) params.set('modLoaderType', String(CURSEFORGE_LOADER_TYPES[instance.loader]));
          const files = (await curseForgeFetch(`/mods/${id}/files?${params}`)).data || [];
          const latest = files[0];
          if (latest && String(latest.id) !== String(mod.installedVersion)) {
            updates.push({ filename: mod.filename, projectId: mod.projectId, title: mod.title, currentVersion: mod.installedVersion, latestVersion: String(latest.id), latestVersionName: latest.displayName || latest.fileName || String(latest.id), source: 'curseforge' });
          }
          continue;
        }
        const versions = await modrinthFetch(`/project/${mod.projectId}/version`);
        // Find the latest version that matches the instance's game version
        const loaders = instance?.loader && instance.loader !== 'vanilla' ? [instance.loader] : [];
        const compatible = versions.filter(v => {
          const gv = v.game_versions || [];
          const lv = v.loaders || [];
          return gv.includes(instance?.gameVersion) &&
            (!loaders.length || loaders.some(l => lv.includes(l)));
        });
        const latest = compatible[0];
        if (latest && latest.id !== mod.installedVersion) {
          updates.push({
            filename: mod.filename,
            projectId: mod.projectId,
            title: mod.title,
            currentVersion: mod.installedVersion,
            latestVersion: latest.id,
            latestVersionName: latest.name || latest.id,
          });
        }
      } catch {}
    }
    return updates;
  });

  // ── Helper: get instance mods list ────────────────────────────────
  async function getInstanceModsList(instanceName) {
    const safeName = sanitizeName(instanceName);
    const modsDir = getInstanceDirByName(safeName, 'mods');
    ensureDir(modsDir);
    const allFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
    const enabledNames = new Set(allFiles.filter(f => f.endsWith('.jar')));
    const files = allFiles.filter(f => !f.endsWith('.jar.disabled') || !enabledNames.has(f.slice(0, -9)));
    const registry = readJSON(INSTANCES_FILE) || [];
    const instanceLoader = registry.find(item => item.name === safeName)?.loader || 'vanilla';
    const metaFile = getInstanceDirByName(safeName, 'mods_meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
    return files.map(f => {
      const metaKey = f.endsWith('.disabled') ? f.slice(0, -9) : f;
      const info = meta[f] || meta[metaKey] || {};
      const jarPath = path.join(modsDir, f);
      return ({
      filename: f,
      path: jarPath,
      projectId: info.projectId || null,
      title: info.title || f.replace(/\.jar(?:\.disabled)?$/, ''),
      iconUrl: info.iconUrl || null,
      installedVersion: info.installedVersion || null,
      installedAt: info.installedAt || null,
      depData: info.depData || null,
      disabled: f.endsWith('.disabled'),
      compatibilityIssue: jarLoaderCompatibilityIssue(jarPath, f, instanceLoader),
    }); });
  }

  // ── Helper: send install progress to renderer ────────────────────
  function sendInstallProgress(instanceName, phase, message, percent) {
    if (mainWindow) {
      mainWindow.webContents.send('install-progress', { instanceName, phase, message, percent });
    }
  }

  // ── get-instance-mods (updated) ───────────────────────────────────
  ipcMain.handle('get-instance-mods', async (_, instanceName) => {
    const safeName = sanitizeName(instanceName);
    return getInstanceModsList(safeName);
  });

  const CONTENT_DIRS = Object.freeze({ resourcepack: 'resourcepacks', shader: 'shaderpacks' });
  function validateContentType(type) {
    if (type !== 'mod' && type !== 'datapack' && !Object.prototype.hasOwnProperty.call(CONTENT_DIRS, type)) {
      throw new Error('Invalid content type');
    }
    return type;
  }
  async function getInstanceContentList(instanceName, type) {
    const safeName = sanitizeName(instanceName);
    validateContentType(type);
    if (type === 'mod') return getInstanceModsList(safeName);
    const base = getInstanceDirByName(safeName);
    const metaFile = resolveSafePath(base, 'content_meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
    const mapFile = (dir, filename, world = null, isDirectory = false) => {
      const enabledName = filename.endsWith('.disabled') ? filename.slice(0, -9) : filename;
      const info = meta[`${type}:${enabledName}`] || meta[`${type}:${filename}`] || {};
      return {
        key: world ? `${world}/${filename}` : filename,
        filename,
        path: path.join(dir, filename),
        projectId: info.projectId || null,
        title: info.title || enabledName.replace(/\.(?:zip|jar)$/i, ''),
        iconUrl: info.iconUrl || null,
        installedVersion: info.installedVersion || null,
        installedAt: info.installedAt || null,
        disabled: filename.endsWith('.disabled'),
        isDirectory,
        world,
        type,
      };
    };
    if (type === 'datapack') {
      const savesDir = resolveSafePath(base, 'saves');
      let worlds = [];
      try { worlds = fs.readdirSync(savesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()); } catch {}
      return worlds.flatMap(world => {
        const dir = resolveSafePath(savesDir, world.name, 'datapacks');
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() || /\.zip(?:\.disabled)?$/i.test(entry.name)); } catch {}
        return entries.map(entry => mapFile(dir, entry.name, world.name, entry.isDirectory()));
      });
    }
    const dir = resolveSafePath(base, CONTENT_DIRS[type]);
    ensureDir(dir);
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || /\.(?:zip|jar)(?:\.disabled)?$/i.test(entry.name))
      .map(entry => mapFile(dir, entry.name, null, entry.isDirectory()));
  }
  ipcMain.handle('get-instance-content', async (_, instanceName, type) => {
    return getInstanceContentList(instanceName, validateContentType(type));
  });
  ipcMain.handle('toggle-instance-content', async (_, instanceName, type, key) => {
    validateContentType(type);
    if (type === 'mod') throw new Error('Use the mod toggle action');
    const item = (await getInstanceContentList(instanceName, type)).find(entry => entry.key === key);
    if (!item) throw new Error('Content file not found');
    const enabledPath = item.path.endsWith('.disabled') ? item.path.slice(0, -9) : item.path;
    const disabledPath = `${enabledPath}.disabled`;
    if (fs.existsSync(enabledPath)) fs.renameSync(enabledPath, disabledPath);
    else if (fs.existsSync(disabledPath)) fs.renameSync(disabledPath, enabledPath);
    return true;
  });
  ipcMain.handle('remove-instance-content', async (_, instanceName, type, key) => {
    validateContentType(type);
    if (type === 'mod') throw new Error('Use the mod removal action');
    const item = (await getInstanceContentList(instanceName, type)).find(entry => entry.key === key);
    if (!item) throw new Error('Content file not found');
    const enabledPath = item.path.endsWith('.disabled') ? item.path.slice(0, -9) : item.path;
    const disabledPath = `${enabledPath}.disabled`;
    if (fs.existsSync(enabledPath)) fs.rmSync(enabledPath, { force: true, recursive: item.isDirectory });
    if (fs.existsSync(disabledPath)) fs.rmSync(disabledPath, { force: true, recursive: item.isDirectory });
    const metaFile = getInstanceDirByName(instanceName, 'content_meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const enabledName = item.filename.endsWith('.disabled') ? item.filename.slice(0, -9) : item.filename;
      delete meta[`${type}:${enabledName}`];
      delete meta[`${type}:${item.filename}`];
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    } catch {}
    return true;
  });

  ipcMain.handle('get-project', async (_, projectId) => {
    return modrinthFetch(`/project/${encodeURIComponent(projectId)}`);
  });

  ipcMain.handle('remove-mod', async (_, instanceName, filename) => {
    const safeName = sanitizeName(instanceName);
    const safeFile = path.basename(filename);
    if (!safeFile.endsWith('.jar') && !safeFile.endsWith('.jar.disabled')) {
      throw new Error('Invalid mod filename');
    }
    const modsDir = getInstanceDirByName(safeName, 'mods');
    const filePath = resolveSafePath(modsDir, safeFile);
    const enabledPath = filePath.endsWith('.disabled') ? filePath.slice(0, -9) : filePath;
    const disabledPath = `${enabledPath}.disabled`;
    if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
    if (fs.existsSync(disabledPath)) fs.unlinkSync(disabledPath);
    const metaFile = getInstanceDirByName(safeName, 'mods_meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const enabledName = safeFile.endsWith('.disabled') ? safeFile.slice(0, -9) : safeFile;
      delete meta[enabledName];
      delete meta[`${enabledName}.disabled`];
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    } catch {}
    return true;
  });

  // ── Settings ──────────────────────────────────────────────────────
  ipcMain.handle('save-settings', async (_, settings) => {
    const allowedBehaviors = new Set(['Keep open', 'Close on launch']);
    const minMemory = sanitizeMemory(settings?.minMemory, '2G');
    const maxMemory = sanitizeMemory(settings?.maxMemory, '4G');
    if (memoryMegabytes(minMemory) > memoryMegabytes(maxMemory)) throw new Error('Minimum memory cannot exceed maximum memory');
    const clean = {
      gayMode: Boolean(settings?.gayMode),
      javaPath: typeof settings?.javaPath === 'string' ? settings.javaPath.slice(0, 1024) : '',
      minMemory,
      maxMemory,
      launchBehavior: allowedBehaviors.has(settings?.launchBehavior) ? settings.launchBehavior : 'Keep open',
      dlLimit: Math.min(16, Math.max(2, Number.parseInt(settings?.dlLimit, 10) || 4)),
      accentColor: /^#[0-9a-f]{6}$/i.test(settings?.accentColor || '') ? settings.accentColor : '#ff5cb9',
      windowWidth: Math.min(7680, Math.max(320, Number.parseInt(settings?.windowWidth, 10) || 1280)),
      windowHeight: Math.min(4320, Math.max(240, Number.parseInt(settings?.windowHeight, 10) || 720)),
      jvmArgs: typeof settings?.jvmArgs === 'string' ? settings.jvmArgs.slice(0, 4096) : '',
      reducedMotion: Boolean(settings?.reducedMotion),
      discordPresence: settings?.discordPresence !== false,
      discordShowInstance: settings?.discordShowInstance !== false,
      discordShowServer: settings?.discordShowServer !== false,
    };
    writeJSON(SETTINGS_FILE, clean);
    refreshDiscordPresence(clean);
    return clean;
  });

  ipcMain.handle('get-settings', async () => {
    const settings = readJSON(SETTINGS_FILE) || {};
    delete settings.curseForgeApiKey;
    return settings;
  });
}

function migrateSettings() {
  const legacy = path.join(__dirname, 'settings.json');
  if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(legacy)) {
    const settings = readJSON(legacy);
    if (settings) writeJSON(SETTINGS_FILE, settings);
  }
}

// ── App Lifecycle ───────────────────────────────────────────────────
// ── Migrate instances out of the app folder (e.g. OneDrive) ────────
function migrateInstances() {
  if (!fs.existsSync(LEGACY_INSTANCES_DIR)) return;
  const migrationMarker = path.join(LEGACY_INSTANCES_DIR, '.pine-migration-complete');
  if (fs.existsSync(migrationMarker)) return;
  try {
    ensureDir(INSTANCES_DIR);
    const legacyRegistryFile = path.join(LEGACY_INSTANCES_DIR, 'registry.json');
    const legacyRegistry = readJSON(legacyRegistryFile) || [];

    let changed = false;
    for (const inst of legacyRegistry) {
      let safeName;
      try { safeName = sanitizeName(inst.name); } catch { continue; }
      const source = resolveSafePath(LEGACY_INSTANCES_DIR, safeName);
      const target = resolveSafePath(INSTANCES_DIR, safeName);
      if (fs.existsSync(source) && !fs.existsSync(target)) {
        fs.cpSync(source, target, { recursive: true });
        inst.path = target;
        changed = true;
      } else if (fs.existsSync(target)) {
        inst.path = target;
        changed = true;
      }
    }
    if (changed) writeJSON(path.join(INSTANCES_DIR, 'registry.json'), legacyRegistry);

    // Orphan folders not present in the registry (e.g. empty registry)
    let entries;
    try { entries = fs.readdirSync(LEGACY_INSTANCES_DIR, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (e.name === 'registry.json' || !e.isDirectory()) continue;
      let safeName;
      try { safeName = sanitizeName(e.name); } catch { continue; }
      const target = resolveSafePath(INSTANCES_DIR, safeName);
      if (!fs.existsSync(target)) {
        fs.cpSync(resolveSafePath(LEGACY_INSTANCES_DIR, safeName), target, { recursive: true });
      }
    }

    if (!fs.existsSync(path.join(INSTANCES_DIR, 'registry.json')) && fs.existsSync(legacyRegistryFile)) {
      fs.copyFileSync(legacyRegistryFile, path.join(INSTANCES_DIR, 'registry.json'));
    }

    fs.writeFileSync(migrationMarker, new Date().toISOString());
    console.log('[Migration] Instances copied to', INSTANCES_DIR, '(source retained as backup)');
  } catch (e) {
    console.warn('[Migration] Failed to migrate instances:', e.message);
  }
}

// ── Migrate userData dir renamed from "glaunch" to "Pine Launcher" ──
function migrateUserDataDir() {
  const oldUserData = path.join(app.getPath('appData'), 'glaunch');
  const newUserData = app.getPath('userData');
  if (oldUserData === newUserData) return;
  if (!fs.existsSync(oldUserData)) return;
  const migrationMarker = path.join(oldUserData, '.pine-migration-v2-complete');
  if (fs.existsSync(migrationMarker)) return;
  try {
    // Only meaningful data is copied; Chromium cache dirs regenerate
    // (and may be locked by the fresh session in the new dir).
    const items = ['instances', 'auth.json', 'settings.json'];
    for (const item of items) {
      const src = path.join(oldUserData, item);
      const dst = path.join(newUserData, item);
      if (fs.existsSync(src)) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
        else if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
      }
    }
    fs.writeFileSync(migrationMarker, new Date().toISOString());
    console.log('[Migration] User data copied to', newUserData, '(source retained as backup)');
  } catch (e) {
    console.warn('[Migration] Failed to migrate user data:', e.message);
  }
}

// ── Shared libraries/assets/versions cache ─────────────────────────
// Every instance launches against these shared dirs (via MCLC overrides),
// so downloads happen once per Minecraft version, not once per instance.
async function seedSharedDirs() {
  try {
    const registry = readJSON(INSTANCES_FILE) || [];
    let needAssets = !fs.existsSync(path.join(GLOBAL_ASSETS_DIR, 'objects'));
    let needLibs = true;
    try { needLibs = fs.readdirSync(GLOBAL_LIBRARIES_DIR).length === 0; } catch {}
    let needVersions = true;
    try {
      needVersions = !fs.readdirSync(GLOBAL_VERSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .some(f => {
          const metadata = readJSON(path.join(GLOBAL_VERSIONS_DIR, f));
          return metadata && !metadata.inheritsFrom && `${metadata.id}.json` === f;
        });
    } catch {}
    if (!needAssets && !needLibs && !needVersions) return;

    for (const inst of registry) {
      let instancePath;
      try { instancePath = getInstanceDir(inst); } catch { continue; }
      try {
        if (needAssets && fs.existsSync(path.join(instancePath, 'assets', 'objects'))) {
          await fs.promises.cp(path.join(instancePath, 'assets'), GLOBAL_ASSETS_DIR, { recursive: true });
          needAssets = false;
        }
        if (needLibs && fs.existsSync(path.join(instancePath, 'libraries'))) {
          await fs.promises.cp(path.join(instancePath, 'libraries'), GLOBAL_LIBRARIES_DIR, { recursive: true });
          needLibs = false;
        }
        if (needVersions && fs.existsSync(path.join(instancePath, 'versions'))) {
          ensureDir(GLOBAL_VERSIONS_DIR);
          const versionsRoot = path.join(instancePath, 'versions');
          let copiedVanilla = false;
          for (const entry of fs.readdirSync(versionsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const jsonPath = path.join(versionsRoot, entry.name, `${entry.name}.json`);
            const jarPath = path.join(versionsRoot, entry.name, `${entry.name}.jar`);
            const metadata = readJSON(jsonPath);
            // Only seed true Vanilla versions. Loader profiles have
            // inheritsFrom and must remain instance-specific.
            if (!metadata || metadata.inheritsFrom || metadata.id !== entry.name) continue;
            const sharedJson = path.join(GLOBAL_VERSIONS_DIR, `${entry.name}.json`);
            const sharedJar = path.join(GLOBAL_VERSIONS_DIR, `${entry.name}.jar`);
            if (!fs.existsSync(sharedJson)) await fs.promises.copyFile(jsonPath, sharedJson);
            if (isValidJar(jarPath) && !fs.existsSync(sharedJar)) await fs.promises.copyFile(jarPath, sharedJar);
            copiedVanilla = true;
          }
          if (copiedVanilla) needVersions = false;
        }
      } catch {}
      if (!needAssets && !needLibs && !needVersions) break;
    }
    console.log('[Shared] assets:', fs.existsSync(path.join(GLOBAL_ASSETS_DIR, 'objects')),
      '| libraries:', fs.existsSync(GLOBAL_LIBRARIES_DIR),
      '| versions:', fs.existsSync(GLOBAL_VERSIONS_DIR));
  } catch (e) {
    console.warn('[Shared] Seeding failed:', e.message);
  }
}

app.whenReady().then(() => {
  diagnosticLog('INFO', `Pine Launcher ${app.getVersion()} | ${process.platform} ${os.release()} ${process.arch} | Electron ${process.versions.electron}`);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  migrateSettings();
  migrateUserDataDir();
  migrateInstances();
  createWindow();
  updateManager = createUpdateManager({
    autoUpdater,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged && !process.argv.includes('--smoke-test'),
    send: updateState => {
      if (!mainWindow?.isDestroyed() && !mainWindow?.webContents.isDestroyed()) {
        mainWindow.webContents.send('update-state', updateState);
      }
    },
    isGameActive: () => Boolean(mcClient || activeInstanceName),
    log: (level, message) => diagnosticLog(String(level || 'info').toUpperCase(), `[Updater] ${message}`),
  });
  setupIPC();
  refreshDiscordPresence();
  updateManager.start();
  sharedSeedPromise = seedSharedDirs();
  if (process.argv.includes('--smoke-test')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const healthy = await mainWindow.webContents.executeJavaScript(
          `document.title === 'Pine Launcher' && typeof window.electronAPI?.listInstances === 'function'`
        );
        app.exit(healthy ? 0 : 2);
      } catch {
        app.exit(2);
      }
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  updateManager?.dispose();
  discordPresence.destroy();
  // The game process is intentionally detached. Only cancel a launch that has
  // not started Java yet; closing Pine must never close a running game.
  if (mcClient && !minecraftProcessStarted) { try { mcClient.stop(); } catch {} }
});
