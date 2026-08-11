'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeMemory, resolveLaunchMemory } = require('../lib/settings');

test('plain memory numbers are interpreted as gigabytes', () => {
  assert.equal(sanitizeMemory('16', '4G'), '16G');
  assert.equal(sanitizeMemory(20, '4G'), '20G');
  assert.equal(sanitizeMemory('512M', '2G'), '512M');
});

test('global memory replaces legacy automatic instance defaults', () => {
  const instance = { minMemory: '2G', maxMemory: '4G' };
  assert.deepEqual(resolveLaunchMemory(instance, { minMemory: '3G', maxMemory: '16G' }), { min: '3G', max: '16G' });
});

test('an explicit instance memory override wins over global memory', () => {
  const instance = { minMemory: '4G', maxMemory: '20G', memoryOverride: true };
  assert.deepEqual(resolveLaunchMemory(instance, { minMemory: '2G', maxMemory: '8G' }), { min: '4G', max: '20G' });
});
