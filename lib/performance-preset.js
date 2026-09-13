'use strict';

const SHARED_PERFORMANCE_MODS = Object.freeze([
  'sodium', 'lithium', 'ferrite-core', 'immediatelyfast', 'entityculling',
  'moreculling', 'dynamic-fps', 'fabric-api', 'modmenu',
]);

const PRESET_MODS = Object.freeze({
  performance: Object.freeze([
    'modernfix', 'krypton', 'alternate-current', 'reeses-sodium-options', 'sodium-extra',
  ]),
  beginner: Object.freeze([
    'rei', 'jade', 'appleskin', 'mouse-tweaks', 'controlling',
    'shulkerboxtooltip', 'betterf3',
  ]),
  builder: Object.freeze([
    'litematica', 'minihud', 'lighty', 'item-scroller', 'worldedit',
    'shulkerboxtooltip',
  ]),
  pvp: Object.freeze([
    'better-ping-display-fabric', 'ukus-armor-hud', 'status-effect-bars',
    'appleskin', 'betterhurtcam', 'zoomify', 'controlling',
  ]),
});

const PRESET_LABELS = Object.freeze({
  performance: 'Performance',
  beginner: 'Beginner',
  builder: 'Builder',
  pvp: 'PvP',
});

const PRESET_NOTES = Object.freeze({
  performance: 'A focused optimization stack for smoother play and lower memory use.',
  beginner: 'Helpful client-side guidance and quality-of-life tools without changing core gameplay.',
  builder: 'WorldEdit works in single-player or on servers where you have permission.',
  pvp: 'Client-side combat information only. Check the rules of each server before playing.',
});

function minecraftMinor(gameVersion) {
  const match = String(gameVersion || '').match(/^1\.(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function performanceModsForVersion(gameVersion) {
  const mods = [...SHARED_PERFORMANCE_MODS, ...PRESET_MODS.performance];
  const minor = minecraftMinor(gameVersion);
  if (minor !== null && minor <= 16) mods.push('phosphor');
  else if (minor !== null && minor < 20) mods.push('starlight');
  return [...new Set(mods)];
}

function presetModsForVersion(preset, gameVersion) {
  if (!Object.hasOwn(PRESET_MODS, preset)) return [];
  if (preset === 'performance') return performanceModsForVersion(gameVersion);
  return [...new Set([...SHARED_PERFORMANCE_MODS, ...PRESET_MODS[preset]])];
}

function isModPreset(profile) {
  return Object.hasOwn(PRESET_MODS, profile);
}

module.exports = {
  PRESET_LABELS,
  PRESET_MODS,
  PRESET_NOTES,
  SHARED_PERFORMANCE_MODS,
  isModPreset,
  performanceModsForVersion,
  presetModsForVersion,
};
