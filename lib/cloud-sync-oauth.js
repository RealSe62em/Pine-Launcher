// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_OAUTH_PORT = 53682;
const CALLBACK_PATH = '/oauth/callback';

/**
 * @typedef {'google-drive' | 'onedrive' | 'dropbox'} OAuthProviderId
 */

/**
 * @typedef {{
 *   id: OAuthProviderId,
 *   label: string,
 *   authUrl: string,
 *   tokenUrl: string,
 *   scope: string,
 *   consoleUrl: string,
 *   supportsClientSecret: boolean,
 *   envClientId: string,
 *   envClientSecret?: string,
 *   extraAuthParams: Record<string, string>,
 * }} OAuthProviderConfig
 */

/** @type {Record<OAuthProviderId, OAuthProviderConfig>} */
const OAUTH_PROVIDERS = Object.freeze({
  'google-drive': Object.freeze({
    id: 'google-drive',
    label: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.file openid email profile',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    supportsClientSecret: true,
    envClientId: 'PINE_GDRIVE_CLIENT_ID',
    envClientSecret: 'PINE_GDRIVE_CLIENT_SECRET',
    extraAuthParams: Object.freeze({
      access_type: 'offline',
      prompt: 'select_account consent',
    }),
  }),
  onedrive: Object.freeze({
    id: 'onedrive',
    label: 'OneDrive',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'Files.ReadWrite.AppFolder User.Read offline_access',
    consoleUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    supportsClientSecret: false,
    envClientId: 'PINE_ONEDRIVE_CLIENT_ID',
    extraAuthParams: Object.freeze({
      prompt: 'select_account',
    }),
  }),
  dropbox: Object.freeze({
    id: 'dropbox',
    label: 'Dropbox',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'files.content.read files.content.write files.metadata.read account_info.read',
    consoleUrl: 'https://www.dropbox.com/developers/apps',
    supportsClientSecret: false,
    envClientId: 'PINE_DROPBOX_CLIENT_ID',
    extraAuthParams: Object.freeze({
      token_access_type: 'offline',
    }),
  }),
});

/**
 * Check if a provider ID is a supported browser OAuth provider.
 * @param {string} id
 * @returns {id is OAuthProviderId}
 */
function isOAuthProvider(id) {
  return id === 'google-drive' || id === 'onedrive' || id === 'dropbox';
}

/**
 * Generate a PKCE S256 verifier and challenge pair.
 * @returns {{ verifier: string, challenge: string, method: 'S256' }}
 */
function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build the default localhost loopback redirect URI.
 * @param {number} [port]
 * @returns {string}
 */
