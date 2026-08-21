'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRuntimeArchive, extractTarGzOnLinux, extractZipOnWindows } = require('../lib/runtime-extraction');

test('Java extraction falls back to PowerShell when native tar fails', async () => {
  const calls = [];
  const selected = await extractZipOnWindows('C:\\cache\\java.zip', 'D:\\Pine Runtimes\\staging', async (command, args) => {
    calls.push({ command, args });
    if (command === 'tar.exe') throw new Error('tar unavailable');
  });

  assert.equal(selected, 'powershell.exe');
  assert.deepEqual(calls.map(call => call.command), ['tar.exe', 'powershell.exe']);
  assert.equal(calls[1].args.at(-2), 'C:\\cache\\java.zip');
  assert.equal(calls[1].args.at(-1), 'D:\\Pine Runtimes\\staging');
});

test('Java extraction reports both native extractor failures', async () => {
  await assert.rejects(
    extractZipOnWindows('java.zip', 'staging', async command => {
      throw new Error(command + ' blocked');
    }),
    /tar\.exe.*powershell\.exe/
  );
});

test('Linux Java extraction uses tar with argument-safe paths', async () => {
  const calls = [];
  const selected = await extractTarGzOnLinux('/tmp/Pine Java.tar.gz', '/tmp/Pine Runtime', async (command, args) => {
    calls.push({ command, args });
  });
  assert.equal(selected, 'tar');
  assert.deepEqual(calls, [{ command: 'tar', args: ['-xzf', '/tmp/Pine Java.tar.gz', '-C', '/tmp/Pine Runtime'] }]);
  assert.equal(await extractRuntimeArchive('runtime.tar.gz', 'runtime', 'linux', async () => {}), 'tar');
});
