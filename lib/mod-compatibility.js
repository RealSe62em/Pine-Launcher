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

function readForgeProvidedModIds(toml) {
  const ids = new Set();
  let insideModDeclaration = false;
  for (const line of String(toml || '').split(/\r?\n/)) {
    const table = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
    if (table) {
      insideModDeclaration = table[1].trim().toLowerCase() === 'mods';
      continue;
    }
    if (!insideModDeclaration) continue;
    const match = line.match(/^\s*modId\s*=\s*["']([^"']+)["']/i);
    if (match) ids.add(match[1].toLowerCase());
  }
  return [...ids].filter(id => /^[a-z0-9_.-]{2,128}$/.test(id));
}

function inspectJar(jarPath, filename = path.basename(jarPath)) {
  const ids = new Set();
  const idsByLoader = { fabric: new Set(), quilt: new Set(), forge: new Set(), neoforge: new Set() };
  const loaders = new Set();
  let fabricMetadata = null;
  const fabricModules = [];
  const providedVersions = {};
  let readable = false;
  try {
    const archive = new AdmZip(jarPath);
    archive.getEntries();
    readable = true;
    const fabric = archive.getEntry('fabric.mod.json');
    if (fabric) {
      loaders.add('fabric');
      fabricMetadata = JSON.parse(fabric.getData().toString('utf8'));
      const collectFabricModule = (metadata, nestedArchive, depth = 0, primary = false) => {
        if (!metadata || typeof metadata !== 'object') return;
        fabricModules.push(metadata);
        if (typeof metadata.id === 'string') {
          if (primary) { ids.add(metadata.id.toLowerCase()); idsByLoader.fabric.add(metadata.id.toLowerCase()); }
          providedVersions[metadata.id.toLowerCase()] = String(metadata.version || '0');
        }
        for (const provided of metadata.provides || []) {
          const id = typeof provided === 'string' ? provided : provided?.id;
          if (typeof id === 'string') {
            if (primary) { ids.add(id.toLowerCase()); idsByLoader.fabric.add(id.toLowerCase()); }
            providedVersions[id.toLowerCase()] = String(typeof provided === 'object' ? provided.version || metadata.version || '0' : metadata.version || '0');
          }
        }
        if (depth >= 2) return;
        for (const nested of metadata.jars || []) {
          const entry = nestedArchive.getEntry(nested?.file || '');
          if (!entry) continue;
          try {
            const childArchive = new AdmZip(entry.getData());
            const childMetadata = childArchive.getEntry('fabric.mod.json');
            if (childMetadata) collectFabricModule(JSON.parse(childMetadata.getData().toString('utf8')), childArchive, depth + 1, false);
          } catch {}
        }
      };
      collectFabricModule(fabricMetadata, archive, 0, true);
    }
    const quilt = archive.getEntry('quilt.mod.json');
    if (quilt) {
      loaders.add('quilt');
      const value = JSON.parse(quilt.getData().toString('utf8'));
      const id = value.quilt_loader?.id;
      if (typeof id === 'string') { ids.add(id.toLowerCase()); idsByLoader.quilt.add(id.toLowerCase()); }
      for (const nested of value.quilt_loader?.provides || []) {
        const provided = typeof nested === 'string' ? nested : nested?.id;
        if (typeof provided === 'string') { ids.add(provided.toLowerCase()); idsByLoader.quilt.add(provided.toLowerCase()); }
      }
    }
    for (const [metadataPath, loader] of [['META-INF/mods.toml', 'forge'], ['META-INF/neoforge.mods.toml', 'neoforge']]) {
      const entry = archive.getEntry(metadataPath);
      if (!entry) continue;
      loaders.add(loader);
      const toml = entry.getData().toString('utf8');
      for (const id of readForgeProvidedModIds(toml)) {
        ids.add(id);
        idsByLoader[loader].add(id);
      }
    }
  } catch {}
  const lower = String(filename || '').toLowerCase();
  if (!loaders.size) {
    if (/(?:^|[-_.+])neoforge(?:[-_.+]|$)/.test(lower)) loaders.add('neoforge');
    else if (/(?:^|[-_.+])forge(?:[-_.+]|$)/.test(lower)) loaders.add('forge');
    else if (/(?:^|[-_.+])fabric(?:[-_.+]|$)/.test(lower)) loaders.add('fabric');
    else if (/(?:^|[-_.+])quilt(?:[-_.+]|$)/.test(lower)) loaders.add('quilt');
  }
  return {
    fabricMetadata,
    fabricModules,
    providedVersions,
    readable,
    ids: [...ids].filter(id => /^[a-z0-9_.-]{2,128}$/.test(id)),
    idsByLoader: Object.fromEntries(Object.entries(idsByLoader).map(([loader, values]) => [loader, [...values]])),
    loaders: [...loaders],
  };
}