function buildRedirectUri(port = DEFAULT_OAUTH_PORT) {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

/**
 * Build the provider authorization URL that opens in the user's system browser.
 * @param {{ providerId: OAuthProviderId, clientId: string, redirectUri: string, state: string, codeChallenge: string }} options
 * @returns {string}
 */
function buildAuthorizeUrl({ providerId, clientId, redirectUri, state, codeChallenge }) {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported cloud provider: ${providerId}`);
  const cleanClientId = String(clientId || '').trim();
  if (!cleanClientId) throw new Error(`${provider.label} OAuth Client ID is required`);
  const params = new URLSearchParams({
    client_id: cleanClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams,
  });
  return `${provider.authUrl}?${params.toString()}`;
}

/**
 * Render a clean self-contained HTML confirmation page for the browser tab after OAuth redirect.
 * @param {{ ok: boolean, title: string, detail: string }} options
 * @returns {string}
 */
function renderOAuthCallbackPage({ ok, title, detail }) {
  const esc = (/** @type {string} */ s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const accent = ok ? '#30d158' : '#ff453a';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} — Pine Launcher</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#090b10; color:#f5f7fa; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    .card { max-width:420px; width:90%; padding:28px; border-radius:20px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); text-align:center; box-shadow:0 24px 60px rgba(0,0,0,0.55); }
    .dot { width:44px; height:44px; border-radius:50%; margin:0 auto 14px; display:grid; place-items:center; background:${accent}22; border:1.5px solid ${accent}; color:${accent}; font-size:22px; font-weight:700; }
    h1 { margin:0 0 8px; font-size:19px; }
    p { margin:0; color:rgba(255,255,255,0.72); font-size:14px; line-height:1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="dot">${ok ? '✓' : '!'}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(detail)}</p>
  </div>
</body>
</html>`;
}

/**
 * Exchange an OAuth authorization code + PKCE verifier for tokens.
 * @param {{ providerId: OAuthProviderId, code: string, redirectUri: string, clientId: string, clientSecret?: string, codeVerifier: string, fetchImpl?: typeof globalThis.fetch }} options
 */
async function exchangeAuthorizationCode({ providerId, code, redirectUri, clientId, clientSecret = '', codeVerifier, fetchImpl = globalThis.fetch }) {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported cloud provider: ${providerId}`);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (provider.supportsClientSecret && clientSecret) {
    params.set('client_secret', clientSecret);
  }
  const response = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`${provider.label} sign-in failed: ${reason}`);
  }
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: payload.scope ? String(payload.scope) : provider.scope,
    tokenType: String(payload.token_type || 'Bearer'),
  };
}

/**
 * Refresh an OAuth access token using a stored refresh token.
 * @param {{ providerId: OAuthProviderId, refreshToken: string, clientId: string, clientSecret?: string, fetchImpl?: typeof globalThis.fetch }} options
 */
async function refreshProviderToken({ providerId, refreshToken, clientId, clientSecret = '', fetchImpl = globalThis.fetch }) {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported cloud provider: ${providerId}`);
  if (!refreshToken) throw new Error(`${provider.label} session expired. Reconnect in Cloud Sync settings.`);
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (provider.supportsClientSecret && clientSecret) {
    params.set('client_secret', clientSecret);
  }
  const response = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`${provider.label} token refresh failed: ${reason}`);
  }
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: payload.scope ? String(payload.scope) : provider.scope,
    tokenType: String(payload.token_type || 'Bearer'),
  };
}

/**
 * Start a localhost loopback OAuth 2.0 + PKCE flow in the user's default browser.
 * Returns `{ promise, cancel, redirectUri }` so UI can cancel a pending sign-in cleanly.
 * @param {{
 *   providerId: OAuthProviderId,
 *   clientId: string,
 *   clientSecret?: string,
 *   openExternal: (url: string) => Promise<void> | void,
 *   fetchImpl?: typeof globalThis.fetch,
 *   preferredPort?: number,
 *   timeoutMs?: number,
 * }} options
 */
