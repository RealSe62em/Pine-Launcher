'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generatePkcePair,
  buildAuthorizeUrl,
  renderOAuthCallbackPage,
  refreshProviderToken,
  startBrowserOAuthFlow,
  createCloudAuthStore,
} = require('../lib/cloud-sync-oauth');
const {
  createLocalFolderProvider,
  createGoogleDriveProvider,
  createOneDriveProvider,
  createDropboxProvider,
  normalizeRemotePath,
} = require('../lib/cloud-sync-providers');
const {
  normalizeCloudSyncConfig,
  sanitizeSettingsForSync,
  extractThemesForSync,
  computeSyncPlan,
  collectLocalSyncBundle,
  buildRemoteManifest,
  parseRemoteManifest,
  filterItemsByScopes,
  uniqueWorldDuplicateName,
  zipWorldDirectory,
  extractWorldZipSafe,
} = require('../lib/cloud-sync');

function createFakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, ''),
  };
}

test('Cloud Sync OAuth builds PKCE browser URLs with account pickers for Google Drive, OneDrive, and Dropbox', () => {
  const pkce = generatePkcePair();
  assert.equal(pkce.method, 'S256');
  assert.ok(pkce.verifier.length >= 32);
  assert.ok(pkce.challenge.length >= 32);

  const gUrl = new URL(buildAuthorizeUrl({
    providerId: 'google-drive',
    clientId: 'g-client-123',
    redirectUri: 'http://127.0.0.1:53682/oauth/callback',
    state: 'state123',
    codeChallenge: pkce.challenge,
  }));
  assert.equal(gUrl.hostname, 'accounts.google.com');
  assert.equal(gUrl.searchParams.get('prompt'), 'select_account consent');
  assert.equal(gUrl.searchParams.get('code_challenge_method'), 'S256');

  const msUrl = new URL(buildAuthorizeUrl({
    providerId: 'onedrive',
    clientId: 'ms-client-123',
    redirectUri: 'http://127.0.0.1:53682/oauth/callback',
    state: 'state123',
    codeChallenge: pkce.challenge,
  }));
  assert.equal(msUrl.hostname, 'login.microsoftonline.com');
  assert.equal(msUrl.searchParams.get('prompt'), 'select_account');

  const dbxUrl = new URL(buildAuthorizeUrl({
    providerId: 'dropbox',
    clientId: 'dbx-client-123',
    redirectUri: 'http://127.0.0.1:53682/oauth/callback',
    state: 'state123',
    codeChallenge: pkce.challenge,
  }));
  assert.equal(dbxUrl.hostname, 'www.dropbox.com');
  assert.equal(dbxUrl.searchParams.get('token_access_type'), 'offline');
});

