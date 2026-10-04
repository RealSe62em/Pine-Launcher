'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeSkinLibrary(value) {
  if (!value || value.version !== 1 || !value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts)) {
    return { version: 1, accounts: {}, capes: {}, activeSkins: {} };
  }
  if (!value.capes || typeof value.capes !== 'object' || Array.isArray(value.capes)) value.capes = {};
  if (!value.activeSkins || typeof value.activeSkins !== 'object' || Array.isArray(value.activeSkins)) value.activeSkins = {};
  return value;
}

function setActiveLocalSkin(library, account, id) {
  const normalized = normalizeSkinLibrary(library);
  const rows = Array.isArray(normalized.accounts[account]) ? normalized.accounts[account] : [];
  const record = rows.find(item => item?.id === id && item?.file);
  if (!record) throw new Error('Skin not found');
  normalized.activeSkins[account] = { id: record.id, variant: record.variant === 'slim' ? 'slim' : 'classic' };
  return record;
}

function activeLocalSkin(library, account) {
  const normalized = normalizeSkinLibrary(library);
  const selection = normalized.activeSkins[account];
  if (!selection?.id) return null;
  return (normalized.accounts[account] || []).find(item => item?.id === selection.id && item?.file) || null;
}

function removeLocalSkin(library, account, id) {
  const normalized = normalizeSkinLibrary(library);
  normalized.accounts[account] = (normalized.accounts[account] || []).filter(item => item?.id !== id);
  if (normalized.activeSkins[account]?.id === id) delete normalized.activeSkins[account];
  return normalized;
}

function writeCustomSkinLoaderConfig(filePath, variant, version = '15.0.1') {
  let config = null;
  try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  if (!Array.isArray(config.loadlist)) config.loadlist = [];
  let local = config.loadlist.find(item => item?.name === 'PineLocalSkin');
  if (!local) {
    local = { name: 'PineLocalSkin', type: 'Legacy', skin: 'PineLocalSkin/skins/{USERNAME}.png' };
    config.loadlist.unshift(local);
  }
  local.type = 'Legacy';
  local.skin = 'PineLocalSkin/skins/{USERNAME}.png';
  local.model = variant === 'slim' ? 'slim' : 'default';
  if (!config.version) config.version = version;
  if (!Number.isInteger(config.buildNumber)) config.buildNumber = 0;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.pine-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
  fs.renameSync(temporary, filePath);
  return config;
}

function removeCustomSkinLoaderConfig(filePath) {
  let config;
  try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return false; }
  if (!config || !Array.isArray(config.loadlist)) return false;
  const next = config.loadlist.filter(item => item?.name !== 'PineLocalSkin');
  if (next.length === config.loadlist.length) return false;
  config.loadlist = next;
  const temporary = `${filePath}.pine-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
  fs.renameSync(temporary, filePath);
  return true;
}

module.exports = { activeLocalSkin, normalizeSkinLibrary, removeCustomSkinLoaderConfig, removeLocalSkin, setActiveLocalSkin, writeCustomSkinLoaderConfig };
