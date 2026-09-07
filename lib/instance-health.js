'use strict';
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { findDuplicateModIds, findLoaderIncompatibleMods, findKnownBrokenMods, readFabricMetadata, readModIds } = require('./mod-compatibility');
const { memoryMegabytes, resolveLaunchMemory } = require('./settings');
function inspectInstanceHealth(root, instance, settings = {}, { javaMajor = null, requiredJava = null, totalMemory = null } = {}) {
  const issues = [];
  const add = (code, title, detail, action, severity = 'warning') => issues.push({ code, title, detail, action, severity });
  if (!fs.existsSync(root)) add('missing-root', 'Instance folder unavailable', 'Reconnect its drive or choose the correct instance location.', 'settings', 'error');
  const modsDir = path.join(root, 'mods');
  for (const duplicate of findDuplicateModIds(modsDir)) add('duplicate', `Duplicate mod: ${duplicate.id}`, duplicate.entries.map(item => item.filename).join(', '), 'content');
  for (const mod of findLoaderIncompatibleMods(modsDir, instance.loader)) add('loader', `${mod.filename} may target another loader`, mod.reason, 'content');
  for (const mod of findKnownBrokenMods(modsDir, instance.gameVersion)) add('known-broken', `${mod.filename} has a known issue`, `${mod.reason} Suggested replacement: ${mod.replacement}`, 'content');
  let files = [];
  try { files = fs.readdirSync(modsDir).filter(file => file.endsWith('.jar')); } catch {}
  const ids = new Set(files.flatMap(file => readModIds(path.join(modsDir, file))));
  // Dependencies can be supplied by nested Fabric API modules or aliases.
  // Read only declared nested archives, with a bounded expansion budget.
  let nestedBytes = 0, nestedCount = 0;
  const collectNested = (archive, depth = 0) => {
    if (depth > 8) return;
    try {
      const entry = archive.getEntry('fabric.mod.json');
      if (!entry || entry.header.size > 1024 * 1024) return;
      const metadata = JSON.parse(entry.getData().toString('utf8'));
      for (const id of [metadata.id, ...(metadata.provides || [])]) if (typeof id === 'string') ids.add(id);
      for (const item of metadata.jars || []) {
        const nested = archive.getEntry(item.file);
        if (!nested || nested.header.size > 32 * 1024 * 1024 || ++nestedCount > 256) continue;
        nestedBytes += nested.header.size;
        if (nestedBytes > 128 * 1024 * 1024) continue;
        collectNested(new AdmZip(nested.getData()), depth + 1);
      }
    } catch {}
  };
  if (['fabric', 'quilt'].includes(instance.loader)) for (const file of files) { try { collectNested(new AdmZip(path.join(modsDir, file))); } catch {} }
  const builtins = new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge']);
  for (const file of files) {
    const metadata = readFabricMetadata(path.join(modsDir, file));
    if (!metadata || !['fabric', 'quilt'].includes(instance.loader)) continue;
    for (const dependency of Object.keys(metadata.depends || {})) {
      if (!builtins.has(dependency) && !ids.has(dependency)) add('dependency', `${metadata.name || metadata.id} needs ${dependency}`, `Required version: ${JSON.stringify(metadata.depends[dependency])}. Install or enable this dependency.`, 'content');
    }
  }
  const memory = resolveLaunchMemory(instance, settings);
  const min = memoryMegabytes(memory.min); const max = memoryMegabytes(memory.max);
  if (!min || !max || min > max) add('memory', 'Memory settings are invalid', 'Set a minimum that does not exceed the maximum.', 'settings', 'error');
  else if (totalMemory && max * 1024 ** 2 > totalMemory * 0.75) add('memory', 'Minecraft is using most of your RAM', 'Leave memory for the operating system and other applications.', 'settings');
  if (javaMajor && requiredJava && javaMajor < requiredJava) add('java', `Java ${requiredJava} or newer is required`, `The configured runtime is Java ${javaMajor}. Select a compatible runtime or clear the custom Java path.`, 'settings');
  return { instanceName: instance.name, checkedAt: new Date().toISOString(), issues, healthy: !issues.length, inspectedMods: files.length, javaMajor, requiredJava, memory };
}
module.exports = { inspectInstanceHealth };
