'use strict';

function parseJavaMajor(output) {
  const match = String(output || '').match(/(?:version\s+["']?)(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const first = Number.parseInt(match[1], 10);
  return first === 1 && match[2] ? Number.parseInt(match[2], 10) : first;
}

function javaMinimumFromRange(range) {
  const ranges = Array.isArray(range) ? range : [range];
  const alternatives = [];
  for (const value of ranges) {
    if (typeof value !== 'string') continue;
    const explicit = [...value.matchAll(/(?:>=|\^|~)?\s*(\d+)/g)].map(m => Number.parseInt(m[1], 10));
    if (explicit.length) alternatives.push(Math.min(...explicit));
  }
  // Fabric arrays represent alternative accepted ranges, so choose the
  // lowest satisfiable minimum. Requirements from different mods are merged
  // later by taking their maximum.
  return alternatives.length ? Math.min(...alternatives) : 0;
}

function chooseCompatibleJava(checked, requiredMajor) {
  return checked
    .filter(java => java.major >= requiredMajor)
    .sort((a, b) => Number(b.major === requiredMajor) - Number(a.major === requiredMajor)
      || Number(b.preferred) - Number(a.preferred) || a.major - b.major)[0] || null;
}

function javaMajorFromClassVersion(classVersion) {
  const value = Number.parseFloat(classVersion);
  return Number.isFinite(value) && value >= 45 ? Math.floor(value - 44) : null;
}

function javaRuntimeArchitectures(processArch) {
  return processArch === 'arm64' ? ['aarch64', 'x64'] : ['x64'];
}

function versionSupports(version, gameVersion, loaders) {
  const games = version?.game_versions || [];
  const versionLoaders = version?.loaders || [];
  return games.includes(gameVersion) && (!loaders.length || loaders.some(loader => versionLoaders.includes(loader)));
}

function normalizeProfileLoader(profile, loader, loaderVersion) {
  const allowedLoaders = new Set(['vanilla', 'fabric', 'quilt', 'forge']);
  const normalizedProfile = profile === 'vanilla' || profile === 'performance' ? profile : 'custom';
  let normalizedLoader = allowedLoaders.has(loader) ? loader : 'vanilla';
  if (normalizedProfile === 'vanilla') normalizedLoader = 'vanilla';
  if (normalizedProfile === 'performance') normalizedLoader = 'fabric';
  return {
    profile: normalizedProfile,
    loader: normalizedLoader,
    loaderVersion: normalizedLoader === 'vanilla' ? null : (loaderVersion || null),
  };
}

module.exports = { parseJavaMajor, javaMinimumFromRange, chooseCompatibleJava, versionSupports, normalizeProfileLoader, javaMajorFromClassVersion, javaRuntimeArchitectures };
