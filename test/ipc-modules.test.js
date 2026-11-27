'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const AdmZip = require('adm-zip');

function ipcRegistry() {
  const handlers = new Map();
  return { handlers, ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) } };
}

function loadWithElectronMock(modulePath, electron) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(modulePath); }
  finally { Module._load = originalLoad; }
}

test('system IPC registers guarded platform operations and clears both metadata caches', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ipc-system-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copied = { value: '' };
  const window = { minimized: false, closed: false, minimize() { this.minimized = true; }, close() { this.closed = true; }, isDestroyed: () => false, isMaximized: () => false, isFullScreen: () => false };
  const electron = {
    BrowserWindow: { fromWebContents: () => window },
    shell: { openExternal: async () => {} },
    clipboard: { writeText: value => { copied.value = value; }, readText: () => copied.value },
  };
  const { registerSystemIPC } = loadWithElectronMock('../lib/ipc-system', electron);
  const { handlers, ipcMain } = ipcRegistry();
  const values = new Map();
  const userData = path.join(root, 'user');
  const modCache = path.join(userData, 'cache', 'mods');
  const packCache = path.join(userData, 'cache', 'managed-packs');
  fs.mkdirSync(modCache, { recursive: true });
  fs.writeFileSync(path.join(modCache, 'old.bin'), 'old');
  let curseClears = 0;
  let modrinthClears = 0;
  registerSystemIPC({
    ipcMain,
    app: { getPath: () => userData },
    readJSON: file => values.get(file),
    writeJSON: (file, value) => values.set(file, value),
    readAuth: () => null,
    ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    DISCORD_SERVER_URL: 'https://discord.gg/example',
    INSTANCES_FILE: 'instances', SETTINGS_FILE: 'settings',
    GLOBAL_DIR: path.join(userData, 'global'), MANAGED_JAVA_DIR: path.join(userData, 'runtimes'),
    BACKUPS_DIR: path.join(userData, 'backups'), LOG_DIR: path.join(userData, 'logs'),
    MOD_CACHE_DIR: modCache, MANAGED_PACK_CACHE_DIR: packCache,
    getInstanceDir: () => path.join(userData, 'instances', 'one'),
    getMcClient: () => null, getActiveInstanceName: () => null,
    getActiveTransfers: () => new Map(), getDownloadManager: () => ({ active: false }),
    curseForgeResponseCache: { clear: () => { curseClears += 1; } },
    clearModrinthResponseCache: () => { modrinthClears += 1; },
  });

  assert.equal(handlers.size, 9);
  assert.equal(await handlers.get('copy-text')({}, 'hello\r\nworld'), true);
  assert.equal(copied.value, 'hello\r\nworld');
  await handlers.get('window-control')({ sender: {} }, 'minimize');
  assert.equal(window.minimized, true);
  await assert.rejects(handlers.get('clear-download-cache')({}, false), /Confirmation/);
  assert.deepEqual(await handlers.get('clear-download-cache')({}, true), { cleared: true });
  assert.equal(fs.existsSync(path.join(modCache, 'old.bin')), false);
  assert.equal(fs.existsSync(modCache), true);
  assert.equal(fs.existsSync(packCache), true);
  assert.equal(curseClears, 1);
  assert.equal(modrinthClears, 1);
});

