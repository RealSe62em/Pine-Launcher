const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const { Client } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const os = require('os');
const { execFile } = require('child_process');

let mainWindow;
let mcClient = null;

// ── Paths ──────────────────────────────────────────────────────────
const INSTANCES_DIR = path.join(__dirname, 'instances');
const INSTANCES_FILE = path.join(INSTANCES_DIR, 'registry.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const AUTH_FILE = path.join(__dirname, 'auth.json');
const MOD_CACHE_DIR = path.join(__dirname, '.cache', 'mods');

// ── MC version → Java version map (fallback) ──────────────
const MC_JAVA_MAP_FALLBACK = [
  { min: '1.20', java: 21 }, { min: '1.17', java: 16 }, { min: '1.16.5', java: 8 },
  { min: '1.12', java: 8 }, { min: '1.7.10', java: 8 },
];

async function getRequiredJava(mcVersion) {
  try {
    const manifest = await fetchMinecraftVersions();
    const entry = manifest.versions?.find(v => v.id === mcVersion);
    if (entry?.url) {
      const verJson = await (await fetch(entry.url)).json();
      if (verJson.javaVersion?.majorVersion) return verJson.javaVersion.majorVersion;
    }
  } catch {}
  for (const entry of MC_JAVA_MAP_FALLBACK) {
    if (compareSemver(mcVersion, entry.min) >= 0) return entry.java;
  }
  return 8;
}

// ── Security helpers ────────────────────────────────────────────────
const SAFE_NAME_RE = /^[a-zA-Z0-9_\- .]+$/;

function sanitizeName(name) {
  if (!name || typeof name !== 'string') throw new Error('Invalid name');
  if (!SAFE_NAME_RE.test(name)) throw new Error('Name contains invalid characters');
  if (name.length > 120) throw new Error('Name too long');
  return name.trim();
}

function resolveSafePath(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

// ── Helpers ─────────────────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Safe auth storage ───────────────────────────────────────
function writeAuth(data) {
  const json = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(AUTH_FILE, encrypted);
  } else {
    fs.writeFileSync(AUTH_FILE, json, 'utf8');
  }
}

function readAuth() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted);
    }
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}

function isValidJar(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 22) return false;
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, 0);
    if (magic[0] !== 0x50 || magic[1] !== 0x4B) { fs.closeSync(fd); return false; }
    const searchSize = Math.min(256, stat.size);
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
function getJavaVersion(javaPath) {
  try {
    const spawnResult = require('child_process').spawnSync(javaPath, ['-version'], { timeout: 5000, encoding: 'utf8' });
    const out = (spawnResult.stderr || '') + (spawnResult.stdout || '');
    const m = out.match(/(?:version\s+["']?)(\d+)/);
    if (m) return parseInt(m[1]);
  } catch {}
  return null;
}

// ── Fetch with retry + resume ──────────────────────────────
function fetchAgent(url) {
  return new https.Agent({ keepAlive: true });
}

async function fetchWithRetry(fileUrl, destPath, onProgress, retries = 3) {
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
      const res = await fetch(fileUrl, { headers, agent: fetchAgent(fileUrl) });
      const total = parseInt(res.headers.get('content-length') || '0') + (res.status === 206 ? downloaded : 0);

      if (res.status === 416) {
        fs.unlinkSync(tmpPath);
        downloaded = 0;
        continue;
      }

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
          stream.write(Buffer.from(value));
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
    const stat = fs.statSync(cacheFile);
    if (stat.size > 0) return cacheFile;
  }
  return null;
}

function writeToCache(versionId, hash, hashType, srcPath) {
  if (!hash || !hashType) return;
  ensureDir(MOD_CACHE_DIR);
  const cacheFile = path.join(MOD_CACHE_DIR, `${hash}.jar`);
  if (!fs.existsSync(cacheFile)) {
    fs.copyFileSync(srcPath, cacheFile);
  }
}

function cleanCorruptedJars(dir) {
  let removed = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) removed += cleanCorruptedJars(fullPath);
      else if (entry.name.endsWith('.jar') && !isValidJar(fullPath)) {
        console.warn('[Cleanup] Removing corrupted JAR:', fullPath);
        fs.unlinkSync(fullPath);
        removed++;
      }
    }
  } catch {}
  return removed;
}

