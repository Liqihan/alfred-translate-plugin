#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'alfred-llm-translator.alfredworkflow');
const FIXED_TIME = new Date('2026-05-12T00:00:00Z');
const INCLUDE = [
  'info.plist',
  'package.json',
  'README.md',
  'translate.js',
  'scripts/paste.js',
  'docs/superpowers/specs/2026-05-12-alfred-llm-translator-design.md',
];

function copyFileToBuild(relativePath, buildDir) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(buildDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.utimesSync(destination, FIXED_TIME, FIXED_TIME);
}

function main() {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-llm-translator-'));
  try {
    for (const file of INCLUDE) {
      copyFileToBuild(file, buildDir);
    }

    fs.rmSync(ARTIFACT, { force: true });
    const sorted = [...INCLUDE].sort();
    execFileSync('zip', ['-X', '-q', ARTIFACT, ...sorted], { cwd: buildDir });
    fs.utimesSync(ARTIFACT, FIXED_TIME, FIXED_TIME);
    console.log(`Created ${path.relative(ROOT, ARTIFACT)}`);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

main();
