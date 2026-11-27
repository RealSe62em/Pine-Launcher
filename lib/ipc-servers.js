'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { normalizeServerIcon, readSavedServers, serverDisplayAddress } = require('./discord-presence');
const { parseAddress, pingServer } = require('./server-dashboard');
const { addServerToInstance } = require('./server-list');

function registerServersIPC({
  ipcMain,
  app,
  portableFetch,
  readJSON,
  writeJSON,
  serverFile,
  INSTANCES_FILE,
  getInstanceDir,
  getRegisteredInstance,
  getActiveInstanceName,
  publicServerDirectoryCache = new Map(),
}) {
  const serverStatusCache = new Map();
  const savedServerList = () => readJSON(serverFile) || [];
  const instanceIdentity = instance => String(instance.id || instance.created || instance.name);

  const serverList = () => {
    const instances = readJSON(INSTANCES_FILE) || [];
    const saved = savedServerList().map(item => ({ ...item, instanceName: instances.find(instance => instanceIdentity(instance) === item.instanceId)?.name || null }));
    for (const instance of instances) {
      for (const server of readSavedServers(getInstanceDir(instance))) {
        const address = serverDisplayAddress(server.ip);
        if (!address || saved.some(item => item.instanceId === instanceIdentity(instance) && item.address.toLowerCase() === address.toLowerCase())) continue;
        saved.push({ id: crypto.createHash('sha256').update(instanceIdentity(instance) + address).digest('hex'), instanceId: instanceIdentity(instance), instanceName: instance.name, address, name: server.name || address, imported: true, iconData: normalizeServerIcon(server.icon) });
      }
    }
    return saved.slice(0, 200);
  };

  ipcMain.handle('list-servers', async () => serverList());

  ipcMain.handle('save-server', async (_, input) => {
    const { instance } = getRegisteredInstance(input?.instanceName);
    const address = parseAddress(input.address).address;
    const name = String(input.name || address).replace(/[\r\n\0]/g, ' ').trim().slice(0, 100);
    const servers = savedServerList();
    const instanceId = instanceIdentity(instance);
    const previous = servers.find(item => item.instanceId === instanceId && item.address.toLowerCase() === address.toLowerCase());
    const entry = { id: previous?.id || crypto.randomUUID(), instanceId, address, name };
    if (previous) Object.assign(previous, entry); else { if (servers.length >= 200) throw new Error('Server limit reached'); servers.push(entry); }
    writeJSON(serverFile, servers); return entry;
  });

  ipcMain.handle('add-instance-server', async (_, input) => {
    const { instance } = getRegisteredInstance(input?.instanceName);
    if (getActiveInstanceName() === instance.name) throw new Error('Close Minecraft before changing this instance server list');
    const address = parseAddress(input?.address).address;
    const name = String(input?.name || address).replace(/[\r\n\0]/g, ' ').trim().slice(0, 100);
    return addServerToInstance(getInstanceDir(instance), { name, ip: address });
  });

  ipcMain.handle('delete-server', async (_, id) => { writeJSON(serverFile, savedServerList().filter(item => item.id !== id)); return true; });

  ipcMain.handle('get-server-status', async (_, id) => {
    const server = serverList().find(item => item.id === id);
    if (!server) throw new Error('Saved server not found');
    const cached = serverStatusCache.get(server.address);
    if (cached && Date.now() - cached.time < 15000) return cached.promise;
    const promise = pingServer(server.address);
    serverStatusCache.set(server.address, { time: Date.now(), promise });
    while (serverStatusCache.size > 200) serverStatusCache.delete(serverStatusCache.keys().next().value);
    return promise;
  });

  ipcMain.handle('get-public-server-status', async (_, address) => {
    const clean = parseAddress(address).address;
    return pingServer(clean);
  });

  ipcMain.handle('search-server-directory', async (_, options = {}) => {
    const page = Math.min(1000, Math.max(1, Number.parseInt(options.page, 10) || 1));
    const type = String(options.type || '').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 40);
    const version = String(options.version || '').replace(/[^a-z0-9._-]/gi, '').trim().slice(0, 30);
    const requiresMods = options.requiresMods === true ? 'true' : options.requiresMods === false ? 'false' : '';
    const supportedProviders = new Set(['Minecraft Java Servers', 'GSM', 'CraftSerwery.pl', 'Craftdex', 'Pine Partner']);
    const provider = supportedProviders.has(options.provider) ? options.provider : '';
    const params = new URLSearchParams({ page: String(page), per_page: '100' });
    if (type) params.set('type', type);
    if (version) params.set('version', version);
    if (requiresMods) params.set('requires_mods', requiresMods);
    if (options.online !== false) params.set('online', 'true');
    const key = `aggregate:${provider || 'all'}:${params}`;
    const cached = publicServerDirectoryCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const headers = { Accept: 'application/json', 'User-Agent': `PineLauncher/${app.getVersion()}` };
    const fetchJson = async url => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await portableFetch(url, { headers, signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
        }
      }
      throw lastError;
    };
    const safeUrl = value => {
      try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
    };
    const cleanText = (value, limit) => String(value || '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
    const normalize = (item, source) => {
      let address = String(item?.address || item?.host || item?.ip || item?.server || '').trim().replace(/^minecraft:\/\//i, '');
      let host = address;
      let port = Number(item?.port || item?.game_port) || 25565;
      try {
        const parsed = parseAddress(address || item?.host);
        host = parsed.host;
        if (parsed.explicitPort) port = parsed.port;
      } catch { return null; }
      if (!host || /[\r\n\0\s/@]/.test(host)) return null;
      const players = item?.players && typeof item.players === 'object' ? item.players : {};
      const types = item?.types || item?.modes || item?.categories || item?.tags || [];
      const versions = item?.versions || [];
      const normalizedAddress = serverDisplayAddress(host, port);
      return {
        id: crypto.createHash('sha256').update(normalizedAddress.toLowerCase()).digest('hex'),
        name: cleanText(item?.name || item?.display_name || item?.server_name || item?.title || host, 120), host, port, address: normalizedAddress,
        status: item?.status === 'offline' || item?.online === false ? 'offline' : 'online',
        playersOnline: Math.max(0, Number(item?.players_online ?? item?.playersOnline ?? (typeof item?.players === 'number' ? item.players : players.online)) || 0),
        playersMax: Math.max(0, Number(item?.players_total ?? item?.playersMax ?? item?.max_players ?? players.max) || 0),
        votes: Math.max(0, Number(item?.votes) || 0),
        uptime: Math.max(0, Math.min(100, Number(item?.uptime ?? item?.health?.score) || 0)),
        version: cleanText(item?.version || (Array.isArray(versions) ? versions.join(', ') : versions), 100),
        versionMin: cleanText(item?.version_min, 30), versionMax: cleanText(item?.version_max, 30),
        types: (Array.isArray(types) ? types : [types]).map(value => cleanText(value, 40)).filter(Boolean).slice(0, 8),
        description: cleanText(item?.short_description || item?.description || item?.motd || item?.map_name || '', 400),
        requiresMods: typeof item?.requires_mods === 'boolean' ? item.requires_mods : null,
        bedrock: item?.bedrock === true, software: cleanText(item?.software, 60),
        iconUrl: safeUrl(item?.icon_url || item?.iconUrl || item?.favicon || item?.icon),
        bannerUrl: safeUrl(item?.banner_url || item?.bannerUrl || item?.banner),
        source, partner: item?.partner === true,
      };
    };
    const sourceNames = [];
    const jobs = [];
    if (!provider || provider === 'Minecraft Java Servers') {
      sourceNames.push('Minecraft Java Servers');
      jobs.push(fetchJson(`https://minecraft-java-servers.com/api/v1/servers?${params}`).then(body => ({
        source: 'Minecraft Java Servers', body,
        items: (Array.isArray(body?.data) ? body.data : []).slice(0, 100),
        total: Number(body?.meta?.total) || 0, pages: Number(body?.meta?.total_pages) || page,
      })));
    }
    if (!provider || provider === 'GSM') {
      sourceNames.push('GSM');
      jobs.push(fetchJson(`https://gsm.kuryzhev.cloud/api/minecraft/servers?online=true&sort=players&order=desc&page=${page}&page_size=100`).then(body => ({
        source: 'GSM', body, items: Array.isArray(body?.items) ? body.items : [], total: Number(body?.total) || 0, pages: Number(body?.total_pages) || page,
      })));
    }
    const includePartner = !provider || provider === 'Pine Partner';
    const partnerStatusPromise = page === 1 && includePartner
      ? pingServer('185.207.164.216:21336', { timeout: 7000 })
      : Promise.resolve(null);
    if (page === 1) {
      const craftParams = new URLSearchParams({ limit: '100' });
      if (options.online !== false) craftParams.set('online', 'true');
      if (!provider || provider === 'CraftSerwery.pl') {
        sourceNames.push('CraftSerwery.pl');
        jobs.push(fetchJson(`https://craftserwery.pl/api/v1/servers?${craftParams}`).then(body => ({
          source: 'CraftSerwery.pl', body, items: Array.isArray(body?.data) ? body.data : [], total: Number(body?.meta?.total || body?.meta?.count) || 0, pages: 1,
        })));
      }
      if (!provider || provider === 'Craftdex') {
        sourceNames.push('Craftdex');
        jobs.push(fetchJson('https://craftdex.net/servers/servers.json').then(body => ({
          source: 'Craftdex', body, items: Array.isArray(body) ? body : Array.isArray(body?.servers) ? body.servers : Array.isArray(body?.data) ? body.data : [], total: Number(body?.total) || 0, pages: 1,
        })));
      }
    }
    const settled = await Promise.allSettled(jobs);
    const successful = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
    const failedSources = settled.flatMap((result, index) => result.status === 'rejected' ? [sourceNames[index] || `Directory ${index + 1}`] : []);
    if (!successful.length && !includePartner) throw new Error('The selected public server directory is temporarily unavailable. Pine will retry automatically.');
    const merged = new Map();
    for (const result of successful) {
      for (const raw of result.items) {
        const item = normalize(raw, result.source);
        if (!item) continue;
        const haystack = [item.name, item.description, item.version, ...item.types].join(' ').toLowerCase();
        if (type && !haystack.includes(type.toLowerCase())) continue;
        if (version && !haystack.includes(version.toLowerCase())) continue;
        if (requiresMods && item.requiresMods !== null && String(item.requiresMods) !== requiresMods) continue;
        const previous = merged.get(item.address.toLowerCase());
        merged.set(item.address.toLowerCase(), previous ? {
          ...item, ...previous,
          iconUrl: previous.iconUrl || item.iconUrl,
          bannerUrl: previous.bannerUrl || item.bannerUrl,
          types: [...new Set([...(previous.types || []), ...(item.types || [])])].slice(0, 8),
          source: [...new Set(`${previous.source},${item.source}`.split(','))].join(','),
        } : item);
      }
    }
    if (page === 1 && includePartner) {
      const partnerStatus = await partnerStatusPromise;
      const partner = normalize({
        name: 'Limitless Network', address: 'limitlessnet.work', online: true,
        version: partnerStatus?.online ? partnerStatus.version : '1.13–26.2', types: ['Economy', 'PvP', 'Survival', 'SMP', 'KitPvP'],
        description: 'Official Pine partner · Survival, PvP, practice, SkyWars, voice chat, and Java + Bedrock support.',
        bedrock: true, requires_mods: false, partner: true,
      }, 'Pine Partner');
      partner.statusAddress = '185.207.164.216:21336';
      if (partnerStatus?.online) {
        partner.playersOnline = partnerStatus.players;
        partner.playersMax = partnerStatus.maxPlayers;
        partner.liveDescription = partnerStatus.description;
        partner.iconData = normalizeServerIcon(partnerStatus.iconData);
        partner.latencyMs = partnerStatus.latencyMs;
      }
      const partnerHaystack = [partner.name, partner.description, partner.version, ...partner.types].join(' ').toLowerCase();
      if ((!type || partnerHaystack.includes(type.toLowerCase())) && (!version || partnerHaystack.includes(version.toLowerCase())) && (!requiresMods || String(partner.requiresMods) === requiresMods)) {
        const previous = merged.get(partner.address.toLowerCase());
        merged.set(partner.address.toLowerCase(), {
          ...previous, ...partner,
          playersOnline: partner.playersOnline || previous?.playersOnline || 0,
          playersMax: partner.playersMax || previous?.playersMax || 0,
          uptime: previous?.uptime || 100, iconData: partner.iconData || previous?.iconData || null,
          iconUrl: previous?.iconUrl || null, bannerUrl: previous?.bannerUrl || null,
          types: [...new Set([...(partner.types || []), ...(previous?.types || [])])].slice(0, 8),
          source: 'Pine Partner', partner: true,
        });
      }
    }
    const servers = [...merged.values()].sort((a, b) => Number(b.partner) - Number(a.partner) || b.playersOnline - a.playersOnline || b.votes - a.votes);
    const primaryPages = successful.filter(result => result.pages > 1).map(result => result.pages);
    const value = { servers, meta: {
      page, loaded: servers.length, total: Math.max(servers.length, successful.reduce((sum, result) => sum + result.total, 0)),
      totalPages: Math.max(page, ...primaryPages), sources: successful.map(result => result.source), failedSources,
    } };
    publicServerDirectoryCache.set(key, { expires: Date.now() + (failedSources.length ? 5_000 : 5 * 60_000), value });
    while (publicServerDirectoryCache.size > 40) publicServerDirectoryCache.delete(publicServerDirectoryCache.keys().next().value);
    return value;
  });

  return {
    serverList,
    serverStatusCache,
  };
}

module.exports = {
  registerServersIPC,
};
