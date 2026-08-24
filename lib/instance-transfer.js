'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function inspectTree(source, { include = () => true, skipSymlinks = false } = {}) {
  const root = path.resolve(source);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Source instance folder does not exist');
  const files = [];
  const directories = [];
  let bytes = 0;

  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (!include(childRelative, entry)) continue;
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink()) {
        if (skipSymlinks) continue;
        throw new Error(`The instance contains a filesystem link that Pine cannot copy safely: ${childRelative}`);
      }
      if (stat.isDirectory()) {
        directories.push(childRelative);
        visit(sourcePath, childRelative);
      } else if (stat.isFile()) {
        files.push({ relative: childRelative, size: stat.size, mtimeMs: stat.mtimeMs });
        bytes += stat.size;
      }
    }
  }

  visit(root);
  return { root, files, directories, bytes };
}

function availableBytes(targetParent) {
  try {
    const stats = fs.statfsSync(targetParent);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function validateCopiedTree(staging, plan) {
  for (const file of plan.files) {
    const copied = path.join(staging, file.relative);
    const stat = fs.statSync(copied);
    if (!stat.isFile() || stat.size !== file.size) {
      throw new Error(`The copied file could not be validated: ${file.relative}`);
    }
  }
  return true;
}

const DUPLICATION_COMPONENT_PATHS = Object.freeze({
  worlds: ['saves'],
  mods: ['mods', 'mods_meta.json', 'config', 'defaultconfigs'],
  settings: ['options.txt', 'optionsof.txt'],
  servers: ['servers.dat', 'servers.dat_old'],
  screenshots: ['screenshots'],
  resourcepacks: ['resourcepacks'],
  shaderpacks: ['shaderpacks'],
});

function createDuplicationFilter(components = null) {
  if (!components || typeof components !== 'object') return () => true;
  const excluded = new Set();
  for (const [component, roots] of Object.entries(DUPLICATION_COMPONENT_PATHS)) {
    if (components[component] === false) roots.forEach(root => excluded.add(root.toLowerCase()));
  }
  // A copy starts with fresh activity and diagnostics even when every user-facing
  // component is selected.
  ['logs', 'crash-reports', 'quickplay', '.pine-activity.json'].forEach(root => excluded.add(root));
  return relative => {
    const top = String(relative || '').split(/[\\/]/, 1)[0].toLowerCase();
    return !excluded.has(top);
  };
}

function abortError() {
  const error = new Error('Transfer cancelled');
  error.code = 'TRANSFER_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function copyInstanceTransactional({ source, destination, onProgress = () => {}, include = () => true, signal = null, skipSymlinks = false, verifyContents = false }) {
  throwIfAborted(signal);
  const target = path.resolve(destination);
  const parent = path.dirname(target);
  const plan = inspectTree(source, { include, skipSymlinks });
  if (target === plan.root || target.startsWith(`${plan.root}${path.sep}`)) {
    throw new Error('The copy destination cannot be inside the source instance');
  }
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(target)) throw new Error('The destination instance folder already exists');

  const free = availableBytes(parent);
  if (free !== null && free < plan.bytes + 64 * 1024 * 1024) {
    throw new Error('There is not enough free disk space to duplicate this instance');
  }

  const token = crypto.randomBytes(6).toString('hex');
  const staging = path.join(parent, `.${path.basename(target)}.pine-copy-${token}`);
  let copiedBytes = 0;
  fs.mkdirSync(staging, { recursive: false });

  try {
    for (const directory of plan.directories) fs.mkdirSync(path.join(staging, directory), { recursive: true });
    for (const file of plan.files) {
      throwIfAborted(signal);
      const from = path.join(plan.root, file.relative);
      const to = path.join(staging, file.relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
      throwIfAborted(signal);
      if (verifyContents) {
        const [sourceHash, copiedHash] = await Promise.all([fileSha256(from), fileSha256(to)]);
        if (sourceHash !== copiedHash) throw new Error(`The copied file failed integrity validation: ${file.relative}`);
      }
      try { await fs.promises.utimes(to, file.mtimeMs / 1000, file.mtimeMs / 1000); } catch {}
      copiedBytes += file.size;
      onProgress({
        bytes: copiedBytes,
        totalBytes: plan.bytes,
        files: plan.files.length,
        percent: plan.bytes ? Math.round((copiedBytes / plan.bytes) * 100) : 100,
        current: file.relative,
      });
    }
    validateCopiedTree(staging, plan);
    fs.renameSync(staging, target);
    return { destination: target, bytes: plan.bytes, files: plan.files.length };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { abortError, availableBytes, copyInstanceTransactional, createDuplicationFilter, fileSha256, inspectTree, throwIfAborted, validateCopiedTree };
