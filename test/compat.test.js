'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJavaMajor, javaMinimumFromRange, chooseCompatibleJava, versionSupports, normalizeProfileLoader, javaMajorFromClassVersion, javaRuntimeArchitectures } = require('../lib/compat');

test('parses legacy and modern Java version output', () => {
  assert.equal(parseJavaMajor('java version "1.8.0_401"'), 8);
  assert.equal(parseJavaMajor('openjdk version "21.0.5"'), 21);
  assert.equal(parseJavaMajor('openjdk version "25"'), 25);
  assert.equal(parseJavaMajor('not java'), null);
});

test('derives the highest minimum Java requirement from Fabric ranges', () => {
  assert.equal(javaMinimumFromRange('>=21'), 21);
  assert.equal(javaMinimumFromRange(['>=17', '>=25']), 17);
  assert.equal(javaMinimumFromRange(undefined), 0);
});

test('prefers a configured compatible Java and otherwise the lowest compatible runtime', () => {
  const runtimes = [
    { path: 'java8', major: 8, preferred: true },
    { path: 'java25', major: 25, preferred: false },
    { path: 'java21', major: 21, preferred: false },
  ];
  assert.equal(chooseCompatibleJava(runtimes, 21).path, 'java21');
  runtimes[2].preferred = true;
  assert.equal(chooseCompatibleJava(runtimes, 21).path, 'java21');
  assert.equal(chooseCompatibleJava(runtimes, 26), null);
});

test('never treats a wrong Minecraft or loader release as compatible', () => {
  const version = { game_versions: ['1.21.1'], loaders: ['fabric'] };
  assert.equal(versionSupports(version, '1.21.1', ['fabric']), true);
  assert.equal(versionSupports(version, '1.21.11', ['fabric']), false);
  assert.equal(versionSupports(version, '1.21.1', ['quilt']), false);
});

test('profile choice is authoritative over stale loader UI state', () => {
  assert.deepEqual(normalizeProfileLoader('vanilla', 'fabric', '0.19.3'), {
    profile: 'vanilla', loader: 'vanilla', loaderVersion: null,
  });
  assert.deepEqual(normalizeProfileLoader('performance', 'vanilla', '0.19.3'), {
    profile: 'performance', loader: 'fabric', loaderVersion: '0.19.3',
  });
});

test('maps JVM class-file versions to Java releases', () => {
  assert.equal(javaMajorFromClassVersion('52.0'), 8);
  assert.equal(javaMajorFromClassVersion('65.0'), 21);
  assert.equal(javaMajorFromClassVersion('69.0'), 25);
});

test('ARM64 Java provisioning falls back to x64 emulation for older runtimes', () => {
  assert.deepEqual(javaRuntimeArchitectures('arm64', 'win32'), ['aarch64', 'x64']);
  assert.deepEqual(javaRuntimeArchitectures('arm64', 'linux'), ['aarch64']);
  assert.deepEqual(javaRuntimeArchitectures('x64', 'linux'), ['x64']);
});
