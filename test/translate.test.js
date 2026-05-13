'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  DEFAULTS,
  TranslatorError,
  buildChatCompletionsUrl,
  buildPrompt,
  callChatCompletions,
  detectTargetLanguage,
  errorItems,
  extractTranslationFromResponse,
  makePasteArg,
  successItems,
  validateConfig,
} = require('../translate');

function validConfig(overrides = {}) {
  return validateConfig({
    apiKey: 'sk-test',
    baseUrl: 'https://example.test/v1/',
    model: 'test-model',
    ...overrides,
  });
}

function response({ ok = true, status = 200, payload }) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test('detectTargetLanguage translates Chinese input to English', () => {
  assert.equal(detectTargetLanguage('你好，世界', 'auto_zh_en'), 'English');
});

test('detectTargetLanguage translates non-Chinese input to Simplified Chinese', () => {
  assert.equal(detectTargetLanguage('hello world', 'auto_zh_en'), 'Simplified Chinese');
});

test('buildChatCompletionsUrl normalizes trailing slashes', () => {
  assert.equal(buildChatCompletionsUrl('https://api.example.com/v1///'), 'https://api.example.com/v1/chat/completions');
});

test('buildPrompt replaces supported placeholders', () => {
  assert.equal(
    buildPrompt('To {{targetLanguage}}: {{text}} / {{text}}', 'hello', 'Simplified Chinese'),
    'To Simplified Chinese: hello / hello',
  );
});

test('validateConfig applies defaults', () => {
  const config = validConfig();
  assert.equal(config.temperature, DEFAULTS.temperature);
  assert.equal(config.timeoutMs, DEFAULTS.timeoutMs);
  assert.equal(config.targetRule, DEFAULTS.targetRule);
  assert.equal(config.promptTemplate, DEFAULTS.promptTemplate);
});

test('validateConfig reports missing required fields', () => {
  assert.throws(
    () => validateConfig({ apiKey: '', baseUrl: 'https://example.test/v1' }),
    (error) => error instanceof TranslatorError
      && error.code === 'missing_fields'
      && error.details.missing.includes('apiKey')
      && error.details.missing.includes('model'),
  );
});

test('successItems returns valid Alfred Script Filter JSON', () => {
  const output = successItems({ translation: '你好', targetLanguage: 'Simplified Chinese', model: 'test-model' });
  assert.equal(output.items.length, 1);
  assert.equal(output.items[0].title, '你好');
  assert.equal(output.items[0].valid, true);
  assert.deepEqual(JSON.parse(output.items[0].arg), { action: 'paste', text: '你好' });
});

test('errorItems returns actionable config item for missing config', () => {
  const output = errorItems(new TranslatorError('missing_config', 'Config file not found.'));
  assert.equal(output.items[0].valid, true);
  assert.equal(JSON.parse(output.items[0].arg).action, 'openConfig');
});

test('errorItems returns invalid Alfred item for empty input', () => {
  const output = errorItems(new TranslatorError('empty_input', 'No text was provided.'));
  assert.equal(output.items[0].valid, false);
  assert.match(output.items[0].title, /Type text/);
});

test('makePasteArg wraps translation text', () => {
  assert.deepEqual(JSON.parse(makePasteArg('translated text')), { action: 'paste', text: 'translated text' });
});

test('extractTranslationFromResponse parses success payload', () => {
  assert.equal(
    extractTranslationFromResponse({ choices: [{ message: { content: ' translated text \n' } }] }),
    'translated text',
  );
});

test('extractTranslationFromResponse rejects malformed payload', () => {
  assert.throws(
    () => extractTranslationFromResponse({ choices: [] }),
    (error) => error instanceof TranslatorError && error.code === 'malformed_response',
  );
});

test('extractTranslationFromResponse rejects empty translation', () => {
  assert.throws(
    () => extractTranslationFromResponse({ choices: [{ message: { content: '   ' } }] }),
    (error) => error instanceof TranslatorError && error.code === 'empty_translation',
  );
});

test('callChatCompletions returns translated content and sends OpenAI-compatible request', async () => {
  let seenUrl;
  let seenBody;
  const config = validConfig();
  const translation = await callChatCompletions(config, 'prompt text', async (url, options) => {
    seenUrl = url;
    seenBody = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer sk-test');
    return response({ payload: { choices: [{ message: { content: '译文' } }] } });
  });

  assert.equal(translation, '译文');
  assert.equal(seenUrl, 'https://example.test/v1/chat/completions');
  assert.deepEqual(seenBody.messages, [{ role: 'user', content: 'prompt text' }]);
});

test('callChatCompletions reports API non-2xx errors', async () => {
  await assert.rejects(
    callChatCompletions(validConfig(), 'prompt', async () => response({
      ok: false,
      status: 401,
      payload: { error: { message: 'bad key' } },
    })),
    (error) => error instanceof TranslatorError && error.code === 'api_error' && /401/.test(error.message) && /bad key/.test(error.message),
  );
});

test('callChatCompletions reports malformed JSON responses', async () => {
  await assert.rejects(
    callChatCompletions(validConfig(), 'prompt', async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new Error('not json');
      },
    })),
    (error) => error instanceof TranslatorError && error.code === 'malformed_response',
  );
});

test('callChatCompletions reports timeout', async () => {
  await assert.rejects(
    callChatCompletions(validConfig({ timeoutMs: 1 }), 'prompt', (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
      setTimeout(() => resolve(response({ payload: { choices: [{ message: { content: 'late' } }] } })), 50);
    })),
    (error) => error instanceof TranslatorError && error.code === 'timeout' && error.details.timeoutMs === 1,
  );
});
