'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CURSEFORGE_CLASS_IDS,
  maskApiKey,
  createCurseForgeKeyStore,
  buildCurseForgeSearchParams,
  buildCurseForgeFilesParams,
  normalizeCurseForgeHit,
  assertAllowedCurseForgeUrl,
  testCurseForgeApiKey,
  createDistributionBlockedError,
} = require('../lib/curseforge-service');

function createFakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buf) => {
      const str = buf.toString('utf8');
      if (!str.startsWith('enc:')) throw new Error('corrupt');
      return str.slice(4);
    },
  };
}

test('CurseForge key store encrypts keys via safeStorage and refuses plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-cf-key-'));
  const keyFile = path.join(dir, 'curseforge-key.bin');
  try {
    const insecureStore = createCurseForgeKeyStore({
      keyFile,
      safeStorage: createFakeSafeStorage(),
      isSecureStorageAvailable: () => false,
      env: {},
    });
    assert.throws(() => insecureStore.saveKey('$2a$10$exampleCurseForgeKey123456'), /plaintext/i);

    const store = createCurseForgeKeyStore({
      keyFile,
      safeStorage: createFakeSafeStorage(),
      isSecureStorageAvailable: () => true,
      env: {},
    });
    assert.deepEqual(store.getStatus(), {
      configured: false,
      source: 'none',
      secureStorageAvailable: true,
      keyHint: null,
    });

    const savedStatus = store.saveKey('$2a$10$exampleCurseForgeKey123456');
    assert.equal(savedStatus.configured, true);
    assert.equal(savedStatus.source, 'saved');
    assert.equal(savedStatus.keyHint, maskApiKey('$2a$10$exampleCurseForgeKey123456'));
    assert.equal(store.getActiveKey(), '$2a$10$exampleCurseForgeKey123456');
    assert.ok(fs.readFileSync(keyFile, 'utf8').startsWith('enc:'));

    const cleared = store.clearKey();
    assert.equal(cleared.configured, false);
    assert.equal(store.getActiveKey(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CurseForge search and file params cover all 5 content types and skip modLoaderType for non-mod assets', () => {
  assert.equal(CURSEFORGE_CLASS_IDS.mod, 6);
  assert.equal(CURSEFORGE_CLASS_IDS.resourcepack, 12);
  assert.equal(CURSEFORGE_CLASS_IDS.modpack, 4471);
  assert.equal(CURSEFORGE_CLASS_IDS.datapack, 6945);
  assert.equal(CURSEFORGE_CLASS_IDS.shader, 6552);

  const modParams = buildCurseForgeSearchParams('sodium', { type: 'mod', gameVersion: '1.21.4', loader: 'fabric', sort: 'downloads' });
  assert.equal(modParams.get('classId'), '6');
  assert.equal(modParams.get('modLoaderType'), '4');
  assert.equal(modParams.get('sortField'), '6');

  for (const assetType of ['resourcepack', 'shader', 'datapack']) {
    const searchParams = buildCurseForgeSearchParams('faithful', { type: assetType, gameVersion: '1.21.4', loader: 'fabric' });
    assert.equal(searchParams.get('classId'), String(CURSEFORGE_CLASS_IDS[assetType]));
    assert.equal(searchParams.get('modLoaderType'), null);

    const fileParams = buildCurseForgeFilesParams({ gameVersion: '1.21.4', loader: 'fabric' }, assetType);
    assert.equal(fileParams.get('gameVersion'), '1.21.4');
    assert.equal(fileParams.get('modLoaderType'), null);
  }

  const modFileParams = buildCurseForgeFilesParams({ gameVersion: '1.21.4', loader: 'neoforge' }, 'mod');
  assert.equal(modFileParams.get('modLoaderType'), '6');
});

test('CurseForge key test, hit normalization, URL allowlist, and blocked-download formatting behave safely', async () => {
  const hit = normalizeCurseForgeHit({
    id: 238222,
    name: 'Just Enough Items (JEI)',
    summary: 'View Items and Recipes',
    downloadCount: 320000000,
    authors: [{ name: 'mezz' }],
    logo: { url: 'https://mediafilez.forgecdn.net/jei.png' },
    links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' },
    categories: [{ name: 'Map and Information' }],
  }, 'mod');
  assert.equal(hit.project_id, 'curseforge:238222');
  assert.equal(hit.source, 'curseforge');
  assert.equal(hit.author, 'mezz');

  const okRes = await testCurseForgeApiKey('valid-key-123456', {
    fetchImpl: async () => new Response(JSON.stringify({ data: { name: 'Minecraft' } }), { status: 200 }),
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.game, 'Minecraft');

  const badRes = await testCurseForgeApiKey('bad-key-123456', {
    fetchImpl: async () => new Response('', { status: 403 }),
  });
  assert.equal(badRes.ok, false);
  assert.match(badRes.message, /403/);

  assert.equal(assertAllowedCurseForgeUrl('https://console.curseforge.com/#/api-keys'), 'https://console.curseforge.com/#/api-keys');
  assert.throws(() => assertAllowedCurseForgeUrl('https://evil.example.com/phish'));
  assert.throws(() => assertAllowedCurseForgeUrl('javascript:alert(1)'));

  const blockedErr = createDistributionBlockedError(
    { links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/example' } },
    { id: 998877 },
  );
  assert.equal(blockedErr.manualDownloadUrl, 'https://www.curseforge.com/minecraft/mc-mods/example/files/998877');
  assert.match(blockedErr.message, /third-party/i);
});
