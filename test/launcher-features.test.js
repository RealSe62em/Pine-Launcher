'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const { claimOnboarding, finishOnboarding, recommendedMemory } = require('../lib/onboarding');
const { DownloadManager } = require('../lib/download-manager');
const { inspectInstanceHealth } = require('../lib/instance-health');
const { previewPackChanges } = require('../lib/pack-preview');
const { buildSupportReport } = require('../lib/support-report');
const { parseAddress, varint, readVarint, serverText, pingServer } = require('../lib/server-dashboard');
const { planDefaultMemoryMigration } = require('../lib/memory-defaults');
const { writeJsonAtomic, readJsonRecovering } = require('../lib/json-store');
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-feature-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const tick = () => new Promise(resolve => setImmediate(resolve));
test('first-open tour survives skip, completion, restart, and settings reset', t => {
  for (const status of ['skipped', 'completed']) {
    const root = temp(t), marker = path.join(root, 'onboarding.json');
    assert.equal(claimOnboarding(marker), true);
    assert.equal(claimOnboarding(marker), false); // closing/crashing during tour
    finishOnboarding(marker, status);
    writeJsonAtomic(path.join(root, 'settings.json'), {});
    assert.equal(claimOnboarding(marker), false);
    assert.equal(readJsonRecovering(marker).status, status);
    fs.unlinkSync(marker); // backup also prevents accidental replay
    assert.equal(claimOnboarding(marker), false);
  }
});
test('upgrading an existing user does not interrupt them with onboarding', t => {
  const marker = path.join(temp(t), 'onboarding.json');
  assert.equal(claimOnboarding(marker, true), false);
  assert.equal(readJsonRecovering(marker).status, 'existing-user');
  assert.equal(claimOnboarding(marker), false);
  assert.equal(recommendedMemory(4 * 1024 ** 3), '2G');
  assert.equal(recommendedMemory(64 * 1024 ** 3), '6G');
});
test('download pause and resume preserve the owning operation and installed state', async () => {
  const manager = new DownloadManager(); let advanced = false;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const operation = manager.run(path.join('/tmp', 'batch', 'mod.jar'), async control => { await gate; await control.checkpoint(); advanced = true; control.progress(20, 20); return 'verified'; });
  const id = manager.list()[0].id;
  manager.control(id, 'pause'); release(); await tick();
  assert.equal(advanced, false);
  manager.control(id, 'resume'); assert.equal(await operation, 'verified');
  assert.equal(manager.list()[0].status, 'downloaded');
  manager.markUnder(path.join('/tmp', 'batch'), 'installed');
  assert.equal(manager.list()[0].status, 'installed');
  assert.equal(manager.active, false);
  assert.equal('destination' in manager.list()[0], false);
});
test('download retry completes the original promise and cancellation unblocks failed or paused jobs', async () => {
  const manager = new DownloadManager(); let attempts = 0;
  const operation = manager.run('/tmp/retry.jar', async () => { if (++attempts === 1) throw new Error('Temporary outage'); return 42; });
  await tick(); assert.equal(manager.list()[0].status, 'failed');
  manager.control(manager.list()[0].id, 'retry'); assert.equal(await operation, 42);
  for (const pause of [true, false]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const failing = manager.run('/tmp/cancel.jar', async control => { await gate; await control.checkpoint(); throw new Error('Offline'); });
    const rejected = assert.rejects(failing, { code: 'DOWNLOAD_CANCELLED' });
    const id = manager.list().at(-1).id;
    if (pause) manager.control(id, 'pause');
    release(); await tick(); manager.control(id, 'cancel'); await rejected;
    assert.equal(manager.list().at(-1).status, 'cancelled');
  }
});
test('health checks find active duplicate mods, missing dependencies, Java and RAM issues', t => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'mods'));
  for (const filename of ['a.jar', 'b.jar', 'disabled.jar.disabled']) { const zip = new Zip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'example', version: '1', depends: { missing: '*' } }))); zip.writeZip(path.join(root, 'mods', filename)); }
  const health = inspectInstanceHealth(root, { name: 'test', gameVersion: '1.21.1', loader: 'fabric' }, { minMemory: '1G', maxMemory: '8G' }, { javaMajor: 17, requiredJava: 21, totalMemory: 8 * 1024 ** 3 });
  assert.equal(health.inspectedMods, 2);
  for (const code of ['duplicate', 'dependency', 'java', 'memory']) assert.ok(health.issues.some(issue => issue.code === code));
  assert.equal(inspectInstanceHealth(path.join(root, 'missing'), {}, { minMemory: '1G', maxMemory: '2G' }).issues[0].severity, 'error');
});
test('pack previews identify custom replacements and removals and invalidate stale approval', t => {
  const root = temp(t), layer = temp(t);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  for (const [file, content] of Object.entries({ changed: 'custom edit', removed: 'custom edit', user: 'local', same: 'same' })) fs.writeFileSync(path.join(root, file), content);
  for (const [file, content] of Object.entries({ changed: 'next', added: 'new', user: 'incoming', same: 'same' })) fs.writeFileSync(path.join(layer, file), content);
  const previous = ['changed', 'removed', 'same'].map(file => ({ path: file, hashes: { sha256: hash(file === 'same' ? 'same' : 'original') } }));
  const next = ['changed', 'added', 'user', 'same'].map(file => ({ path: file }));
  const preview = previewPackChanges(root, layer, previous, next);
  assert.deepEqual(preview.added, ['added']); assert.deepEqual(preview.removed, ['removed']);
  assert.deepEqual(preview.changed, ['changed', 'user']); assert.deepEqual(preview.conflicts.sort(), ['changed', 'removed', 'user']);
  assert.equal(previewPackChanges(root, layer, previous, next).fingerprint, preview.fingerprint);
  fs.writeFileSync(path.join(root, 'same'), 'changed during review');
  assert.notEqual(previewPackChanges(root, layer, previous, next).fingerprint, preview.fingerprint);
  assert.throws(() => previewPackChanges(root, layer, [], [{ path: '../outside' }]), /unsafe/);
});
test('support reports allowlist fields and redact common secrets before review', () => {
  const report = buildSupportReport({ launcherVersion: '1.2.4', platform: 'linux x64', instance: { name: 'Private name', gameVersion: '1.21.1', loader: 'fabric', javaPath: '/home/private/java', accessToken: 'NEVER_EXPORT' }, java: {}, memory: { min: '1G', max: '4G' }, mods: [{ filename: 'example.jar', accessToken: 'NEVER_EXPORT' }], diagnostics: { sources: ['logs/latest.log'], log: 'accessToken=SECRET_TOKEN user@example.com /home/private/game/file' }, health: { issues: [] } });
  for (const secret of ['NEVER_EXPORT', 'Private name', 'SECRET_TOKEN', 'user@example.com', '/home/private']) assert.equal(report.includes(secret), false, secret);
  assert.ok(report.includes('example.jar')); assert.ok(report.includes('1.21.1'));
});
test('server addresses and packet framing handle ports, IPv6, fragmentation, and unsafe input', () => {
  assert.equal(parseAddress('play.example.com').port, 25565);
  assert.equal(parseAddress('[::1]:25566').host, '::1');
  for (const input of ['https://example.com', 'host:0', 'host:65536', 'host\n--flag']) assert.throws(() => parseAddress(input));
  for (const value of [0, 127, 128, 25565, 1048576]) assert.equal(readVarint(varint(value)).value, value);
  assert.equal(readVarint(Buffer.from([128])), null);
  assert.throws(() => readVarint(Buffer.from([128, 128, 128, 128, 128])));
  assert.equal(serverText({ text: '§aHello', extra: [{ text: ' world' }] }), 'Hello world');
});
test('server dashboard performs a real status and ping exchange with a local fixture', async t => {
  const net = require('node:net'); const server = net.createServer(socket => {
    let sent = false;
    socket.on('data', chunk => {
      if (!sent) {
        sent = true; const json = Buffer.from(JSON.stringify({ version: { name: 'Fixture 1.21.1' }, players: { online: 3, max: 20 }, description: 'Hello' }));
        const body = Buffer.concat([varint(0), varint(json.length), json]); const frame = Buffer.concat([varint(body.length), body]);
        socket.write(frame.subarray(0, 1)); setImmediate(() => socket.write(frame.subarray(1)));
      } else socket.write(chunk);
    });
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Sandbox disallows local sockets'); throw error; }
  t.after(() => server.close());
  const status = await pingServer(`127.0.0.1:${server.address().port}`);
  assert.equal(status.online, true); assert.equal(status.players, 3); assert.equal(status.version, 'Fixture 1.21.1'); assert.ok(status.latencyMs >= 0);
});
test('upgrade migration preserves all loader identities, custom roots, worlds and chosen memory', t => {
  const root = temp(t); const world = path.join(root, 'level.dat'); fs.writeFileSync(world, 'precious world');
  const instances = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(loader => ({ name: loader, loader, loaderVersion: 'pinned', gameVersion: '1.21.1', customPath: root, modpack: { lockState: 'locked' } }));
  const result = planDefaultMemoryMigration({ minMemory: '1G', maxMemory: '3G', customSetting: 'keep' }, instances);
  const file = path.join(root, 'registry.json'); writeJsonAtomic(file, result.instances);
  for (const instance of readJsonRecovering(file)) { assert.equal(instance.customPath, root); assert.equal(instance.loaderVersion, 'pinned'); assert.equal(instance.maxMemory, '3G'); assert.equal(instance.modpack.lockState, 'locked'); }
  assert.equal(result.settings.customSetting, 'keep'); assert.equal(fs.readFileSync(world, 'utf8'), 'precious world');
  assert.equal(planDefaultMemoryMigration(result.settings, result.instances).changed, false);
});
test('health recognizes dependencies bundled inside another mod', t => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'mods'));
  const nested = new Zip(); nested.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'bundled_api', version: '1' })));
  const provider = new Zip(); provider.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'provider', jars: [{ file: 'nested/api.jar' }] }))); provider.addFile('nested/api.jar', nested.toBuffer()); provider.writeZip(path.join(root, 'mods', 'provider.jar'));
  const consumer = new Zip(); consumer.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'consumer', depends: { bundled_api: '*' } }))); consumer.writeZip(path.join(root, 'mods', 'consumer.jar'));
  const health = inspectInstanceHealth(root, { loader: 'fabric' }, { minMemory: '1G', maxMemory: '3G' });
  assert.equal(health.issues.some(issue => issue.code === 'dependency'), false);
});
