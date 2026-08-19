'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COACH_ASSET_UNAVAILABLE = 'COACH_ASSET_UNAVAILABLE';
const html = path.join(__dirname, 'coach-page.html');
const js = path.join(__dirname, 'coach-app.js');
const dict = path.join(__dirname, 'phonetic-dict.js');
const REQUIRED_ASSETS = Object.freeze({
  html: Object.freeze({ name: 'coach-page.html', getter: 'getCoachHtml' }),
  js: Object.freeze({ name: 'coach-app.js', getter: 'getCoachJs' }),
  dict: Object.freeze({ name: 'phonetic-dict.js', getter: 'getPhoneticDict' }),
});

function createCoachAssetUnavailableError(assetName) {
  const safeAssetName = path.basename(String(assetName || 'unknown'));
  const error = new Error(`Required coach asset unavailable: ${safeAssetName}`);
  error.code = COACH_ASSET_UNAVAILABLE;
  error.assetName = safeAssetName;
  return error;
}

function isCoachAssetUnavailableError(error) {
  return Boolean(error && error.code === COACH_ASSET_UNAVAILABLE);
}

function createCoachAssetLoader({ fsImpl = fs, assetPaths = { html, js, dict } } = {}) {
  const cache = new Map();

  function readRequiredAsset(key) {
    const asset = REQUIRED_ASSETS[key];

    try {
      const { mtimeMs } = fsImpl.statSync(assetPaths[key]);
      if (!Number.isFinite(mtimeMs)) throw new TypeError('invalid mtime');

      const cached = cache.get(key);
      if (cached && Object.is(cached.mtimeMs, mtimeMs)) return cached.content;

      const content = fsImpl.readFileSync(assetPaths[key], 'utf8');
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new TypeError('empty required asset');
      }

      cache.set(key, { content, mtimeMs });
      return content;
    } catch (error) {
      if (isCoachAssetUnavailableError(error)) throw error;
      throw createCoachAssetUnavailableError(asset.name);
    }
  }

  return Object.freeze({
    getCoachHtml: () => readRequiredAsset('html'),
    getCoachJs: () => readRequiredAsset('js'),
    getPhoneticDict: () => readRequiredAsset('dict'),
  });
}

const productionLoader = createCoachAssetLoader();

function getCoachHtml() {
  return productionLoader.getCoachHtml();
}

function getCoachJs() {
  return productionLoader.getCoachJs();
}

function getPhoneticDict() {
  return productionLoader.getPhoneticDict();
}

module.exports = {
  COACH_ASSET_UNAVAILABLE,
  REQUIRED_ASSETS,
  createCoachAssetLoader,
  createCoachAssetUnavailableError,
  getCoachHtml,
  getCoachJs,
  getPhoneticDict,
  isCoachAssetUnavailableError,
};
