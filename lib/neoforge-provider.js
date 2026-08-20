'use strict';

const { isNeoForgeVersionForMinecraft, validateNeoForgeProfile } = require('./neoforge');

function createNeoForgeProvider(operations) {
  const required = ['prepare', 'health', 'remove'];
  for (const name of required) if (typeof operations?.[name] !== 'function') throw new Error(`NeoForge operation ${name} is required`);
  return {
    id: 'neoforge',
    displayName: 'NeoForge',
    validateSelection(instance) {
      const gameVersion = String(instance?.gameVersion || '');
      const loaderVersion = String(instance?.loaderVersion || '');
      return isNeoForgeVersionForMinecraft(loaderVersion, gameVersion)
        ? { valid: true, errors: [] }
        : { valid: false, errors: [`NeoForge ${loaderVersion || 'version'} is not for Minecraft ${gameVersion || 'version'}`] };
    },
    validateProfile: validateNeoForgeProfile,
    prepare: operations.prepare,
    health: operations.health,
    remove: operations.remove,
  };
}

module.exports = { createNeoForgeProvider };
