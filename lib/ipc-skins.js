// ── Skins & Wardrobe IPC ──────────────────────────────────────
// Player skin lookup, community skin browsing, import, and cape selection.
// ─────────────────────────────────────────────────────────────

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { dialog } = require('electron');
const { validateSkinPng } = require('./pine-studio');
const { applyCapeSelection, mergeCapeInventory } = require('./cape-inventory');
const { activeLocalSkin, removeLocalSkin, setActiveLocalSkin } = require('./local-skin');

function registerSkinsIPC({
  ipcMain,
  app,
  getMainWindow,
  portableFetch,
  writeJSON,
  readAuth,
  SKINS_DIR,
  SKINS_FILE,
  skinAccountKey,
  readSkinLibrary,
  publicSkinRecord,
  minecraftProfileFor,
  remoteImageData,
  uploadMinecraftSkin,
  refreshMicrosoftAuth,
  minecraftUiTextures,
}) {
  const playerSkinLookupCache = new Map();
  const publicSkinDirectoryCache = new Map();

  async function getSkinLibraryPayload() {
    const auth = readAuth();
    const library = readSkinLibrary();
    const account = skinAccountKey(auth);
    const saved = (library.accounts[account] || []).filter(item => item && item.file).map(publicSkinRecord);
    let profile = null;
    let capeSyncError = '';
    try {
      profile = await minecraftProfileFor(auth);
    } catch (error) {
      capeSyncError = error?.message || String(error);
    }
    const cachedCapes = Array.isArray(library.capes[account]) ? library.capes[account] : [];
    const ownedCapes = profile ? mergeCapeInventory(cachedCapes, profile.capes) : mergeCapeInventory(cachedCapes, cachedCapes);
    if (profile) {
      library.capes[account] = ownedCapes;
      writeJSON(SKINS_FILE, library);
    }
    const capes = await Promise.all(ownedCapes.map(async cape => ({ ...cape, data: await remoteImageData(cape.url) })));
    const rawActive = auth?.meta?.type === 'offline'
      ? activeLocalSkin(library, account)
      : (profile?.skins?.find(item => item.state === 'ACTIVE') || null);
    const activeSkin = rawActive
      ? (rawActive.file ? publicSkinRecord(rawActive) : rawActive)
      : null;
    return {
      account: auth ? { name: auth.profile.name, type: auth.meta?.type === 'offline' ? 'offline' : 'microsoft' } : null,
      canApply: Boolean(auth?.profile),
      canManageCapes: Boolean(auth?.access_token && auth?.meta?.type !== 'offline'),
      applyMode: auth?.meta?.type === 'offline' ? 'local' : 'minecraft',
      saved,
      activeSkin,
      capes,
      capeSyncError,
    };
  }

  ipcMain.handle('lookup-player-skin', async (_, value) => {
    const username = String(value || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Enter a valid Minecraft Java username');
    const key = username.toLowerCase();
    const cached = playerSkinLookupCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const headers = { Accept: 'application/json', 'User-Agent': `PineLauncher/${app.getVersion()} (player skin lookup)` };
    let identity = null;
    for (const url of [
      `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(username)}`,
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    ]) {
      const response = await portableFetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (response.status === 429) throw new Error('Minecraft is rate-limiting player searches. Try again shortly.');
      if (!response.ok) continue;
      const candidate = await response.json();
      const id = String(candidate?.id || '').replace(/-/g, '');
      if (/^[a-f0-9]{32}$/i.test(id)) { identity = { id, name: String(candidate?.name || username).slice(0, 16) }; break; }
    }
    if (!identity) throw new Error(`No Minecraft Java player named ${username} was found`);
    const profileResponse = await portableFetch(`https://sessionserver.mojang.com/session/minecraft/profile/${identity.id}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (profileResponse.status === 429) throw new Error('Minecraft is rate-limiting skin lookups. Try again shortly.');
    if (!profileResponse.ok) throw new Error(`Could not load ${identity.name}'s Minecraft profile`);
    const profile = await profileResponse.json();
    const textureProperty = (Array.isArray(profile?.properties) ? profile.properties : []).find(property => property?.name === 'textures' && typeof property?.value === 'string');
    if (!textureProperty || textureProperty.value.length > 100_000) throw new Error(`${identity.name} does not have a public skin texture`);
    let payload;
    try { payload = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8')); }
    catch { throw new Error(`Could not read ${identity.name}'s skin texture`); }
    const rawUrl = String(payload?.textures?.SKIN?.url || '');
    let textureUrl;
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'textures.minecraft.net' || !/^\/texture\/[a-f0-9]{32,128}$/i.test(parsed.pathname)) throw new Error();
      parsed.protocol = 'https:';
      parsed.port = '';
      parsed.search = '';
      parsed.hash = '';
      textureUrl = parsed.toString();
    } catch { throw new Error(`${identity.name} does not have a usable Minecraft skin`); }
    const result = {
      id: `player-${identity.id}`, shortId: identity.id.slice(0, 8), name: String(profile?.name || identity.name).slice(0, 16),
      textureUrl, variant: payload?.textures?.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic',
      player: true, uuid: identity.id, source: 'Minecraft profile',
    };
    playerSkinLookupCache.set(key, { expires: Date.now() + 5 * 60_000, value: result });
    while (playerSkinLookupCache.size > 100) playerSkinLookupCache.delete(playerSkinLookupCache.keys().next().value);
    return result;
  });

  ipcMain.handle('browse-skin-library', async (_, options = {}) => {
    const after = /^[a-f0-9]{32}$/i.test(String(options.after || '')) ? String(options.after) : '';
    const size = Math.min(32, Math.max(8, Number.parseInt(options.size, 10) || 20));
    const key = `${size}:${after}`;
    const cached = publicSkinDirectoryCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const params = new URLSearchParams({ size: String(size) });
    if (after) params.set('after', after);
    const response = await portableFetch(`https://api.mineskin.org/v2/skins?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': `PineLauncher/${app.getVersion()} (skin browser)` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`MineSkin returned HTTP ${response.status}`);
    const body = await response.json();
    const skins = (Array.isArray(body?.skins) ? body.skins : []).flatMap(item => {
      const uuid = String(item?.uuid || '').replace(/-/g, '');
      const texture = String(item?.texture || '');
      if (!/^[a-f0-9]{32}$/i.test(uuid) || !/^[a-f0-9]{32,128}$/i.test(texture)) return [];
      const shortId = String(item?.shortId || uuid.slice(0, 8)).replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
      const suppliedName = String(item?.name || '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      return [{
        id: uuid, shortId,
        name: suppliedName || 'MineSkin skin',
        textureUrl: `https://textures.minecraft.net/texture/${texture}`,
        timestamp: Number(item?.timestamp) || 0,
        source: 'MineSkin',
      }];
    });
    const next = String(body?.pagination?.next?.after || '').replace(/-/g, '');
    const value = { skins, next: /^[a-f0-9]{32}$/i.test(next) ? next : '' };
    publicSkinDirectoryCache.set(key, { expires: Date.now() + 15 * 60_000, value });
    while (publicSkinDirectoryCache.size > 80) publicSkinDirectoryCache.delete(publicSkinDirectoryCache.keys().next().value);
    return value;
  });

  ipcMain.handle('save-library-skin', async (_, input, variant = 'classic', apply = false) => {
    const parsed = new URL(String(input?.textureUrl || ''));
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'textures.minecraft.net' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/texture\/[a-f0-9]{32,128}$/i.test(parsed.pathname)) throw new Error('Invalid community skin texture');
    const response = await portableFetch(parsed.toString(), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Could not download skin (HTTP ${response.status})`);
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > 1024 * 1024) throw new Error('Skin file is too large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 1024 * 1024) throw new Error('Skin file is too large');
    validateSkinPng(buffer);
    const auth = readAuth();
    const account = skinAccountKey(auth);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
    const relative = path.join(account, `${hash}.png`);
    const absolute = path.join(SKINS_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    const library = readSkinLibrary();
    const rows = library.accounts[account] || [];
    const record = {
      id: hash, file: relative,
      name: String(input?.name || `Community skin ${hash.slice(0, 8)}`).replace(/[\r\n\0]+/g, ' ').trim().slice(0, 80),
      variant: variant === 'slim' ? 'slim' : 'classic', addedAt: new Date().toISOString(), source: 'MineSkin',
    };
    library.accounts[account] = [record, ...rows.filter(item => item.id !== hash)].slice(0, 256);
    writeJSON(SKINS_FILE, library);
    if (apply) {
      if (!auth?.profile) throw new Error('Select an account before applying a skin');
      if (auth.meta?.type === 'offline') setActiveLocalSkin(library, account, record.id);
      else await uploadMinecraftSkin(auth, buffer, record.variant);
      writeJSON(SKINS_FILE, library);
    }
    return { ...publicSkinRecord(record), appliedMode: apply ? (auth?.meta?.type === 'offline' ? 'local' : 'minecraft') : null };
  });

  ipcMain.handle('get-skin-library', async () => {
    return getSkinLibraryPayload();
  });

  ipcMain.handle('get-minecraft-ui-textures', () => minecraftUiTextures());

  ipcMain.handle('import-skin', async (_, variant = 'classic', apply = false) => {
    const mainWindow = getMainWindow();
    const picked = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Minecraft skin', properties: ['openFile'], filters: [{ name: 'Minecraft skin', extensions: ['png'] }] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const buffer = fs.readFileSync(picked.filePaths[0]);
    validateSkinPng(buffer);
    const auth = readAuth();
    const account = skinAccountKey(auth);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
    const relative = path.join(account, `${hash}.png`);
    const absolute = path.join(SKINS_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    const library = readSkinLibrary();
    const rows = library.accounts[account] || [];
    const record = { id: hash, file: relative, name: path.basename(picked.filePaths[0], '.png').slice(0, 80), variant: variant === 'slim' ? 'slim' : 'classic', addedAt: new Date().toISOString() };
    library.accounts[account] = [record, ...rows.filter(item => item.id !== hash)].slice(0, 256);
    writeJSON(SKINS_FILE, library);
    if (apply) {
      if (auth?.meta?.type === 'offline') setActiveLocalSkin(library, account, record.id);
      else await uploadMinecraftSkin(auth, buffer, record.variant);
      writeJSON(SKINS_FILE, library);
    }
    return publicSkinRecord(record);
  });

  ipcMain.handle('apply-skin', async (_, id) => {
    const auth = readAuth();
    if (!auth?.profile) throw new Error('Select an account before applying a skin');
    const library = readSkinLibrary();
    const account = skinAccountKey(auth);
    const record = (library.accounts[account] || []).find(item => item.id === id);
    if (!record) throw new Error('Skin not found');
    const buffer = fs.readFileSync(path.join(SKINS_DIR, record.file));
    validateSkinPng(buffer);
    if (auth.meta?.type === 'offline') {
      setActiveLocalSkin(library, account, id);
      writeJSON(SKINS_FILE, library);
      return { mode: 'local', message: 'Applied locally. Pine will enable it when you launch a modded instance.' };
    }
    await uploadMinecraftSkin(auth, buffer, record.variant);
    return { mode: 'minecraft', message: 'Skin applied to your Minecraft profile' };
  });

  ipcMain.handle('delete-skin', async (_, id) => {
    const auth = readAuth();
    const account = skinAccountKey(auth);
    const library = readSkinLibrary();
    const rows = library.accounts[account] || [];
    const record = rows.find(item => item.id === id);
    if (record) fs.rmSync(path.join(SKINS_DIR, record.file), { force: true });
    removeLocalSkin(library, account, id);
    writeJSON(SKINS_FILE, library);
    return true;
  });

  ipcMain.handle('set-active-cape', async (_, capeId) => {
    const auth = readAuth();
    if (!auth || auth.meta?.type === 'offline') throw new Error('Sign in with Microsoft to manage capes');
    const refreshed = await refreshMicrosoftAuth(auth);
    const response = await portableFetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
      method: capeId ? 'PUT' : 'DELETE',
      headers: { Authorization: `Bearer ${refreshed.access_token}`, 'Content-Type': 'application/json' },
      body: capeId ? JSON.stringify({ capeId: String(capeId) }) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Minecraft rejected the cape change (${response.status})`);
    const library = readSkinLibrary();
    const account = skinAccountKey(refreshed);
    library.capes[account] = applyCapeSelection(library.capes[account], capeId);
    writeJSON(SKINS_FILE, library);
    return true;
  });
}

module.exports = { registerSkinsIPC };
