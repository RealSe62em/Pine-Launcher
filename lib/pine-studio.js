'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SYNC_TARGETS = Object.freeze({
  options: 'options.txt',
  servers: 'servers.dat',
  commands: 'command_history.txt',
  hotbars: 'hotbar.nbt',
});

function parseMinecraftOptions(text = '') {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw) continue;
    const split = raw.indexOf(':');
    rows.push(split < 0
      ? { key: raw, value: '', raw: true }
      : { key: raw.slice(0, split), value: raw.slice(split + 1), raw: false });
  }
  return rows;
}

function serializeMinecraftOptions(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid game settings');
  const seen = new Set();
  return rows.map(row => {
    const key = String(row?.key || '').trim();
    if (!key || /[\r\n:]/.test(key) || seen.has(key)) throw new Error('Invalid or duplicate game setting');
    seen.add(key);
    return `${key}:${String(row?.value ?? '').replace(/[\r\n]/g, '')}`;
  }).join('\n') + (rows.length ? '\n' : '');
}

function validateSkinPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Choose a valid PNG skin file');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) throw new Error('Minecraft skins must be 64×64 or legacy 64×32 PNG files');
  return { width, height };
}

function listScreenshots(instanceDir) {
  const root = path.join(instanceDir, 'screenshots');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => {
      const absolute = path.join(root, entry.name);
      const stat = fs.statSync(absolute);
      return { name: entry.name, path: absolute, modifiedAt: stat.mtime.toISOString(), bytes: stat.size };
    })
    .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

function normalizeHooks(value = {}) {
  const clean = input => String(input || '').trim().slice(0, 2048);
  const env = {};
  for (const [key, val] of Object.entries(value.environment || {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) env[key] = String(val).slice(0, 4096);
  }
  return { preLaunch: clean(value.preLaunch), wrapper: clean(value.wrapper), postExit: clean(value.postExit), environment: env };
}

function syncInstanceData(sourceDir, destinationDir, selections = {}) {
  const copied = [];
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const [key, filename] of Object.entries(SYNC_TARGETS)) {
    if (!selections[key]) continue;
    const source = path.join(sourceDir, filename);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    fs.copyFileSync(source, path.join(destinationDir, filename));
    copied.push(key);
  }
  for (const [key, folder] of [['resourcepacks', 'resourcepacks'], ['datapacks', 'datapacks']]) {
    if (!selections[key]) continue;
    const source = path.join(sourceDir, folder);
    const target = path.join(destinationDir, folder);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, target, { recursive: true, force: true });
    copied.push(key);
  }
  return copied;
}

module.exports = { listScreenshots, normalizeHooks, parseMinecraftOptions, serializeMinecraftOptions, syncInstanceData, validateSkinPng };
