'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveSafePath } = require('./safety');

const USER_DATA_ROOTS = new Set(['saves', 'screenshots', 'logs', 'crash-reports', 'natives', 'quickplay']);
const INTERNAL_FILES = new Set(['.pine-activity.json', 'mods_meta.json']);

function normalizePackPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || normalized.startsWith('/') || parts.some(part => part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('Managed pack metadata contains an unsafe path');
  }
  return parts.join('/');
}

function hashFile(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function managedFileRecord(root, relative, details = {}) {
  const safe = normalizePackPath(relative);
  const target = resolveSafePath(root, ...safe.split('/'));
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error(`Managed pack file is missing: ${safe}`);
  return {
    path: safe,
    fileSize: stat.size,
    hashes: { ...(details.hashes || {}), sha256: hashFile(target, 'sha256') },
    downloads: Array.isArray(details.downloads) ? details.downloads.slice(0, 4) : [],
    kind: details.kind === 'override' ? 'override' : 'download',
    projectId: details.projectId ?? null,
    fileId: details.fileId ?? null,
  };
}

function normalizedManagedFiles(records) {
  const result = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.path) continue;
    const safe = normalizePackPath(record.path);
    const key = safe.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...record, path: safe });
  }
  return result;
}

function verifyManagedFile(root, record, validationCache = null) {
  const safe = normalizePackPath(record.path);
  const target = resolveSafePath(root, ...safe.split('/'));
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return 'missing';
    if (Number(record.fileSize) > 0 && stat.size !== Number(record.fileSize)) return 'modified';
    const algorithm = record.hashes?.sha512 ? 'sha512' : record.hashes?.sha256 ? 'sha256' : record.hashes?.sha1 ? 'sha1' : null;
    if (algorithm) {
      const expected = String(record.hashes[algorithm]).toLowerCase();
      const valid = validationCache
        ? validationCache.isValid(target, `${algorithm}:${expected}`, () => hashFile(target, algorithm).toLowerCase() === expected)
        : hashFile(target, algorithm).toLowerCase() === expected;
      if (!valid) return 'modified';
    }
    return 'healthy';
  } catch {
    return 'missing';
  }
}

function walkFiles(root, current = root, output = []) {
  let entries = [];
  try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const top = relative.split('/')[0].toLowerCase();
    if (USER_DATA_ROOTS.has(top)) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, output);
    else if (entry.isFile() && !INTERNAL_FILES.has(relative.toLowerCase())) output.push(relative);
  }
  return output;
}

function inspectManagedState(root, records, { validationCache = null } = {}) {
  const managed = normalizedManagedFiles(records);
  const owned = new Set(managed.map(record => record.path.toLowerCase()));
  const status = { checked: managed.length, healthy: 0, missing: [], modified: [], userAdded: [] };
  for (const record of managed) {
    const result = verifyManagedFile(root, record, validationCache);
    if (result === 'healthy') status.healthy += 1;
    else status[result].push(record.path);
  }
  status.userAdded = walkFiles(root).filter(relative => !owned.has(relative.toLowerCase()));
  return status;
}

function removeManagedFiles(root, records) {
  const removed = [];
  for (const record of normalizedManagedFiles(records)) {
    const target = resolveSafePath(root, ...record.path.split('/'));
    try {
      if (fs.statSync(target).isFile()) {
        fs.rmSync(target, { force: true });
        removed.push(record.path);
      }
    } catch {}
  }
  return removed;
}

function snapshotPackMetadata(pack) {
  if (!pack || typeof pack !== 'object') return null;
  const { history: _history, availableVersion: _availableVersion, ...snapshot } = pack;
  return JSON.parse(JSON.stringify(snapshot));
}

module.exports = {
  inspectManagedState,
  managedFileRecord,
  normalizePackPath,
  normalizedManagedFiles,
  removeManagedFiles,
  snapshotPackMetadata,
  verifyManagedFile,
};
