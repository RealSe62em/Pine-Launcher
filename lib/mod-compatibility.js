'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const KNOWN_BROKEN_MODS = [
  {
    id: 'viafabric',
    gameVersion: '1.21.11',
    versions: new Set(['0.4.21+173-1.14-1.21']),
    reason: 'This ViaFabric build contains an internally incompatible ViaVersion Java compatibility library and crashes during startup on Java 21.',
    replacement: 'ViaFabricPlus',
  },
];

function readFabricMetadata(jarPath) {
  try {
    const archive = new AdmZip(jarPath);
    const entry = archive.getEntry('fabric.mod.json');
    if (!entry) return null;
    return JSON.parse(entry.getData().toString('utf8'));
  } catch {
    return null;
  }
}

function detectJarLoaders(jarPath, filename = path.basename(jarPath)) {
  const loaders = new Set();
  try {
    const archive = new AdmZip(jarPath);
    if (archive.getEntry('fabric.mod.json')) loaders.add('fabric');
    if (archive.getEntry('quilt.mod.json')) loaders.add('quilt');
    if (archive.getEntry('META-INF/neoforge.mods.toml')) loaders.add('neoforge');
    if (archive.getEntry('META-INF/mods.toml')) loaders.add('forge');
  } catch {}
  const lower = String(filename || '').toLowerCase();
  if (!loaders.size) {
    if (/(?:^|[-_.+])neoforge(?:[-_.+]|$)/.test(lower)) loaders.add('neoforge');
    else if (/(?:^|[-_.+])forge(?:[-_.+]|$)/.test(lower)) loaders.add('forge');
    else if (/(?:^|[-_.+])fabric(?:[-_.+]|$)/.test(lower)) loaders.add('fabric');
    else if (/(?:^|[-_.+])quilt(?:[-_.+]|$)/.test(lower)) loaders.add('quilt');
  }
  return [...loaders];
}

function readModIds(jarPath) {
  const ids = new Set();
  try {
    const archive = new AdmZip(jarPath);
    const fabric = archive.getEntry('fabric.mod.json');
    if (fabric) {
      const value = JSON.parse(fabric.getData().toString('utf8'));
      if (typeof value.id === 'string') ids.add(value.id.toLowerCase());
      for (const nested of value.provides || []) if (typeof nested === 'string') ids.add(nested.toLowerCase());
    }
    const quilt = archive.getEntry('quilt.mod.json');
    if (quilt) {
      const value = JSON.parse(quilt.getData().toString('utf8'));
      const id = value.quilt_loader?.id;
      if (typeof id === 'string') ids.add(id.toLowerCase());
      for (const nested of value.quilt_loader?.provides || []) {
        const provided = typeof nested === 'string' ? nested : nested?.id;
        if (typeof provided === 'string') ids.add(provided.toLowerCase());
      }
    }
    for (const filename of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      const entry = archive.getEntry(filename);
      if (!entry) continue;
      const toml = entry.getData().toString('utf8');
      for (const match of toml.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gmi)) ids.add(match[1].toLowerCase());
    }
  } catch {}
  return [...ids].filter(id => /^[a-z0-9_.-]{2,128}$/.test(id));
}

function findDuplicateModIds(modsDir) {
  let files = [];
  try { files = fs.readdirSync(modsDir).filter(file => file.toLowerCase().endsWith('.jar')); }
  catch { return []; }
  const owners = new Map();
  for (const filename of files) {
    const file = path.join(modsDir, filename);
    const modified = fs.statSync(file).mtimeMs;
    for (const id of readModIds(file)) {
      if (!owners.has(id)) owners.set(id, []);
      owners.get(id).push({ id, filename, file, modified });
    }
  }
  return [...owners.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({ id, entries: entries.sort((a, b) => b.modified - a.modified) }));
}

