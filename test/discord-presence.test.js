const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  DiscordPresence,
  discordIpcEndpoints,
  encodeFrame,
  isPrivateServerAddress,
  normalizeServerIcon,
  normalizeActivityButtons,
  normalizeActivityUrl,
  normalizeServerAddress,
  parseGamePresenceLine,
  serverDisplayAddress,
  serverDisplayName,
} = require('../lib/discord-presence');

test('uses native Discord IPC endpoints on Windows and Linux', () => {
  assert.equal(discordIpcEndpoints({ platform: 'win32', maxPipeIndex: 0 })[0], '\\\\?\\pipe\\discord-ipc-0');
  const linux = discordIpcEndpoints({ platform: 'linux', maxPipeIndex: 0 });
  assert.ok(linux.some(endpoint => endpoint.endsWith('/discord-ipc-0')));
  assert.ok(linux.some(endpoint => endpoint.endsWith('/snap.discord/discord-ipc-0')));
  assert.ok(linux.some(endpoint => endpoint.endsWith('/app/com.discordapp.Discord/discord-ipc-0')));
  assert.ok(linux.some(endpoint => endpoint.endsWith('/app/dev.vencord.Vesktop/discord-ipc-0')));
  assert.ok(linux.every(endpoint => !endpoint.includes('\\\\?\\pipe')));
});

test('encodes Discord IPC frames', () => {
  const frame = encodeFrame(0, { v: 1, client_id: '123' });
  assert.equal(frame.readInt32LE(0), 0);
  assert.equal(frame.readInt32LE(4), frame.length - 8);
  assert.deepEqual(JSON.parse(frame.subarray(8).toString()), { v: 1, client_id: '123' });
});

test('normalizes and protects private server addresses', () => {
  assert.equal(normalizeServerAddress('Play.Example.COM:25565'), 'play.example.com');
  assert.equal(isPrivateServerAddress('192.168.1.4:25565'), true);
  assert.equal(isPrivateServerAddress('play.example.com'), false);
  assert.equal(serverDisplayName('192.168.1.4'), 'Private server');
});

test('uses the friendly Minecraft saved-server name', () => {
  const servers = [{ name: 'The Pine Test Realm', ip: 'play.example.com:25565' }];
  assert.equal(serverDisplayName('play.example.com', servers), 'The Pine Test Realm');
});

test('formats the exact multiplayer address for Discord', () => {
  assert.equal(serverDisplayAddress('play.example.com', 25565), 'play.example.com');
  assert.equal(serverDisplayAddress('play.example.com:25565', 25565), 'play.example.com');
  assert.equal(serverDisplayAddress('play.example.com:25565'), 'play.example.com');
  assert.equal(serverDisplayAddress('play.example.com:25570', 25570), 'play.example.com:25570');
  assert.equal(serverDisplayAddress('2001:db8::1', 25565), '2001:db8::1');
});

test('accepts real PNG server icons and rejects placeholder text', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.match(normalizeServerIcon(png.toString('base64')), /^data:image\/png;base64,/);
  assert.equal(normalizeServerIcon('not-an-icon'), null);
});

test('keeps up to two secure Rich Presence buttons', () => {
  assert.deepEqual(normalizeActivityButtons([
    { label: 'Join Pine Discord', url: 'https://discord.gg/XT3HNASPVs' },
    { label: 'Unsafe', url: 'javascript:alert(1)' },
    { label: 'Website', url: 'https://example.com/path' },
  ]), [
    { label: 'Join Pine Discord', url: 'https://discord.gg/XT3HNASPVs' },
    { label: 'Website', url: 'https://example.com/path' },
  ]);
});

test('allows secure activity links and rejects other protocols', () => {
  assert.equal(normalizeActivityUrl('https://discord.gg/XT3HNASPVs'), 'https://discord.gg/XT3HNASPVs');
  assert.equal(normalizeActivityUrl('http://discord.gg/XT3HNASPVs'), undefined);
  assert.equal(normalizeActivityUrl('javascript:alert(1)'), undefined);
});

test('recognizes game activity log lines', () => {
  assert.deepEqual(parseGamePresenceLine('[Render thread/INFO]: Connecting to mc.hypixel.net, 25565'),
    { type: 'multiplayer', address: 'mc.hypixel.net', port: 25565 });
  assert.deepEqual(parseGamePresenceLine('[Render thread/INFO]: Connecting to /203.0.113.8:25570'),
    { type: 'multiplayer', address: '203.0.113.8', port: 25570 });
  assert.deepEqual(parseGamePresenceLine('[Render thread/INFO]: Connecting to play.example.com/203.0.113.8:25570'),
    { type: 'multiplayer', address: '203.0.113.8', port: 25570 });
  assert.deepEqual(parseGamePresenceLine('Starting integrated minecraft server'), { type: 'singleplayer' });
  assert.deepEqual(parseGamePresenceLine('Disconnected'), { type: 'menu' });
});

test('completes a Discord desktop handshake and publishes activity', async t => {
  const pipePrefix = process.platform === 'win32'
    ? `\\\\?\\pipe\\pine-discord-presence-test-${process.pid}-${Date.now()}-`
    : path.join(os.tmpdir(), `pine-discord-${process.pid}-${Date.now()}-`);
  const pipe = `${pipePrefix}0`;
  let received = Buffer.alloc(0);
  let resolveActivity;
  const activityPromise = new Promise(resolve => { resolveActivity = resolve; });
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 8 && received.length >= 8 + received.readInt32LE(4)) {
        const opcode = received.readInt32LE(0);
        const length = received.readInt32LE(4);
        const payload = JSON.parse(received.subarray(8, 8 + length).toString());
        received = received.subarray(8 + length);
        if (opcode === 0) socket.write(encodeFrame(1, { evt: 'READY' }));
        if (payload.cmd === 'SET_ACTIVITY') resolveActivity(payload.args.activity);
      }
    });
  });
  try {
    await new Promise((resolve, reject) => server.listen(pipe, resolve).once('error', reject));
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('The test sandbox does not permit local IPC sockets');
      return;
    }
    throw error;
  }
  const presence = new DiscordPresence('123', { pipePrefix, maxPipeIndex: 0 });
  presence.setEnabled(true);
  presence.setActivity({
    details: 'Playing Pine Test',
    detailsUrl: 'https://discord.gg/XT3HNASPVs',
    state: 'On Test Server',
    stateUrl: 'https://discord.gg/XT3HNASPVs',
    largeImageKey: 'pine_logo',
    largeImageText: 'Pine Launcher',
    largeImageUrl: 'https://discord.gg/XT3HNASPVs',
    buttons: [{ label: 'Join Pine Discord', url: 'https://discord.gg/XT3HNASPVs' }],
  });
  const activity = await Promise.race([
    activityPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Discord IPC activity timed out')), 3000)),
  ]);
  assert.equal(activity.details, 'Playing Pine Test');
  assert.equal(activity.details_url, 'https://discord.gg/XT3HNASPVs');
  assert.equal(activity.state, 'On Test Server');
  assert.equal(activity.state_url, 'https://discord.gg/XT3HNASPVs');
  assert.deepEqual(activity.assets, { large_image: 'pine_logo', large_text: 'Pine Launcher', large_url: 'https://discord.gg/XT3HNASPVs' });
  assert.deepEqual(activity.buttons, [{ label: 'Join Pine Discord', url: 'https://discord.gg/XT3HNASPVs' }]);
  presence.destroy();
  await new Promise(resolve => server.close(resolve));
});
