const fs = require('fs');
const path = require('path');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MINECRAFT_DESKTOP_ID = 'pine-minecraft';

function linuxDataHome(homeDir, env = process.env) {
  const configured = String(env.XDG_DATA_HOME || '').trim();
  return configured ? path.resolve(configured) : path.join(homeDir, '.local', 'share');
}

function validAssetHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function readMinecraftIcon(assetRoot, preferredIndex) {
  const indexesDir = path.join(assetRoot, 'indexes');
  if (!fs.existsSync(indexesDir)) return null;
  const preferred = preferredIndex ? path.join(indexesDir, `${preferredIndex}.json`) : null;
  const candidates = [preferred, ...fs.readdirSync(indexesDir)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(indexesDir, name))]
    .filter(Boolean)
    .filter((file, index, list) => list.indexOf(file) === index);

  for (const indexFile of candidates) {
    try {
      const objects = JSON.parse(fs.readFileSync(indexFile, 'utf8')).objects || {};
      const record = objects['icons/icon_32x32.png'] || objects['minecraft/icons/icon_32x32.png'];
      if (!validAssetHash(record?.hash)) continue;
      const objectFile = path.join(assetRoot, 'objects', record.hash.slice(0, 2), record.hash);
      const bytes = fs.readFileSync(objectFile);
      if (bytes.length < PNG_SIGNATURE.length || bytes.length > 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) continue;
      return bytes;
    } catch {}
  }
  return null;
}

function desktopValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '').replace(/\r/g, '').replace(/\s/g, '\\s');
}

function writeIfChanged(file, data, options) {
  try {
    if (fs.readFileSync(file).equals(Buffer.isBuffer(data) ? data : Buffer.from(data))) return false;
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, options);
  return true;
}

function ensureLinuxGameIntegration({ homeDir, env = process.env, assetRoot, gameVersion }) {
  const dataHome = linuxDataHome(homeDir, env);
  const supportDir = path.join(dataHome, 'pine-launcher');
  const iconFile = path.join(supportDir, 'minecraft.png');
  const desktopFile = path.join(dataHome, 'applications', `${MINECRAFT_DESKTOP_ID}.desktop`);
  const icon = readMinecraftIcon(assetRoot, gameVersion);
  let changed = false;
  if (icon) changed = writeIfChanged(iconFile, icon) || changed;

  const iconValue = fs.existsSync(iconFile) ? desktopValue(iconFile) : 'applications-games';
  const desktop = `[Desktop Entry]\nVersion=1.0\nType=Application\nName=Minecraft\nComment=Minecraft launched by Pine Launcher\nExec=/usr/bin/true\nIcon=${iconValue}\nTerminal=false\nNoDisplay=true\nStartupWMClass=${MINECRAFT_DESKTOP_ID}\nCategories=Game;\n`;
  changed = writeIfChanged(desktopFile, desktop, { mode: 0o644 }) || changed;
  return { changed, desktopFile, iconFile: fs.existsSync(iconFile) ? iconFile : null };
}

module.exports = { MINECRAFT_DESKTOP_ID, ensureLinuxGameIntegration, linuxDataHome, readMinecraftIcon };
