#!/usr/bin/env node
'use strict';

/**
 * Validate that the TransVoice standalone deploy bundle is complete and runnable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const REQUIRED_BACKEND_FILES = [
  'voice-standalone-server.js',
  'voice-standalone-runtime.js',
  'voice-standalone-config.js',
  'voice-runtime-entrypoints.js',
  'voice-session-state.js',
  'learner-context-service.js',
  'learner-context-route-handlers.js',
];

const REQUIRED_DIST_FILES = [
  'voice-tutor.html',
  'voice-tutor-app.html',
  'voice-tutor.webmanifest',
  'voice-tutor-sw.js',
  'voice-tutor-offline.html',
];

const REQUIRED_ROOT_FILES = [
  'server.js',
  'package.json',
  'manifest.json',
  'install.sh',
];

function checkFiles(baseDir, files, label) {
  const missing = [];
  for (const file of files) {
    const filePath = path.join(baseDir, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
    }
  }
  return { label, missing, total: files.length };
}

function checkBackendPackageJson() {
  const pkgPath = path.join(ROOT, 'backend', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = pkg.dependencies || {};
    const required = ['cors', 'express', 'ws'];
    const missing = required.filter((dep) => !deps[dep]);
    return { valid: missing.length === 0, missing };
  } catch {
    return { valid: false, missing: ['package.json unreadable'] };
  }
}

function checkRootPackageJson() {
  const pkgPath = path.join(ROOT, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    const required = ['start', 'dev', 'doctor'];
    const missing = required.filter((s) => !scripts[s]);
    return { valid: missing.length === 0, missing, name: pkg.name, version: pkg.version };
  } catch {
    return { valid: false, missing: ['package.json unreadable'] };
  }
}

function main() {
  const checks = [];

  checks.push(checkFiles(path.join(ROOT, 'backend'), REQUIRED_BACKEND_FILES, 'Backend runtime'));
  checks.push(checkFiles(path.join(ROOT, 'dist'), REQUIRED_DIST_FILES, 'Frontend dist'));
  checks.push(checkFiles(ROOT, REQUIRED_ROOT_FILES, 'Root files'));

  const backendPkg = checkBackendPackageJson();
  const rootPkg = checkRootPackageJson();

  let allPassed = true;

  for (const check of checks) {
    if (check.missing.length) {
      console.error(`[FAIL] ${check.label}: missing ${check.missing.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`[OK]   ${check.label}: ${check.total} files present`);
    }
  }

  if (!backendPkg.valid) {
    console.error(`[FAIL] Backend package.json: missing deps ${backendPkg.missing.join(', ')}`);
    allPassed = false;
  } else {
    console.log('[OK]   Backend package.json: dependencies present');
  }

  if (!rootPkg.valid) {
    console.error(`[FAIL] Root package.json: missing scripts ${rootPkg.missing.join(', ')}`);
    allPassed = false;
  } else {
    console.log(`[OK]   Root package.json: ${rootPkg.name}@${rootPkg.version}`);
  }

  if (allPassed) {
    console.log('\n[TransVoice Deploy Check] All checks passed.');
    process.exit(0);
  } else {
    console.error('\n[TransVoice Deploy Check] FAILED — see errors above.');
    process.exit(1);
  }
}

main();
