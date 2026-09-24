'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOptiFineFilename, parseOptiFineCatalog, resolveOptiFineDownloadUrl } = require('../lib/optifine');

test('OptiFine official catalog parsing keeps exact game versions and prefers stable metadata', () => {
  const html = `
    <a href="adloadx?f=preview_OptiFine_1.8.9_HD_U_M6_pre2.jar">Mirror</a>
    <a href="https://optifine.net/adloadx?f=OptiFine_1.8.9_HD_U_M5.jar">Mirror</a>
    <a href="adloadx?f=OptiFine_1.12.2_HD_U_G5.jar">Mirror</a>
    <a href="adloadx?f=OptiFine_1.8.9_HD_U_M5.jar">Duplicate</a>`;
  const builds = parseOptiFineCatalog(html);
  assert.equal(builds.length, 3);
  assert.deepEqual(builds.filter(build => build.gameVersion === '1.8.9').map(build => [build.build, build.preview]), [['M6 pre2', true], ['M5', false]]);
  assert.equal(parseOptiFineFilename('random.jar'), null);
});

test('OptiFine download resolution accepts only the requested tokenized official URL', () => {
  const filename = 'OptiFine_1.8.9_HD_U_M5.jar';
  const html = `<a href="downloadx?f=${filename}&amp;x=abc123">Download</a>`;
  const resolved = new URL(resolveOptiFineDownloadUrl(html, filename));
  assert.equal(resolved.hostname, 'optifine.net');
  assert.equal(resolved.pathname, '/downloadx');
  assert.equal(resolved.searchParams.get('f'), filename);
  assert.equal(resolved.searchParams.get('x'), 'abc123');
  assert.throws(() => resolveOptiFineDownloadUrl('<a href="https://evil.example/downloadx?f=x.jar&x=bad">Download</a>', 'x.jar'), /valid official download link/);
});
