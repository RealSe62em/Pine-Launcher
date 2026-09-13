'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESET_MODS,
  SHARED_PERFORMANCE_MODS,
  performanceModsForVersion,
  presetModsForVersion,
} = require('../lib/performance-preset');

test('performance candidates use the maintained optimization core', () => {
  const modern = performanceModsForVersion('1.21.11');
  assert.ok(modern.includes('modernfix'));
  assert.ok(modern.includes('lithium'));
  assert.ok(modern.includes('sodium-extra'));
  assert.ok(!modern.includes('lazydfu'));
  assert.ok(!modern.includes('memoryleakfix'));
  assert.ok(!modern.includes('no-chat-reports'));
});

test('legacy lighting candidates never install competing lighting engines together', () => {
  const legacy = performanceModsForVersion('1.19.4');
  assert.ok(legacy.includes('starlight'));
  assert.ok(!legacy.includes('phosphor'));
  assert.ok(performanceModsForVersion('1.16.5').includes('phosphor'));
  assert.equal(new Set(legacy).size, legacy.length);
});

test('curated presets combine their own utilities with the shared performance base', () => {
  for (const preset of ['beginner', 'builder', 'pvp']) {
    const mods = presetModsForVersion(preset, '1.21.11');
    assert.ok(mods.includes('sodium'));
    assert.ok(mods.includes('lithium'));
    assert.ok(PRESET_MODS[preset].every(mod => mods.includes(mod)));
    assert.equal(new Set(mods).size, mods.length);
  }
  assert.ok(SHARED_PERFORMANCE_MODS.includes('immediatelyfast'));
  assert.deepEqual(presetModsForVersion('unknown', '1.21.11'), []);
});
