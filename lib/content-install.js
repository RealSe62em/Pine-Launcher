'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveSafePath, safeRemoteFilename } = require('./safety');

// Downloads stay outside the live game directories until the next launch.
// A ready manifest is published only after every file has been verified.
function beginContentInstall(root) {
  const queue = path.join(root, '.pine-content-installs');
  fs.mkdirSync(queue, { recursive: true });
  return fs.mkdtempSync(path.join(queue, 'staging-'));
}

function targetPath(root, relative) {
  if (typeof relative !== 'string' || !/^(mods|resourcepacks|shaderpacks)\/[^/\\]+$/.test(relative)) {
    throw new Error('Invalid content installation path');
  }
  const filename = relative.split('/')[1];
  safeRemoteFilename(filename);
  if (filename === '.' || filename === '..') throw new Error('Invalid content filename');
  return resolveSafePath(root, ...relative.split('/'));
}

function pendingContentInstalls(root) {
  const queue = path.join(root, '.pine-content-installs');
  if (!fs.existsSync(queue)) return [];
  return fs.readdirSync(queue).filter(name => /^ready-[\w-]+$/.test(name)).sort().map(id => {
    const manifest = JSON.parse(fs.readFileSync(path.join(queue, id, 'manifest.json'), 'utf8'));
    return { id, files: manifest.files, gameVersion: manifest.gameVersion, loader: manifest.loader };
  });
}

function discardContentInstall(root, id) {
  if (!/^ready-[\w-]+$/.test(id)) throw new Error('Invalid queued installation');
  const directory = path.join(root, '.pine-content-installs', id);
  if (fs.existsSync(path.join(directory, 'journal.json'))) throw new Error('This installation needs rollback recovery before it can be discarded. Close Minecraft and retry launching.');
  const cancelled = directory.replace(/ready-([^/\\]+)$/, 'cancelled-$1');
  fs.renameSync(directory, cancelled);
  fs.rmSync(cancelled, { recursive: true, force: true });
}

function queueContentInstall(root, staging, manifest) {
  for (const file of manifest.files) {
    const source = targetPath(staging, file);
    if (!fs.statSync(source).isFile()) throw new Error('Missing staged content');
  }
  const hashes = Object.fromEntries(manifest.files.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(targetPath(staging, file))).digest('hex')]));
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ ...manifest, hashes }));
  const previous = pendingContentInstalls(root).map(item => Number(item.id.split('-')[1]));
  const timestamp = Math.max(Date.now(), ...previous.map(value => value + 1));
  const ready = path.join(root, '.pine-content-installs', `ready-${timestamp}-${crypto.randomUUID()}`);
  fs.renameSync(staging, ready);
  return ready;
}

function replaceFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(source, temporary);
    fs.renameSync(temporary, destination);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function applyContentInstalls(root, instance) {
  const queue = path.join(root, '.pine-content-installs');
  if (!fs.existsSync(queue)) return 0;
  let applied = 0;
  for (const name of fs.readdirSync(queue).filter(name => /^ready-[\w-]+$/.test(name)).sort()) {
    const directory = path.join(queue, name);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    const metadataNames = ['mods_meta.json', 'content_meta.json'];
    const resolve = relative => metadataNames.includes(relative) ? path.join(root, relative) : targetPath(root, relative);
    const journalPath = path.join(directory, 'journal.json');
    const rollback = journal => {
      for (const [relative, existed] of Object.entries(journal)) {
        const destination = resolve(relative);
        if (existed) replaceFile(path.join(directory, 'backup', relative), destination);
        else fs.rmSync(destination, { force: true });
      }
      fs.rmSync(journalPath, { force: true });
    };
    // Finish an interrupted rollback before trying the durable queue again.
    if (fs.existsSync(journalPath)) rollback(JSON.parse(fs.readFileSync(journalPath, 'utf8')));
    if (manifest.gameVersion !== instance.gameVersion || manifest.loader !== instance.loader) {
      throw new Error('Queued content targets a different Minecraft version or loader. Restore the instance version before launching.');
    }
    for (const relative of manifest.files) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(targetPath(directory, relative))).digest('hex');
      if (actual !== manifest.hashes[relative]) throw new Error('Queued content failed verification: ' + relative);
    }
    const toDisable = new Set(manifest.disableFiles || []);
    // An earlier queued install may now be present even though it was absent
    // when the later request ran its compatibility check.
    let currentMods = {};
    try { currentMods = JSON.parse(fs.readFileSync(path.join(root, 'mods_meta.json'), 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [filename, info] of Object.entries(manifest.metadata?.['mods_meta.json'] || {})) {
      for (const [existing, oldInfo] of Object.entries(currentMods)) {
        if (info.projectId && info.projectId === oldInfo.projectId && existing !== filename) toDisable.add(`mods/${existing}`);
      }
    }
    const disabled = [...toDisable].filter(relative => !manifest.files.includes(relative));
    const affected = new Set([...manifest.files, ...disabled, ...disabled.map(file => `${file}.disabled`), ...metadataNames]);
    const journal = {};
    for (const relative of affected) {
      const destination = resolve(relative);
      journal[relative] = fs.existsSync(destination);
      if (journal[relative]) {
        const backup = path.join(directory, 'backup', relative);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(destination, backup);
      }
    }
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    try {
      for (const relative of disabled) {
        const destination = resolve(relative);
        if (fs.existsSync(destination)) fs.renameSync(destination, `${destination}.disabled`);
      }
      for (const relative of manifest.files) replaceFile(targetPath(directory, relative), resolve(relative));
      for (const name of metadataNames) {
        let metadata = {};
        try { metadata = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        Object.assign(metadata, manifest.metadata?.[name] || {});
        const staged = path.join(directory, name);
        fs.writeFileSync(staged, JSON.stringify(metadata, null, 2));
        replaceFile(staged, path.join(root, name));
      }
      // Renaming marks the transaction committed even if cleanup is interrupted.
      const completed = path.join(queue, name.replace('ready-', 'complete-'));
      fs.renameSync(directory, completed);
      try { fs.rmSync(completed, { recursive: true, force: true }); } catch {}
      applied += manifest.files.length;
    } catch (error) {
      try { rollback(journal); } catch (rollbackError) {
        throw new Error(`${error.message}. Content rollback will be retried before launch: ${rollbackError.message}`);
      }
      throw error;
    }
  }
  return applied;
}

module.exports = { beginContentInstall, queueContentInstall, applyContentInstalls, pendingContentInstalls, discardContentInstall };
