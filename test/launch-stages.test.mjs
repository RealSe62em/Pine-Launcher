import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLine, parseDownloadLine, shortFile } from '../renderer/launch-stages.js';

test('classifies representative launch stages', () => {
  assert.equal(classifyLine('Downloading asset foo'), 'assets');
  assert.equal(classifyLine('Downloading library bar'), 'libraries');
  assert.equal(classifyLine('Launching with arguments'), 'launching');
});

test('parses download sizes and shortens long names', () => {
  assert.equal(parseDownloadLine('Downloading asset foo.jar (1.5 MB)').bytes, 1.5 * 1024 * 1024);
  assert.ok(shortFile('x'.repeat(80)).length < 80);
});
