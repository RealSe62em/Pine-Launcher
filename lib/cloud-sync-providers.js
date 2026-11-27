// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveSafePath } = require('./safety');

const DRIVE_FOLDER_NAME = 'Pine Launcher Sync';
const ONEDRIVE_ROOT_PREFIX = 'PineLauncherSync';

/**
 * Normalize a relative remote sync path (forward slashes, no leading slash, no traversal).
 * @param {string} remotePath
 * @returns {string}
 */
function normalizeRemotePath(remotePath) {
  const clean = String(remotePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length || parts.some(p => p === '.' || p === '..' || p.includes('\0'))) {
    throw new Error(`Unsafe cloud sync path: ${remotePath}`);
  }
  return parts.join('/');
}

/**
 * Google Drive v3 provider storing synced files in a dedicated `Pine Launcher Sync` folder.
 * Uses `appProperties.pinePath` to map nested logical paths without extra folder round-trips.
 * @param {{ getAccessToken: () => Promise<string>, fetchImpl?: typeof globalThis.fetch }} options
 */
function createGoogleDriveProvider({ getAccessToken, fetchImpl = globalThis.fetch }) {
  /** @type {string | null} */
  let cachedFolderId = null;

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   */
  async function authedFetch(url, init = {}) {
    const token = await getAccessToken();
    const headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    return fetchImpl(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(30000) });
  }

  async function ensureFolderId() {
    if (cachedFolderId) return cachedFolderId;
    const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
    const listRes = await authedFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`,
    );
    if (!listRes.ok) throw new Error(`Google Drive folder lookup failed (${listRes.status})`);
    const listData = await listRes.json();
    if (listData?.files?.[0]?.id) {
      cachedFolderId = listData.files[0].id;
      return cachedFolderId;
    }
    const createRes = await authedFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createRes.ok) throw new Error(`Could not create Google Drive sync folder (${createRes.status})`);
    const created = await createRes.json();
    cachedFolderId = created.id;
    return cachedFolderId;
  }

  async function getAccountInfo() {
    const [userRes, aboutRes] = await Promise.all([
      authedFetch('https://www.googleapis.com/oauth2/v3/userinfo'),
      authedFetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(usage,limit)').catch(() => null),
    ]);
    const user = userRes.ok ? await userRes.json().catch(() => ({})) : {};
    const about = aboutRes && aboutRes.ok ? await aboutRes.json().catch(() => ({})) : {};
    return {
      email: user.email || about?.user?.emailAddress || null,
      name: user.name || about?.user?.displayName || null,
      quotaUsed: about?.storageQuota?.usage ? Number(about.storageQuota.usage) : null,
      quotaTotal: about?.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
    };
  }

  /** @returns {Promise<Array<{ id: string, path: string, size: number, modifiedAt: string }>>} */
  async function listFiles() {
    const folderId = await ensureFolderId();
    const out = [];
    let pageToken = '';
    do {
      const q = `'${folderId}' in parents and trashed=false`;
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,size,modifiedTime,appProperties)',
        pageSize: '200',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await authedFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
      if (!res.ok) throw new Error(`Google Drive list failed (${res.status})`);
      const data = await res.json();
      for (const file of data.files || []) {
        const logicalPath = file.appProperties?.pinePath || file.name;
        out.push({
          id: String(file.id),
          path: String(logicalPath),
          size: Number(file.size) || 0,
          modifiedAt: String(file.modifiedTime || new Date().toISOString()),
        });
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /** @param {string} remotePath */
  async function findFile(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    const files = await listFiles();
    return files.find(f => f.path === normalized) || null;
  }

  /**
   * @param {string} remotePath
   * @returns {Promise<Buffer | null>}
   */
  async function downloadFile(remotePath) {
    const entry = await findFile(remotePath);
    if (!entry) return null;
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.id)}?alt=media`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Google Drive download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * @param {string} remotePath
   * @param {Buffer} buffer
   * @param {string} [contentType]
   */
  async function uploadFile(remotePath, buffer, contentType = 'application/octet-stream') {
    const normalized = normalizeRemotePath(remotePath);
    const folderId = await ensureFolderId();
    const existing = await findFile(normalized);
    const boundary = `pine_boundary_${Date.now().toString(36)}`;
    const metadata = existing
      ? { name: normalized.replace(/\//g, '__'), appProperties: { pinePath: normalized } }
      : { name: normalized.replace(/\//g, '__'), parents: [folderId], appProperties: { pinePath: normalized } };

    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([head, buffer, tail]);
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await authedFetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status})`);
    return true;
  }

  /** @param {string} remotePath */
  async function deleteFile(remotePath) {
    const existing = await findFile(remotePath);
    if (!existing) return false;
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.id)}`, {
      method: 'DELETE',
    });
    return res.ok || res.status === 404;
  }

  return {
    id: 'google-drive',
    label: 'Google Drive',
    getAccountInfo,
    listFiles,
    downloadFile,
    uploadFile,
    deleteFile,
  };
}

/**
 * Microsoft OneDrive provider backed by Graph API AppFolder (`/me/drive/special/approot`).
 * @param {{ getAccessToken: () => Promise<string>, fetchImpl?: typeof globalThis.fetch }} options
 */
function createOneDriveProvider({ getAccessToken, fetchImpl = globalThis.fetch }) {
  /**
   * @param {string} url
   * @param {RequestInit} [init]
   */
  async function authedFetch(url, init = {}) {
    const token = await getAccessToken();
    const headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    return fetchImpl(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(30000) });
  }

  /** @param {string} remotePath */
  function encodedGraphPath(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    return `${ONEDRIVE_ROOT_PREFIX}/${normalized}`
      .split('/')
      .map(encodeURIComponent)
      .join('/');
  }

  async function getAccountInfo() {
    const [meRes, driveRes] = await Promise.all([
      authedFetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName'),
      authedFetch('https://graph.microsoft.com/v1.0/me/drive?$select=quota').catch(() => null),
    ]);
    const me = meRes.ok ? await meRes.json().catch(() => ({})) : {};
    const drive = driveRes && driveRes.ok ? await driveRes.json().catch(() => ({})) : {};
    return {
      email: me.mail || me.userPrincipalName || null,
      name: me.displayName || null,
      quotaUsed: drive?.quota?.used != null ? Number(drive.quota.used) : null,
      quotaTotal: drive?.quota?.total != null ? Number(drive.quota.total) : null,
    };
  }

  /**
   * @param {string} [subPath]
   * @returns {Promise<Array<{ path: string, size: number, modifiedAt: string }>>}
   */
  async function listChildren(subPath = '') {
    const full = subPath ? `${ONEDRIVE_ROOT_PREFIX}/${subPath}` : ONEDRIVE_ROOT_PREFIX;
    const encoded = full.split('/').map(encodeURIComponent).join('/');
    const res = await authedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encoded}:/children?$top=200`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
    const data = await res.json();
    const out = [];
    for (const item of data.value || []) {
      const rel = subPath ? `${subPath}/${item.name}` : item.name;
      if (item.folder) {
        const nested = await listChildren(rel);
        out.push(...nested);
      } else {
        out.push({
          path: rel,
          size: Number(item.size) || 0,
          modifiedAt: String(item.lastModifiedDateTime || new Date().toISOString()),
        });
      }
    }
    return out;
  }

  async function listFiles() {
    return listChildren('');
  }

  /**
   * @param {string} remotePath
   * @returns {Promise<Buffer | null>}
   */
  async function downloadFile(remotePath) {
    const res = await authedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodedGraphPath(remotePath)}:/content`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * @param {string} remotePath
   * @param {Buffer} buffer
   * @param {string} [contentType]
   */
  async function uploadFile(remotePath, buffer, contentType = 'application/octet-stream') {
    const target = encodedGraphPath(remotePath);
    if (buffer.length <= 4 * 1024 * 1024) {
      const res = await authedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${target}:/content`, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(buffer),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`);
      return true;
    }
    // Chunked upload session for files > 4 MB (e.g. world backups)
    const sessionRes = await authedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${target}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    if (!sessionRes.ok) throw new Error(`OneDrive upload session failed (${sessionRes.status})`);
    const { uploadUrl } = await sessionRes.json();
    const chunkSize = 5 * 1024 * 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const end = Math.min(buffer.length, offset + chunkSize);
      const chunk = buffer.subarray(offset, end);
      const chunkRes = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
        },
        body: new Uint8Array(chunk),
        signal: AbortSignal.timeout(120000),
      });
      if (!chunkRes.ok && chunkRes.status !== 202) {
        throw new Error(`OneDrive chunk upload failed (${chunkRes.status})`);
      }
    }
    return true;
  }

  /** @param {string} remotePath */
  async function deleteFile(remotePath) {
    const res = await authedFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodedGraphPath(remotePath)}`, {
      method: 'DELETE',
    });
    return res.ok || res.status === 404;
  }

  return {
    id: 'onedrive',
    label: 'OneDrive',
    getAccountInfo,
    listFiles,
    downloadFile,
    uploadFile,
    deleteFile,
  };
}

/**
 * Dropbox API v2 provider (App Folder or `/PineLauncherSync`).
 * @param {{ getAccessToken: () => Promise<string>, fetchImpl?: typeof globalThis.fetch }} options
 */
function createDropboxProvider({ getAccessToken, fetchImpl = globalThis.fetch }) {
  /**
   * @param {string} url
   * @param {RequestInit} [init]
   */
  async function authedFetch(url, init = {}) {
    const token = await getAccessToken();
    const headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    return fetchImpl(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(30000) });
  }

  /** @param {string} remotePath */
  function dropboxPath(remotePath) {
    return `/${ONEDRIVE_ROOT_PREFIX}/${normalizeRemotePath(remotePath)}`;
  }

  async function getAccountInfo() {
    const [acctRes, spaceRes] = await Promise.all([
      authedFetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST' }),
      authedFetch('https://api.dropboxapi.com/2/users/get_space_usage', { method: 'POST' }).catch(() => null),
    ]);
    const acct = acctRes.ok ? await acctRes.json().catch(() => ({})) : {};
    const space = spaceRes && spaceRes.ok ? await spaceRes.json().catch(() => ({})) : {};
    return {
      email: acct.email || null,
      name: acct?.name?.display_name || null,
      quotaUsed: space.used != null ? Number(space.used) : null,
      quotaTotal: space?.allocation?.allocated != null ? Number(space.allocation.allocated) : null,
    };
  }

  async function listFiles() {
    const res = await authedFetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `/${ONEDRIVE_ROOT_PREFIX}`, recursive: true }),
    });
    if (res.status === 409) return [];
    if (!res.ok) throw new Error(`Dropbox list failed (${res.status})`);
    const data = await res.json();
    const prefix = `/${ONEDRIVE_ROOT_PREFIX.toLowerCase()}/`;
    const out = [];
    for (const entry of data.entries || []) {
      if (entry['.tag'] !== 'file') continue;
      const lower = String(entry.path_lower || '');
      const display = String(entry.path_display || '');
      const rel = lower.startsWith(prefix) ? display.slice(prefix.length) : display.replace(/^\/+/, '');
      out.push({
        path: rel,
        size: Number(entry.size) || 0,
        modifiedAt: String(entry.server_modified || new Date().toISOString()),
      });
    }
    return out;
  }

  /**
   * @param {string} remotePath
   * @returns {Promise<Buffer | null>}
   */
  async function downloadFile(remotePath) {
    const res = await authedFetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath(remotePath) }),
      },
    });
    if (res.status === 409) return null;
    if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * @param {string} remotePath
   * @param {Buffer} buffer
   */
  async function uploadFile(remotePath, buffer) {
    const res = await authedFetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath(remotePath),
          mode: 'overwrite',
          mute: true,
        }),
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`);
    return true;
  }

  /** @param {string} remotePath */
  async function deleteFile(remotePath) {
    const res = await authedFetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath(remotePath) }),
    });
    return res.ok || res.status === 409;
  }

  return {
    id: 'dropbox',
    label: 'Dropbox',
    getAccountInfo,
    listFiles,
    downloadFile,
    uploadFile,
    deleteFile,
  };
}

