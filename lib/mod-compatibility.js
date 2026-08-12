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
  findKnownBrokenMods,
  knownModrinthIncompatibility,
  quarantineKnownBrokenMods,
  readFabricMetadata,
};