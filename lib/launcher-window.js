'use strict';

const net = require('net');

const EXTERNAL_HOSTS = new Set([
  'modrinth.com',
  'www.modrinth.com',
  'optifine.net',
  'www.optifine.net',
  'curseforge.com',
  'www.curseforge.com',
  'github.com',
  'www.github.com',
  'gitlab.com',
  'discord.gg',
  'discord.com',
  'minecraft.net',
  'www.minecraft.net',
]);

function isPrivateOrLocalHost(host) {
  if (!host) return true;
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.local') || normalized.endsWith('.localhost') || normalized.endsWith('.internal') || normalized.endsWith('.lan')) {
    return true;
  }
  const ipType = net.isIP(normalized);
  if (ipType === 4) {
    const parts = normalized.split('.').map(p => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (ipType === 6) {
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.slice(7);
      return isPrivateOrLocalHost(v4Part);
    }
    return false;
  }
  return false;
}

function isSafeExternalUrl(parsed) {
  if (!parsed || parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname;
  if (!host || isPrivateOrLocalHost(host)) return false;
  return true;
}

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
      if (parsed.protocol === 'https:' && (EXTERNAL_HOSTS.has(parsed.hostname) || isSafeExternalUrl(parsed))) {
        shell.openExternal(url);
      }
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

module.exports = { EXTERNAL_HOSTS, createLauncherWindow, isSafeExternalUrl };
