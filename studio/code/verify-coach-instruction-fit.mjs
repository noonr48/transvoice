#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';

const runtimeRoot = process.env.PLAYWRIGHT_ROOT || '/home/USER/Desktop/solane/vocechat-bridge';
const require = createRequire(path.join(runtimeRoot, 'package.json'));
const { chromium } = require('playwright');
const target = process.env.TRANSVOICE_URL || 'http://127.0.0.1:3021/app';

const scenarios = [
  { name: 'practice-compact', width: 320, height: 568, textScale: 1, kind: 'practice', length: 120 },
  { name: 'pronunciation-compact', width: 320, height: 568, textScale: 1, kind: 'pronunciation', length: 160 },
  { name: 'practice-enlarged', width: 360, height: 620, textScale: 1.5, kind: 'practice', length: 120 },
  { name: 'pronunciation-enlarged', width: 360, height: 620, textScale: 1.5, kind: 'pronunciation', length: 160 },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
    });
    await page.goto(target, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tv-coach-session-toggle:not([disabled])');
    const metrics = await page.evaluate(async ({ textScale, kind, length }) => {
      const root = document.getElementById('tv-coach-surface');
      const canvas = document.getElementById('tv-coach-canvas');
      const line = document.getElementById('tv-coach-practice-line');
      const pronunciation = document.getElementById('tv-coach-pronunciation');
      const status = document.getElementById('tv-coach-status');
      if (!root || !canvas || !line || !pronunciation || !status) {
        throw new Error('Coach instruction canvas is incomplete.');
      }

      root.dataset.instructionState = 'ready';
      root.dataset.instructionDensity = 'dense';
      root.dataset.instructionRepresentation = kind;
      root.dataset.activity = 'ready';
      status.textContent = 'Ready — speak now';
      const active = kind === 'practice' ? line : pronunciation;
      const inactive = kind === 'practice' ? pronunciation : line;
      const baseFontSize = Number.parseFloat(getComputedStyle(active).fontSize);
      const baseStatusFontSize = Number.parseFloat(getComputedStyle(status).fontSize);
      if (textScale > 1) {
        const style = document.createElement('style');
        style.dataset.testTextEnlargement = 'true';
        style.textContent = `
          #${active.id} { font-size: ${baseFontSize * textScale}px !important; }
          #tv-coach-status { font-size: ${baseStatusFontSize * textScale}px !important; }
        `;
        document.head.append(style);
      }
      active.textContent = 'W'.repeat(length);
      active.hidden = false;
      inactive.textContent = '';
      inactive.hidden = true;
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));

      const canvasBox = canvas.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      const computedFontSize = Number.parseFloat(getComputedStyle(active).fontSize);
      return {
        document: {
          clientHeight: document.documentElement.clientHeight,
          scrollHeight: document.documentElement.scrollHeight,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        canvas: {
          clientHeight: canvas.clientHeight,
          scrollHeight: canvas.scrollHeight,
          clientWidth: canvas.clientWidth,
          scrollWidth: canvas.scrollWidth,
          inlineGap: canvas.style.gap,
        },
        active: {
          id: active.id,
          baseFontSize,
          computedFontSize,
          inlineFontSize: active.style.fontSize,
          contained: (
            activeBox.top >= canvasBox.top - 0.5
            && activeBox.bottom <= canvasBox.bottom + 0.5
            && activeBox.left >= canvasBox.left - 0.5
            && activeBox.right <= canvasBox.right + 0.5
          ),
        },
        status: {
          clientHeight: status.clientHeight,
          scrollHeight: status.scrollHeight,
          clientWidth: status.clientWidth,
          scrollWidth: status.scrollWidth,
          baseFontSize: baseStatusFontSize,
          computedFontSize: Number.parseFloat(getComputedStyle(status).fontSize),
        },
        inactiveHidden: inactive.hidden,
        persistentControls: root.querySelectorAll('[data-coach-persistent-control]').length,
        instructionFit: root.dataset.instructionFit,
      };
    }, scenario);
    const checks = {
      documentNoScroll: (
        metrics.document.clientHeight === metrics.document.scrollHeight
        && metrics.document.clientWidth === metrics.document.scrollWidth
      ),
      canvasNoScroll: (
        metrics.canvas.scrollHeight <= metrics.canvas.clientHeight
        && metrics.canvas.scrollWidth <= metrics.canvas.clientWidth
      ),
      contentContained: metrics.active.contained,
      textScalePreserved: metrics.active.computedFontSize >= (
        metrics.active.baseFontSize * scenario.textScale * 0.99
      ),
      statusTextScalePreserved: metrics.status.computedFontSize >= (
        metrics.status.baseFontSize * scenario.textScale * 0.99
      ),
      statusNotClipped: (
        metrics.status.scrollHeight <= metrics.status.clientHeight
        && metrics.status.scrollWidth <= metrics.status.clientWidth
      ),
      noInlineCounterScale: (
        metrics.active.inlineFontSize === ''
        && metrics.canvas.inlineGap === ''
        && metrics.instructionFit === 'native'
      ),
      oneVisibleRepresentation: metrics.inactiveHidden === true,
      exactlyTwoPersistentControls: metrics.persistentControls === 2,
    };
    results.push({
      ...scenario,
      metrics,
      checks,
      pass: Object.values(checks).every(Boolean),
    });
    await page.close();
  }
} finally {
  await browser.close();
}

const report = {
  target,
  generatedAt: new Date().toISOString(),
  results,
  pass: results.every((result) => result.pass),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
