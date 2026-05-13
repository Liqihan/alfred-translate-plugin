'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { EXAMPLE_CONFIG, ensureConfigFile, parseAction } = require('../scripts/paste');

test('parseAction parses JSON action argument', () => {
  assert.deepEqual(parseAction([JSON.stringify({ action: 'paste', text: 'hello' })]), { action: 'paste', text: 'hello' });
});

test('parseAction treats non-JSON argument as paste text', () => {
  assert.deepEqual(parseAction(['hello', 'world']), { action: 'paste', text: 'hello world' });
});

test('ensureConfigFile creates example config without overwriting existing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-config-'));
  const configPath = path.join(dir, 'config.json');
  try {
    ensureConfigFile(configPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), EXAMPLE_CONFIG);

    fs.writeFileSync(configPath, '{"apiKey":"custom"}\n');
    ensureConfigFile(configPath);
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{"apiKey":"custom"}\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
