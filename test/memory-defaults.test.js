'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planDefaultMemoryMigration } = require('../lib/memory-defaults');
const { resolveLaunchMemory } = require('../lib/settings');

test('default memory migration preserves existing effective allocations', () => {
  const oldSettings = { minMemory: '2G', maxMemory: '4G' };
  const existing = [
    { name: 'Inherited defaults', memoryOverride: false },
    { name: 'Custom', memoryOverride: true, minMemory: '6G', maxMemory: '10G' },
  ];
  const migration = planDefaultMemoryMigration(oldSettings, existing);

  assert.deepEqual(resolveLaunchMemory(migration.instances[0], migration.settings), { min: '2G', max: '4G' });
  assert.deepEqual(resolveLaunchMemory(migration.instances[1], migration.settings), { min: '6G', max: '10G' });
  assert.equal(migration.settings.minMemory, '4G');
  assert.equal(migration.settings.maxMemory, '4G');
  assert.equal(migration.settings.defaultMemoryVersion, 2);
});

test('custom global memory is preserved while existing instances are frozen to it', () => {
  const migration = planDefaultMemoryMigration(
    { minMemory: '3G', maxMemory: '8G' },
    [{ name: 'Existing', memoryOverride: false }],
  );
  assert.equal(migration.settings.minMemory, '3G');
  assert.equal(migration.settings.maxMemory, '8G');
  assert.deepEqual(resolveLaunchMemory(migration.instances[0], migration.settings), { min: '3G', max: '8G' });
});

test('completed memory migration is idempotent', () => {
  const settings = { minMemory: '4G', maxMemory: '4G', defaultMemoryVersion: 2 };
  const instances = [{ name: 'New', memoryOverride: false, minMemory: '4G', maxMemory: '4G' }];
  const migration = planDefaultMemoryMigration(settings, instances);
  assert.equal(migration.changed, false);
  assert.equal(migration.settings, settings);
  assert.equal(migration.instances, instances);
});
