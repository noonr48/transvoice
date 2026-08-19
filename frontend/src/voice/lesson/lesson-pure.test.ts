// Pure-logic tests for the lesson surface (Wave B). These cover the
// deterministic core (no DOM): card normalization, karaoke thresholds, the
// pluggable timing windows, replay frame mapping, and the compass coordinate
// transform. The modules under test import no DOM at runtime, so they run under
// `node --test` after an esbuild transpile (see the repo verification notes);
// the frontend tsconfig excludes *.test.ts from the production build.
//
// Run (from frontend/):
//   node_modules/.bin/esbuild src/voice/lesson/{card,word-timing,karaoke,replay-frames,compass}.ts \
//     --bundle --format=esm --platform=node --outdir=/tmp/lp && \
//   node_modules/.bin/esbuild src/voice/lesson/lesson-pure.test.ts \
//     --bundle --format=esm --platform=node --external:node:* --outfile=/tmp/lp/t.mjs && \
//   node --test /tmp/lp/t.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVoicePracticeCard,
  normalizeVoiceReplayDirective,
  voiceCardRevisionIncreased,
  voiceCardIdentity,
} from './card';
import {
  ProgressTimingSource,
  tokenIndexAtElapsed,
  tokenIndexAtProgress,
} from './word-timing';
import {
  markCardTokens,
  karaokeStateFromScore,
  checkpointQualityScore,
  checkpointForCardToken,
  normalizePhraseForMatch,
  KARAOKE_HIT_THRESHOLD,
  KARAOKE_MISS_THRESHOLD,
  type KaraokeCheckpoint,
} from './karaoke';
import {
  replayFrameIndex,
  replayTrailFrames,
  replayFrameIndexAtProgress,
  replayElapsedMsAtIndex,
} from './replay-frames';
import { compassBandsFromProfile, compassRegionRect } from './compass';
import type { VoiceLiveFrame } from '../state';

// --- card ------------------------------------------------------------------
test('card normalizer: clamps emphasis 0-3, parses focus axis, defaults revision', () => {
  const c = normalizeVoicePracticeCard({
    id: 'card_1',
    phrase: 'hello there',
    focus: { axis: 'resonance', direction: 'brighter', statement: 'Today: brightness' },
    tokens: [
      { text: 'hello', emphasis: 9, startProgress: 0, endProgress: 0.5 },
      { text: 'there', emphasis: -2, startProgress: 0.5, endProgress: 1 },
    ],
    difficulty: 'easy',
    source: 'tutor',
  });
  assert.ok(c);
  assert.equal(c.focus.axis, 'resonance');
  assert.equal(c.tokens[0].emphasis, 3);
  assert.equal(c.tokens[1].emphasis, 0);
  assert.equal(c.revision, 1);
  assert.equal(c.source, 'tutor');
});

test('card normalizer: junk -> null; bad axis -> null axis', () => {
  assert.equal(normalizeVoicePracticeCard(null), null);
  assert.equal(normalizeVoicePracticeCard({}), null);
  const c = normalizeVoicePracticeCard({ phrase: 'x', focus: { axis: 'bogus' } });
  assert.equal(c?.focus.axis, null);
});

test('replay directive: requires attemptId, clamps momentProgress', () => {
  assert.equal(normalizeVoiceReplayDirective({ momentProgress: 0.5 }), null);
  const d = normalizeVoiceReplayDirective({ attemptId: 'a1', momentProgress: 1.7, reason: 'end dropped' });
  assert.equal(d?.attemptId, 'a1');
  assert.equal(d?.momentProgress, 1);
});

test('revision pulse detection: same id higher revision -> true', () => {
  const v1 = normalizeVoicePracticeCard({ id: 'c', phrase: 'p', revision: 1 });
  const v2 = normalizeVoicePracticeCard({ id: 'c', phrase: 'p', revision: 2 });
  assert.equal(voiceCardRevisionIncreased(v1, v2), true);
  assert.equal(voiceCardRevisionIncreased(v2, v1), false);
  assert.notEqual(voiceCardIdentity(v1), voiceCardIdentity(v2));
});

