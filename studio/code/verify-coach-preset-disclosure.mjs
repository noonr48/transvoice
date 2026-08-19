#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';

const runtimeRoot = process.env.PLAYWRIGHT_ROOT || '/home/USER/Desktop/solane/vocechat-bridge';
const require = createRequire(path.join(runtimeRoot, 'package.json'));
const { chromium } = require('playwright');
const target = process.env.TRANSVOICE_URL || 'http://127.0.0.1:3021/app';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 620 } });
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tv-coach-session-toggle:not([disabled])');

  await page.focus('#tv-coach-preset-button');
  await page.click('#tv-coach-preset-button');
  await page.waitForSelector('#tv-coach-preset-menu:not([hidden])');
  const opened = await page.evaluate(() => {
    const menu = document.getElementById('tv-coach-preset-menu');
    return {
      role: menu?.getAttribute('role'),
      expanded: document.getElementById('tv-coach-preset-button')?.getAttribute('aria-expanded'),
      focusInside: Boolean(menu?.contains(document.activeElement)),
      activeId: document.activeElement?.id || null,
    };
  });

  await page.keyboard.press('Escape');
  const escaped = await page.evaluate(() => ({
    hidden: document.getElementById('tv-coach-preset-menu')?.hidden,
    expanded: document.getElementById('tv-coach-preset-button')?.getAttribute('aria-expanded'),
    activeId: document.activeElement?.id || null,
  }));

  await page.click('#tv-coach-preset-button');
  await page.waitForSelector('#tv-coach-preset-menu:not([hidden])');
  await page.click('#tv-coach-upload-open');
  await page.click('#tv-coach-upload-cancel');
  const cancelled = await page.evaluate(() => ({
    hidden: document.getElementById('tv-coach-preset-menu')?.hidden,
    activeId: document.activeElement?.id || null,
  }));

  const checks = {
    truthfulRegion: opened.role === 'region',
    openMovesFocusInside: opened.expanded === 'true' && opened.focusInside,
    escapeCloses: escaped.hidden === true && escaped.expanded === 'false',
    escapeRestoresFocus: escaped.activeId === 'tv-coach-preset-button',
    cancelStaysInside: cancelled.hidden === false && cancelled.activeId === 'tv-coach-upload-open',
  };
  const report = {
    target: page.url(),
    generatedAt: new Date().toISOString(),
    opened,
    escaped,
    cancelled,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
