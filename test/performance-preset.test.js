'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performanceModsForVersion } = require('../lib/performance-preset');

test('performance candidates keep questionable mods visible for compatibility inspection', () => {
  const modern = performanceModsForVersion('1.21.11');
  assert.ok(modern.includes('modernfix'));
  assert.ok(modern.includes('lazydfu'));
  assert.ok(modern.includes('sodium-extra'));
});

test('performance candidates include legacy-only optimization projects on older Minecraft', () => {
  const legacy = performanceModsForVersion('1.19.4');
  assert.ok(legacy.includes('phosphor'));
  assert.ok(legacy.includes('starlight'));
  assert.equal(new Set(legacy).size, legacy.length);
});
