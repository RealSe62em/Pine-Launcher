import { DurableObject } from 'cloudflare:workers';

const SESSION_TTL_MS = 6 * 60 * 1000; // 6 minutes
const ALLOWED_STATES = new Set(['launcher', 'playing']);
const ALLOWED_PLATFORMS = new Set(['win32', 'linux', 'darwin']);

/**
 * Constant-time token comparison using Web Crypto SHA-256 digests so secret length/bytes cannot leak via timing.
 */
async function timingSafeTokenEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) {
    return false;
  }
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < viewA.length; i += 1) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

function sanitizeHeartbeat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sessionId = String(raw.sessionId || '').trim();
  if (!/^[a-f0-9-]{16,64}$/i.test(sessionId)) return null;
  const state = ALLOWED_STATES.has(raw.state) ? raw.state : null;
  if (!state) return null;
  const platform = ALLOWED_PLATFORMS.has(raw.platform) ? raw.platform : 'other';
  const version = String(raw.version || 'unknown').trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'unknown';
  return { sessionId, state, platform, version };
}

export class OnlineCounterDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS active_sessions (
          session_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          version TEXT NOT NULL,
          platform TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);
      `);
    });
  }

  pruneExpired(now = Date.now()) {
    this.ctx.storage.sql.exec('DELETE FROM active_sessions WHERE expires_at <= ?', now);
  }

  async recordHeartbeat(payload) {
    const now = Date.now();
    this.pruneExpired(now);
    this.ctx.storage.sql.exec(
      `INSERT INTO active_sessions (session_id, state, version, platform, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         state = excluded.state,
         version = excluded.version,
         platform = excluded.platform,
         expires_at = excluded.expires_at`,
      payload.sessionId,
      payload.state,
      payload.version,
      payload.platform,
      now + SESSION_TTL_MS,
    );
  }

  async removeSession(sessionId) {
    this.ctx.storage.sql.exec('DELETE FROM active_sessions WHERE session_id = ?', sessionId);
  }

  async getStats() {
    const now = Date.now();
    this.pruneExpired(now);
    const rows = this.ctx.storage.sql
      .exec('SELECT state, version, platform FROM active_sessions')
      .toArray();

    let playingNow = 0;
    let inLauncher = 0;
    const byPlatform = {};
    const byVersion = {};

    for (const row of rows) {
      if (row.state === 'playing') playingNow += 1;
      else inLauncher += 1;
      const plat = String(row.platform || 'other');
      const ver = String(row.version || 'unknown');
      byPlatform[plat] = (byPlatform[plat] || 0) + 1;
      byVersion[ver] = (byVersion[ver] || 0) + 1;
    }

    return {
      updatedAt: new Date(now).toISOString(),
      totalOnline: rows.length,
      playingNow,
      inLauncher,
      byPlatform,
      byVersion,
    };
  }
}

function renderPrivateDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pine Launcher — Live Players</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#090b10; color:#f5f7fa; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    .card { width:min(480px,92vw); padding:24px; border-radius:18px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); box-shadow:0 20px 60px rgba(0,0,0,0.55); }
    h1 { margin:0 0 14px; font-size:18px; }
    .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0; }
    .stat { padding:14px 10px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); text-align:center; }
    .stat b { display:block; font-size:26px; }
    .stat span { font-size:12px; color:rgba(255,255,255,0.65); }
    .row { display:flex; gap:8px; }
    input { flex:1; padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.16); background:rgba(0,0,0,0.35); color:#fff; }
    button { padding:9px 14px; border-radius:10px; border:0; background:#ff5cb9; color:#fff; font-weight:600; cursor:pointer; }
    pre { margin:12px 0 0; padding:10px; border-radius:10px; background:rgba(0,0,0,0.35); font-size:12px; color:rgba(255,255,255,0.8); overflow:auto; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Pine Launcher — Private Live Counter</h1>
    <div class="row">
      <input id="tok" type="password" placeholder="Admin token">
      <button id="go" type="button">View</button>
    </div>
    <div class="grid" id="grid" hidden>
      <div class="stat"><b id="s-total">0</b><span>Online</span></div>
      <div class="stat"><b id="s-playing">0</b><span>Playing MC</span></div>
      <div class="stat"><b id="s-launcher">0</b><span>In Launcher</span></div>
    </div>
    <pre id="out" hidden></pre>
  </div>
  <script>
    const tok = document.getElementById('tok');
    const out = document.getElementById('out');
    const grid = document.getElementById('grid');
    tok.value = sessionStorage.getItem('pine_admin_tok') || '';
    async function load() {
      const t = tok.value.trim();
      if (!t) return;
      sessionStorage.setItem('pine_admin_tok', t);
      const res = await fetch('/stats', { headers: { Authorization: 'Bearer ' + t } });
      if (!res.ok) { grid.hidden = true; out.hidden = false; out.textContent = 'Unauthorized (' + res.status + ')'; return; }
      const data = await res.json();
      grid.hidden = false;
      document.getElementById('s-total').textContent = data.totalOnline;
      document.getElementById('s-playing').textContent = data.playingNow;
      document.getElementById('s-launcher').textContent = data.inLauncher;
      out.hidden = false;
      out.textContent = JSON.stringify({ byPlatform: data.byPlatform, byVersion: data.byVersion, updatedAt: data.updatedAt }, null, 2);
    }
    document.getElementById('go').addEventListener('click', load);
    if (tok.value) load();
    setInterval(() => { if (tok.value.trim()) load(); }, 15000);
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/dashboard') {
      return new Response(renderPrivateDashboardHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/stats') {
      const auth = request.headers.get('Authorization') || '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const ok = await timingSafeTokenEqual(provided, env.ADMIN_TOKEN || '');
      if (!ok) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      const stub = env.ONLINE_COUNTER.getByName('global-online-counter');
      const stats = await stub.getStats();
      return Response.json(stats, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (request.method === 'POST' && (url.pathname === '/heartbeat' || url.pathname === '/leave')) {
      const contentLength = Number(request.headers.get('content-length') || '0');
      if (contentLength > 2048) {
        return Response.json({ error: 'Payload too large' }, { status: 413 });
      }
      let body;
      try {
        const text = await request.text();
        if (text.length > 2048) return Response.json({ error: 'Payload too large' }, { status: 413 });
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const stub = env.ONLINE_COUNTER.getByName('global-online-counter');
      if (url.pathname === '/leave') {
        const sid = String(body?.sessionId || '').trim();
        if (!/^[a-f0-9-]{16,64}$/i.test(sid)) return Response.json({ error: 'Invalid sessionId' }, { status: 400 });
        await stub.removeSession(sid);
        return new Response(null, { status: 204 });
      }

      const clean = sanitizeHeartbeat(body);
      if (!clean) return Response.json({ error: 'Invalid heartbeat payload' }, { status: 400 });
      await stub.recordHeartbeat(clean);
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
