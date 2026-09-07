'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sanitizeDestination } = require('./activity-store');

const ID = /^[a-f0-9]{32}$/;
function shortcutArgument(argv) {
  const value = argv.find(value => typeof value === 'string' && value.startsWith('--pine-shortcut='));
  const id = value?.slice('--pine-shortcut='.length);
  return ID.test(id || '') ? id : null;
}
function entryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}
function desktopQuote(value) {
  // Desktop entries have both string escaping and command-line quoting layers.
  return entryValue('"' + String(value).replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"');
}
function windowsQuote(value) {
  return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
function pngToIco(png, size = 64) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = header[7] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}
function createDesktopShortcut({ desktop, storage, executable, appPath, platform, instance, destination, png, writeShortcutLink }) {
  if (!['win32', 'linux'].includes(platform)) throw new Error('Desktop shortcuts are supported on Windows and Linux');
  const clean = sanitizeDestination(destination);
  if (!clean) throw new Error('Invalid shortcut destination');
  const instanceId = String(instance.id || instance.created || instance.name);
  const id = crypto.createHash('sha256').update(JSON.stringify([instanceId, clean.type, clean.identifier])).digest('hex').slice(0, 32);
  const title = `${clean.label} — Pine`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100);
  fs.mkdirSync(storage, { recursive: true });
  fs.mkdirSync(desktop, { recursive: true });
  const icon = path.join(storage, `${id}.${platform === 'win32' ? 'ico' : 'png'}`);
  fs.writeFileSync(icon, platform === 'win32' ? pngToIco(png) : png);
  const manifest = path.join(storage, `${id}.json`);
  fs.writeFileSync(manifest, JSON.stringify({ instanceId, instanceName: instance.name, destination: clean }));
  const args = [...(appPath ? [appPath] : []), `--pine-shortcut=${id}`];
  // The stable suffix avoids overwriting a user's unrelated desktop shortcut.
  const shortcut = path.join(desktop, `${title} (${id.slice(0, 8)}).${platform === 'win32' ? 'lnk' : 'desktop'}`);
  if (platform === 'win32') {
    if (!writeShortcutLink(shortcut, 'create', { target: executable, args: args.map(windowsQuote).join(' '), cwd: path.dirname(executable), icon, iconIndex: 0, description: `Play ${clean.label} with Pine Launcher` })) {
      throw new Error('Windows could not create the desktop shortcut');
    }
  } else {
    fs.writeFileSync(shortcut, `[Desktop Entry]\nVersion=1.0\nType=Application\nName=${entryValue(clean.label)}\nComment=Play with Pine Launcher\nExec=${[executable, ...args].map(desktopQuote).join(' ')}\nIcon=${entryValue(icon)}\nTerminal=false\nCategories=Game;\n`, { mode: 0o755 });
    fs.chmodSync(shortcut, 0o755);
  }
  return { path: shortcut, id };
}
function readDesktopShortcut(storage, id, instances) {
  if (!ID.test(id || '')) throw new Error('Invalid desktop shortcut');
  const saved = JSON.parse(fs.readFileSync(path.join(storage, `${id}.json`), 'utf8'));
  const instance = instances.find(item => String(item.id || item.created || item.name) === saved.instanceId);
  if (!instance) throw new Error('This shortcut’s instance was deleted. Create a shortcut from an existing instance.');
  const destination = sanitizeDestination(saved.destination);
  if (!destination) throw new Error('The shortcut destination is invalid');
  return { instanceName: instance.name, destination };
}
module.exports = { shortcutArgument, desktopQuote, windowsQuote, pngToIco, createDesktopShortcut, readDesktopShortcut };
