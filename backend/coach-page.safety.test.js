'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COACH_ASSET_UNAVAILABLE,
  createCoachAssetLoader,
  createCoachAssetUnavailableError,
} = require('./coach-page');

const assetPaths = Object.freeze({
  html: '/assets/page.html',
  js: '/assets/app.js',
  dict: '/assets/dict.js',
});

function createFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const calls = { read: [], stat: [] };

  return {
    calls,
    files,
    statSync(filePath) {
      calls.stat.push(filePath);
      const file = files.get(filePath);
      if (!file || file.statError) throw file?.statError || new Error('ENOENT sensitive path');
      return { mtimeMs: file.mtimeMs };
    },
    readFileSync(filePath, encoding) {
      calls.read.push({ filePath, encoding });
      const file = files.get(filePath);
      if (!file || file.readError) throw file?.readError || new Error('ENOENT sensitive path');
      return file.content;
    },
  };
}

function assertUnavailable(fn, assetName) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, COACH_ASSET_UNAVAILABLE);
    assert.equal(error.assetName, assetName);
    assert.equal(error.message, `Required coach asset unavailable: ${assetName}`);
    assert.equal(error.message.includes('/assets/'), false);
    return true;
  });
}

test('initial access loads every required asset and never returns an empty string', () => {
  const fakeFs = createFakeFs({
    [assetPaths.html]: { mtimeMs: 1, content: '<main>coach</main>' },
    [assetPaths.js]: { mtimeMs: 2, content: 'window.coach = true;' },
    [assetPaths.dict]: { mtimeMs: 3, content: 'window.dict = {};' },
  });
  const loader = createCoachAssetLoader({ fsImpl: fakeFs, assetPaths });

  for (const value of [loader.getCoachHtml(), loader.getCoachJs(), loader.getPhoneticDict()]) {
    assert.equal(typeof value, 'string');
    assert.notEqual(value, '');
  }
  assert.equal(fakeFs.calls.stat.length, 3);
  assert.equal(fakeFs.calls.read.length, 3);
});

test('unchanged mtime returns validated cache without rereading', () => {
  const fakeFs = createFakeFs({
    [assetPaths.html]: { mtimeMs: 10, content: '<main>cached</main>' },
  });
  const loader = createCoachAssetLoader({ fsImpl: fakeFs, assetPaths });

  assert.equal(loader.getCoachHtml(), '<main>cached</main>');
  fakeFs.files.set(assetPaths.html, { mtimeMs: 10, content: '<main>not read</main>' });
  assert.equal(loader.getCoachHtml(), '<main>cached</main>');
  assert.equal(fakeFs.calls.read.length, 1);
  assert.equal(fakeFs.calls.stat.length, 2);
});

test('changed mtime refreshes and atomically replaces cache after a valid read', () => {
  const fakeFs = createFakeFs({
    [assetPaths.js]: { mtimeMs: 1, content: 'window.version = 1;' },
  });
  const loader = createCoachAssetLoader({ fsImpl: fakeFs, assetPaths });

  assert.equal(loader.getCoachJs(), 'window.version = 1;');
  fakeFs.files.set(assetPaths.js, { mtimeMs: 2, content: 'window.version = 2;' });
  assert.equal(loader.getCoachJs(), 'window.version = 2;');
  assert.equal(loader.getCoachJs(), 'window.version = 2;');
  assert.equal(fakeFs.calls.read.length, 2);
});

test('missing, stat, read, empty, non-string, and invalid-mtime assets are unavailable', () => {
  const cases = [
    [undefined, 'coach-page.html'],
    [{ statError: new Error('EACCES /secret/page.html') }, 'coach-page.html'],
    [{ mtimeMs: 1, readError: new Error('EACCES /secret/page.html') }, 'coach-page.html'],
    [{ mtimeMs: 1, content: '' }, 'coach-page.html'],
    [{ mtimeMs: 1, content: '  \n' }, 'coach-page.html'],
    [{ mtimeMs: 1, content: Buffer.from('not a string') }, 'coach-page.html'],
    [{ mtimeMs: Number.NaN, content: '<main>bad mtime</main>' }, 'coach-page.html'],
  ];

  for (const [file, assetName] of cases) {
    const fakeFs = createFakeFs(file ? { [assetPaths.html]: file } : {});
    const loader = createCoachAssetLoader({ fsImpl: fakeFs, assetPaths });
    assertUnavailable(() => loader.getCoachHtml(), assetName);
  }
});

test('failed refresh retains old cache without serving it, then permits a valid retry', () => {
  const oldBytes = '<main>old validated bytes</main>';
  const fakeFs = createFakeFs({
    [assetPaths.html]: { mtimeMs: 1, content: oldBytes },
  });
  const loader = createCoachAssetLoader({ fsImpl: fakeFs, assetPaths });
  assert.equal(loader.getCoachHtml(), oldBytes);

  fakeFs.files.set(assetPaths.html, { mtimeMs: 2, content: '' });
  assertUnavailable(() => loader.getCoachHtml(), 'coach-page.html');
  assert.equal(fakeFs.calls.read.length, 2);

  // Returning to the cached mtime must use retained validated bytes. A loader
  // that deleted cache on refresh failure would reread and expose this sentinel.
  fakeFs.files.set(assetPaths.html, { mtimeMs: 1, content: '<main>must not be read</main>' });
  assert.equal(loader.getCoachHtml(), oldBytes);
  assert.equal(fakeFs.calls.read.length, 2);

  fakeFs.files.set(assetPaths.html, { mtimeMs: 2, content: '<main>valid retry</main>' });
  assert.equal(loader.getCoachHtml(), '<main>valid retry</main>');
  assert.equal(loader.getCoachHtml(), '<main>valid retry</main>');
  assert.equal(fakeFs.calls.read.length, 3);
});

test('error helper exposes only a stable non-sensitive asset name', () => {
  const error = createCoachAssetUnavailableError('/secret/private/coach-app.js');
  assert.equal(error.code, COACH_ASSET_UNAVAILABLE);
  assert.equal(error.assetName, 'coach-app.js');
  assert.equal(error.message, 'Required coach asset unavailable: coach-app.js');
});