test('server IPC validates persistence and normalizes remote directory data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ipc-servers-'));
  try {
    const { registerServersIPC } = require('../lib/ipc-servers');
    const { handlers, ipcMain } = ipcRegistry();
    const instance = { id: 'instance-1', name: 'Main' };
    let saved = [];
    registerServersIPC({
      ipcMain,
      app: { getVersion: () => '1.3.0' },
      portableFetch: async () => ({ ok: true, json: async () => ({ items: [{ name: 'Public Server', host: 'play.example.net', port: 25565, players_online: 12, players_total: 50, tags: ['survival'] }], total: 1, total_pages: 2 }) }),
      readJSON: file => file === 'instances' ? [instance] : saved,
      writeJSON: (_, value) => { saved = value; },
      serverFile: 'servers', INSTANCES_FILE: 'instances',
      getInstanceDir: () => root,
      getRegisteredInstance: name => { assert.equal(name, 'Main'); return { instance }; },
      getActiveInstanceName: () => null,
    });

    const entry = await handlers.get('save-server')({}, { instanceName: 'Main', address: 'example.net:25565', name: ' Example ' });
    assert.equal(entry.name, 'Example');
    assert.equal((await handlers.get('list-servers')()).length, 1);
    const directory = await handlers.get('search-server-directory')({}, { provider: 'GSM', page: 2 });
    assert.equal(directory.servers[0].address, 'play.example.net');
    assert.equal(directory.servers[0].playersOnline, 12);
    await handlers.get('delete-server')({}, entry.id);
    assert.deepEqual(saved, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('world IPC keeps duplication, deletion, data-pack installation, and export inside the instance', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ipc-worlds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'saves');
  const world = path.join(saves, 'World One');
  fs.mkdirSync(world, { recursive: true });
  fs.writeFileSync(path.join(world, 'level.dat'), 'world data');
  const packSource = path.join(root, 'example-pack.zip');
  const pack = new AdmZip();
  pack.addFile('pack.mcmeta', Buffer.from('{"pack":{"pack_format":15,"description":"test"}}'));
  pack.writeZip(packSource);
  const exportPath = path.join(root, 'world-export.zip');
  let openSelection = packSource;
  let saveSelection = exportPath;
  let backups = 0;
  const { registerWorldsIPC } = require('../lib/ipc-worlds');
  const { handlers, ipcMain } = ipcRegistry();
  const instance = { name: 'Main', gameVersion: '1.20.1', backupRetention: 3 };
  const instancePath = (...parts) => path.join(root, ...parts);
  registerWorldsIPC({
    ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [openSelection] }),
      showSaveDialog: async () => ({ canceled: false, filePath: saveSelection }),
    },
    shell: { openPath: async () => '' }, getMainWindow: () => null,
    BACKUPS_DIR: path.join(root, 'backups'),
    runBackupInWorker: async () => { backups += 1; return { id: 'backup' }; },
    listWorldsInWorker: async () => [[{ identifier: 'World One', name: 'World One', version: '1.20.1' }]],
    compareSemver: (a, b) => a.localeCompare(b), sanitizeName: value => String(value).trim(),
    resolveSafePath: (base, ...parts) => {
      const target = path.resolve(base, ...parts);
      if (target !== path.resolve(base) && !target.startsWith(path.resolve(base) + path.sep)) throw new Error('Unsafe path');
      return target;
    },
    safeRemoteFilename: value => path.basename(String(value)), ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    getInstanceDir: (_, ...parts) => instancePath(...parts),
    getInstanceDirByName: (_, ...parts) => instancePath(...parts),
    getRegisteredInstance: () => ({ instance }), getActiveInstanceName: () => null,
    modrinthFetch: async () => { throw new Error('not used'); }, fetchWithRetry: async () => {},
  });

  assert.deepEqual(await handlers.get('get-instance-worlds')({}, 'Main'), ['World One']);
  const duplicate = await handlers.get('duplicate-world')({}, 'Main', 'World One');
  assert.equal(duplicate.identifier, 'World One Copy');
  assert.equal(fs.readFileSync(path.join(saves, duplicate.identifier, 'level.dat'), 'utf8'), 'world data');
  assert.deepEqual(await handlers.get('install-world-datapack-file')({}, 'Main', 'World One'), { filename: 'example-pack.zip' });
  assert.equal(fs.existsSync(path.join(world, 'datapacks', 'example-pack.zip')), true);
  assert.equal(await handlers.get('export-world')({}, 'Main', 'World One'), exportPath);
  assert.equal(fs.existsSync(exportPath), true);
  assert.equal(await handlers.get('delete-world')({}, 'Main', duplicate.identifier), true);
  assert.equal(fs.existsSync(path.join(saves, duplicate.identifier)), false);
  assert.equal(backups, 2);
});