test('Cloud Sync loopback browser OAuth flow verifies state and exchanges code for tokens', async () => {
  let openedUrl = '';
  const flow = startBrowserOAuthFlow({
    providerId: 'dropbox',
    clientId: 'dbx-test-id',
    preferredPort: 0,
    openExternal: async (url) => {
      openedUrl = url;
      const parsed = new URL(url);
      const redirect = parsed.searchParams.get('redirect_uri');
      const state = parsed.searchParams.get('state');
      const res = await fetch(`${redirect}?code=test-auth-code&state=${encodeURIComponent(state)}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Dropbox connected/);
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.dropboxapi.com/oauth2/token');
      assert.match(String(init.body), /code=test-auth-code/);
      assert.match(String(init.body), /code_verifier=/);
      return new Response(JSON.stringify({
        access_token: 'access-xyz',
        refresh_token: 'refresh-xyz',
        expires_in: 14400,
      }), { status: 200 });
    },
  });

  const tokens = await flow.promise;
  assert.ok(openedUrl.startsWith('https://www.dropbox.com/oauth2/authorize?'));
  assert.equal(tokens.accessToken, 'access-xyz');
  assert.equal(tokens.refreshToken, 'refresh-xyz');
});

test('Cloud Sync auth store encrypts credentials and refuses plaintext persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-cloud-auth-'));
  const authFile = path.join(dir, 'cloud-sync-auth.bin');
  try {
    const insecure = createCloudAuthStore({
      authFile,
      safeStorage: createFakeSafeStorage(),
      isSecureStorageAvailable: () => false,
      env: {},
    });
    assert.throws(() => insecure.saveOAuthCredentials('onedrive', { clientId: 'abc' }), /plaintext/i);

    const store = createCloudAuthStore({
      authFile,
      safeStorage: createFakeSafeStorage(),
      isSecureStorageAvailable: () => true,
      env: {},
    });
    store.saveOAuthCredentials('google-drive', { clientId: 'cid-1', clientSecret: 'sec-1' });
    store.saveProviderSession('google-drive', {
      accessToken: 'tok-1',
      refreshToken: 'ref-1',
      expiresAt: Date.now() + 3600_000,
      account: { email: 'alex@example.com', name: 'Alex' },
    });
    assert.equal(store.resolveOAuthCredentials('google-drive').clientId, 'cid-1');
    assert.equal(store.getProviderEntry('google-drive').account.email, 'alex@example.com');
    store.clearProviderSession('google-drive');
    assert.equal(store.getProviderEntry('google-drive').accessToken, undefined);
    assert.equal(store.resolveOAuthCredentials('google-drive').clientId, 'cid-1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3-way Cloud Sync planner classifies push, pull, unchanged, and conflicts safely', () => {
  const mk = (key, hash, kind = 'settings') => ({
    key,
    kind,
    label: key,
    hash,
    size: 100,
    modifiedAt: '2026-01-01T00:00:00.000Z',
  });

  const base = {
    'settings.json': mk('settings.json', 'h1'),
    'themes.json': mk('themes.json', 't1', 'themes'),
    'servers.json': mk('servers.json', 's1', 'servers'),
    'instances/main.json': mk('instances/main.json', 'i1', 'instance'),
  };
  const local = {
    'settings.json': mk('settings.json', 'h2'), // local changed -> push
    'themes.json': mk('themes.json', 't1', 'themes'), // remote changed -> pull
    'servers.json': mk('servers.json', 's-local', 'servers'), // both changed -> conflict
    'instances/main.json': mk('instances/main.json', 'i1', 'instance'), // unchanged
    'instances/new.json': mk('instances/new.json', 'n1', 'instance'), // local-only -> push
  };
  const remote = {
    'settings.json': mk('settings.json', 'h1'),
    'themes.json': mk('themes.json', 't2', 'themes'),
    'servers.json': mk('servers.json', 's-remote', 'servers'),
    'instances/main.json': mk('instances/main.json', 'i1', 'instance'),
    'instances/from-other-pc.json': mk('instances/from-other-pc.json', 'r1', 'instance'), // remote-only -> pull
  };

  const plan = computeSyncPlan(local, remote, base);
  assert.deepEqual(plan.toPush.map(i => i.key), ['instances/new.json', 'settings.json']);
  assert.deepEqual(plan.toPull.map(i => i.key), ['instances/from-other-pc.json', 'themes.json']);
  assert.deepEqual(plan.conflicts.map(c => c.key), ['servers.json']);
  assert.deepEqual(plan.unchanged.map(i => i.key), ['instances/main.json']);
});

test('Settings sanitization strips machine-local paths and never syncs secrets; world ZIP round-trips safely', async () => {
  const sanitized = sanitizeSettingsForSync({
    minMemory: '2G',
    maxMemory: '6G',
    javaPath: '/usr/lib/jvm/java-21/bin/java',
    curseForgeApiKey: 'super-secret',
    compactLibrary: true,
  });
  assert.equal(sanitized.minMemory, '2G');
  assert.equal(sanitized.compactLibrary, true);
  assert.equal(sanitized.javaPath, undefined);
  assert.equal(sanitized.curseForgeApiKey, undefined);

  const themes = extractThemesForSync({ theme: 'evergreen', uiStyle: 'cyber-hud', accentColor: '#10b981', customThemes: [{ id: 'c1', name: 'Mine' }] });
  assert.equal(themes.theme, 'evergreen');
  assert.equal(themes.customThemes.length, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-world-sync-'));
  try {
    const instDir = path.join(dir, 'inst');
    const worldDir = path.join(instDir, 'saves', 'Survival');
    fs.mkdirSync(worldDir, { recursive: true });
    fs.writeFileSync(path.join(worldDir, 'level.dat'), Buffer.from('fake-nbt-data'));
    fs.writeFileSync(path.join(worldDir, 'session.lock'), Buffer.from('lock'));

    const { buffer, skippedReason } = zipWorldDirectory(worldDir, 10 * 1024 * 1024);
    assert.equal(skippedReason, null);
    assert.ok(Buffer.isBuffer(buffer));

    const extractedDir = path.join(dir, 'restored-world');
    extractWorldZipSafe(buffer, extractedDir);
    assert.equal(fs.readFileSync(path.join(extractedDir, 'level.dat'), 'utf8'), 'fake-nbt-data');
    assert.equal(fs.existsSync(path.join(extractedDir, 'session.lock')), false);

    const bundle = collectLocalSyncBundle({
      scopes: { settings: true, themes: true, servers: true, instances: true, worlds: true },
      settings: { maxMemory: '6G', theme: 'pine-dark' },
      savedServers: [{ name: 'SMP', address: 'play.example.com' }],
      instances: [{ id: '1', name: 'Main', gameVersion: '1.21.4', loader: 'fabric' }],
      getInstanceDir: () => instDir,
      maxWorldSizeMb: 50,
    });
    assert.ok(bundle.descriptors['settings.json']);
    assert.ok(bundle.descriptors['themes.json']);
    assert.ok(bundle.descriptors['servers.json']);
    assert.ok(bundle.descriptors['instances/Main.json']);
    assert.ok(bundle.descriptors['worlds/Main/Survival.zip']);

    // LocalFolder provider round-trip
    const syncDir = path.join(dir, 'synced-drive');
    const provider = createLocalFolderProvider({ rootDir: syncDir });
    await provider.uploadFile('settings.json', bundle.payloads['settings.json'].buffer);
    const listed = await provider.listFiles();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].path, 'settings.json');
    const dl = await provider.downloadFile('settings.json');
    assert.deepEqual(dl, bundle.payloads['settings.json'].buffer);
    assert.throws(() => normalizeRemotePath('../escape.json'), /Unsafe/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Google Drive, OneDrive, and Dropbox providers talk to their official HTTPS endpoints', async () => {
  const calls = [];
  const gdrive = createGoogleDriveProvider({
    getAccessToken: async () => 'g-token',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('userinfo')) return new Response(JSON.stringify({ email: 'u@gmail.com', name: 'G User' }), { status: 200 });
      return new Response(JSON.stringify({ storageQuota: { usage: '100', limit: '1000' } }), { status: 200 });
    },
  });
  const gAcct = await gdrive.getAccountInfo();
  assert.equal(gAcct.email, 'u@gmail.com');

  const onedrive = createOneDriveProvider({
    getAccessToken: async () => 'ms-token',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/v1.0/me?')) return new Response(JSON.stringify({ displayName: 'MS User', mail: 'u@outlook.com' }), { status: 200 });
      return new Response(JSON.stringify({ quota: { used: 50, total: 500 } }), { status: 200 });
    },
  });
  const msAcct = await onedrive.getAccountInfo();
  assert.equal(msAcct.email, 'u@outlook.com');

  const dropbox = createDropboxProvider({
    getAccessToken: async () => 'dbx-token',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('get_current_account')) return new Response(JSON.stringify({ email: 'u@dropbox.com', name: { display_name: 'DBX User' } }), { status: 200 });
      return new Response(JSON.stringify({ used: 10, allocation: { allocated: 200 } }), { status: 200 });
    },
  });
  const dbxAcct = await dropbox.getAccountInfo();
  assert.equal(dbxAcct.email, 'u@dropbox.com');
  assert.ok(calls.every(u => u.startsWith('https://')));
});

test('Google Drive, OneDrive, and Dropbox providers support list, upload, download, and delete', async () => {
  // Google Drive full lifecycle (create folder, upload new, upload patch, list, download, delete)
  let gFiles = [];
  const gdrive = createGoogleDriveProvider({
    getAccessToken: async () => 'g-tok',
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      if (u.includes('mimeType') && (!init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1', name: 'Pine Launcher Sync' }] }), { status: 200 });
      }
      if (u.includes('/drive/v3/files?') && u.includes('appProperties')) {
        return new Response(JSON.stringify({ files: gFiles }), { status: 200 });
      }
      if (u.includes('/upload/drive/v3/files') && init.method === 'POST') {
        gFiles.push({ id: 'f1', name: 'settings.json', size: '12', modifiedTime: '2026-01-01T00:00:00Z', appProperties: { pinePath: 'settings.json' } });
        return new Response(JSON.stringify({ id: 'f1' }), { status: 200 });
      }
      if (u.includes('/upload/drive/v3/files/f1') && init.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'f1' }), { status: 200 });
      }
      if (u.includes('/drive/v3/files/f1?alt=media')) {
        return new Response(Buffer.from('{"ok":true}'), { status: 200 });
      }
      if (u.includes('/drive/v3/files/f1') && init.method === 'DELETE') {
        gFiles = [];
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 200 });
    },
  });
  await gdrive.uploadFile('settings.json', Buffer.from('{"ok":true}'), 'application/json');
  await gdrive.uploadFile('settings.json', Buffer.from('{"ok":2}'), 'application/json');
  assert.equal((await gdrive.listFiles()).length, 1);
  assert.equal((await gdrive.downloadFile('settings.json')).toString('utf8'), '{"ok":true}');
  assert.equal(await gdrive.deleteFile('settings.json'), true);
  assert.equal(await gdrive.downloadFile('missing.json'), null);

  // OneDrive full lifecycle (list nested, small PUT, >4MB chunked upload, download, delete)
  const odChunks = [];
  const onedrive = createOneDriveProvider({
    getAccessToken: async () => 'ms-tok',
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith(':/children?$top=200')) {
        if (u.includes('instances')) {
          return new Response(JSON.stringify({ value: [{ name: 'Main.json', size: 10, lastModifiedDateTime: '2026-01-01T00:00:00Z' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ value: [{ name: 'instances', folder: {} }, { name: 'settings.json', size: 20, lastModifiedDateTime: '2026-01-01T00:00:00Z' }] }), { status: 200 });
      }
      if (u.endsWith(':/createUploadSession')) {
        return new Response(JSON.stringify({ uploadUrl: 'https://upload.onedrive.example/session1' }), { status: 200 });
      }
      if (u === 'https://upload.onedrive.example/session1') {
        odChunks.push(init.headers['Content-Range']);
        return new Response('{}', { status: 200 });
      }
      if (u.endsWith(':/content') && init.method === 'PUT') return new Response('{}', { status: 200 });
      if (u.endsWith(':/content')) return new Response(Buffer.from('hello-od'), { status: 200 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response('', { status: 404 });
    },
  });
  const odList = await onedrive.listFiles();
  assert.deepEqual(odList.map(f => f.path).sort(), ['instances/Main.json', 'settings.json']);
  await onedrive.uploadFile('settings.json', Buffer.from('small'));
  await onedrive.uploadFile('worlds/Main/big.zip', Buffer.alloc(4 * 1024 * 1024 + 10));
  assert.equal(odChunks.length, 1);
  assert.equal((await onedrive.downloadFile('settings.json')).toString('utf8'), 'hello-od');
  assert.equal(await onedrive.deleteFile('settings.json'), true);

  // Dropbox full lifecycle
  const dropbox = createDropboxProvider({
    getAccessToken: async () => 'dbx-tok',
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/files/list_folder')) {
        return new Response(JSON.stringify({
          entries: [
            { '.tag': 'folder', path_lower: '/pinelaunchersync/instances', path_display: '/PineLauncherSync/instances' },
            { '.tag': 'file', path_lower: '/pinelaunchersync/settings.json', path_display: '/PineLauncherSync/settings.json', size: 15, server_modified: '2026-01-01T00:00:00Z' },
          ],
        }), { status: 200 });
      }
      if (u.includes('/files/upload')) return new Response('{}', { status: 200 });
      if (u.includes('/files/download')) return new Response(Buffer.from('hello-dbx'), { status: 200 });
      if (u.includes('/files/delete_v2')) return new Response('{}', { status: 200 });
      return new Response('', { status: 404 });
    },
  });
  assert.equal((await dropbox.listFiles())[0].path, 'settings.json');
  await dropbox.uploadFile('settings.json', Buffer.from('abc'));
  assert.equal((await dropbox.downloadFile('settings.json')).toString('utf8'), 'hello-dbx');
  assert.equal(await dropbox.deleteFile('settings.json'), true);
});

test('OAuth token refresh, callback HTML rendering, and Cloud Sync manifest/config helpers work cleanly', async () => {
  const html = renderOAuthCallbackPage({ ok: false, title: 'Cancelled', detail: 'User closed' });
  assert.match(html, /Cancelled/);

  const refreshed = await refreshProviderToken({
    providerId: 'google-drive',
    refreshToken: 'ref-1',
    clientId: 'cid-1',
    clientSecret: 'sec-1',
    fetchImpl: async () => new Response(JSON.stringify({ access_token: 'fresh-tok', expires_in: 3600 }), { status: 200 }),
  });
  assert.equal(refreshed.accessToken, 'fresh-tok');
  assert.equal(refreshed.refreshToken, 'ref-1');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-cloud-helpers-'));
  try {
    const authStore = createCloudAuthStore({
      authFile: path.join(dir, 'auth.bin'),
      safeStorage: createFakeSafeStorage(),
      isSecureStorageAvailable: () => true,
      env: {},
    });
    authStore.saveOAuthCredentials('onedrive', { clientId: 'ms-1' });
    authStore.saveProviderSession('onedrive', {
      accessToken: 'expired-tok',
      refreshToken: 'ref-ms',
      expiresAt: Date.now() - 1000,
    });
    const nextTok = await authStore.getValidAccessToken('onedrive', {
      fetchImpl: async () => new Response(JSON.stringify({ access_token: 'new-ms-tok', expires_in: 3600 }), { status: 200 }),
    });
    assert.equal(nextTok, 'new-ms-tok');

    const cfg = normalizeCloudSyncConfig({ activeProvider: 'google-drive', scopes: { worlds: true }, maxWorldSizeMb: 150 });
    assert.equal(cfg.activeProvider, 'google-drive');
    assert.equal(cfg.scopes.worlds, true);
    assert.equal(cfg.maxWorldSizeMb, 150);

    const manifest = buildRemoteManifest(cfg, {
      'settings.json': { key: 'settings.json', kind: 'settings', label: 'Settings', hash: 'a', size: 10, modifiedAt: '2026-01-01T00:00:00Z' },
      'worlds/Main/W.zip': { key: 'worlds/Main/W.zip', kind: 'world', label: 'W', hash: 'b', size: 20, modifiedAt: '2026-01-01T00:00:00Z' },
    });
    const parsed = parseRemoteManifest(Buffer.from(JSON.stringify(manifest)));
    assert.equal(parsed.format, 1);
    assert.equal(parseRemoteManifest(Buffer.from('bad-json')), null);

    const filtered = filterItemsByScopes(parsed.items, { settings: true, themes: false, servers: false, instances: false, worlds: false });
    assert.deepEqual(Object.keys(filtered), ['settings.json']);

    fs.mkdirSync(path.join(dir, 'World (Cloud Copy)'), { recursive: true });
    assert.equal(uniqueWorldDuplicateName(dir, 'World'), 'World (Cloud Copy 2)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