// ── Create Window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Pine Launcher',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

// ── Auth (Microsoft OAuth) ─────────────────────────────────────────
const CLIENT_ID = '00000000402b5328'; // Minecraft for Windows
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';

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
    const authWindow = new BrowserWindow({ width: 600, height: 700, title: 'Microsoft Login' });
    authWindow.loadURL(authUrl);

    let authHandled = false;

    async function processAuthCode(code) {
      if (authHandled) return;
      authHandled = true;
      authWindow.close();

      try {
        const tokenRes = await fetch('https://login.live.com/oauth20_token.srf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            code: code,
            code_verifier: codeVerifier,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No access token: ' + JSON.stringify(tokenData));
        const msaToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        // Step 2: XBL auth
        const xblRes = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msaToken}` },
            RelyingParty: 'http://auth.xboxlive.com',
            TokenType: 'JWT',
          }),
        });
        const xblData = await xblRes.json();
        const xblToken = xblData.Token;

        // Step 3: XSTS auth
        const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
            RelyingParty: 'rp://api.minecraftservices.com/',
            TokenType: 'JWT',
          }),
        });
        const xstsData = await xstsRes.json();
        const userHash = xstsData.DisplayClaims.xui[0].uhs;

        // Step 4: Minecraft auth
        const mcRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsData.Token}` }),
        });
        const mcData = await mcRes.json();
        const mcAccessToken = mcData.access_token;

        // Step 5: Profile
        const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
          headers: { Authorization: `Bearer ${mcAccessToken}` },
        });
        const profile = await profileRes.json();

        const authData = {
          access_token: mcAccessToken,
          refresh_token: refreshToken,
          profile: { name: profile.name, uuid: profile.id },
        };
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
  const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
  versionCache = await res.json();
  return versionCache;
}