test('diagnostics IPC bounds, redacts, uploads, and repairs through injected services', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ipc-diagnostics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reportPath = path.join(root, 'support.txt');
  const electron = { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: reportPath }) } };
  const { registerDiagnosticsIPC } = loadWithElectronMock('../lib/ipc-diagnostics', electron);
  const { handlers, ipcMain } = ipcRegistry();
  const instance = { name: 'Main', gameVersion: '1.20.1', loader: 'fabric', minMemory: '1G', maxMemory: '4G' };
  let cleaned = 0;
  registerDiagnosticsIPC({
    ipcMain, app: { getVersion: () => '1.3.0' }, getMainWindow: () => null,
    portableFetch: async () => ({ ok: true, json: async () => ({ success: true, id: 'AbC123', expires: 123 }) }),
    readJSON: () => ({}), cleanCorruptedJars: () => { cleaned += 1; return 1; }, diagnosticLog: () => {},
    createAutomaticInstanceBackup: async () => ({ id: 'backup-1' }),
    getRegisteredInstance: () => ({ instance }), getInstanceDir: () => root, getInstanceModsList: async () => [],
    pendingContentInstalls: () => [], resolveExportableContent: async () => ({ files: [], omitted: [], suggestions: [] }),
    compareSemver: () => 1, getJavaVersionAsync: async () => 21, getActiveInstanceName: () => null,
    SETTINGS_FILE: 'settings', GLOBAL_VERSIONS_DIR: root, GLOBAL_LIBRARIES_DIR: root,
    MC_JAVA_MAP_FALLBACK: [{ min: '1.0', java: 8 }],
  });

  const health = await handlers.get('get-instance-health')({}, 'Main');
  assert.equal(Array.isArray(health.issues), true);
  const diagnosis = await handlers.get('analyze-crash')({}, 'Main', 'java.lang.OutOfMemoryError: Java heap space');
  assert.match(diagnosis.summary, /memory/i);
  const uploaded = await handlers.get('upload-crash-log')({}, 'Main', 'accessToken=SECRET_VALUE', true);
  assert.equal(uploaded.url, 'https://mclo.gs/AbC123');
  await handlers.get('save-support-report')({}, 'Authorization: Bearer PRIVATE_TOKEN');
  assert.equal(fs.readFileSync(reportPath, 'utf8').includes('PRIVATE_TOKEN'), false);
  const repair = await handlers.get('repair-instance-files')({}, 'Main');
  assert.equal(repair.backupId, 'backup-1');
  assert.equal(cleaned, 3);
});