/**
 * Local Synced Folder provider (works directly with Google Drive / OneDrive / Dropbox desktop folders or Syncthing).
 * @param {{ rootDir: string }} options
 */
function createLocalFolderProvider({ rootDir }) {
  const cleanRoot = String(rootDir || '').trim();
  if (!cleanRoot) throw new Error('Choose a local sync folder first');
  const syncRoot = path.join(cleanRoot, ONEDRIVE_ROOT_PREFIX);

  async function getAccountInfo() {
    return {
      email: null,
      name: path.basename(cleanRoot) || cleanRoot,
      quotaUsed: null,
      quotaTotal: null,
    };
  }

  /**
   * @param {string} dir
   * @param {string} [prefix]
   */
  function walk(dir, prefix = '') {
    /** @type {Array<{ path: string, size: number, modifiedAt: string }>} */
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full, rel));
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        out.push({
          path: rel,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
    return out;
  }

  async function listFiles() {
    return walk(syncRoot, '');
  }

  /** @param {string} remotePath */
  async function downloadFile(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    const target = resolveSafePath(syncRoot, ...normalized.split('/'));
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }

  /**
   * @param {string} remotePath
   * @param {Buffer} buffer
   */
  async function uploadFile(remotePath, buffer) {
    const normalized = normalizeRemotePath(remotePath);
    const target = resolveSafePath(syncRoot, ...normalized.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
    return true;
  }

  /** @param {string} remotePath */
  async function deleteFile(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    const target = resolveSafePath(syncRoot, ...normalized.split('/'));
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    return true;
  }

  return {
    id: 'local-folder',
    label: 'Synced Folder',
    getAccountInfo,
    listFiles,
    downloadFile,
    uploadFile,
    deleteFile,
  };
}

module.exports = {
  DRIVE_FOLDER_NAME,
  ONEDRIVE_ROOT_PREFIX,
  normalizeRemotePath,
  createGoogleDriveProvider,
  createOneDriveProvider,
  createDropboxProvider,
  createLocalFolderProvider,
};
