#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.alfred-llm-translator.json');
const EXAMPLE_CONFIG = {
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  timeoutMs: 15000,
  targetRule: 'auto_zh_en',
  promptTemplate: 'You are a professional translation engine. Translate the following text into {{targetLanguage}}. Preserve meaning, tone, formatting, punctuation, URLs, code, and product names. Return only the translation, no explanation.\n\nText:\n{{text}}',
};

function parseAction(argv = process.argv.slice(2)) {
  const raw = argv.join(' ');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Backward-compatible fallback: treat a non-JSON argument as text to paste.
  }
  return { action: 'paste', text: raw };
}

function ensureConfigFile(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(EXAMPLE_CONFIG, null, 2)}\n`, { mode: 0o600 });
  }
  return configPath;
}

function openFile(filePath) {
  spawnSync('open', [filePath], { stdio: 'ignore' });
}

function pasteText(text) {
  execFileSync('pbcopy', [], { input: text });
  execFileSync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
}

function main() {
  const action = parseAction();
  if (action.action === 'openConfig') {
    openFile(ensureConfigFile(action.configPath || DEFAULT_CONFIG_PATH));
    return;
  }
  pasteText(String(action.text || ''));
}

if (require.main === module) {
  main();
}

module.exports = {
  EXAMPLE_CONFIG,
  ensureConfigFile,
  parseAction,
};
