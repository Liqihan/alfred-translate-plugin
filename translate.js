#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG_PATH = path.join(os.homedir(), '.alfred-llm-translator.json');
const DEFAULT_PROMPT_TEMPLATE = 'You are a professional translation engine. Translate the following text into {{targetLanguage}}. Preserve meaning, tone, formatting, punctuation, URLs, code, and product names. Return only the translation, no explanation.\n\nText:\n{{text}}';
const DEFAULTS = Object.freeze({
  temperature: 0.2,
  timeoutMs: 15000,
  targetRule: 'auto_zh_en',
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
});
const SUPPORTED_TARGET_RULES = new Set(['auto_zh_en']);

class TranslatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TranslatorError';
    this.code = code;
    this.details = details;
  }
}

function getConfigPath() {
  return process.env.ALFRED_LLM_TRANSLATOR_CONFIG || CONFIG_PATH;
}

function makeOpenConfigArg() {
  return JSON.stringify({ action: 'openConfig', configPath: getConfigPath() });
}

function loadConfig(configPath = getConfigPath()) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new TranslatorError('missing_config', `Config file not found at ${configPath}.`, { configPath });
    }
    throw new TranslatorError('config_unreadable', `Could not read config file: ${error.message}`, { configPath });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new TranslatorError('invalid_json', `Config file contains invalid JSON: ${error.message}`, { configPath });
  }
}

function applyConfigDefaults(config) {
  return {
    ...DEFAULTS,
    ...config,
  };
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TranslatorError('invalid_config', 'Config must be a JSON object.');
  }

  const missing = ['apiKey', 'baseUrl', 'model'].filter((field) => typeof config[field] !== 'string' || config[field].trim() === '');
  if (missing.length > 0) {
    throw new TranslatorError('missing_fields', `Missing required config field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`, { missing });
  }

  const merged = applyConfigDefaults({
    ...config,
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
  });

  if (typeof merged.temperature !== 'number' || Number.isNaN(merged.temperature) || merged.temperature < 0 || merged.temperature > 2) {
    throw new TranslatorError('invalid_config', 'Config field temperature must be a number between 0 and 2.');
  }

  if (!Number.isInteger(merged.timeoutMs) || merged.timeoutMs <= 0) {
    throw new TranslatorError('invalid_config', 'Config field timeoutMs must be a positive integer.');
  }

  if (!SUPPORTED_TARGET_RULES.has(merged.targetRule)) {
    throw new TranslatorError('invalid_config', `Unsupported targetRule: ${merged.targetRule}. Supported value: auto_zh_en.`);
  }

  if (typeof merged.promptTemplate !== 'string' || merged.promptTemplate.trim() === '') {
    throw new TranslatorError('invalid_config', 'Config field promptTemplate must be a non-empty string.');
  }

  return merged;
}

function containsMeaningfulChinese(text) {
  const chineseMatches = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu) || [];
  return chineseMatches.length > 0;
}

function detectTargetLanguage(text, targetRule = DEFAULTS.targetRule) {
  if (targetRule !== 'auto_zh_en') {
    throw new TranslatorError('invalid_config', `Unsupported targetRule: ${targetRule}. Supported value: auto_zh_en.`);
  }

  return containsMeaningfulChinese(text) ? 'English' : 'Simplified Chinese';
}

function buildPrompt(template, text, targetLanguage) {
  return template
    .replaceAll('{{targetLanguage}}', targetLanguage)
    .replaceAll('{{text}}', text);
}

function buildChatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/u, '')}/chat/completions`;
}

function extractApiErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }

  if (typeof payload.message === 'string') {
    return payload.message;
  }

  return '';
}

function extractTranslationFromResponse(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new TranslatorError('malformed_response', 'The API response did not contain choices[0].message.content.');
  }

  const translation = content.trim();
  if (!translation) {
    throw new TranslatorError('empty_translation', 'The model returned an empty translation.');
  }

  return translation;
}

async function callChatCompletions(config, prompt, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new TranslatorError('runtime_error', 'This workflow requires Node.js 18 or newer with fetch support.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;

  try {
    response = await fetchImpl(buildChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new TranslatorError('timeout', `Request timed out after ${config.timeoutMs} ms.`, { timeoutMs: config.timeoutMs });
    }
    throw new TranslatorError('network_error', `Network error: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new TranslatorError('malformed_response', `The API returned non-JSON data: ${error.message}`);
  }

  if (!response.ok) {
    const message = extractApiErrorMessage(payload) || 'No error message returned.';
    throw new TranslatorError('api_error', `API returned HTTP ${response.status}: ${message}`, { status: response.status });
  }

  return extractTranslationFromResponse(payload);
}

