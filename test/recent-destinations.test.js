'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDestinationCatalog } = require('../lib/recent-destinations');

const world = (instanceId, identifier, extra = {}) => ({
  type: 'singleplayer',
  identifier,
  key: `world:${identifier.toLowerCase()}`,
  instanceId,
  instanceName: instanceId,
  label: identifier,
  launches: 2,
  ...extra,
});

test('partial destination refreshes preserve entries belonging to unscanned instances', () => {
  const existing = [world('healthy', 'Old world'), world('failed', 'Kept world'), world('deleted', 'Archived world')];
  const live = [world('healthy', 'New world')];
  const registry = [{ id: 'healthy' }, { id: 'failed' }];
  const merged = mergeDestinationCatalog(existing, live, registry, new Set(['healthy']));

  assert.deepEqual(merged.map(item => item.identifier), ['New world', 'Kept world', 'Archived world']);
  assert.equal(merged.find(item => item.identifier === 'Kept world').deletedInstance, false);
  assert.equal(merged.find(item => item.identifier === 'Archived world').deletedInstance, true);
  assert.equal(merged.some(item => item.identifier === 'Old world'), false);
});

test('destination refreshes retain custom labels without duplicating live entries', () => {
  const existing = [world('main', 'World', { customLabel: 'My base', label: 'My base' })];
  const live = [world('main', 'World', { label: 'World' }), world('main', 'World', { label: 'Duplicate' })];
  const merged = mergeDestinationCatalog(existing, live, [{ id: 'main' }], new Set(['main']));

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, 'My base');
  assert.equal(merged[0].customLabel, 'My base');
});
