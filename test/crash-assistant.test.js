'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanEvidence, collectInstanceDiagnostics, diagnoseCrash, redactSensitiveLog } = require('../lib/crash-assistant');

test('explains common crashes with safe evidence', () => {
  const result = diagnoseCrash('C:\\Users\\Alex\\Pine\njava.lang.OutOfMemoryError: Java heap space', { instance: 'Modded' });
  assert.equal(result.findings[0].id, 'memory');
  assert.match(result.findings[0].evidence, /%USERPROFILE%/);
  assert.doesNotMatch(result.findings[0].evidence, /Alex/);
});

test('returns an honest fallback when no rule matches', () => {
  const result = diagnoseCrash('Minecraft closed unexpectedly');
  assert.equal(result.findings.length, 0);
  assert.match(result.summary, /could not identify/i);
});

test('redacts token-shaped diagnostic text', () => {
  assert.match(cleanEvidence('refresh_token=private-secret'), /\[redacted\]/);
  assert.doesNotMatch(cleanEvidence('refresh_token=private-secret'), /private-secret/);
});

test('recognizes every crash category promised by the assistant', () => {
  const samples = {
    dependency: 'Mod fancylights requires architectury which is missing!',
    'duplicate-mod': 'Found duplicate mods: example and example',
    loader: 'Incompatible mod set! coolmod is not compatible with fabric',
    java: 'java.lang.UnsupportedClassVersionError: class file version 66.0',
    mixin: 'org.spongepowered.asm.mixin.throwables.MixinApplyError: Mixin failed',
    graphics: 'GLFW error 65542: The driver does not appear to support OpenGL',
    corrupt: 'java.util.zip.ZipException: zip END header not found',
  };
  for (const [id, log] of Object.entries(samples)) {
    assert.ok(diagnoseCrash(log).findings.some(finding => finding.id === id), id);
  }
});

test('identifies a likely installed mod without claiming certainty', () => {
  const result = diagnoseCrash('MixinApplyError in sodium\nCaused by sodium renderer\nsodium failed', {
    mods: [{ filename: 'sodium.jar', title: 'Sodium' }, { filename: 'iris.jar', title: 'Iris' }],
  });
  assert.equal(result.suspectMod.filename, 'sodium.jar');
  assert.equal(result.findings[0].confidence, 'medium');
});

test('anonymizes identity and connection details before sharing', () => {
  const cleaned = redactSensitiveLog('C:\\Users\\Alex\\Pine\nUsername: Alex\nfoo@example.com\nConnecting to play.example.com:25565\nAuthorization: Bearer secret');
  assert.doesNotMatch(cleaned, /Alex|foo@example|play\.example|secret/);
  assert.match(cleaned, /redacted-server/);
});

test('collects bounded recent diagnostics without leaving the instance', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine crash unicode — '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'crash-reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'latest.log'), 'latest failure');
  fs.writeFileSync(path.join(root, 'crash-reports', 'crash.txt'), 'crash detail');
  fs.writeFileSync(path.join(root, 'not-a-log.jar'), 'private binary');
  const result = collectInstanceDiagnostics(root, 'launcher failure', { maxTotalBytes: 64 * 1024 });
  assert.match(result.log, /launcher failure/);
  assert.match(result.log, /latest failure/);
  assert.match(result.log, /crash detail/);
  assert.doesNotMatch(result.log, /private binary/);
  assert.deepEqual(result.sources.sort(), ['crash-reports/crash.txt', 'logs/latest.log']);
});