// --- word-timing -----------------------------------------------------------
test('ProgressTimingSource: maps startProgress/endProgress * duration', () => {
  const card = normalizeVoicePracticeCard({
    id: 'c', phrase: 'a b',
    tokens: [{ text: 'a', startProgress: 0, endProgress: 0.5 }, { text: 'b', startProgress: 0.5, endProgress: 1 }],
  });
  const w = new ProgressTimingSource().getTokenWindows(card, 2000);
  assert.deepEqual(w[0], { tokenIndex: 0, startMs: 0, endMs: 1000 });
  assert.deepEqual(w[1], { tokenIndex: 1, startMs: 1000, endMs: 2000 });
});

test('ProgressTimingSource: null progress -> even split; zero duration -> []', () => {
  const card = normalizeVoicePracticeCard({
    id: 'c', phrase: 'a b c d',
    tokens: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
  });
  const w = new ProgressTimingSource().getTokenWindows(card, 4000);
  assert.equal(w.length, 4);
  assert.equal(w[0].endMs, 1000);
  assert.equal(w[3].endMs, 4000);
  assert.deepEqual(new ProgressTimingSource().getTokenWindows(card, 0), []);
  assert.deepEqual(new ProgressTimingSource().getTokenWindows(null, 2000), []);
});

test('tokenIndexAtElapsed / tokenIndexAtProgress', () => {
  const windows = [
    { tokenIndex: 0, startMs: 0, endMs: 1000 },
    { tokenIndex: 1, startMs: 1000, endMs: 2000 },
  ];
  assert.equal(tokenIndexAtElapsed(windows, 500), 0);
  assert.equal(tokenIndexAtElapsed(windows, 1500), 1);
  assert.equal(tokenIndexAtElapsed(windows, 9999), 1);
  assert.equal(tokenIndexAtProgress(windows, 0.75), 1);
  assert.equal(tokenIndexAtElapsed([], 5), -1);
});

// --- karaoke ---------------------------------------------------------------
test('karaoke thresholds: hit>=0.6, missed<0.35, else seen, null->pending', () => {
  assert.equal(KARAOKE_HIT_THRESHOLD, 0.6);
  assert.equal(KARAOKE_MISS_THRESHOLD, 0.35);
  assert.equal(karaokeStateFromScore(0.6), 'hit');
  assert.equal(karaokeStateFromScore(0.59), 'seen');
  assert.equal(karaokeStateFromScore(0.35), 'seen');
  assert.equal(karaokeStateFromScore(0.34), 'missed');
  assert.equal(karaokeStateFromScore(null), 'pending');
});

test('checkpointQualityScore: 70/30 path/lane blend', () => {
  assert.equal(checkpointQualityScore({ pathMatchScore: 1, laneMatchScore: 0, startProgress: 0, endProgress: 1 }), 0.7);
  assert.equal(checkpointQualityScore({ pathMatchScore: 0.8, laneMatchScore: null, startProgress: 0, endProgress: 1 }), 0.8);
  assert.equal(checkpointQualityScore(null), null);
});

test('checkpointForCardToken: prefers worst genuinely-scored overlap; null sorts last', () => {
  const token = { text: 'x', emphasis: 0, focusHint: null, startProgress: 0.4, endProgress: 0.6 };
  const cps: KaraokeCheckpoint[] = [
    { pathMatchScore: 0.9, laneMatchScore: 0.9, startProgress: 0, endProgress: 0.45 },
    { pathMatchScore: 0.2, laneMatchScore: 0.2, startProgress: 0.45, endProgress: 1 },
  ];
  assert.equal(checkpointForCardToken(token, cps)?.pathMatchScore, 0.2);
  // A lane-only checkpoint is preferred over a fully-unscored one.
  const cps2: KaraokeCheckpoint[] = [
    { pathMatchScore: null, laneMatchScore: null, startProgress: 0, endProgress: 1 },
    { pathMatchScore: null, laneMatchScore: 0.5, startProgress: 0, endProgress: 1 },
  ];
  assert.equal(checkpointForCardToken(token, cps2)?.laneMatchScore, 0.5);
});

