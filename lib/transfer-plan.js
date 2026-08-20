'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CATEGORY_ROOTS = Object.freeze({
  worlds: ['saves'],
  mods: ['mods', 'mods_meta.json'],
  configuration: ['config', 'defaultconfigs'],
  settings: ['options.txt', 'optionsof.txt', 'optionsshaders.txt'],
  servers: ['servers.dat', 'servers.dat_old'],
  resourcepacks: ['resourcepacks'],
  shaderpacks: ['shaderpacks'],
  screenshots: ['screenshots'],
  datapacks: ['datapacks'],
  loader: ['versions', 'libraries', 'patches', 'jarmods', 'bin'],
});

const CATEGORY_LABELS = Object.freeze({
  worlds: 'Worlds', mods: 'Mods', configuration: 'Mod configurations', settings: 'Game settings',
  servers: 'Saved servers', resourcepacks: 'Resource packs', shaderpacks: 'Shader packs',
  screenshots: 'Screenshots', datapacks: 'Data packs', loader: 'Loader files', custom: 'Custom files',
});

const PRIVATE_ROOTS = new Set([
  'launcher_accounts.json', 'launcher_profiles.json', 'accounts.json', 'auth.json', 'usercache.json',
  'usernamecache.json', 'cookies', 'webcache', 'webcache2', 'login.json', 'launcher_msa_credentials.bin',
]);

function portableRelative(value) {
  const normalized = String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\0'))) throw new Error('Transfer path is unsafe');
  return parts.join('/');
}

function categoryFor(relative) {
  const normalized = portableRelative(relative).toLowerCase();
  const top = normalized.split('/')[0];
  for (const [category, roots] of Object.entries(CATEGORY_ROOTS)) {
    if (roots.includes(top)) return category;
  }
  // Data packs stored inside saves belong to the world payload.
  if (normalized.startsWith('saves/') && normalized.includes('/datapacks/')) return 'worlds';
  return 'custom';
}

function normalizedSelection(selection = {}, defaults = {}) {
  return Object.fromEntries([...Object.keys(CATEGORY_LABELS)].map(category => [
    category,
    typeof selection?.[category] === 'boolean' ? selection[category] : defaults?.[category] !== false,
  ]));
}

function buildTransferPlan({ source, sourceFormat = 'folder', sourceLauncher = 'Minecraft', selection = {}, defaults = {}, warnings = [], rejected = [] }) {
  const root = path.resolve(String(source || ''));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Transfer source folder does not exist');
  const selected = normalizedSelection(selection, defaults);
  const files = [];
  const directories = [];
  const categoryStats = Object.fromEntries(Object.keys(CATEGORY_LABELS).map(category => [category, { label: CATEGORY_LABELS[category], files: 0, bytes: 0, selected: selected[category] }]));
  const safeWarnings = [...warnings];
  const safeRejected = [...rejected];
  let totalBytes = 0;

  function visit(current, relative = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = portableRelative(relative ? `${relative}/${entry.name}` : entry.name);
      const absolute = path.join(current, entry.name);
      const top = childRelative.split('/')[0].toLowerCase();
      const stat = fs.lstatSync(absolute);
      if (PRIVATE_ROOTS.has(top)) {
        safeRejected.push({ path: childRelative, reason: 'Account, session, or private launcher data is never imported' });
        continue;
      }
      if (stat.isSymbolicLink()) {
        safeRejected.push({ path: childRelative, reason: 'Filesystem links are not followed' });
        continue;
      }
      if (stat.isDirectory()) {
        directories.push(childRelative);
        visit(absolute, childRelative);
      } else if (stat.isFile()) {
        const category = categoryFor(childRelative);
        const record = { path: childRelative, category, size: stat.size, mtimeMs: stat.mtimeMs };
        files.push(record);
        categoryStats[category].files += 1;
        categoryStats[category].bytes += stat.size;
        if (selected[category]) totalBytes += stat.size;
      }
    }
  }

  visit(root);
  const planCore = { format: 1, source: root, sourceFormat, sourceLauncher, selection: selected, categories: categoryStats, files, directories, warnings: safeWarnings, rejected: safeRejected, totalBytes, requiredBytes: totalBytes + 64 * 1024 * 1024 };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ source: root, sourceFormat, files: files.map(file => [file.path, file.size, Math.trunc(file.mtimeMs)]) })).digest('hex');
  return { ...planCore, fingerprint };
}

function transferPlanSummary(plan) {
  return {
    format: plan.format,
    sourceFormat: plan.sourceFormat,
    sourceLauncher: plan.sourceLauncher,
    selection: plan.selection,
    categories: plan.categories,
    warnings: plan.warnings,
    rejected: plan.rejected.slice(0, 200),
    rejectedCount: plan.rejected.length,
    totalFiles: plan.files.filter(file => plan.selection[file.category]).length,
    totalBytes: plan.totalBytes,
    requiredBytes: plan.requiredBytes,
    fingerprint: plan.fingerprint,
  };
}

function createTransferInclude(selection = {}, defaults = {}) {
  const selected = normalizedSelection(selection, defaults);
  return relative => selected[categoryFor(relative)] !== false && !PRIVATE_ROOTS.has(portableRelative(relative).split('/')[0].toLowerCase());
}

module.exports = { CATEGORY_LABELS, CATEGORY_ROOTS, PRIVATE_ROOTS, buildTransferPlan, categoryFor, createTransferInclude, normalizedSelection, portableRelative, transferPlanSummary };