// ── Loader Version Fetching ─────────────────────────────────────────
async function fetchLoaderVersions(gameVersion, loader) {
  switch (loader) {
    case 'fabric': case 'quilt': {
      const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`;
      const res = await fetch(url);
      const data = await res.json();
      return data.map(v => ({
        version: v.loader.version,
        name: `Fabric Loader ${v.loader.version}`,
        stable: v.loader.stable,
      }));
    }
    case 'forge': {
      const res = await fetch(`https://meta.minecraftforge.net/v2/versions/${gameVersion}`);
      const data = await res.json();
      return (data.versions || []).map(v => ({
        version: v.version,
        name: `Forge ${v.version}`,
        stable: true,
      }));
    }
    case 'neoforge': {
      const res = await fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
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

// ── Modrinth API ────────────────────────────────────────────────────
const MODRINTH_API = 'https://api.modrinth.com/v2';
async function modrinthFetch(path) {
  const res = await fetch(`${MODRINTH_API}${path}`, {
    headers: { 'User-Agent': 'PineLauncher/1.0' },
  });
  if (!res.ok) throw new Error(`Modrinth ${res.status}: ${res.statusText}`);
  return res.json();
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

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const profile = await res.json();
    const profileId = profile.id;
    if (!profileId) return null;
    const verDir = path.join(instanceDir, 'versions', profileId);
    ensureDir(verDir);
    fs.writeFileSync(path.join(verDir, `${profileId}.json`), JSON.stringify(profile, null, 2));
    return profileId;
  } catch {
    return null;
  }
}

// ── IPC Handlers ────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('check-java', async () => {
    return new Promise((resolve) => {
      execFile('java', ['-version'], (err, stdout, stderr) => {
        if (err) return resolve(false);
        const match = (stderr || stdout).match(/(\d+)\.(\d+)\.(\d+)/);
        if (!match) return resolve(false);
        resolve({ major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) });
      });
    });
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

  ipcMain.handle('get-auth', async () => {
    return readAuth();
  });

  ipcMain.handle('create-instance', async (_, data) => {
    const safeName = sanitizeName(data.name);
    ensureDir(INSTANCES_DIR);
    const registry = readJSON(INSTANCES_FILE) || [];
    const existing = registry.find(i => i.name === safeName);
    if (existing) throw new Error(`Instance "${safeName}" already exists`);

    const instanceDir = resolveSafePath(INSTANCES_DIR, safeName);
    ensureDir(instanceDir);
    ensureDir(path.join(instanceDir, 'mods'));
    ensureDir(path.join(instanceDir, 'saves'));
    ensureDir(path.join(instanceDir, 'config'));

    const entry = {
      name: safeName,
      path: instanceDir,
      gameVersion: data.gameVersion,
      loader: data.loader || 'vanilla',
      loaderVersion: data.loaderVersion || null,
      created: new Date().toISOString(),
      lastPlayed: null,
      javaPath: data.javaPath || null,
      minMemory: data.minMemory || '2G',
      maxMemory: data.maxMemory || '4G',
      iconData: null,
      bannerData: null,
      bannerBlurDir: 'left',
    };

    if (data.iconData) entry.iconData = data.iconData;
    if (data.bannerData) entry.bannerData = data.bannerData;
    entry.bannerBlurDir = data.bannerBlurDir || 'left';

    registry.push(entry);
    writeJSON(INSTANCES_FILE, registry);
    return entry;
  });

  ipcMain.handle('get-instances-dir', async () => INSTANCES_DIR);

  ipcMain.handle('list-instances', async () => {
    const registry = readJSON(INSTANCES_FILE) || [];
    let changed = false;
    for (const inst of registry) {
      if (!inst.path) {
        inst.path = path.join(INSTANCES_DIR, inst.name);
        changed = true;
      }
    }
    if (changed) writeJSON(INSTANCES_FILE, registry);
    return registry;
  });

  ipcMain.handle('update-instance', async (_, name, data) => {
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const idx = registry.findIndex(i => i.name === safeName);
    if (idx < 0) throw new Error(`Instance "${safeName}" not found`);
    const newName = data.name;
    if (newName && newName !== safeName) {
      const safeNewName = sanitizeName(newName);
      const oldDir = resolveSafePath(INSTANCES_DIR, safeName);
      const newDir = resolveSafePath(INSTANCES_DIR, safeNewName);
      if (fs.existsSync(newDir)) throw new Error(`An instance named "${safeNewName}" already exists`);
      if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
      registry[idx].path = newDir;
    }
    registry[idx] = { ...registry[idx], ...data };
    writeJSON(INSTANCES_FILE, registry);
    return registry[idx];
  });

  ipcMain.handle('delete-instance', async (_, name) => {
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const filtered = registry.filter(i => i.name !== safeName);
    writeJSON(INSTANCES_FILE, filtered);
    const instanceDir = resolveSafePath(INSTANCES_DIR, safeName);
    if (fs.existsSync(instanceDir)) {
      fs.rmSync(instanceDir, { recursive: true, force: true });
    }
    return true;
  });

  ipcMain.handle('launch-instance', async (_, name) => {
    const safeName = sanitizeName(name);
    const registry = readJSON(INSTANCES_FILE) || [];
    const instance = registry.find(i => i.name === safeName);
    if (!instance) throw new Error(`Instance "${safeName}" not found`);

    const authData = readAuth();
    if (!authData) throw new Error('Please login with Microsoft account first');

    const instanceDir = path.join(INSTANCES_DIR, name);
    const settings = readJSON(SETTINGS_FILE) || {};

    mcClient = new Client();

    const customLoader = await buildLoaderUrl(instance, instanceDir);

    const opts = {
      authorization: {
        access_token: authData.access_token,
        client_token: crypto.randomUUID(),
        uuid: authData.profile.uuid,
        name: authData.profile.name,
        user_properties: '{}',
        meta: { type: 'msa', demo: false },
      },
      root: instanceDir,
      version: {
        number: instance.gameVersion,
        type: 'release',
        custom: customLoader,
      },
      memory: {
        max: instance.maxMemory || settings.maxMemory || '4G',
        min: instance.minMemory || settings.minMemory || '2G',
      },
      javaPath: instance.javaPath || settings.javaPath || '',
      window: {
        width: settings.windowWidth || 1280,
        height: settings.windowHeight || 720,
      },
      overrides: {},
    };

    return new Promise((resolve, reject) => {
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
        mainWindow?.webContents.send('launch-data', e);
        mainWindow?.webContents.send('launch-log', e);
        if (typeof e === 'string') {
          metrics.eventsSeen++;
          if (metrics.stage === 'launching') {
            // First data after launch — game process is running
            advanceStage('done');
            metrics.progress = 100;
            emitMetrics(true);
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
        mainWindow?.webContents.send('launch-error', e);
        mainWindow?.webContents.send('launch-log', '[ERROR] ' + (e.message || e));
        mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'error' });
        const fixed = cleanCorruptedJars(path.join(INSTANCES_DIR, instance.name, 'libraries'))
                   + cleanCorruptedJars(path.join(INSTANCES_DIR, instance.name, 'mods'));
        if (fixed > 0) mainWindow?.webContents.send('launch-fixed', fixed);
        reject(e);
      });
      mcClient.on('close', () => {
        mainWindow?.webContents.send('launch-close');
        mainWindow?.webContents.send('launch-log', '[Minecraft closed]');
        mainWindow?.webContents.send('launch-metrics', { ...metrics, stage: 'closed' });
        mcClient = null;
        resolve(true);
      });

      instance.lastPlayed = new Date().toISOString();
      writeJSON(INSTANCES_FILE, registry);
      const cleaned = cleanCorruptedJars(path.join(INSTANCES_DIR, instance.name, 'libraries'))
                   + cleanCorruptedJars(path.join(INSTANCES_DIR, instance.name, 'mods'));
      if (cleaned > 0) mainWindow?.webContents.send('launch-fixed', cleaned);
      mcClient.launch(opts);
    });
  });

  // ── Modrinth IPC ──────────────────────────────────────────────────
  ipcMain.handle('search-mods', async (_, query, facets, offset, limit) => {
    try {
      const facetStr = facets ? `&facets=${encodeURIComponent(JSON.stringify(facets))}` : '';
      return await modrinthFetch(`/search?query=${encodeURIComponent(query || '')}&offset=${offset || 0}&limit=${limit || 20}${facetStr}`);
    } catch { return { hits: [], total_hits: 0 }; }
  });

  ipcMain.handle('get-project-versions', async (_, projectId, loaders, gameVersions) => {
    try {
      const params = new URLSearchParams();
      if (loaders?.length) params.set('loaders', JSON.stringify(loaders));
      if (gameVersions?.length) params.set('game_versions', JSON.stringify(gameVersions));
      return await modrinthFetch(`/project/${projectId}/version?${params}`);
    } catch { return []; }
  });

  // ── Helper: resolve a dependency to its version ────────────────────
  async function resolveDepVersion(dep, loaders, gameVersion) {
    if (dep.version_id) {
      try { return await modrinthFetch(`/version/${dep.version_id}`); } catch {}
    }
    if (dep.project_id) {
      try {
        const versions = await modrinthFetch(`/project/${dep.project_id}/version`);
        const compatible = versions.filter(v => {
          const gv = v.game_versions || [];
          const lv = v.loaders || [];
          return gv.includes(gameVersion) && (!loaders.length || loaders.some(l => lv.includes(l)));
        });
        return compatible[0] || versions[0];
      } catch {}
    }
    return null;
  }

  // ── Helper: recursively resolve deps (N levels, dedup, cycle guard) ──
  async function resolveDepsRecursive(deps, loaders, gameVersion, visited = new Set(), results = []) {
    for (const dep of deps) {
      if (!dep.project_id || visited.has(dep.project_id)) continue;
      visited.add(dep.project_id);
      const depVer = await resolveDepVersion(dep, loaders, gameVersion);
      if (depVer) {
        results.push(depVer);
        const subDeps = (depVer.dependencies || [])
          .filter(d => d.dependency_type === 'required' && d.project_id);
        if (subDeps.length) {
          await resolveDepsRecursive(subDeps, loaders, gameVersion, visited, results);
        }
      }
    }
    return results;
  }

  // ── Helper: validate loader version per loader type ────────────────
  async function checkLoaderVersion(loader, loaderVersion, gameVersion) {
    if (!loader || loader === 'vanilla' || !loaderVersion) return null;
    switch (loader) {
      case 'fabric': {
        const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}`;
        try { const r = await fetch(url); if (!r.ok) return 'Installed Fabric Loader ' + loaderVersion + ' may not be compatible with MC ' + gameVersion; } catch {}
        return null;
      }
      case 'quilt': {
        const url = `https://meta.quiltmc.org/v3/versions/loader/${gameVersion}/${loaderVersion}`;
        try { const r = await fetch(url); if (!r.ok) return 'Installed Quilt Loader ' + loaderVersion + ' may not be compatible with MC ' + gameVersion; } catch {}
        return null;
      }
      case 'forge': {
        try {
          const r = await fetch(`https://meta.minecraftforge.net/v2/versions/${gameVersion}`);
          if (r.ok) {
            const data = await r.json();
            const known = (data.versions || []).some(v => v.version === loaderVersion);
            if (!known) return 'Installed Forge ' + loaderVersion + ' may not be compatible with MC ' + gameVersion;
          }
        } catch {}
        return null;
      }
      case 'neoforge': {
        try {
          const r = await fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
          if (r.ok) {
            const xml = await r.text();
            const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
            const prefix = gameVersion.replace(/^1\./, '') + '.';
            const known = versions.some(v => v.startsWith(prefix) && v === loaderVersion);
            if (!known && !versions.some(v => v.startsWith(prefix))) return 'Installed NeoForge ' + loaderVersion + ' may not be compatible with MC ' + gameVersion;
          }
        } catch {}
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

    const warnings = [];
    const errors = [];

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
    const javaPath = instance.javaPath || readJSON(SETTINGS_FILE)?.javaPath || 'java';
    const javaVer = getJavaVersion(javaPath);
    const requiredJava = await getRequiredJava(gameVersion);
    if (javaVer && requiredJava && javaVer < requiredJava) {
      warnings.push({
        code: 'OLD_JAVA',
        message: `Instance uses Java ${javaVer}, but MC ${gameVersion} needs Java ${requiredJava}+`,
        detail: 'Install the correct Java version in Settings',
      });
    }

    // 4. Dependency analysis + resolve required dep versions (recursive)
    const deps = version.dependencies || [];
    const requiredDeps = deps.filter(d => d.dependency_type === 'required' && d.project_id);
    const optionalDeps = deps.filter(d => d.dependency_type === 'optional' && d.project_id);
    const incompatibleDeps = deps.filter(d => d.dependency_type === 'incompatible' && d.project_id);

    const visitedDeps = new Set([projectId]); // prevent self-reference
    const resolvedRequired = await resolveDepsRecursive(requiredDeps, loaders, gameVersion, visitedDeps);

    // 5. Disk space check (after dep resolution)
    const primarySize = validFiles[0].size || 0;
    const depSizes = resolvedRequired.reduce((s, v) => s + (v.files?.[0]?.size || 0), 0);
    const totalNeeded = Math.ceil((primarySize + depSizes) * 1.2);
    const modsDir = path.join(INSTANCES_DIR, instanceName, 'mods');
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
      file: validFiles[0],
      version,
      project,
      instance,
    };
  });

  // ── Helper: process a single version file through verify pipeline ──
  async function processSingleVersion(instanceName, versionId, modsDir, writtenFiles) {
    const version = await modrinthFetch(`/version/${versionId}`);
    const file = version.files?.[0];
    if (!file) throw new Error(`No files in version ${versionId}`);

    const filePath = path.join(modsDir, file.filename);

    // Already written by a prior iteration — skip
    if (fs.existsSync(filePath) && writtenFiles.includes(filePath)) return null;

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

    // Validate JAR
    if (!isValidJar(filePath)) {
      throw new Error(`Downloaded file ${file.filename} is corrupted`);
    }

    // Save to cache
    writeToCache(versionId, file.hashes?.sha512 || file.hashes?.sha1,
      file.hashes?.sha512 ? 'sha512' : 'sha1', filePath);

    return { version, file, filePath };
  }

  // ── Install mod (download + verify + save) with batch rollback ────
  ipcMain.handle('install-mod', async (_, instanceName, options = {}) => {
    const { versionIds, disableFiles } = options;
    if (!versionIds?.length) throw new Error('No versions to install');
    const safeName = sanitizeName(instanceName);

    const modsDir = resolveSafePath(INSTANCES_DIR, safeName, 'mods');
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
          const fullPath = path.join(modsDir, f);
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

        const result = await processSingleVersion(instanceName, vid, modsDir, writtenFiles);
        if (result === null) continue; // already existed

        // Save metadata
        const metaFile = path.join(INSTANCES_DIR, instanceName, 'mods_meta.json');
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
        try {
          const project = await modrinthFetch(`/project/${result.version.project_id}`);
          meta[result.file.filename].iconUrl = project.icon_url || null;
          meta[result.file.filename].title = project.title || result.version.name || result.file.filename;
        } catch {}
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

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
      const metaFile = path.join(INSTANCES_DIR, instanceName, 'mods_meta.json');
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
    const modsDir = resolveSafePath(INSTANCES_DIR, safeName, 'mods');
    const filePath = path.join(modsDir, safeFile);
    const disabledPath = filePath + '.disabled';
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, disabledPath);
    } else if (fs.existsSync(disabledPath)) {
      // Already disabled — re-enable
      fs.renameSync(disabledPath, filePath);
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
        const versions = await modrinthFetch(`/project/${mod.projectId}/version`);
        // Find the latest version that matches the instance's game version
        const registry = readJSON(INSTANCES_FILE) || [];
        const instance = registry.find(i => i.name === instanceName);
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
    const modsDir = resolveSafePath(INSTANCES_DIR, safeName, 'mods');
    ensureDir(modsDir);
    const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
    const metaFile = resolveSafePath(INSTANCES_DIR, safeName, 'mods_meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
    return files.map(f => ({
      filename: f,
      path: path.join(modsDir, f),
      projectId: meta[f]?.projectId || null,
      title: meta[f]?.title || f.replace(/\.jar$/, ''),
      iconUrl: meta[f]?.iconUrl || null,
      installedVersion: meta[f]?.installedVersion || null,
      installedAt: meta[f]?.installedAt || null,
      depData: meta[f]?.depData || null,
    }));
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

  ipcMain.handle('get-project', async (_, projectId) => {
    try {
      return await modrinthFetch(`/project/${projectId}`);
    } catch { return null; }
  });

  ipcMain.handle('remove-mod', async (_, instanceName, filename) => {
    const safeName = sanitizeName(instanceName);
    const safeFile = path.basename(filename);
    if (!safeFile.endsWith('.jar') && !safeFile.endsWith('.jar.disabled')) {
      throw new Error('Invalid mod filename');
    }
    const modsDir = resolveSafePath(INSTANCES_DIR, safeName, 'mods');
    const filePath = path.join(modsDir, safeFile);
    const disabledPath = filePath + '.disabled';
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, disabledPath);
    } else if (fs.existsSync(disabledPath)) {
      fs.unlinkSync(disabledPath);
    }
    const metaFile = resolveSafePath(INSTANCES_DIR, safeName, 'mods_meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      delete meta[filename];
      delete meta[filename + '.disabled'];
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    } catch {}
    return true;
  });

  // ── Settings ──────────────────────────────────────────────────────
  ipcMain.handle('save-settings', async (_, settings) => {
    writeJSON(SETTINGS_FILE, settings);
    return true;
  });

  ipcMain.handle('get-settings', async () => {
    return readJSON(SETTINGS_FILE) || {};
  });
}

// ── App Lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (mcClient) { try { mcClient.stop(); } catch {} }
});
