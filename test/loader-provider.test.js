'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoaderProviderRegistry } = require('../lib/loader-provider');
const { createNeoForgeProvider } = require('../lib/neoforge-provider');

const operation = () => true;

test('loader providers expose one complete lifecycle boundary', () => {
  const provider = createNeoForgeProvider({ prepare: operation, health: operation, remove: operation });
  const registry = createLoaderProviderRegistry([provider]);
  assert.deepEqual(registry.ids(), ['neoforge']);
  assert.equal(registry.get('NeoForge').displayName, 'NeoForge');
  assert.equal(registry.get('neoforge').validateSelection({ gameVersion: '1.21.1', loaderVersion: '21.1.200' }).valid, true);
  assert.equal(registry.get('neoforge').validateSelection({ gameVersion: '1.21', loaderVersion: '21.1.200' }).valid, false);
});

test('provider registry rejects partial and duplicate implementations', () => {
  assert.throws(() => createLoaderProviderRegistry([{ id: 'broken' }]), /missing validateSelection/);
  const provider = createNeoForgeProvider({ prepare: operation, health: operation, remove: operation });
  assert.throws(() => createLoaderProviderRegistry([provider, provider]), /Duplicate/);
});
