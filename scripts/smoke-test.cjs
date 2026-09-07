'use strict';
// Runs the real preload, renderer, and IPC against disposable data only.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-ui-smoke-'));
const user = path.join(root, 'user');
fs.mkdirSync(path.join(user, 'instances'), { recursive: true });
fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({ minMemory: '1G', maxMemory: '3G', defaultMemoryVersion: 2, discordPresence: false }));
fs.writeFileSync(path.join(user, 'instances', 'registry.json'), '[]');
for (const [key, value] of Object.entries({ appData: root, userData: user, cache: path.join(root, 'cache'), logs: path.join(root, 'logs') })) app.setPath(key, value);
app.commandLine.appendSwitch('disable-gpu');
let completed = false;
const timeout = setTimeout(() => { console.error('Renderer smoke test timed out'); app.exit(3); }, 90000);
timeout.unref();
app.on('browser-window-created', (_, window) => {
  if (completed) return;
  window.webContents.once('did-finish-load', async () => {
    const js = source => window.webContents.executeJavaScript(source);
    const until = async source => { for (let n = 0; n < 250; n++) { if (await js(source)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Renderer never reached: ${source}`); };
    try {
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Start with your account'`);
      assert.equal(await js(`document.querySelector('.tour-coach h2').textContent`), 'Start with your account');
      assert.equal(await js(`['downloads-button','servers-button','guide-button'].some(id => document.getElementById(id))`), false);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.ok(await js(`document.querySelector('.tour-spotlight').getBoundingClientRect().width > 40`));
      if (process.env.PINE_SMOKE_SCREENSHOT) fs.writeFileSync(process.env.PINE_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await js(`document.getElementById('account-row').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Choose how you play'`);
      await js(`document.querySelector('.tour-next').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Create your first instance'`);
      await js(`document.getElementById('hero-create-btn').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Pick the kind of setup'`);
      await js(`document.querySelector('.tour-back').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Create your first instance'`);
      await js(`document.getElementById('hero-create-btn').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Pick the kind of setup'`);
      await js(`document.querySelector('.tour-next').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Name your instance'`);
      await js(`document.querySelector('.tour-back').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Pick the kind of setup'`);
      for (const title of ['Name your instance', 'Choose Minecraft carefully', 'Build the instance']) {
        await js(`document.querySelector('.tour-next').click()`);
        await until(`document.querySelector('.tour-coach h2')?.textContent === ${JSON.stringify(title)}`);
      }
      await js(`document.querySelector('.tour-next').click()`);
      await until(`document.querySelector('.tour-coach h2')?.textContent === 'Discover compatible content'`);
      await js(`document.querySelector('.tour-skip').click()`);
      await until(`!document.querySelector('.tour-layer')`);
      assert.equal((await js(`window.electronAPI.claimOnboarding()`)).show, false);
      const profiles = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(loader => ({ name: `Smoke ${loader}`, gameVersion: '1.21.1', loader, created: loader, minMemory: '1G', maxMemory: '3G', memoryOverride: true }));
      for (const profile of profiles) fs.mkdirSync(path.join(user, 'instances', profile.name), { recursive: true });
      fs.writeFileSync(path.join(user, 'instances', 'registry.json'), JSON.stringify(profiles));
      const listed = await js(`window.electronAPI.listInstances()`); assert.equal(listed.length, 5);
      for (const profile of profiles) {
        const health = await js(`window.electronAPI.getInstanceHealth(${JSON.stringify(profile.name)})`); assert.equal(health.healthy, true, JSON.stringify(health));
      }
      const server = await js(`window.electronAPI.saveServer({name:'Smoke server',address:'127.0.0.1:25565',instanceName:'Smoke vanilla'})`);
      assert.equal((await js(`window.electronAPI.listServers()`))[0].name, 'Smoke server');
      await js(`window.electronAPI.deleteServer(${JSON.stringify(server.id)})`);
      assert.equal((await js(`window.electronAPI.listServers()`)).length, 0);
      const recipe = await js(`window.electronAPI.getRecipePreview('Smoke vanilla')`); assert.equal(recipe.files.length, 0);
      const report = await js(`window.electronAPI.getSupportReport('Smoke vanilla', 'accessToken=PRIVATE_SMOKE_TOKEN')`);
      assert.equal(report.includes('PRIVATE_SMOKE_TOKEN'), false); assert.equal(report.includes('Pine Launcher support report'), true);
      await window.webContents.reload();
      await until(`Boolean(document.getElementById('health-button')?.onclick)`);
      assert.equal(await js(`Boolean(document.querySelector('.tour-layer'))`), false);
      assert.equal((await js(`window.electronAPI.claimOnboarding()`)).show, false);
      completed = true; clearTimeout(timeout); console.log('Pine UI smoke passed: spotlight tour interactions and persistence, five loader profiles, health, recipes, and redacted reports.'); app.exit(0);
    } catch (error) { console.error(error); app.exit(2); }
  });
});
app.on('quit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
require('../main.js');