test('markCardTokens: phrase mismatch -> all pending; match -> scored', () => {
  const card = normalizeVoicePracticeCard({
    id: 'c', phrase: 'hello there',
    tokens: [{ text: 'hello', startProgress: 0, endProgress: 0.5 }, { text: 'there', startProgress: 0.5, endProgress: 1 }],
  });
  const comparison = {
    phrase: 'hello there',
    checkpoints: [
      { pathMatchScore: 0.9, laneMatchScore: 0.9, startProgress: 0, endProgress: 0.5 },
      { pathMatchScore: 0.1, laneMatchScore: 0.1, startProgress: 0.5, endProgress: 1 },
    ],
  };
  assert.deepEqual(markCardTokens(card, comparison, { phraseMatches: false }), ['pending', 'pending']);
  const marks = markCardTokens(card, comparison, { phraseMatches: true });
  assert.equal(marks[0], 'hit');
  assert.equal(marks[1], 'missed');
});

test('normalizePhraseForMatch: case/punct insensitive', () => {
  assert.equal(normalizePhraseForMatch('Hello, There!'), normalizePhraseForMatch('hello   there'));
});

// --- replay-frames ---------------------------------------------------------
test('replayFrameIndex: progress maps to frame index; edge cases', () => {
  assert.equal(replayFrameIndex(11, 0, 10), 0);
  assert.equal(replayFrameIndex(11, 5, 10), 5);
  assert.equal(replayFrameIndex(11, 10, 10), 10);
  assert.equal(replayFrameIndex(11, 99, 10), 10);
  assert.equal(replayFrameIndex(0, 5, 10), -1);
  assert.equal(replayFrameIndex(1, 5, 10), 0);
  assert.equal(replayFrameIndex(11, 5, 0), 0);
});

test('replayFrameIndexAtProgress + inclusive trail + elapsed from timestamps', () => {
  assert.equal(replayFrameIndexAtProgress(11, 0.5), 5);
  const frames = [{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }] as VoiceLiveFrame[];
  assert.equal(replayTrailFrames(frames, 2).length, 3);
  assert.deepEqual(replayTrailFrames(frames, -1), []);
  const stamped = [{ t: 10 }, { t: 11 }, { t: 12 }] as VoiceLiveFrame[];
  assert.equal(replayElapsedMsAtIndex(stamped, 2, 9999), 2000);
  assert.equal(replayElapsedMsAtIndex([], 0, 1000), 0);
});

// --- compass ---------------------------------------------------------------
test('compassRegionRect aligns with the dot coordinate transform', () => {
  const leftFor = (r: number) => 12 + r * 76;
  const topFor = (p: number) => 88 - ((p - 80) / 320) * 76;
  const rect = compassRegionRect(compassBandsFromProfile({
    pitchFloorHz: 180, pitchCeilingHz: 240, resonanceFloor: 0.4, resonanceCeiling: 0.7,
  } as never));
  assert.ok(rect);
  assert.equal(rect!.leftPct, leftFor(0.4));
  assert.equal(Math.round((rect!.leftPct + rect!.widthPct) * 1e6) / 1e6, Math.round(leftFor(0.7) * 1e6) / 1e6);
  assert.equal(rect!.topPct, topFor(240));
  assert.equal(Math.round((rect!.topPct + rect!.heightPct) * 1e6) / 1e6, Math.round(topFor(180) * 1e6) / 1e6);
});

test('compassRegionRect preserves valid low and high custom pitch bands', () => {
  const low = compassRegionRect({
    pitchFloorHz: 80, pitchCeilingHz: 100, resonanceFloor: null, resonanceCeiling: null,
  });
  const high = compassRegionRect({
    pitchFloorHz: 330, pitchCeilingHz: 400, resonanceFloor: null, resonanceCeiling: null,
  });
  assert.ok(low && low.heightPct > 2, '80–100 Hz must not collapse at the lower edge');
  assert.ok(high && high.heightPct > 2, '330–400 Hz must not collapse at the upper edge');
  assert.ok(high.topPct < low.topPct, 'higher custom band must render above lower custom band');
});

test('compassRegionRect: no bands -> null; half-specified spans full opposite axis', () => {
  assert.equal(compassRegionRect(compassBandsFromProfile(null)), null);
  const rect = compassRegionRect(compassBandsFromProfile({ resonanceFloor: 0.3, resonanceCeiling: 0.6 } as never));
  assert.ok(rect);
  assert.equal(rect!.topPct, 12);
  assert.equal(rect!.heightPct, 76);
});