function startBrowserOAuthFlow({
  providerId,
  clientId,
  clientSecret = '',
  openExternal,
  fetchImpl = globalThis.fetch,
  preferredPort = DEFAULT_OAUTH_PORT,
  timeoutMs = 180000,
}) {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported cloud provider: ${providerId}`);
  const pkce = generatePkcePair();
  const state = crypto.randomBytes(24).toString('hex');

  /** @type {http.Server | null} */
  let server = null;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let settled = false;
  /** @type {(err: Error) => void} */
  let rejectFlow = () => {};

  function cleanup() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (server) {
      try { server.close(); } catch {}
      server = null;
    }
  }

  /** @param {string} [reason] */
  function cancel(reason = 'Sign-in was cancelled') {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFlow(new Error(reason));
  }

  const promise = new Promise((resolve, reject) => {
    rejectFlow = reject;
    let redirectUri = buildRedirectUri(preferredPort);

    server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const errorParam = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');
        const returnedState = reqUrl.searchParams.get('state');
        const code = reqUrl.searchParams.get('code');

        if (errorParam) {
          const detail = errorDesc || errorParam;
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderOAuthCallbackPage({
            ok: false,
            title: `${provider.label} connection cancelled`,
            detail: `${detail}. You can close this tab and return to Pine Launcher.`,
          }));
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`${provider.label} sign-in cancelled: ${detail}`));
          }
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderOAuthCallbackPage({
            ok: false,
            title: 'Invalid sign-in response',
            detail: 'Security state mismatch. Please start the connection again from Pine Launcher.',
          }));
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('OAuth state verification failed'));
          }
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage({
          ok: true,
          title: `${provider.label} connected`,
          detail: 'You can close this browser tab and return to Pine Launcher.',
        }));

        if (!settled) {
          settled = true;
          cleanup();
          exchangeAuthorizationCode({
            providerId,
            code,
            redirectUri,
            clientId,
            clientSecret,
            codeVerifier: pkce.verifier,
            fetchImpl,
          }).then(resolve, reject);
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    });

    const beginListening = (/** @type {number} */ portToTry, /** @type {boolean} */ allowFallback) => {
      server?.once('error', (/** @type {NodeJS.ErrnoException} */ err) => {
        if (allowFallback && err.code === 'EADDRINUSE') {
          beginListening(0, false);
          return;
        }
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`Could not start local OAuth callback listener: ${err.message}`));
        }
      });

      server?.listen(portToTry, '127.0.0.1', () => {
        const addr = server?.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : preferredPort;
        redirectUri = buildRedirectUri(boundPort);
        const authUrl = buildAuthorizeUrl({
          providerId,
          clientId,
          redirectUri,
          state,
          codeChallenge: pkce.challenge,
        });
        timer = setTimeout(() => {
          cancel(`${provider.label} sign-in timed out after ${Math.round(timeoutMs / 1000)} seconds`);
        }, timeoutMs);
        Promise.resolve(openExternal(authUrl)).catch(openError => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Could not open your browser: ${openError?.message || openError}`));
          }
        });
      });
    };

    beginListening(preferredPort, preferredPort !== 0);
  });

  return { promise, cancel };
}

/**
 * Create an encrypted store for Cloud Sync OAuth tokens and custom OAuth app credentials.
 * Refuses to persist tokens in plaintext if OS keyring / safeStorage is unavailable.
 * @param {{
 *   authFile: string,
 *   safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (text: string) => Buffer, decryptString: (buf: Buffer) => string },
 *   isSecureStorageAvailable: () => boolean,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 */
