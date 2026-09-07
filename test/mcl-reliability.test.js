'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const AdmZip = require('adm-zip');

function freshModules() {
  const patchPath = require.resolve('../lib/mcl-reliability');
  const handlerPath = require.resolve('minecraft-launcher-core/components/handler');
  delete require.cache[patchPath];
  delete require.cache[handlerPath];
  return {
    install: require('../lib/mcl-reliability').installMclReliabilityPatches,
    Handler: require('minecraft-launcher-core/components/handler'),
  };
}

function makeHandler(Handler) {
  const client = new EventEmitter();
  client.options = { overrides: {}, timeout: 1000 };
  return new Handler(client);
}

test('Forge processor outputs with empty URLs are deferred until the installer runs', async () => {
  const { install, Handler } = freshModules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-forge-output-'));
  try {
    install({ fetchImpl: async () => { throw new Error('Generated files must not be downloaded'); } });
    const handler = makeHandler(Handler);
    handler.options.root = dir;
    handler.options.customArgs = ['-Dforgewrapper.installer=forge-1.21.11-61.2.1-installer.jar'];
    const libraries = [{ name: 'net.minecraftforge:forge:1.21.11-61.2.1:client', downloads: { artifact: {
      path: 'net/minecraftforge/forge/1.21.11-61.2.1/forge-1.21.11-61.2.1-client.jar',
      url: '', sha1: '632ace45e535291c7576764c1c8d6388b73c9a75',
    } } }];
    const classes = await handler.downloadToDirectory(dir, libraries, 'classes-custom');
    assert.equal(classes.length, 1);
    assert.match(classes[0], /61\.2\.1-client\.jar$/);
    handler.options.customArgs = [];
    await assert.rejects(handler.downloadToDirectory(dir, libraries, 'classes-custom'), /no retry URL/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Forge downloadable libraries still fail verification when their hash is wrong', async () => {
  const { install, Handler } = freshModules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-forge-hash-'));
  try {
    install({ fetchImpl: async () => new Response('wrong content') });
    const handler = makeHandler(Handler);
    handler.options.root = dir;
    handler.options.customArgs = ['-Dforgewrapper.installer=forge.jar'];
    await assert.rejects(handler.downloadToDirectory(dir, [{ name: 'example:library:1', downloads: { artifact: {
      path: 'example/library/1/library-1.jar', url: 'https://example.test/library.jar', sha1: '0'.repeat(40),
    } } }], 'classes-custom'), /checksum failed after retry/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installed bootstrap Forge launches directly without ForgeWrapper', async () => {
  const { install, Handler } = freshModules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-forge-native-'));
  try {
    const installer = path.join(dir, 'forge-installer.jar');
    const zip = new AdmZip();
    zip.addFile('version.json', Buffer.from(JSON.stringify({ mainClass: 'net.minecraftforge.bootstrap.ForgeBootstrap' })));
    zip.writeZip(installer);
    const relative = 'net/minecraftforge/forge/1.21.11-61.2.1/forge-1.21.11-61.2.1-client.jar';
    const generated = path.join(dir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, 'generated client');
    const hash = require('crypto').createHash('sha1').update('generated client').digest('hex');

    install();
    const handler = makeHandler(Handler);
    handler.options.root = dir;
    handler.options.overrides = { libraryRoot: dir, fw: { version: '1.6.0' } };
    handler.options.forge = installer;
    handler.options.customArgs = ['-Dforgewrapper.installer=' + installer, '-Dkeep=true'];
    // Stub MCLC's original method through the cached-profile path.
    fs.mkdirSync(path.join(dir, 'forge', '1.21.11'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'forge', '1.21.11', 'version.json'), JSON.stringify({
      id: '1.21.11-forge-61.2.1', inheritsFrom: '1.21.11', forgeWrapperVersion: '1.6.0',
      mainClass: 'io.github.zekerzhayard.forgewrapper.installer.Main',
      libraries: [
        { name: 'net.minecraftforge:forge:1.21.11-61.2.1:client', downloads: { artifact: { path: relative, sha1: hash, url: '' } } },
        { name: 'io:github:zekerzhayard:ForgeWrapper:1.6.0' },
      ],
    }));
    handler.version = { id: '1.21.11' };
    const profile = await handler.getForgedWrapped();
    assert.equal(profile.mainClass, 'net.minecraftforge.bootstrap.ForgeBootstrap');
    assert.equal(profile.libraries.some(item => /ForgeWrapper/.test(item.name)), false);
    assert.deepEqual(handler.options.customArgs, ['-Dkeep=true']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('patched downloads reject instead of silently succeeding', async () => {
  const { install, Handler } = freshModules();
  install({ fetchImpl: async () => { throw new Error('network blocked'); } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-download-fail-'));
  try {
    await assert.rejects(makeHandler(Handler).downloadAsync('https://example.invalid/file.jar', dir, 'file.jar', false, 'classes'), /network blocked/);
    assert.equal(fs.existsSync(path.join(dir, 'file.jar')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patched downloads commit complete responses atomically', async () => {
  const { install, Handler } = freshModules();
  const body = Buffer.from('complete file');
  install({ fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-download-ok-'));
  try {
    await makeHandler(Handler).downloadAsync('https://example.test/file.jar', dir, 'file.jar', false, 'classes');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'file.jar')), body);
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.part')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patched downloads limit concurrent network requests', async () => {
  const { install, Handler } = freshModules();
  let active = 0;
  let peak = 0;
  install({
    maxConcurrentDownloads: 2,
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return new Response(Buffer.from('ok'), { status: 200, headers: { 'content-length': '2' } });
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-download-limit-'));
  try {
    const handler = makeHandler(Handler);
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      handler.downloadAsync('https://example.test/' + index, dir, index + '.jar', false, 'classes')
    ));
    assert.equal(peak, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCLC reuses a Java runtime that Pine already verified', async () => {
  const { install, Handler } = freshModules();
  const { rememberValidatedJava } = require('../lib/mcl-reliability');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-java-cache-'));
  const java = path.join(dir, 'java.exe');
  try {
    fs.writeFileSync(java, 'runtime fingerprint');
    install();
    rememberValidatedJava(java, 21);
    const result = await makeHandler(Handler).checkJava(java);
    assert.equal(result.run, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCLC checksum cache rehashes a file only after it changes', async () => {
  const { install, Handler } = freshModules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-checksum-cache-'));
  const file = path.join(dir, 'asset.bin');
  try {
    fs.writeFileSync(file, 'asset');
    install();
    const handler = makeHandler(Handler);
    handler.options.root = dir;
    const hash = require('crypto').createHash('sha1').update('asset').digest('hex');
    assert.equal(await handler.checkSum(hash, file), true);
    assert.equal(await handler.checkSum(hash, file), true);
    fs.writeFileSync(file, 'changed');
    assert.equal(await handler.checkSum(hash, file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
