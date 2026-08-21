'use strict';

const { execFile } = require('child_process');

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 120000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const detail = String(stderr || stdout || error.message || '').trim();
      reject(new Error(detail || command + ' failed'));
    });
  });
}

async function extractZipOnWindows(archive, destination, run = execFileAsync) {
  const extractors = [
    {
      command: 'tar.exe',
      args: ['-xf', archive, '-C', destination],
    },
    {
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '& { param($zip, $dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }',
        archive,
        destination,
      ],
    },
  ];

  const failures = [];
  for (const extractor of extractors) {
    try {
      await run(extractor.command, extractor.args);
      return extractor.command;
    } catch (error) {
      failures.push(extractor.command + ': ' + (error.message || error));
    }
  }

  throw new Error('Could not extract the Java runtime. Windows reported: ' + failures.join(' | '));
}

async function extractTarGzOnLinux(archive, destination, run = execFileAsync) {
  try {
    await run('tar', ['-xzf', archive, '-C', destination]);
    return 'tar';
  } catch (error) {
    throw new Error(`Could not extract the Java runtime. Linux tar reported: ${error.message}`);
  }
}

async function extractRuntimeArchive(archive, destination, platform = process.platform, run = execFileAsync) {
  if (platform === 'win32') return extractZipOnWindows(archive, destination, run);
  if (platform === 'linux') return extractTarGzOnLinux(archive, destination, run);
  throw new Error(`Automatic Java extraction is not supported on ${platform}`);
}

module.exports = { extractRuntimeArchive, extractTarGzOnLinux, extractZipOnWindows };
