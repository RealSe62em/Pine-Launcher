'use strict';

const fs = require('fs');
const path = require('path');

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
    };
  }

  const curse = readJson(path.join(metadataRoot, 'manifest.json')) || readJson(path.join(gameRoot, 'manifest.json'));
  if (curse?.manifestType === 'minecraftModpack' || curse?.minecraft?.version) {
    const primary = curse.minecraft?.modLoaders?.find(item => item.primary) || curse.minecraft?.modLoaders?.[0];
    const parsed = loaderFromText(primary?.id);
    return { adapter: 'curseforge', source: 'CurseForge', confidence: 'high', evidence: ['manifest.json Minecraft modpack metadata'], name: String(curse.name || path.basename(gameRoot)), gameVersion: String(curse.minecraft?.version || ''), ...parsed };
  }

  const profile = readJson(path.join(metadataRoot, 'profile.json')) || readJson(path.join(gameRoot, 'profile.json'));
  if (profile && (profile.game_version || profile.minecraft_version || profile.loader)) {
    const parsed = loaderFromText(profile.loader || profile.loader_version);
    return { adapter: 'modrinth', source: 'Modrinth App', confidence: 'high', evidence: ['profile.json'], name: pickString([profile], ['name', 'title']) || path.basename(gameRoot), gameVersion: pickString([profile], ['game_version', 'minecraft_version']), loader: parsed.loader, loaderVersion: pickString([profile], ['loader_version']) || parsed.loaderVersion };
  }

  const candidates = ['instance.json', 'instanceData.json', 'config.json'].map(name => ({ name, value: readJson(path.join(metadataRoot, name)) || readJson(path.join(gameRoot, name)) })).filter(item => item.value);
  if (candidates.length) {
    const objects = candidates.map(item => item.value);
    const combinedLoader = pickString(objects, ['loader', 'modloader', 'modLoader', 'loaderType', 'type']);
    const parsed = loaderFromText(combinedLoader);
    const hinted = /gdlauncher/i.test(hint) ? 'GDLauncher' : /atlauncher/i.test(hint) ? 'ATLauncher' : /technic/i.test(hint) ? 'Technic Launcher' : hint || 'Launcher instance';
    return {
      adapter: hinted.toLowerCase().replace(/[^a-z0-9]+/g, '-'), source: hinted, confidence: hint ? 'high' : 'medium',
      evidence: candidates.map(item => item.name), name: pickString(objects, ['name', 'title', 'instanceName', 'packName']) || path.basename(gameRoot),
      gameVersion: pickString(objects, ['minecraftVersion', 'minecraft_version', 'gameVersion', 'game_version', 'version']),
      loader: parsed.loader, loaderVersion: pickString(objects, ['loaderVersion', 'loader_version', 'modloaderVersion']) || parsed.loaderVersion,
    };
  }

  return { adapter: 'minecraft-folder', source: hint || 'Minecraft folder', confidence: 'medium', evidence: ['Minecraft data folders or files'], name: path.basename(gameRoot), gameVersion: '', loader: 'vanilla', loaderVersion: null };
}

module.exports = { inspectLauncherMetadata, loaderFromText, readProperties };