function parseComparableVersion(value) {
  const clean = String(value || '').trim().replace(/^v/i, '').split('+')[0];
  const [core, ...preParts] = clean.split('-');
  const numbers = core.split('.').map(part => Number.parseInt(part, 10)).map(number => Number.isFinite(number) ? number : 0);
  return { numbers, prerelease: preParts.join('-').split(/[.-]/).filter(Boolean) };
}

function compareModVersions(left, right) {
  const a = parseComparableVersion(left);
  const b = parseComparableVersion(right);
  const width = Math.max(a.numbers.length, b.numbers.length, 3);
  for (let index = 0; index < width; index++) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference) return difference;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    if (a.prerelease[index] == null) return -1;
    if (b.prerelease[index] == null) return 1;
    const aNumber = /^\d+$/.test(a.prerelease[index]) ? Number(a.prerelease[index]) : null;
    const bNumber = /^\d+$/.test(b.prerelease[index]) ? Number(b.prerelease[index]) : null;
    if (aNumber != null && bNumber != null && aNumber !== bNumber) return aNumber - bNumber;
    if (aNumber != null && bNumber == null) return -1;
    if (aNumber == null && bNumber != null) return 1;
    const difference = a.prerelease[index].localeCompare(b.prerelease[index]);
    if (difference) return difference;
  }
  return 0;
}

function satisfiesComparator(version, comparator) {
  const value = comparator.trim();
  if (!value || value === '*' || /^x$/i.test(value)) return true;
  const wildcard = value.match(/^(\d+)(?:\.(\d+))?(?:\.(?:x|\*))$/i);
  if (wildcard) {
    const parsed = parseComparableVersion(version).numbers;
    return parsed[0] === Number(wildcard[1]) && (wildcard[2] == null || parsed[1] === Number(wildcard[2]));
  }
  const match = value.match(/^(<=|>=|!=|=|<|>|\^|~)?\s*v?([^\s]+)$/i);
  if (!match) return true;
  const operator = match[1] || '=';
  const target = match[2];
  const difference = compareModVersions(version, target);
  if (operator === '=') return difference === 0;
  if (operator === '!=') return difference !== 0;
  if (operator === '<') return difference < 0;
  if (operator === '<=') return difference <= 0;
  if (operator === '>') return difference > 0;
  if (operator === '>=') return difference >= 0;
  if (operator === '~') {
    const targetParts = parseComparableVersion(target).numbers;
    const upper = `${targetParts[0] || 0}.${(targetParts[1] || 0) + 1}.0`;
    return difference >= 0 && compareModVersions(version, upper) < 0;
  }
  if (operator === '^') {
    const targetParts = parseComparableVersion(target).numbers;
    const upper = targetParts[0] > 0 ? `${targetParts[0] + 1}.0.0`
      : targetParts[1] > 0 ? `0.${targetParts[1] + 1}.0` : `0.0.${(targetParts[2] || 0) + 1}`;
    return difference >= 0 && compareModVersions(version, upper) < 0;
  }
  return true;
}