function createCloudAuthStore({ authFile, safeStorage, isSecureStorageAvailable, env = process.env }) {
  function emptyStore() {
    return { version: 1, providers: {} };
  }

  function readStore() {
    try {
      if (!fs.existsSync(authFile)) return emptyStore();
      if (!isSecureStorageAvailable()) return emptyStore();
      const raw = fs.readFileSync(authFile);
      if (!raw.length) return emptyStore();
      const parsed = JSON.parse(safeStorage.decryptString(raw));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.providers !== 'object') {
        return emptyStore();
      }
      return { version: 1, providers: parsed.providers };
    } catch {
      return emptyStore();
    }
  }

  /** @param {{ version: number, providers: Record<string, any> }} data */
  function writeStore(data) {
    if (!isSecureStorageAvailable()) {
      throw new Error(
        `${process.platform === 'linux' ? 'Linux Secret Service' : 'OS secure credential storage'} is unavailable, so Pine will not save Cloud Sync credentials in plaintext`,
      );
    }
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(data));
    const tempFile = `${authFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, encrypted, { mode: 0o600 });
    fs.renameSync(tempFile, authFile);
  }

  /** @param {OAuthProviderId} providerId */
  function getProviderEntry(providerId) {
    const store = readStore();
    return store.providers[providerId] || {};
  }

  /** @param {OAuthProviderId} providerId */
  function resolveOAuthCredentials(providerId) {
    const meta = OAUTH_PROVIDERS[providerId];
    const saved = getProviderEntry(providerId);
    const savedClientId = String(saved.clientId || '').trim();
    const savedClientSecret = String(saved.clientSecret || '').trim();
    if (savedClientId) {
      return {
        clientId: savedClientId,
        clientSecret: savedClientSecret,
        source: /** @type {'saved'} */ ('saved'),
      };
    }
    const envClientId = String(env[meta.envClientId] || '').trim();
    const envClientSecret = meta.envClientSecret ? String(env[meta.envClientSecret] || '').trim() : '';
    if (envClientId) {
      return {
        clientId: envClientId,
        clientSecret: envClientSecret,
        source: /** @type {'env'} */ ('env'),
      };
    }
    return {
      clientId: '',
      clientSecret: '',
      source: /** @type {'none'} */ ('none'),
    };
  }

  /**
   * @param {OAuthProviderId} providerId
   * @param {{ clientId?: string, clientSecret?: string }} creds
   */
  function saveOAuthCredentials(providerId, { clientId = '', clientSecret = '' }) {
    const store = readStore();
    const prev = store.providers[providerId] || {};
    const cleanId = String(clientId || '').trim().slice(0, 256);
    const cleanSecret = String(clientSecret || '').trim().slice(0, 256);
    store.providers[providerId] = {
      ...prev,
      clientId: cleanId || undefined,
      clientSecret: cleanSecret || undefined,
    };
    writeStore(store);
  }

  /**
   * @param {OAuthProviderId} providerId
   * @param {{ accessToken: string, refreshToken: string | null, expiresAt: number, scope?: string, tokenType?: string, account?: import('../types').CloudSyncAccountInfo | null }} session
   */
  function saveProviderSession(providerId, session) {
    const store = readStore();
    const prev = store.providers[providerId] || {};
    store.providers[providerId] = {
      ...prev,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken || prev.refreshToken || null,
      expiresAt: session.expiresAt,
      scope: session.scope || prev.scope || null,
      tokenType: session.tokenType || 'Bearer',
      account: session.account !== undefined ? session.account : (prev.account || null),
      connectedAt: new Date().toISOString(),
    };
    writeStore(store);
  }

  /** @param {OAuthProviderId} providerId */
  function clearProviderSession(providerId) {
    const store = readStore();
    const prev = store.providers[providerId] || {};
    store.providers[providerId] = {
      clientId: prev.clientId,
      clientSecret: prev.clientSecret,
    };
    writeStore(store);
  }

  /**
   * Get a valid access token for a provider, refreshing automatically if near expiry.
   * @param {OAuthProviderId} providerId
   * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
   * @returns {Promise<string>}
   */
  async function getValidAccessToken(providerId, { fetchImpl = globalThis.fetch } = {}) {
    const entry = getProviderEntry(providerId);
    if (!entry.accessToken && !entry.refreshToken) {
      throw new Error(`${OAUTH_PROVIDERS[providerId].label} is not connected`);
    }
    const now = Date.now();
    if (entry.accessToken && Number(entry.expiresAt) > now + 60_000) {
      return entry.accessToken;
    }
    const creds = resolveOAuthCredentials(providerId);
    if (!creds.clientId) {
      throw new Error(`${OAUTH_PROVIDERS[providerId].label} OAuth Client ID is missing`);
    }
    const refreshed = await refreshProviderToken({
      providerId,
      refreshToken: entry.refreshToken,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      fetchImpl,
    });
    saveProviderSession(providerId, { ...refreshed, account: entry.account || null });
    return refreshed.accessToken;
  }

  return {
    getProviderEntry,
    resolveOAuthCredentials,
    saveOAuthCredentials,
    saveProviderSession,
    clearProviderSession,
    getValidAccessToken,
  };
}

module.exports = {
  DEFAULT_OAUTH_PORT,
  CALLBACK_PATH,
  OAUTH_PROVIDERS,
  isOAuthProvider,
  generatePkcePair,
  buildRedirectUri,
  buildAuthorizeUrl,
  renderOAuthCallbackPage,
  exchangeAuthorizationCode,
  refreshProviderToken,
  startBrowserOAuthFlow,
  createCloudAuthStore,
};