test('skin IPC validates remote records and preserves offline account isolation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ipc-skins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  const imported = path.join(root, 'Imported.png');
  fs.writeFileSync(imported, png);
  const electron = { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [imported] }) } };
  const { registerSkinsIPC } = loadWithElectronMock('../lib/ipc-skins', electron);
  const { handlers, ipcMain } = ipcRegistry();
  const auth = { profile: { name: 'OfflinePlayer', uuid: 'offline-id' }, access_token: '', meta: { type: 'offline' } };
  const library = { version: 1, accounts: {}, activeSkins: {}, capes: {} };
  const writes = [];
  const textureHash = 'a'.repeat(64);
  registerSkinsIPC({
    ipcMain, app: { getVersion: () => '1.3.0' }, getMainWindow: () => null,
    portableFetch: async url => {
      if (String(url).includes('mineskin.org')) return { ok: true, json: async () => ({ skins: [{ uuid: 'b'.repeat(32), texture: textureHash, name: 'Community' }], pagination: {} }) };
      return { ok: true, headers: new Headers({ 'content-length': String(png.length) }), arrayBuffer: async () => png };
    },
    writeJSON: (_, value) => writes.push(value), readAuth: () => auth,
    SKINS_DIR: root, SKINS_FILE: path.join(root, 'library.json'), skinAccountKey: () => 'offline-id',
    readSkinLibrary: () => library, publicSkinRecord: record => ({ ...record }), minecraftProfileFor: async () => null,
    remoteImageData: async () => null, uploadMinecraftSkin: async () => {}, refreshMicrosoftAuth: async value => value,
    minecraftUiTextures: () => ({ steve: 'texture' }),
  });

  const browsed = await handlers.get('browse-skin-library')({}, { size: 20 });
  assert.equal(browsed.skins[0].textureUrl, `https://textures.minecraft.net/texture/${textureHash}`);
  const saved = await handlers.get('save-library-skin')({}, browsed.skins[0], 'slim', true);
  assert.equal(saved.appliedMode, 'local');
  assert.equal((await handlers.get('get-skin-library')()).activeSkin.id, saved.id);
  const importedSkin = await handlers.get('import-skin')({}, 'classic', false);
  assert.equal(importedSkin.name, 'Imported');
  assert.equal((await handlers.get('apply-skin')({}, importedSkin.id)).mode, 'local');
  assert.equal(await handlers.get('delete-skin')({}, importedSkin.id), true);
  await assert.rejects(handlers.get('set-active-cape')({}, 'cape'), /Microsoft/);
  assert.equal(writes.length > 0, true);
});

test('destination catalog serializes cleanup and preserves useful deleted-instance history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-destinations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = { pending: { items: [] }, groups: [], instances: [{ name: 'Main', group: 'Favorites', created: '2026-01-01' }], catalog: { items: [] } };
  const { createDestinationCatalog } = require('../lib/destination-catalog');
  const catalog = createDestinationCatalog({
    readJSON: file => files[file], writeJSON: (file, value) => { files[file] = value; }, diagnosticLog: () => {},
    PENDING_DELETIONS_FILE: 'pending', GROUPS_FILE: 'groups', INSTANCES_FILE: 'instances', DESTINATION_CATALOG_FILE: 'catalog',
    getInstanceDir: () => root,
    readActivity: () => ({ destinations: [{ type: 'multiplayer', identifier: 'play.example.net', launches: 3, lastUsed: '2026-02-01' }] }),
    readSavedServers: () => [{ ip: 'play.example.net', name: 'Friendly Server', icon: null }], listWorlds: () => [],
    destinationCatalogId: item => `${item.instanceId}:${item.identifier}`,
    sanitizeDestination: item => ({ type: item.type, identifier: item.identifier, label: item.label }),
    destinationKey: item => `${item.type}:${item.address || item.identifier}`.toLowerCase(), normalizeServerIcon: () => null,
    isPrivateServerAddress: () => false, mergeDestinationCatalog: (_, live) => live,
  });

  assert.equal(catalog.ensureGroupExists(' New\nGroup '), 'New Group');
  assert.deepEqual(catalog.readGroups().map(item => item.name), ['Favorites', 'New Group']);
  const deleting = path.join(root, '.pine-deleting-test');
  fs.mkdirSync(deleting);
  const pending = { id: 'one', root, target: deleting, instanceName: 'Main' };
  await catalog.rememberPendingDeletion(pending);
  assert.equal(await catalog.finishPendingDeletion(pending), true);
  assert.equal(fs.existsSync(deleting), false);
  assert.deepEqual(catalog.pendingDeletions(), []);
  assert.equal(await catalog.finishPendingDeletion({ id: 'bad', root: '/', target: '/tmp' }), false);
  catalog.archiveDeletedInstance({ id: 'instance-1', name: 'Main', gameVersion: '1.20.1', loader: 'fabric', created: '2026-01-01' });
  assert.equal(files.catalog.items[0].label, 'Friendly Server');
  assert.equal(files.catalog.items[0].deletedInstance, true);
});
