'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { modrinthFetch, checkModUpdatesBulk, clearModrinthResponseCache, fileSha1, MODRINTH_API, APP_USER_AGENT } = require('../lib/modrinth-service');

test('modrinthFetch sets user-agent and parses response JSON', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    };
  };

  const res = await modrinthFetch('/search?query=sodium', { fetchImpl: fakeFetch });
  assert.deepEqual(res, { hits: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${MODRINTH_API}/search?query=sodium`);
  assert.equal(calls[0].options.headers['User-Agent'], APP_USER_AGENT);
});

test('clearing download caches invalidates cached Modrinth responses', async () => {
  let calls = 0;
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ call: ++calls }),
  });
  clearModrinthResponseCache();
  assert.equal((await modrinthFetch('/project/cache-test', { fetchImpl: fakeFetch })).call, 1);
  assert.equal((await modrinthFetch('/project/cache-test', { fetchImpl: fakeFetch })).call, 1);
  clearModrinthResponseCache();
  assert.equal((await modrinthFetch('/project/cache-test', { fetchImpl: fakeFetch })).call, 2);
});

test('modrinthFetch retries on HTTP 429 rate limit', async () => {
  let attempt = 0;
  const fakeFetch = async () => {
    attempt++;
    if (attempt === 1) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': '1' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'ok' }),
    };
  };

  const res = await modrinthFetch('/project/sodium', { fetchImpl: fakeFetch, timeout: 5000 });
  assert.equal(res.id, 'ok');
  assert.equal(attempt, 2);
});

test('checkModUpdatesBulk matches mod file hashes in a single call', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-mod-test-'));
  try {
    const jar1 = path.join(tempDir, 'mod-a.jar');
    const jar2 = path.join(tempDir, 'mod-b.jar');
    fs.writeFileSync(jar1, 'dummy content A');
    fs.writeFileSync(jar2, 'dummy content B');
    const hash1 = fileSha1(jar1);

    const mods = [
      { filename: 'mod-a.jar', path: jar1, installedVersion: 'v1', title: 'Mod A', projectId: 'proj-a' },
      { filename: 'mod-b.jar', path: jar2, installedVersion: 'v2', title: 'Mod B', projectId: 'proj-b' },
    ];

    const fakeFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, `${MODRINTH_API}/version_files/update`);
      assert(body.hashes.includes(hash1));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          [hash1]: {
            id: 'v1-latest',
            project_id: 'proj-a',
            name: 'Mod A 1.2',
          },
        }),
      };
    };

    const instance = { gameVersion: '1.20.1', loader: 'fabric' };
    const { updates, remaining } = await checkModUpdatesBulk(mods, instance, { fetchImpl: fakeFetch });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].filename, 'mod-a.jar');
    assert.equal(updates[0].latestVersion, 'v1-latest');
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].filename, 'mod-b.jar');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
