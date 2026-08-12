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

module.exports = { extractZipOnWindows };