function versionPredicateSatisfies(version, predicate) {
  const alternatives = Array.isArray(predicate) ? predicate : [predicate];
  return alternatives.some(raw => String(raw || '*').split(/\s*\|\|\s*/).some(part => {
    const range = part.trim();
    if (!range || range === '*') return true;
    if (parseComparableVersion(version).prerelease.length && !range.includes('-')) return false;
    const interval = range.match(/^([[(])\s*([^,]*)\s*,\s*([^\])]*)\s*([\])])$/);
    if (interval) {
      const lower = interval[2] ? compareModVersions(version, interval[2]) : 1;
      const upper = interval[3] ? compareModVersions(version, interval[3]) : -1;
      const lowerPass = interval[1] === '[' ? lower >= 0 : lower > 0;
      const upperPass = interval[4] === ']' ? upper <= 0 : upper < 0;
      return lowerPass && upperPass;
    }
    const comparators = range.match(/(?:<=|>=|!=|=|<|>|\^|~)?\s*v?\d+(?:\.(?:\d+|x|\*))*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|\*/gi);
    if (!comparators?.length) return true;
    // Fabric does not treat an arbitrary prerelease as satisfying a stable
    // range. This is the common cause of release/beta Sodium + Iris failures.
    return comparators.every(comparator => satisfiesComparator(version, comparator));
  }));
}

function relationEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function analyzeFabricRelations(records, builtins = {}) {
  const loaderBuiltins = new Set(['java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge']);
  const providers = new Map();
  for (const record of records || []) {
    const modules = record.fabricModules?.length ? record.fabricModules : [record.fabricMetadata];
    for (const metadata of modules) {
      if (!metadata?.id || !metadata?.version) continue;
      for (const provided of [metadata.id, ...(metadata.provides || [])]) {
        const id = typeof provided === 'string' ? provided : provided?.id;
        const normalized = typeof id === 'string' ? id.toLowerCase() : '';
        const version = typeof provided === 'object' && provided?.version ? provided.version : metadata.version;
        if (normalized && !providers.has(normalized)) providers.set(normalized, { ...record, id: normalized, version: String(version) });
      }
    }
  }
  for (const [id, version] of Object.entries(builtins || {})) {
    if (version != null) providers.set(id.toLowerCase(), { id: id.toLowerCase(), version: String(version), builtin: true });
  }
  const issues = [];
  const seen = new Set();
  const add = issue => {
    const key = `${issue.code}:${issue.sourceId}:${issue.targetId}:${issue.sourceFilename}`;
    if (!seen.has(key)) { seen.add(key); issues.push(issue); }
  };
  for (const record of records || []) {
    const modules = record.fabricModules?.length ? record.fabricModules : [record.fabricMetadata];
    for (const metadata of modules) {
    if (!metadata?.id || !metadata?.version) continue;
    const sourceId = String(metadata.id).toLowerCase();
    for (const [targetIdRaw, requirement] of relationEntries(metadata.depends)) {
      const targetId = targetIdRaw.toLowerCase();
      const target = providers.get(targetId);
      if (!target) {
        if (loaderBuiltins.has(targetId)) continue;
        add({ code: 'MISSING_DEPENDENCY', severity: 'error', sourceId, sourceFilename: record.filename, sourceVersion: String(metadata.version), targetId, requirement,
          title: `${metadata.name || sourceId} needs ${targetId}`, detail: `${targetId} is required (${String(requirement)}) but is not installed.` });
      } else if (!versionPredicateSatisfies(target.version, requirement)) {
        add({ code: 'DEPENDENCY_VERSION', severity: 'error', sourceId, sourceFilename: record.filename, sourceVersion: String(metadata.version), targetId, targetFilename: target.filename, targetVersion: target.version, requirement,
          title: `${metadata.name || sourceId} needs another ${targetId} version`, detail: `Installed ${targetId} ${target.version} does not satisfy ${String(requirement)}.` });
      }
    }
    for (const field of ['breaks', 'conflicts']) for (const [targetIdRaw, requirement] of relationEntries(metadata[field])) {
      const targetId = targetIdRaw.toLowerCase();
      const target = providers.get(targetId);
      if (target && versionPredicateSatisfies(target.version, requirement)) {
        add({ code: 'DECLARED_CONFLICT', severity: 'error', sourceId, sourceFilename: record.filename, sourceVersion: String(metadata.version), targetId, targetFilename: target.filename, targetVersion: target.version, requirement,
          title: `${metadata.name || sourceId} conflicts with ${targetId}`, detail: `${targetId} ${target.version} matches the incompatible range ${String(requirement)}.` });
      }
    }
    }
  }
  return issues;
}