function quarantineDuplicateModIds(modsDir) {
  const quarantined = [];
  let candidates = [];
  try {
    candidates = fs.readdirSync(modsDir)
      .filter(filename => filename.toLowerCase().endsWith('.jar'))
      .map(filename => {
        const file = path.join(modsDir, filename);
        return { filename, file, ids: readModIds(file), modified: fs.statSync(file).mtimeMs };
      })
      .filter(candidate => candidate.ids.length)
      .sort((a, b) => b.modified - a.modified || a.filename.localeCompare(b.filename));
  } catch {
    return quarantined;
  }

  // Greedily retain the newest compatible set. Processing one ID collision at
  // a time can accidentally disable every provider of a second shared ID when
  // a jar advertises multiple IDs, so ownership is decided per file instead.
  const claimedIds = new Map();
  for (const candidate of candidates) {
    const conflicts = candidate.ids
      .filter(id => claimedIds.has(id))
      .map(id => ({ id, owner: claimedIds.get(id) }));
    if (!conflicts.length) {
      for (const id of candidate.ids) claimedIds.set(id, candidate.filename);
      continue;
    }
    if (!fs.existsSync(candidate.file)) continue;
    const destination = candidate.file + '.disabled';
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    fs.renameSync(candidate.file, destination);
    const details = conflicts.map(conflict => `"${conflict.id}" (${conflict.owner})`).join(', ');
    quarantined.push({
      filename: candidate.filename,
      disabledFilename: path.basename(destination),
      reason: `It duplicates mod ID ${details}. Pine kept the newer compatible file set.`,
    });
  }
  return quarantined;
}

function jarLoaderCompatibilityIssue(jarPath, filename, instanceLoader) {
  const target = String(instanceLoader || '').toLowerCase();
  if (!target || target === 'vanilla') return null;
  const loaders = detectJarLoaders(jarPath, filename);
  if (!loaders.length || loaders.includes(target)) return null;
  const display = loader => loader === 'neoforge' ? 'NeoForge' : loader[0].toUpperCase() + loader.slice(1);
  return `Built for ${loaders.map(display).join('/')} but this instance uses ${display(target)}.`;
}

function quarantineLoaderIncompatibleMods(modsDir, instanceLoader) {
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter(file => file.toLowerCase().endsWith('.jar'));
  } catch {
    return [];
  }
  const quarantined = [];
  for (const filename of files) {
    const source = path.join(modsDir, filename);
    const reason = jarLoaderCompatibilityIssue(source, filename, instanceLoader);
    if (!reason) continue;
    const destination = source + '.disabled';
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    fs.renameSync(source, destination);
    quarantined.push({ filename, disabledFilename: path.basename(destination), reason });
  }
  return quarantined;
}

function findKnownBrokenMods(modsDir, gameVersion) {
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter(file => file.toLowerCase().endsWith('.jar'));
  } catch {
    return [];
  }

  const matches = [];
  for (const filename of files) {
    const metadata = readFabricMetadata(path.join(modsDir, filename));
    if (!metadata?.id || !metadata?.version) continue;
    const rule = KNOWN_BROKEN_MODS.find(item =>
      item.id === metadata.id &&
      item.gameVersion === gameVersion &&
      item.versions.has(metadata.version)
    );
    if (rule) matches.push({ filename, id: metadata.id, version: metadata.version, ...rule });
  }
  return matches;
}

function quarantineKnownBrokenMods(modsDir, gameVersion) {
  const quarantined = [];
  for (const match of findKnownBrokenMods(modsDir, gameVersion)) {
    const source = path.join(modsDir, match.filename);
    const destination = source + '.disabled';
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    fs.renameSync(source, destination);
    quarantined.push({ ...match, disabledFilename: path.basename(destination) });
  }
  return quarantined;
}

function knownModrinthIncompatibility(projectId, versionId, gameVersion) {
  if (
    gameVersion === '1.21.11' &&
    (projectId === 'YlKdE5VK' || String(projectId).toLowerCase() === 'viafabric') &&
    versionId === 'U1uUiwCm'
  ) {
    return {
      code: 'KNOWN_BROKEN_MOD_BUILD',
      message: 'ViaFabric 0.4.21+173 crashes on Minecraft 1.21.11 with Java 21 because its bundled ViaVersion compatibility classes do not match.',
      detail: 'Install ViaFabricPlus instead, or wait for a corrected ViaFabric release.',
    };
  }
  return null;
}

module.exports = {
  detectJarLoaders,
  findDuplicateModIds,
  findKnownBrokenMods,
  jarLoaderCompatibilityIssue,
  knownModrinthIncompatibility,
  quarantineLoaderIncompatibleMods,
  quarantineDuplicateModIds,
  quarantineKnownBrokenMods,
  readFabricMetadata,
  readModIds,
};
