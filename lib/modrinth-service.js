'use strict';

const crypto = require('crypto');
const fs = require('fs');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const APP_USER_AGENT = 'PineLauncher/1.3.0 (https://github.com/RealSe62em/Pine-Launcher)';
const modrinthResponseCache = new Map();

function clearModrinthResponseCache() {
  modrinthResponseCache.clear();
}

function fileSha1(filePath) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

async function modrinthFetch(path, { fetchImpl = globalThis.fetch, timeout = 15000, method = 'GET', body = null } = {}) {
  const now = Date.now();
  const cacheKey = `${method}:${path}:${body ? JSON.stringify(body) : ''}`;
  if (method === 'GET') {
    const cached = modrinthResponseCache.get(cacheKey);
    if (cached && cached.expires > now) return cached.promise;
  }

  const promise = (async () => {
    const headers = { 'User-Agent': APP_USER_AGENT };
    if (body) headers['Content-Type'] = 'application/json';
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    };
    if (body) init.body = typeof body === 'string' ? body : JSON.stringify(body);

    let res = await fetchImpl(`${MODRINTH_API}${path}`, init);
    if (res.status === 429) {
      const retryAfter = Math.min(10, Math.max(1, Number.parseInt(res.headers.get('Retry-After'), 10) || 2));
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetchImpl(`${MODRINTH_API}${path}`, init);
    }
    if (!res.ok) throw new Error(`Modrinth ${res.status}: ${res.statusText}`);
    return res.json();
  })();

  if (method === 'GET') {
    modrinthResponseCache.set(cacheKey, { expires: now + (path.startsWith('/search?') ? 10000 : 60000), promise });
    if (modrinthResponseCache.size > 500) modrinthResponseCache.delete(modrinthResponseCache.keys().next().value);
  }

  try {
    return await promise;
  } catch (e) {
    modrinthResponseCache.delete(cacheKey);
    throw e;
  }
}

async function checkModUpdatesBulk(mods, instance, { fetchImpl = globalThis.fetch } = {}) {
  const updates = [];
  const unmatchedMods = [];
  const hashToMod = new Map();

  for (const mod of mods) {
    if (!mod.path || !fs.existsSync(mod.path)) {
      unmatchedMods.push(mod);
      continue;
    }
    const hash = fileSha1(mod.path);
    if (hash) {
      hashToMod.set(hash.toLowerCase(), mod);
    } else {
      unmatchedMods.push(mod);
    }
  }

  if (hashToMod.size > 0 && instance?.gameVersion) {
    try {
      const loaders = instance.loader && instance.loader !== 'vanilla' ? [instance.loader] : [];
      const payload = {
        hashes: Array.from(hashToMod.keys()),
        algorithm: 'sha1',
        game_versions: [instance.gameVersion],
        loaders,
      };
      const response = await modrinthFetch('/version_files/update', {
        fetchImpl,
        method: 'POST',
        body: payload,
      });

      if (response && typeof response === 'object') {
        for (const [hash, latestVersion] of Object.entries(response)) {
          const mod = hashToMod.get(hash.toLowerCase());
          if (!mod) continue;
          hashToMod.delete(hash.toLowerCase());
          if (latestVersion && latestVersion.id && latestVersion.id !== mod.installedVersion) {
            updates.push({
              filename: mod.filename,
              projectId: mod.projectId || latestVersion.project_id,
              title: mod.title,
              currentVersion: mod.installedVersion,
              latestVersion: latestVersion.id,
              latestVersionName: latestVersion.name || latestVersion.id,
            });
          }
        }
      }
    } catch {}
  }

  const remaining = [...unmatchedMods, ...hashToMod.values()];
  return { updates, remaining };
}

module.exports = {
  MODRINTH_API,
  APP_USER_AGENT,
  modrinthFetch,
  checkModUpdatesBulk,
  clearModrinthResponseCache,
  fileSha1,
};
