'use strict';

const fs = require('fs');
const path = require('path');
const { detectJarLoaders } = require('./mod-compatibility');

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function readProperties(file) {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => {
      const index = line.indexOf('=');
      return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : null;
    }).filter(Boolean));
  } catch { return {}; }
}

function loaderFromText(value) {
  const text = String(value || '').toLowerCase();
  const match = text.match(/(neoforge|fabric|quilt|forge)[-_: ]?([0-9][a-z0-9+_.-]*)?/i);
  return match ? { loader: match[1].toLowerCase(), loaderVersion: match[2] || '' } : { loader: 'vanilla', loaderVersion: null };
}

function pickString(objects, keys) {
  for (const object of objects) for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const GAME_MARKERS = Object.freeze(['options.txt', 'servers.dat', 'saves', 'mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'screenshots']);
const METADATA_MARKERS = Object.freeze(['mmc-pack.json', 'instance.cfg', 'manifest.json', 'profile.json', 'instance.json', 'instanceData.json', 'minecraftinstance.json', 'modpack.json']);

function resolveGameRoot(metadataRoot) {
  const root = path.resolve(metadataRoot);
  const score = candidate => GAME_MARKERS.reduce((total, marker) => total + (fs.existsSync(path.join(candidate, marker)) ? 1 : 0), 0);
  const candidates = [root, ...['.minecraft', 'minecraft', 'game'].map(name => path.join(root, name)).filter(candidate => {
    try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
  })];
  let selected = root;
  let selectedScore = score(root);
  for (const candidate of candidates.slice(1)) {
    const candidateScore = score(candidate);
    if (candidateScore > selectedScore) {
      selected = candidate;
      selectedScore = candidateScore;
    }
  }
  return selected;
}

function resolveMetadataRoot(selectedRoot, gameRoot = resolveGameRoot(selectedRoot)) {
  const selected = path.resolve(selectedRoot);
  const game = path.resolve(gameRoot);
  const hasMetadata = candidate => METADATA_MARKERS.some(marker => fs.existsSync(path.join(candidate, marker)));
  if (hasMetadata(selected)) return selected;
  const parent = path.dirname(game);
  if (parent !== game && hasMetadata(parent)) return parent;
  return selected;
}

function readTail(file, maximum = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return '';
    const length = Math.min(stat.size, maximum);
    const buffer = Buffer.alloc(length);
    const handle = fs.openSync(file, 'r');
    try { fs.readSync(handle, buffer, 0, length, stat.size - length); }
    finally { fs.closeSync(handle); }
    return buffer.toString('utf8');
  } catch { return ''; }
}

function inspectLogMetadata(gameRoot) {
  const logs = ['latest.log', 'debug.log'].map(name => path.join(gameRoot, 'logs', name));
  for (const file of logs) {
    const text = readTail(file);
    if (!text) continue;
    let match = text.match(/Loading Minecraft\s+([0-9][a-z0-9+_.-]*)\s+with Fabric Loader\s+([0-9][a-z0-9+_.-]*)/i);
    if (match) return { gameVersion: match[1], loader: 'fabric', loaderVersion: match[2], evidence: ['Minecraft log'] };
    match = text.match(/Loading Minecraft\s+([0-9][a-z0-9+_.-]*)\s+with Quilt Loader\s+([0-9][a-z0-9+_.-]*)/i);
    if (match) return { gameVersion: match[1], loader: 'quilt', loaderVersion: match[2], evidence: ['Minecraft log'] };
    match = text.match(/Loading NeoForge\s+([0-9][a-z0-9+_.-]*)\s+for Minecraft\s+([0-9][a-z0-9+_.-]*)/i);
    if (match) return { gameVersion: match[2], loader: 'neoforge', loaderVersion: match[1], evidence: ['Minecraft log'] };
    match = text.match(/Forge Mod Loader version\s+([0-9][a-z0-9+_.-]*)\s+for Minecraft\s+([0-9][a-z0-9+_.-]*)/i);
    if (match) return { gameVersion: match[2], loader: 'forge', loaderVersion: match[1], evidence: ['Minecraft log'] };
  }
  return null;
}

function inspectInstalledProfiles(gameRoot) {
  const versions = path.join(gameRoot, 'versions');
  let entries = [];
  try { entries = fs.readdirSync(versions, { withFileTypes: true }).filter(entry => entry.isDirectory()).slice(0, 200); }
  catch { return null; }
  const profiles = [];
  for (const entry of entries) {
    const file = path.join(versions, entry.name, `${entry.name}.json`);
    const profile = readJson(file);
    if (!profile) continue;
    const gameVersion = String(profile.inheritsFrom || '').trim();
    if (!gameVersion) continue;
    const libraries = Array.isArray(profile.libraries) ? profile.libraries.map(item => String(item?.name || '')) : [];
    let loader = 'vanilla';
    let loaderVersion = null;
    for (const library of libraries) {
      let match = library.match(/^net\.fabricmc:fabric-loader:(.+)$/i);
      if (match) { loader = 'fabric'; loaderVersion = match[1]; break; }
      match = library.match(/^org\.quiltmc:quilt-loader:(.+)$/i);
      if (match) { loader = 'quilt'; loaderVersion = match[1]; break; }
      match = library.match(/^net\.minecraftforge:forge:(.+)$/i);
      if (match) { loader = 'forge'; loaderVersion = match[1].replace(new RegExp(`^${gameVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), ''); break; }
      match = library.match(/^net\.neoforged:neoforge:(.+)$/i);
      if (match) { loader = 'neoforge'; loaderVersion = match[1]; break; }
    }
    if (loader === 'vanilla') continue;
    let modified = 0;
    try { modified = fs.statSync(file).mtimeMs; } catch {}
    profiles.push({ gameVersion, loader, loaderVersion, modified, evidence: ['installed loader profile'] });
  }
  return profiles.sort((left, right) => right.modified - left.modified)[0] || null;
}

function inferLoaderFromMods(gameRoot) {
  const mods = path.join(gameRoot, 'mods');
  let files = [];
  try { files = fs.readdirSync(mods, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar')).slice(0, 96); }
  catch { return null; }
  const counts = new Map();
  for (const entry of files) for (const loader of detectJarLoaders(path.join(mods, entry.name), entry.name)) counts.set(loader, (counts.get(loader) || 0) + 1);
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1])) return null;
  return { loader: ranked[0][0], loaderVersion: null, evidence: ['mod JAR metadata'] };
}

function inspectRuntimeMetadata(gameRoot) {
  const exact = inspectLogMetadata(gameRoot) || inspectInstalledProfiles(gameRoot);
  if (exact) return exact;
  return inferLoaderFromMods(gameRoot);
}

function inspectLauncherMetadata(metadataRoot, gameRoot, hint = '') {
  const mmc = readJson(path.join(metadataRoot, 'mmc-pack.json')) || readJson(path.join(gameRoot, 'mmc-pack.json'));
  const cfg = readProperties(path.join(metadataRoot, 'instance.cfg'));
  if (Array.isArray(mmc?.components)) {
    const component = uid => mmc.components.find(item => item.uid === uid);
    const loaders = [
      ['fabric', component('net.fabricmc.fabric-loader')], ['quilt', component('org.quiltmc.quilt-loader')],
      ['forge', component('net.minecraftforge')], ['neoforge', component('net.neoforged')],
    ];
    const found = loaders.find(([, value]) => value);
    return {
      adapter: 'multimc', source: /prism/i.test(hint) ? 'Prism Launcher' : /multimc/i.test(hint) ? 'MultiMC' : 'Prism or MultiMC',
      confidence: 'high', evidence: ['mmc-pack.json components', ...(Object.keys(cfg).length ? ['instance.cfg'] : [])],
      name: cfg.name || path.basename(metadataRoot), gameVersion: String(component('net.minecraft')?.version || ''),
      loader: found?.[0] || 'vanilla', loaderVersion: found ? String(found[1].version || '') : null,
      versionDetected: Boolean(component('net.minecraft')?.version), loaderDetected: true,
    };
  }

  const curse = readJson(path.join(metadataRoot, 'manifest.json')) || readJson(path.join(gameRoot, 'manifest.json'));
  if (curse?.manifestType === 'minecraftModpack' || curse?.minecraft?.version) {
    const primary = curse.minecraft?.modLoaders?.find(item => item.primary) || curse.minecraft?.modLoaders?.[0];
    const parsed = loaderFromText(primary?.id);
    return { adapter: 'curseforge', source: 'CurseForge', confidence: 'high', evidence: ['manifest.json Minecraft modpack metadata'], name: String(curse.name || path.basename(gameRoot)), gameVersion: String(curse.minecraft?.version || ''), ...parsed, versionDetected: Boolean(curse.minecraft?.version), loaderDetected: Boolean(primary?.id) };
  }

  const profile = readJson(path.join(metadataRoot, 'profile.json')) || readJson(path.join(gameRoot, 'profile.json'));
  if (profile && (profile.game_version || profile.minecraft_version || profile.loader)) {
    const parsed = loaderFromText(profile.loader || profile.loader_version);
    const profileGameVersion = pickString([profile], ['game_version', 'minecraft_version']);
    return { adapter: 'modrinth', source: 'Modrinth App', confidence: 'high', evidence: ['profile.json'], name: pickString([profile], ['name', 'title']) || path.basename(gameRoot), gameVersion: profileGameVersion, loader: parsed.loader, loaderVersion: pickString([profile], ['loader_version']) || parsed.loaderVersion, versionDetected: Boolean(profileGameVersion), loaderDetected: Boolean(profile.loader || profile.loader_version) };
  }

  const candidates = ['instance.json', 'instanceData.json', 'instance_data.json', 'minecraftinstance.json', 'modpack.json', 'config.json']
    .map(name => ({ name, value: readJson(path.join(metadataRoot, name)) || readJson(path.join(gameRoot, name)) }))
    .filter(item => item.value);
  if (candidates.length) {
    const roots = candidates.map(item => item.value);
    const objects = roots.flatMap(value => [value, value.instance, value.minecraft, value.game, value.pack, value.modpack].filter(item => item && typeof item === 'object'));
    const combinedLoader = pickString(objects, ['loader', 'modloader', 'modLoader', 'loaderType', 'type']);
    const parsed = loaderFromText(combinedLoader);
    const runtime = inspectRuntimeMetadata(gameRoot);
    const hinted = /gdlauncher/i.test(hint) ? 'GDLauncher' : /atlauncher/i.test(hint) ? 'ATLauncher' : /technic/i.test(hint) ? 'Technic Launcher' : hint || 'Launcher instance';
    const candidateGameVersion = pickString(objects, ['minecraftVersion', 'minecraft_version', 'gameVersion', 'game_version', 'version']) || runtime?.gameVersion || '';
    const detectedLoader = combinedLoader ? parsed.loader : runtime?.loader || 'vanilla';
    return {
      adapter: hinted.toLowerCase().replace(/[^a-z0-9]+/g, '-'), source: hinted, confidence: hint ? 'high' : 'medium',
      evidence: [...candidates.map(item => item.name), ...(runtime?.evidence || [])], name: pickString(objects, ['name', 'title', 'instanceName', 'packName']) || path.basename(gameRoot),
      gameVersion: candidateGameVersion,
      loader: detectedLoader, loaderVersion: pickString(objects, ['loaderVersion', 'loader_version', 'modloaderVersion']) || parsed.loaderVersion || runtime?.loaderVersion || null,
      versionDetected: Boolean(candidateGameVersion), loaderDetected: Boolean(combinedLoader || runtime?.loader),
    };
  }

  const runtime = inspectRuntimeMetadata(gameRoot);
  if (runtime) {
    return {
      adapter: 'minecraft-runtime', source: hint || 'Minecraft folder', confidence: runtime.gameVersion ? 'high' : 'medium',
      evidence: runtime.evidence, name: path.basename(metadataRoot), gameVersion: runtime.gameVersion || '', loader: runtime.loader || 'vanilla',
      loaderVersion: runtime.loaderVersion || null, versionDetected: Boolean(runtime.gameVersion), loaderDetected: Boolean(runtime.loader),
    };
  }

  return { adapter: 'minecraft-folder', source: hint || 'Minecraft folder', confidence: 'medium', evidence: ['Minecraft data folders or files'], name: path.basename(gameRoot), gameVersion: '', loader: 'vanilla', loaderVersion: null, versionDetected: false, loaderDetected: false };
}

module.exports = { GAME_MARKERS, inspectLauncherMetadata, inspectRuntimeMetadata, loaderFromText, readProperties, resolveGameRoot, resolveMetadataRoot };
