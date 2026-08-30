'use strict';

const BASE_PERFORMANCE_MODS = Object.freeze([
  'sodium', 'entityculling', 'ferrite-core', 'krypton', 'modernfix',
  'no-chat-reports', 'memoryleakfix', 'lazydfu', 'ebe', 'immediatelyfast',
  'alternate-current', 'dynamic-fps', 'fastload', 'moreculling', 'fastanim',
  'vmp-fabric', 'reeses-sodium-options', 'skip-transitions',
  'fabric-api', 'cloth-config', 'modmenu',
]);

function performanceModsForVersion(gameVersion) {
  const mods = [...BASE_PERFORMANCE_MODS];
  const match = String(gameVersion || '').match(/^(\d+)\.(\d+)/);
  if (!match) return mods;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  if (major === 1 && minor < 20) mods.push('phosphor', 'starlight');
  if (major === 1 && minor >= 21) mods.push('sodium-extra');
  return [...new Set(mods)];
}

module.exports = { BASE_PERFORMANCE_MODS, performanceModsForVersion };