function alfredItem({ title, subtitle, arg, valid = true, uid, icon }) {
  return {
    uid,
    title,
    subtitle,
    arg,
    valid,
    icon,
  };
}

function makePasteArg(text) {
  return JSON.stringify({ action: 'paste', text });
}

function successItems({ translation, targetLanguage, model }) {
  return {
    items: [
      alfredItem({
        uid: 'translation',
        title: translation,
        subtitle: `Translate to ${targetLanguage} · ${model} · Press Enter to paste`,
        arg: makePasteArg(translation),
        valid: true,
      }),
    ],
  };
}

function errorItems(error) {
  const commonOpenConfig = {
    arg: makeOpenConfigArg(),
    valid: true,
  };

  switch (error.code) {
    case 'empty_input':
      return { items: [alfredItem({ uid: 'empty-input', title: 'Type text to translate', subtitle: 'Usage: tr hello world', valid: false })] };
    case 'missing_config':
      return { items: [alfredItem({ uid: 'missing-config', title: 'Create translator config', subtitle: `${error.message} Press Enter to create and open it.`, ...commonOpenConfig })] };
    case 'config_unreadable':
    case 'invalid_json':
    case 'missing_fields':
    case 'invalid_config':
      return { items: [alfredItem({ uid: error.code, title: 'Fix translator config', subtitle: `${error.message} Press Enter to open it.`, ...commonOpenConfig })] };
    case 'timeout':
      return { items: [alfredItem({ uid: 'timeout', title: 'Translation request timed out', subtitle: `${error.message} Check network or baseUrl.`, valid: false })] };
    case 'api_error':
      return { items: [alfredItem({ uid: 'api-error', title: 'Translation API error', subtitle: error.message, valid: false })] };
    case 'malformed_response':
      return { items: [alfredItem({ uid: 'malformed-response', title: 'Malformed API response', subtitle: error.message, valid: false })] };
    case 'empty_translation':
      return { items: [alfredItem({ uid: 'empty-translation', title: 'No translation returned', subtitle: error.message, valid: false })] };
    case 'network_error':
      return { items: [alfredItem({ uid: 'network-error', title: 'Network error', subtitle: `${error.message} Check network or baseUrl.`, valid: false })] };
    default:
      return { items: [alfredItem({ uid: 'unexpected-error', title: 'Unexpected translator error', subtitle: error.message || String(error), valid: false })] };
  }
}

function toAlfredItems(result) {
  if (result && result.ok) {
    return successItems(result);
  }
  return errorItems(result.error || result);
}

async function translateQuery(query) {
  const text = String(query || '').trim();
  if (!text) {
    throw new TranslatorError('empty_input', 'No text was provided.');
  }

  const config = validateConfig(loadConfig());
  const targetLanguage = detectTargetLanguage(text, config.targetRule);
  const prompt = buildPrompt(config.promptTemplate, text, targetLanguage);
  const translation = await callChatCompletions(config, prompt);

  return {
    ok: true,
    translation,
    targetLanguage,
    model: config.model,
  };
}

async function main(argv = process.argv.slice(2)) {
  const query = argv.join(' ');
  try {
    const result = await translateQuery(query);
    process.stdout.write(`${JSON.stringify(toAlfredItems(result))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(toAlfredItems({ ok: false, error }))}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG_PATH,
  DEFAULTS,
  DEFAULT_PROMPT_TEMPLATE,
  TranslatorError,
  applyConfigDefaults,
  buildChatCompletionsUrl,
  buildPrompt,
  callChatCompletions,
  containsMeaningfulChinese,
  detectTargetLanguage,
  errorItems,
  extractTranslationFromResponse,
  loadConfig,
  makeOpenConfigArg,
  makePasteArg,
  successItems,
  toAlfredItems,
  validateConfig,
};
