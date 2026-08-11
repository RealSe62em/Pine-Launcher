const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync, execFile, spawn } = require('child_process');
const installerCore = require('./core');

const PRODUCT = 'Pine Launcher';
const PRODUCT_KEY = 'PineLauncher';
const INSTALL_MARKER = '.pine-launcher-install.json';
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-files')
  : path.dirname(app.getAppPath());
const VERSION = (readJSON(path.join(APP_ROOT, 'package.json')) || {}).version || '1.0.0';
const DEFAULT_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local', 'Programs'),
  'Programs', 'Pine Launcher'
);

const EXCLUDES = new Set([
  '.git', '.gitignore', '.cache', '.claude', 'build',
  'instances', 'settings.json', 'README.md', 'auth.json',
  'dist', 'electron-builder.yml', 'package-lock.json',
]);

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isInstalledDir(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'))
      && fs.existsSync(path.join(dir, 'main.js'))
      && fs.existsSync(path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe'));
  } catch { return false; }
}

function installMarkerPath(dir) { return path.join(dir, INSTALL_MARKER); }

function isOwnedInstallDir(dir) {
  return installerCore.isOwnedInstallDir(dir, PRODUCT, PRODUCT_KEY, INSTALL_MARKER);
}

function requestedInstallDir() {
  const arg = process.argv.find((v) => v.startsWith('--install-dir='));
  if (!arg) return null;
  return installerCore.decodeInstallDir(arg.slice(14));
}

function registeredInstallDir() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg.exe', ['query', UNINSTALL_KEY, '/v', 'InstallLocation'],
      { windowsHide: true, stdio: 'pipe', encoding: 'utf8' });
    const match = out.match(/InstallLocation\s+REG_SZ\s+"?([^\r\n"]+)/i);
    return match ? path.resolve(match[1].trim()) : null;
  } catch { return null; }
}

function currentInstallDir() {
  const candidates = [requestedInstallDir(), APP_ROOT, path.dirname(app.getAppPath()), registeredInstallDir(), DEFAULT_DIR];
  return candidates.find((dir) => dir && isOwnedInstallDir(dir)) || null;
}

function psRun(script) {
  execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: 'pipe' });
}

