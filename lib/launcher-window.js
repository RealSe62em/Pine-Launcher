'use strict';

const EXTERNAL_HOSTS = new Set([
  'modrinth.com',
  'www.modrinth.com',
  'optifine.net',
  'www.optifine.net',
  'curseforge.com',
  'www.curseforge.com',
]);

function createLauncherWindow({ BrowserWindow, Menu, shell, icon, preload, entryFile, dev = false }) {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    title: 'Pine Launcher',
    backgroundColor: '#000000',
    icon,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(entryFile);
  const sendMaximizedState = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send('window-maximized-changed', window.isMaximized() || window.isFullScreen());
  };
  window.on('maximize', sendMaximizedState);
  window.on('unmaximize', sendMaximizedState);
  window.on('enter-full-screen', sendMaximizedState);
  window.on('leave-full-screen', sendMaximizedState);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.hostname)) shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show(); }, 3000);
  if (dev) window.webContents.openDevTools();
  return window;
}

module.exports = { EXTERNAL_HOSTS, createLauncherWindow };
