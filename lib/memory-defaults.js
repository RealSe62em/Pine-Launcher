'use strict';

const { sanitizeMemory, memoryMegabytes } = require('./settings');

const DEFAULT_MEMORY_VERSION = 2;
const DEFAULT_MIN_MEMORY = '4G';
const DEFAULT_MAX_MEMORY = '4G';

function planDefaultMemoryMigration(settings = {}, instances = []) {
  if (Number(settings.defaultMemoryVersion) >= DEFAULT_MEMORY_VERSION) {
    return { settings, instances, changed: false };
  }

  const oldMin = sanitizeMemory(settings.minMemory, '2G');
  const oldMaxCandidate = sanitizeMemory(settings.maxMemory, '4G');
  const oldMax = memoryMegabytes(oldMaxCandidate) >= memoryMegabytes(oldMin) ? oldMaxCandidate : oldMin;
  const migratedInstances = instances.map(instance => instance.memoryOverride === true ? instance : {
    ...instance,
    minMemory: oldMin,
    maxMemory: oldMax,
    memoryOverride: true,
  });
  const migratedSettings = { ...settings, defaultMemoryVersion: DEFAULT_MEMORY_VERSION };

  // Only replace Pine's old untouched defaults. User-chosen global defaults remain intact.
  if (oldMin === '2G' && oldMax === '4G') {
    migratedSettings.minMemory = DEFAULT_MIN_MEMORY;
    migratedSettings.maxMemory = DEFAULT_MAX_MEMORY;
  }

  return { settings: migratedSettings, instances: migratedInstances, changed: true };
}

module.exports = {
  DEFAULT_MEMORY_VERSION,
  DEFAULT_MIN_MEMORY,
  DEFAULT_MAX_MEMORY,
  planDefaultMemoryMigration,
};