function createShortcut(lnkPath, target, args, workDir, iconPath) {
  fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  const esc = (s) => s.replace(/'/g, "''");
  psRun(
    `$ws = New-Object -ComObject WScript.Shell; ` +
    `$s = $ws.CreateShortcut('${esc(lnkPath)}'); ` +
    `$s.TargetPath = '${esc(target)}'; ` +
    `$s.Arguments = '${esc(args)}'; ` +
    `$s.WorkingDirectory = '${esc(workDir)}'; ` +
    `$s.IconLocation = '${esc(iconPath)},0'; ` +
    `$s.Description = '${esc(PRODUCT)}'; ` +
    `$s.Save()`
  );
}

function removeShortcut(lnkPath) {
  try { if (fs.existsSync(lnkPath)) fs.unlinkSync(lnkPath); } catch {}
}

function shortcutPaths(installDir) {
  const desktop = path.join(app.getPath('desktop'), `${PRODUCT}.lnk`);
  const startMenu = path.join(app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`);
  return { desktop, startMenu, installDir, icon: path.join(installDir, 'icon.ico') };
}

function ensureIconFile(installDir) {
  const pngPath = path.join(installDir, 'icon.png');
  const icoPath = path.join(installDir, 'icon.ico');
  if (!fs.existsSync(pngPath)) return;
  const png = fs.readFileSync(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

function electronExe(installDir) {
  return path.join(installDir, 'node_modules', 'electron', 'dist', 'electron.exe');
}

const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_KEY}`;

function regSet(name, value, type) {
  execFileSync('reg.exe', ['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', value, '/f'],
    { windowsHide: true, stdio: 'pipe' });
}

function registerUninstall(installDir) {
  if (process.platform !== 'win32') return;
  const exe = electronExe(installDir);
  const main = path.join(installDir, 'installer', 'main.js');
  regSet('DisplayName', PRODUCT, 'REG_SZ');
  regSet('DisplayVersion', VERSION, 'REG_SZ');
  regSet('Publisher', PRODUCT, 'REG_SZ');
  regSet('DisplayIcon', `"${path.join(installDir, 'icon.ico')}"`, 'REG_SZ');
  regSet('InstallLocation', `"${installDir}"`, 'REG_SZ');
  const encodedDir = installerCore.encodeInstallDir(installDir);
  regSet('UninstallString', `"${exe}" "${main}" --uninstall --install-dir=${encodedDir}`, 'REG_SZ');
  regSet('NoModify', '1', 'REG_DWORD');
  regSet('NoRepair', '1', 'REG_DWORD');
}

function unregisterUninstall() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('reg.exe', ['delete', UNINSTALL_KEY, '/f'], { windowsHide: true, stdio: 'pipe' });
  } catch {}
}

function killLaunchersIn(dir, opts = {}) {
  if (process.platform !== 'win32') return;
  const base = dir.replace(/'/g, "''");
  const exclude = opts.excludeSelf ? `-and $_.ProcessId -ne ${process.pid}` : '';
  try {
    psRun(
      `Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" ` +
      `| Where-Object { ($_.ExecutablePath -like '${base}*') ${exclude} } ` +
      `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    );
  } catch {}
}

function totalSize(root) {
  let sum = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) sum += fs.statSync(p).size;
    }
  };
  walk(root);
  return sum;
}

function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile()) {
        files.push(p);
      }
    }
  };
  walk(root);
  return files;
}

function copyFileChunked(src, dst, onChunk) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    const ws = fs.createWriteStream(dst);
    rs.on('data', (chunk) => { if (onChunk) onChunk(chunk.length); });
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
}

async function launchersGone(dir, excludePid = null) {
  const base = dir.replace(/'/g, "''");
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
          `(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.ExecutablePath -like '${base}*'${excludePid ? ` -and $_.ProcessId -ne ${excludePid}` : ''} } | Measure-Object).Count`],
        { windowsHide: true, stdio: 'pipe' });
      if (parseInt(out.toString().trim(), 10) === 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function removeDirRetry(dir, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function installApp(installDir, onProgress) {
  installDir = path.resolve(installDir);
  if (fs.existsSync(installDir) && !isOwnedInstallDir(installDir)) {
    const entries = fs.readdirSync(installDir);
    if (entries.length) throw new Error('The selected folder is not an existing Pine Launcher installation. Choose an empty folder.');
  }
  if (isOwnedInstallDir(installDir)) {
    killLaunchersIn(installDir);
    await launchersGone(installDir);
    await removeDirRetry(installDir);
  }
  fs.mkdirSync(installDir, { recursive: true });

  const files = listFiles(APP_ROOT).filter((f) => !EXCLUDES.has(path.relative(APP_ROOT, f).split(path.sep)[0]));
  const total = files.reduce((s, f) => s + fs.statSync(f).size, 0);
  let copied = 0;

  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    const queue = [...files];
    const workers = 8;
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
      while (queue.length) {
        const src = queue.pop();
        const rel = path.relative(APP_ROOT, src);
        const dst = path.join(installDir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        await copyFileChunked(src, dst, (n) => {
          copied += n;
          onProgress(copied / total);
        });
      }
    }));
  } finally {
    process.noAsar = prevNoAsar;
  }

  ensureIconFile(installDir);
  fs.writeFileSync(installMarkerPath(installDir), JSON.stringify({
    product: PRODUCT_KEY,
    version: VERSION,
    installedAt: new Date().toISOString(),
  }, null, 2));

  const { desktop, startMenu, icon } = shortcutPaths(installDir);
  const exe = electronExe(installDir);
  if (process.platform === 'win32') {
    createShortcut(startMenu, exe, '.', installDir, icon);
    createShortcut(desktop, exe, '.', installDir, icon);
  }
  registerUninstall(installDir);
}

async function uninstallApp(onProgress) {
  const installDir = currentInstallDir();
  if (!installDir) throw new Error('Could not locate a verified Pine Launcher installation. No files were removed.');
  onProgress({ percent: 0.15, line: 'Stopping Pine Launcher…' });
  killLaunchersIn(installDir, { excludeSelf: true });
  await launchersGone(installDir, process.pid);
  onProgress({ percent: 0.4, line: 'Removing shortcuts…' });
  const { desktop, startMenu } = shortcutPaths(installDir);
  removeShortcut(desktop);
  removeShortcut(startMenu);
  unregisterUninstall();
  onProgress({ percent: 0.6, line: 'Removing files…' });
  const bat = path.join(app.getPath('temp'), `pine-uninstall-${process.pid}.bat`);
  fs.writeFileSync(bat,
    `@echo off\r\n` +
    `set /a tries=0\r\n` +
    `:loop\r\n` +
    `set /a tries+=1\r\n` +
    `if %tries% gtr 90 goto giveup\r\n` +
    `timeout /t 1 /nobreak >nul\r\n` +
    `rmdir /s /q "${installDir.replace(/"/g, '""')}" 2>nul\r\n` +
    `if exist "${installDir.replace(/"/g, '""')}" goto loop\r\n` +
    `del /f /q "${bat.replace(/"/g, '""')}"\r\n` +
    `exit /b 0\r\n` +
    `:giveup\r\n` +
    `del /f /q "${bat.replace(/"/g, '""')}"\r\n` +
    `exit /b 1\r\n`);
  spawn('cmd.exe', ['/c', bat], { cwd: app.getPath('temp'), detached: true, stdio: 'ignore' }).unref();
  onProgress({ percent: 1, line: 'Pine Launcher removed.' });
  setTimeout(() => app.quit(), 1200);
  await new Promise((r) => setTimeout(r, 300));
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 660,
    minWidth: 560,
    minHeight: 660,
    maxWidth: 560,
    maxHeight: 660,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#000000',
    title: `${PRODUCT} Installer`,
    icon: path.join(APP_ROOT, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

function setupIPC() {
  ipcMain.handle('get-state', () => ({
    product: PRODUCT,
    version: VERSION,
    appPath: APP_ROOT,
    isUninstaller: process.argv.includes('--uninstall'),
    isInstalled: Boolean(currentInstallDir()),
    installedDir: currentInstallDir(),
    defaultDir: DEFAULT_DIR,
  }));

  ipcMain.handle('install', async (_, targetDir) => {
    const dir = targetDir || DEFAULT_DIR;
    try {
      await installApp(dir, (ratio) => {
        win?.webContents.send('install-progress', {
          percent: Math.round(ratio * 100),
          line: ratio < 0.2 ? 'Preparing files…'
            : ratio < 0.6 ? 'Copying Pine Launcher…'
            : 'Finalizing shortcuts…',
        });
      });
      win?.webContents.send('install-progress', { percent: 100, line: 'Done!' });
      return { ok: true, dir };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('uninstall', async () => {
    try {
      await uninstallApp(({ percent, line }) => {
        win?.webContents.send('install-progress', { percent: Math.round(percent * 100), line });
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('open-path', async (_, dir) => {
    if (fs.existsSync(dir)) shell.openPath(dir);
  });

  ipcMain.handle('choose-dir', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose install location',
      defaultPath: DEFAULT_DIR,
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('launch-installed', async () => {
    const dir = currentInstallDir();
    if (!dir) throw new Error('Installed application not found');
    const exe = electronExe(dir);
    spawn(exe, ['.'], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
  });

  ipcMain.handle('win-close', () => {
    if (win) win.close();
  });
}

app.whenReady().then(() => {
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => app.quit());
