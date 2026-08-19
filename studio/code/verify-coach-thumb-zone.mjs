#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const outputRoot = path.join(projectRoot, 'design/frontend/verify');
const screenshotPath = path.join(outputRoot, 'screenshots/max-content-w360-h620.png');
const reportPath = path.join(outputRoot, 'max-content-w360-h620.json');
const runtimeRoot = process.env.PLAYWRIGHT_ROOT || '/home/USER/Desktop/solane/vocechat-bridge';
const require = createRequire(path.join(runtimeRoot, 'package.json'));
const { chromium } = require('playwright');

await mkdir(path.dirname(screenshotPath), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 620 } });
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} — ${request.failure()?.errorText || 'failed'}`));

  await page.goto(process.env.TRANSVOICE_URL || 'http://127.0.0.1:3021/app', {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('#tv-coach-session-toggle:not([disabled])');

  const metrics = await page.evaluate(() => {
    const root = document.getElementById('tv-coach-surface');
    const canvas = document.getElementById('tv-coach-canvas');
    const line = document.getElementById('tv-coach-practice-line');
    const pronunciation = document.getElementById('tv-coach-pronunciation');
    const action = document.getElementById('tv-coach-session-toggle');
    if (!root || !canvas || !line || !pronunciation || !action) {
      throw new Error('Coach surface is incomplete.');
    }

    // The Coach owns one text space. Pronunciation is the longer supported
    // representation, so this probe uses its 160-character maximum and keeps
    // the ordinary phrase hidden.
    root.dataset.instructionState = 'ready';
    root.dataset.instructionDensity = 'dense';
    root.dataset.instructionRepresentation = 'pronunciation';
    line.textContent = '';
    line.hidden = true;
    pronunciation.textContent = 'W'.repeat(160);
    pronunciation.hidden = false;

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const canvasRect = rect(canvas);
    const lineRect = rect(line);
    const pronunciationRect = rect(pronunciation);
    const actionRect = rect(action);
    const visiblePersistentControls = Array.from(document.querySelectorAll('[data-coach-persistent-control]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
      })
      .map((element) => element.id);

    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollY,
      },
      density: root.dataset.instructionDensity,
      state: root.dataset.instructionState,
      representation: root.dataset.instructionRepresentation,
      canvas: { ...canvasRect, clientHeight: canvas.clientHeight, scrollHeight: canvas.scrollHeight },
      line: { ...lineRect, clientHeight: line.clientHeight, scrollHeight: line.scrollHeight, length: line.textContent?.length || 0 },
      pronunciation: {
        ...pronunciationRect,
        clientHeight: pronunciation.clientHeight,
        scrollHeight: pronunciation.scrollHeight,
        length: pronunciation.textContent?.length || 0,
      },
      action: {
        ...actionRect,
        centerY: actionRect.top + actionRect.height / 2,
        targetCenterY: innerHeight * 2 / 3,
        label: action.textContent?.trim() || '',
      },
      visiblePersistentControls,
    };
  });

  const geometryChecks = {
    viewportExact: metrics.viewport.width === 360 && metrics.viewport.height === 620,
    documentNoScroll: metrics.document.scrollWidth === metrics.document.clientWidth
      && metrics.document.scrollHeight === metrics.document.clientHeight
      && metrics.document.scrollY === 0,
    exactControlSet: JSON.stringify(metrics.visiblePersistentControls.sort())
      === JSON.stringify(['tv-coach-preset-button', 'tv-coach-session-toggle']),
    exactContentLengths: metrics.line.length === 0 && metrics.pronunciation.length === 160,
    inactivePhraseHidden: metrics.line.height === 0,
    canvasContainsPronunciation: metrics.pronunciation.top >= metrics.canvas.top
      && metrics.pronunciation.bottom <= metrics.canvas.bottom,
    // Fractional line boxes can round each paragraph's DOM scrollHeight up by
    // one CSS pixel even when its full bounding box is visible. The clipping
    // boundary is the canvas, so pair its exact scroll metric with the explicit
    // child containment checks above.
    contentDoesNotClip: metrics.canvas.scrollHeight <= metrics.canvas.clientHeight,
    actionClearance: metrics.canvas.bottom <= metrics.action.top,
    thumbZoneCenter: Math.abs(metrics.action.centerY - metrics.action.targetCenterY) < 0.51,
    touchTarget: metrics.action.height >= 44,
    terseAction: metrics.action.label === 'Start' || metrics.action.label === 'End',
    denseState: metrics.density === 'dense'
      && metrics.state === 'ready'
      && metrics.representation === 'pronunciation',
  };
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const report = {
    target: page.url(),
    generatedAt: new Date().toISOString(),
    metrics,
    checks: geometryChecks,
    runtimeFailures: failures,
    pass: Object.values(geometryChecks).every(Boolean) && failures.length === 0,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
