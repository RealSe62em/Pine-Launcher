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
  findKnownBrokenMods,
  jarLoaderCompatibilityIssue,
  knownModrinthIncompatibility,
  quarantineLoaderIncompatibleMods,
  quarantineKnownBrokenMods,
  readFabricMetadata,
};
