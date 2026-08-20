'use strict';

function minecraftNeoForgeLine(gameVersion) {
  const clean = String(gameVersion || '').trim();
  const classic = clean.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (classic) return `${Number(classic[1])}.${Number(classic[2] || 0)}`;
  const calendar = clean.match(/^(\d{2})\.(\d+)(?:\.\d+)?$/);
  if (calendar) return `${Number(calendar[1])}.${Number(calendar[2])}`;
  return null;
}

function isNeoForgeVersionForMinecraft(loaderVersion, gameVersion) {
  const line = minecraftNeoForgeLine(gameVersion);
  if (!line) return false;
  const escaped = line.replace('.', '\\.');
  return new RegExp(`^${escaped}(?:\\.|$)`).test(String(loaderVersion || '').trim());
}

function neoForgeVersionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0), qualifier: String(match[4] || '') };
}

function compareNeoForgeVersions(left, right) {
  const a = neoForgeVersionParts(left);
  const b = neoForgeVersionParts(right);
  if (!a || !b) return String(left).localeCompare(String(right), undefined, { numeric: true });
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.qualifier && b.qualifier) return 1;
  if (a.qualifier && !b.qualifier) return -1;
  return a.qualifier.localeCompare(b.qualifier, undefined, { numeric: true });
}

function isStableNeoForgeVersion(value) {
  return Boolean(neoForgeVersionParts(value)) && !/(?:^|-)(?:alpha|beta|pre|rc|snapshot)(?:-|\d|$)/i.test(String(value));
}

function neoForgeCoordinateVersion(name) {
  const parts = String(name || '').split(':');
  if (parts[0] !== 'net.neoforged' || !['neoforge', 'forge'].includes(parts[1])) return null;
  return parts[2] || null;
}

function validateNeoForgeProfile(profile, gameVersion, loaderVersion) {
  const errors = [];
  if (!profile || typeof profile !== 'object') errors.push('Profile JSON is missing');
  if (!profile?.id || typeof profile.id !== 'string') errors.push('Profile ID is missing');
  if (profile?.inheritsFrom !== gameVersion) errors.push(`Profile does not inherit from Minecraft ${gameVersion}`);
  if (!profile?.mainClass || typeof profile.mainClass !== 'string') errors.push('Launch class is missing');
  if (!Array.isArray(profile?.libraries) || !profile.libraries.length) errors.push('Loader libraries are missing');
  const installedVersion = (profile?.libraries || []).map(item => neoForgeCoordinateVersion(item?.name)).find(Boolean) || null;
  if (!installedVersion) errors.push('NeoForge library identity is missing');
  else if (String(installedVersion) !== String(loaderVersion)) errors.push(`Profile contains NeoForge ${installedVersion}, not ${loaderVersion}`);
  const hasArguments = Array.isArray(profile?.arguments?.game) || typeof profile?.minecraftArguments === 'string';
  if (!hasArguments) errors.push('Game launch arguments are missing');
  return { valid: errors.length === 0, errors, installedVersion, profileId: profile?.id || null };
}

module.exports = {
  compareNeoForgeVersions,
  isNeoForgeVersionForMinecraft,
  isStableNeoForgeVersion,
  minecraftNeoForgeLine,
  neoForgeCoordinateVersion,
  neoForgeVersionParts,
  validateNeoForgeProfile,
};
