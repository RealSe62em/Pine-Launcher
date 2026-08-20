'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { readNbt } = require('./discord-presence');

const SKIPPED_FULL_ENTRIES = new Set(['logs', 'crash-reports', 'natives', 'quickPlay']);

function backupKey(instance) {
  const identity = String(instance?.id || instance?.path || instance?.name || 'instance');
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function safeDescription(value) {
  return String(value || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 160);
}

function copyTree(source, destination, { topLevel = true } = {}) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) return { bytes: 0, files: 0 };
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return { bytes: stat.size, files: 1 };
  }
  if (!stat.isDirectory()) return { bytes: 0, files: 0 };
  fs.mkdirSync(destination, { recursive: true });
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (topLevel && SKIPPED_FULL_ENTRIES.has(entry.name)) continue;
    const copied = copyTree(path.join(source, entry.name), path.join(destination, entry.name), { topLevel: false });
    bytes += copied.bytes;
    files += copied.files;
  }
  return { bytes, files };
}

function readWorldVersions(savesDir) {
  const versions = new Set();
  let entries = [];
  try { entries = fs.readdirSync(savesDir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const level = fs.readFileSync(path.join(savesDir, entry.name, 'level.dat'));
      if (level.length > 16 * 1024 * 1024) continue;
      const decoded = level[0] === 0x1f && level[1] === 0x8b ? zlib.gunzipSync(level) : level;
      const version = String(readNbt(decoded)?.Data?.Version?.Name || '').trim();
      if (/^\d+(?:\.\d+){1,3}$/.test(version)) versions.add(version);
    } catch {}
  }
  return [...versions];
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}

function instanceBackupRoot(backupsDir, instance) {
  return path.join(backupsDir, backupKey(instance));
}

function listBackups(backupsDir, instance) {
  const root = instanceBackupRoot(backupsDir, instance);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory() && !entry.name.endsWith('.creating'))
    .map(entry => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8'));
        if (manifest.id !== entry.name || manifest.instanceKey !== backupKey(instance)) return null;
        return manifest;
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function pruneAutomaticBackups(backupsDir, instance, retention) {
  const keep = Math.min(20, Math.max(1, Number.parseInt(retention, 10) || 5));
  const automatic = listBackups(backupsDir, instance).filter(item => item.kind === 'automatic');
  for (const backup of automatic.slice(keep)) {
    fs.rmSync(path.join(instanceBackupRoot(backupsDir, instance), backup.id), { recursive: true, force: true });
  }
}

function createBackup({ backupsDir, instance, instanceDir, scope = 'full', kind = 'manual', description = '', retention = 5, reason = '' }) {
  if (!['full', 'worlds'].includes(scope)) throw new Error('Invalid backup scope');
  if (!['manual', 'automatic'].includes(kind)) throw new Error('Invalid backup type');
  if (!fs.existsSync(instanceDir)) throw new Error('Instance folder does not exist');
  const source = scope === 'worlds' ? path.join(instanceDir, 'saves') : instanceDir;
  if (scope === 'worlds' && !fs.existsSync(source)) throw new Error('This instance has no worlds to back up');

  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const root = instanceBackupRoot(backupsDir, instance);
  const staging = path.join(root, `${id}.creating`);
  const finalDir = path.join(root, id);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const payload = path.join(staging, 'payload');
    const copied = scope === 'worlds'
      ? copyTree(source, path.join(payload, 'saves'), { topLevel: false })
      : copyTree(source, payload);
    const manifest = {
      format: 1,
      id,
      instanceKey: backupKey(instance),
      instanceName: instance.name,
      gameVersion: String(instance.gameVersion || ''),
      worldVersions: readWorldVersions(path.join(source === instanceDir ? instanceDir : path.dirname(source), 'saves')),
      scope,
      kind,
      description: safeDescription(description),
      reason: safeDescription(reason),
      createdAt,
      bytes: copied.bytes,
      files: copied.files,
    };
    writeJsonAtomic(path.join(staging, 'manifest.json'), manifest);
    fs.renameSync(staging, finalDir);
    if (kind === 'automatic') pruneAutomaticBackups(backupsDir, instance, retention);
    return manifest;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function getBackup(backupsDir, instance, id) {
  const backup = listBackups(backupsDir, instance).find(item => item.id === id);
  if (!backup) throw new Error('Backup not found');
  return backup;
}

function deleteBackup(backupsDir, instance, id) {
  getBackup(backupsDir, instance, id);
  fs.rmSync(path.join(instanceBackupRoot(backupsDir, instance), id), { recursive: true, force: true });
  return true;
}

function restoreBackup({ backupsDir, instance, instanceDir, id }) {
  const backup = getBackup(backupsDir, instance, id);
  const payload = path.join(instanceBackupRoot(backupsDir, instance), id, 'payload');
  const token = crypto.randomBytes(6).toString('hex');
  const target = backup.scope === 'worlds' ? path.join(instanceDir, 'saves') : instanceDir;
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${path.basename(target)}.pine-restore-${token}`);
  const rollback = path.join(parent, `.${path.basename(target)}.pine-rollback-${token}`);
  const marker = path.join(backupsDir, `.restore-${token}.json`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(rollback, { recursive: true, force: true });
  const source = backup.scope === 'worlds' ? path.join(payload, 'saves') : payload;
  copyTree(source, staging, { topLevel: false });
  writeJsonAtomic(marker, { target, staging, rollback, phase: 'prepared', createdAt: new Date().toISOString() });
  try {
    if (fs.existsSync(target)) fs.renameSync(target, rollback);
    writeJsonAtomic(marker, { target, staging, rollback, phase: 'swapped-old', createdAt: new Date().toISOString() });
    fs.renameSync(staging, target);
    writeJsonAtomic(marker, { target, staging, rollback, phase: 'committed', createdAt: new Date().toISOString() });
    fs.rmSync(rollback, { recursive: true, force: true });
    fs.rmSync(marker, { force: true });
    return backup;
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(rollback)) fs.renameSync(rollback, target);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(marker, { force: true });
    throw error;
  }
}

function recoverInterruptedRestores(backupsDir) {
  let entries = [];
  try { entries = fs.readdirSync(backupsDir).filter(name => /^\.restore-[a-f0-9]+\.json$/.test(name)); } catch { return []; }
  const recovered = [];
  for (const name of entries) {
    const marker = path.join(backupsDir, name);
    try {
      const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (!path.isAbsolute(state.target) || !path.isAbsolute(state.staging) || !path.isAbsolute(state.rollback)) throw new Error('Invalid restore marker');
      if (!fs.existsSync(state.target)) {
        if (fs.existsSync(state.rollback)) fs.renameSync(state.rollback, state.target);
        else if (fs.existsSync(state.staging)) fs.renameSync(state.staging, state.target);
      }
      fs.rmSync(state.staging, { recursive: true, force: true });
      fs.rmSync(state.rollback, { recursive: true, force: true });
      fs.rmSync(marker, { force: true });
      recovered.push(state.target);
    } catch {
      // Keep an unreadable marker for manual inspection; never guess at paths.
    }
  }
  return recovered;
}

module.exports = {
  backupKey,
  createBackup,
  deleteBackup,
  listBackups,
  pruneAutomaticBackups,
  recoverInterruptedRestores,
  restoreBackup,
};
