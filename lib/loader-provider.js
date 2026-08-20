'use strict';

function createLoaderProvider(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('Loader provider definition is required');
  const id = String(definition.id || '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Loader provider ID is invalid');
  for (const operation of ['validateSelection', 'prepare', 'health', 'remove']) {
    if (typeof definition[operation] !== 'function') throw new Error(`${id} provider is missing ${operation}`);
  }
  return Object.freeze({
    id,
    displayName: String(definition.displayName || id),
    validateSelection: definition.validateSelection,
    prepare: definition.prepare,
    health: definition.health,
    remove: definition.remove,
  });
}

function createLoaderProviderRegistry(providers = []) {
  const entries = new Map();
  for (const provider of providers) {
    const normalized = createLoaderProvider(provider);
    if (entries.has(normalized.id)) throw new Error(`Duplicate loader provider: ${normalized.id}`);
    entries.set(normalized.id, normalized);
  }
  return Object.freeze({
    get(id) { return entries.get(String(id || '').toLowerCase()) || null; },
    has(id) { return entries.has(String(id || '').toLowerCase()); },
    ids() { return [...entries.keys()]; },
  });
}

module.exports = { createLoaderProvider, createLoaderProviderRegistry };
