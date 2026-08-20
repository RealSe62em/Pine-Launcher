'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readNbt, serverDisplayAddress } = require('./discord-presence');

const MAX_DESTINATIONS_PER_INSTANCE = 30;

function destinationKey(value) {
  if (value?.type === 'multiplayer') return `server:${serverDisplayAddress(value.address || value.identifier).toLowerCase()}`;
  if (value?.type === 'singleplayer') return `world:${String(value.identifier || '').trim().toLowerCase()}`;
  return '';
}

function sanitizeDestination(value) {
  const type = value?.type;
  if (!['multiplayer', 'singleplayer'].includes(type)) return null;
  const identifier = String(value.identifier || value.address || '').trim().slice(0, 255);
  if (!identifier || /[\r\n\0]/.test(identifier)) return null;
  const label = String(value.label || identifier).replace(/[\r\n\0]+/g, ' ').trim().slice(0, 128);
  return {
    type,
    identifier,
    address: type === 'multiplayer' ? identifier : undefined,
    label: label || identifier,
  };
}

function readActivity(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value?.destinations)
      ? { ...value, destinations: value.destinations, hiddenKeys: Array.isArray(value.hiddenKeys) ? value.hiddenKeys.slice(0, 100) : [] }
      : { destinations: [], hiddenKeys: [] };
  } catch {
    return { destinations: [], hiddenKeys: [] };
  }
}

function writeActivity(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}

function recordDestination(file, destination, at = new Date()) {
  const clean = sanitizeDestination(destination);
  if (!clean) return null;
  const state = readActivity(file);
  const key = destinationKey(clean);
  const previous = state.destinations.find(item => destinationKey(item) === key);
  const next = {
    ...clean,
    launches: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(previous?.launches) || 0) + 1),
    lastUsed: at.toISOString(),
  };
  state.destinations = [next, ...state.destinations.filter(item => destinationKey(item) !== key)]
    .slice(0, MAX_DESTINATIONS_PER_INSTANCE);
  state.hiddenKeys = (state.hiddenKeys || []).filter(item => item !== key);
  writeActivity(file, state);
  return next;
}

function removeDestination(file, destination) {
  const clean = sanitizeDestination(destination);
  if (!clean) return false;
  const state = readActivity(file);
  const key = destinationKey(clean);
  const remaining = state.destinations.filter(item => destinationKey(item) !== key);
  const hiddenKeys = [key, ...(state.hiddenKeys || []).filter(item => item !== key)].slice(0, 100);
  writeActivity(file, { ...state, destinations: remaining, hiddenKeys });
  return true;
}

function rankDestinations(items, limit = 9) {
  return [...items].sort((a, b) => {
    const frequency = (Number(b.launches) || 0) - (Number(a.launches) || 0);
    if (frequency) return frequency;
    return new Date(b.lastUsed || 0).getTime() - new Date(a.lastUsed || 0).getTime();
  }).slice(0, Math.max(0, Math.min(9, Number(limit) || 9)));
}

function newestWorld(savesDir) {
  try {
    return fs.readdirSync(savesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const dir = path.join(savesDir, entry.name);
        const level = path.join(dir, 'level.dat');
        const modified = fs.existsSync(level) ? fs.statSync(level).mtimeMs : fs.statSync(dir).mtimeMs;
        return { identifier: entry.name, label: entry.name, modified };
      })
      .sort((a, b) => b.modified - a.modified)[0] || null;
  } catch {
    return null;
  }
}

function readWorldMetadata(savesDir, identifier) {
  const folder = String(identifier || '').trim();
  if (!folder || folder === '.' || folder === '..' || folder !== path.basename(folder)) return null;
  const root = path.resolve(savesDir);
  const worldDir = path.resolve(root, folder);
  if (worldDir !== root && !worldDir.startsWith(root + path.sep)) return null;
  let version = null;
  let gameMode = null;
  let lastPlayed = null;
  try {
    if (!fs.statSync(worldDir).isDirectory()) return null;
  } catch {
    return null;
  }

  let name = folder;
  try {
    const levelFile = fs.readFileSync(path.join(worldDir, 'level.dat'));
    if (levelFile.length <= 16 * 1024 * 1024) {
      const decoded = levelFile[0] === 0x1f && levelFile[1] === 0x8b ? zlib.gunzipSync(levelFile) : levelFile;
      const parsed = readNbt(decoded);
      const levelName = String(parsed?.Data?.LevelName || '').replace(/[\r\n\0]+/g, ' ').trim();
      if (levelName) name = levelName.slice(0, 128);
      version = String(parsed?.Data?.Version?.Name || '').trim() || null;
      const gameTypes = ['Survival', 'Creative', 'Adventure', 'Spectator'];
      const gameType = Number(parsed?.Data?.GameType);
      gameMode = gameTypes[gameType] || null;
      const played = Number(parsed?.Data?.LastPlayed);
      if (Number.isFinite(played) && played > 0) lastPlayed = new Date(played).toISOString();
    }
  } catch {}

  let iconData = null;
  try {
    const icon = fs.readFileSync(path.join(worldDir, 'icon.png'));
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (icon.length <= 1024 * 1024 && icon.subarray(0, 8).equals(signature)) {
      iconData = `data:image/png;base64,${icon.toString('base64')}`;
    }
  } catch {}
  let modified = 0;
  try {
    const level = path.join(worldDir, 'level.dat');
    modified = (fs.existsSync(level) ? fs.statSync(level) : fs.statSync(worldDir)).mtimeMs;
  } catch {}
  let size = 0;
  const countBytes = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      try {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) countBytes(file);
        else if (stat.isFile()) size += stat.size;
      } catch {}
    }
  };
  countBytes(worldDir);
  return { identifier: folder, name, iconData, modified, version, gameMode, lastPlayed, size };
}

function listWorlds(savesDir) {
  try {
    return fs.readdirSync(savesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => readWorldMetadata(savesDir, entry.name))
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
}

module.exports = {
  destinationKey,
  listWorlds,
  newestWorld,
  rankDestinations,
  readActivity,
  readWorldMetadata,
  recordDestination,
  removeDestination,
  sanitizeDestination,
};
