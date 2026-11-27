'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXTERNAL_HOSTS, createLauncherWindow } = require('../lib/launcher-window');

test('launcher-window maintains required default hosts while allowing safe HTTPS navigation', () => {
  assert(EXTERNAL_HOSTS.has('optifine.net'), 'must include optifine.net');
  assert(EXTERNAL_HOSTS.has('www.optifine.net'), 'must include www.optifine.net');
  assert(EXTERNAL_HOSTS.has('modrinth.com'), 'must include modrinth.com');
  assert(EXTERNAL_HOSTS.has('curseforge.com'), 'must include curseforge.com');
  assert(EXTERNAL_HOSTS.has('github.com'), 'must include github.com');
  assert(EXTERNAL_HOSTS.has('discord.gg'), 'must include discord.gg');
});

test('launcher-window rejects unsafe schemes, local networks, and credentials in external links', () => {
  const opened = [];
  const fakeShell = { openExternal: (url) => opened.push(url) };
  let windowOpenHandler;
  const fakeBrowserWindow = function() {
    return {
      loadFile: () => {},
      on: () => {},
      once: () => {},
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: {
        setWindowOpenHandler: (handler) => { windowOpenHandler = handler; },
        on: () => {},
      },
    };
  };

  createLauncherWindow({
    BrowserWindow: fakeBrowserWindow,
    Menu: { setApplicationMenu: () => {} },
    shell: fakeShell,
    icon: 'icon.png',
    preload: 'preload.js',
    entryFile: 'renderer/index.html',
  });

  assert(typeof windowOpenHandler === 'function', 'setWindowOpenHandler must be registered');

  // Valid HTTPS links
  windowOpenHandler({ url: 'https://github.com/RealSe62em/Pine-Launcher' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0], 'https://github.com/RealSe62em/Pine-Launcher');

  windowOpenHandler({ url: 'https://modrinth.com/mod/sodium' });
  assert.equal(opened.length, 2);

  // Unsafe / rejected URLs
  windowOpenHandler({ url: 'http://insecure.com' });
  windowOpenHandler({ url: 'file:///etc/passwd' });
  windowOpenHandler({ url: 'javascript:alert(1)' });
  windowOpenHandler({ url: 'https://user:pass@example.com' });
  windowOpenHandler({ url: 'https://127.0.0.1:8080' });
  windowOpenHandler({ url: 'https://127.0.0.2:9000' });
  windowOpenHandler({ url: 'https://192.168.1.1/admin' });
  windowOpenHandler({ url: 'https://10.0.0.1/' });
  windowOpenHandler({ url: 'https://172.20.0.1/' });
  windowOpenHandler({ url: 'https://169.254.169.254/latest/meta-data' });
  windowOpenHandler({ url: 'https://[::1]:8080' });
  windowOpenHandler({ url: 'https://router.local' });
  windowOpenHandler({ url: 'https://company.internal' });
  windowOpenHandler({ url: 'https://localhost/test' });

  // Only the two valid HTTPS URLs should have been opened
  assert.equal(opened.length, 2);
});