function inspectModSet(modsDir, instanceLoader, gameVersion) {
  let filenames = [];
  try { filenames = fs.readdirSync(modsDir).filter(file => file.toLowerCase().endsWith('.jar')); }
  catch { return { duplicates: [], incompatible: [], knownBroken: [] }; }
  const records = filenames.map(filename => {
    const file = path.join(modsDir, filename);
    let modified = 0;
    try { modified = fs.statSync(file).mtimeMs; } catch {}
    const inspected = inspectJar(file, filename);
    const loaderIds = inspected.idsByLoader?.[String(instanceLoader || '').toLowerCase()] || [];
    return { filename, file, modified, ...inspected, ids: loaderIds.length ? loaderIds : inspected.ids };
  });
  const target = String(instanceLoader || '').toLowerCase();
  const display = loader => loader === 'neoforge' ? 'NeoForge' : loader[0].toUpperCase() + loader.slice(1);
  const incompatible = target && target !== 'vanilla'
    ? records.filter(item => item.loaders.length && !item.loaders.includes(target)).map(item => ({
      filename: item.filename,
      reason: `Built for ${item.loaders.map(display).join('/')} but this instance uses ${display(target)}.`,
    }))
    : [];
  const knownBroken = records.flatMap(item => {
    const metadata = item.fabricMetadata;
    if (!metadata?.id || !metadata?.version) return [];
    const rule = KNOWN_BROKEN_MODS.find(candidate => candidate.id === metadata.id && candidate.gameVersion === gameVersion && candidate.versions.has(metadata.version));
    return rule ? [{ filename: item.filename, id: metadata.id, version: metadata.version, ...rule }] : [];
  });
  const owners = new Map();
  for (const item of records) for (const id of item.ids) {
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push({ id, filename: item.filename, file: item.file, modified: item.modified });
  }
  const duplicates = [...owners.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({ id, entries: entries.sort((a, b) => b.modified - a.modified) }));
  const relations = analyzeFabricRelations(records, { minecraft: gameVersion });
  return { duplicates, incompatible, knownBroken, relations, records: records.map(record => ({ filename: record.filename, ids: record.ids, loaders: record.loaders, fabricMetadata: record.fabricMetadata, fabricModules: record.fabricModules, providedVersions: record.providedVersions, readable: record.readable })) };
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
      return [...ids].filter(id => /^[a-z0-9_.-]{2,128}$/.test(id));
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
      return [...ids].filter(id => /^[a-z0-9_.-]{2,128}$/.test(id));
    }
    for (const filename of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      const entry = archive.getEntry(filename);
      if (!entry) continue;
      const toml = entry.getData().toString('utf8');
      for (const id of readForgeProvidedModIds(toml)) ids.add(id);
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

function findLoaderIncompatibleMods(modsDir, instanceLoader) {
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter(file => file.toLowerCase().endsWith('.jar'));
  } catch {
    return [];
  }
  return files.flatMap(filename => {
    const reason = jarLoaderCompatibilityIssue(path.join(modsDir, filename), filename, instanceLoader);
    return reason ? [{ filename, reason }] : [];
  });
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
  findLoaderIncompatibleMods,
  jarLoaderCompatibilityIssue,
  inspectModSet,
  analyzeFabricRelations,
  compareModVersions,
  knownModrinthIncompatibility,
  quarantineLoaderIncompatibleMods,
  quarantineDuplicateModIds,
  quarantineKnownBrokenMods,
  readFabricMetadata,
  readModIds,
  versionPredicateSatisfies,
};
