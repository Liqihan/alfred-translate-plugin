# Alfred LLM Translator Design

This document captures the implementation scope for version 1 of Alfred LLM Translator.

## Goal

Build an Alfred workflow for translating text with an OpenAI Chat Completions compatible large-model API. The workflow produces a directly installable `.alfredworkflow` file suitable for distribution from GitHub Releases.

## Version 1 Scope

- Alfred keyword workflow using `tr`.
- Node.js runtime.
- OpenAI Chat Completions compatible API.
- User-managed config file at `~/.alfred-llm-translator.json`.
- Configurable `apiKey`, `baseUrl`, `model`, `temperature`, `timeoutMs`, `targetRule`, and `promptTemplate`.
- Automatic language direction: Chinese input translates to English; other input translates to Simplified Chinese.
- Clear Alfred error items for missing config, invalid config, API errors, timeout, malformed responses, and empty input.
- Enter action pastes the translated text into the active app.
- Packaged `.alfredworkflow` artifact for direct Alfred installation.
- GitHub-ready project layout with release artifact expectations documented.

## Out Of Scope

- Hotkey translation of selected text.
- Translation history.
- Multiple provider profiles or provider switching.
- Streaming translation.
- Glossaries or terminology memory.
- GUI configuration inside Alfred.

## Configuration

The workflow reads configuration from `~/.alfred-llm-translator.json`. Secrets stay outside the workflow bundle so exported `.alfredworkflow` files and GitHub release artifacts do not contain user secrets.

Required fields are `apiKey`, `baseUrl`, and `model`. Defaults are `temperature: 0.2`, `timeoutMs: 15000`, `targetRule: auto_zh_en`, and the default professional translation prompt.

## Translation Rule

`auto_zh_en` translates meaningful Chinese input to English and all other input to Simplified Chinese.

## Packaging

The build produces `alfred-llm-translator.alfredworkflow`, a deterministic zip-based Alfred workflow containing runtime files but excluding local config files and API keys.
