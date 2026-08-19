'use strict';

/**
 * section-scorer unit battery + signal/renderer integration (phase B,
 * sentence-teardown pedagogy).
 *
 * Fixtures are SYNTHESIZED rather than recorded, on purpose: the whole point of
 * this module is what it refuses to claim, and a recorded take cannot be tuned
 * to sit exactly on the confident/unconfident boundary.
 *
 * Frame geometry matches the real artifact contract: `t` in ms from take start,
 * per-frame voiced/pitchHz/resonanceScore/weightScore/confidence — the shape
 * asserted by voice-coach-take-leg.test.js oneshotTakeResponse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreTakeSections,
  MIN_SECTION_VOICED_FRAMES,
  SECTION_SCORE_MARGIN,
  MAX_FRAGMENT_TOKENS,
} = require('./section-scorer');
const { buildSignal } = require('./signal-builder');
const { buildRendererUserMessage } = require('./renderer-client');

// The SHIPPED cute-feminine target (services/voice-trainer/src/services/
// audio_analysis.py:143-147), not an invented one — the constants' derivation
// depends on this band really being 188-255 Hz (= 5.28 semitones wide).
const TARGET = Object.freeze({
  source: 'preset',
  targetPreset: 'cute-feminine',
  direction: 'feminine',
  pitchFloorHz: 188,
  pitchCeilingHz: 255,
  resonanceFloor: 0.32,
  resonanceCeiling: 1,
  weightFloor: 0,
  weightCeiling: 0.4,
  minTargetHitPct: 0.28,
});

const FIVE_TOKENS = ['The', 'quick', 'brown', 'fox', 'ran'];

/**
 * Advanced metrics that PASS the shared measurement-usability gate.
 *
 * Required by any test that expects `confident: true`. The scorer demands
 * positive evidence that the take was measurable before it will name a word:
 * resolveVoiceMeasurementUsability treats an ABSENT measurement as usable (so an
 * absent take is not accused of a capture fault it was never observed to have),
 * which is right for "may this take be scored" and wrong for "may I blame one
 * word". Omitting these is therefore a legitimate not-confident case, not a
 * fixture oversight — see the R2 regression test.
 */
const USABLE_METRICS = Object.freeze({
  measurementAvailable: true,
  voicedFramePct: 1,
  confidentFramePct: 0.95,
  scoreConfidence: 0.9,
  captureReliability: 0.9,
  snrDb: 24,
  clippingPct: 0,
  pitchValidFrameCount: 80,
});

/** Card-shaped tokens: `{ text, emphasis, focusHint }` — NO timing fields. */
function cardTokens(words = FIVE_TOKENS) {
  return words.map((text) => ({ text, emphasis: 1, focusHint: '' }));
}

/**
 * Build a synthetic timeline.
 * `shape(progress)` returns a partial frame override for that position, so a
 * test can bend one slice of the take without hand-writing 100 frames.
 */
function buildTimeline({ frameCount = 100, durationMs = 2000, shape = () => ({}) } = {}) {
  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    const progress = frameCount === 1 ? 0 : i / (frameCount - 1);
    frames.push({
      t: Math.round(progress * durationMs),
      voiced: true,
      pitchHz: 210,
      pitchScore: 0.9,
      resonanceScore: 0.6,
      weightScore: 0.2,
      confidence: 0.9,
      loudnessDb: -20,
      ...shape(progress, i),
    });
  }
  return frames;
}

/** Token index i of N occupies uniform progress window [i/N, (i+1)/N). */
function inToken(progress, index, total = FIVE_TOKENS.length) {
  return progress >= index / total && progress < (index + 1) / total;
}

// ---------------------------------------------------------------------------
// (a) clean take -> worst null-or-unconfident
// ---------------------------------------------------------------------------

test('(a) a clean take names no weak section', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline(),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });

  assert.equal(result.sections.length, 5, 'one section per token');
  for (const section of result.sections) {
    assert.equal(section.axis, null, `${section.text} should be inside every band`);
    assert.equal(section.score, 0);
  }
  // Either shape is acceptable for a clean take; what must NEVER happen is a
  // confident blame.
  assert.notEqual(result.worst?.confident, true);
  assert.equal(result.worst, null, 'nothing outside a band -> nothing to name');
});

// ---------------------------------------------------------------------------
// (b) one section 4+ semitones flat -> that section confidently worst, axis pitch
// ---------------------------------------------------------------------------

test('(b) a section 4+ semitones flat is confidently the worst, on the pitch axis', () => {
  // 145 Hz against a 188 Hz floor = 12*log2(188/145) = 4.49 semitones flat.
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });

  assert.ok(result.worst, 'a clearly flat word must be named');
  assert.equal(result.worst.confident, true);
  assert.equal(result.worst.axis, 'pitch');
  assert.equal(result.worst.direction, 'under');
  assert.equal(result.worst.text, 'brown');
  assert.equal(result.worst.tokenStart, 2);
  assert.equal(result.worst.tokenEnd, 2);

  // The measured delta really is ~4.5 semitones flat, not merely "negative".
  const worstSection = result.sections.find((s) => s.tokenStart === 2);
  assert.ok(worstSection.pitchDelta < -4, `expected < -4 st, got ${worstSection.pitchDelta}`);
  assert.ok(worstSection.pitchDelta > -5, `expected > -5 st, got ${worstSection.pitchDelta}`);
  assert.equal(result.alignment, 'uniform-word-index');
});

// ---------------------------------------------------------------------------
// (c) low voiced frames in the bad section -> confident false
// ---------------------------------------------------------------------------

test('(c) too few voiced frames under the worst section -> not confident', () => {
  // 20 frames over 5 tokens = 4 frames per token, one short of the floor of 5.
  const result = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 20,
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });

  assert.ok(result.worst, 'the reading is still produced');
  assert.ok(
    result.worst.voicedFrames < MIN_SECTION_VOICED_FRAMES,
    `fixture must sit under the floor; got ${result.worst.voicedFrames}`,
  );
  // The gate actually tests samples on the BLAMED axis, so assert that quantity
  // too rather than leaning on voicedFrames happening to equal it here.
  const worstSection = result.sections.find((s) => s.tokenStart === result.worst.tokenStart);
  assert.ok(
    worstSection.axisSampleCounts.pitch < MIN_SECTION_VOICED_FRAMES,
    `the gated quantity must be under the floor; got ${worstSection.axisSampleCounts.pitch}`,
  );
  assert.equal(result.worst.confident, false, 'thin evidence must never be confident');
});

test('(c2) unvoiced frames do not count toward the evidence floor', () => {
  // Plenty of frames, but the weak token is mostly silence: only 2 are voiced.
  let voicedInBad = 0;
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => {
        if (!inToken(progress, 2)) return {};
        voicedInBad += 1;
        return voicedInBad <= 2
          ? { pitchHz: 145 }
          : { voiced: false, pitchHz: null, resonanceScore: null, weightScore: null };
      },
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });

  const bad = result.sections.find((s) => s.tokenStart === 2);
  assert.equal(bad.voicedFrames, 2);
  assert.ok(bad.frames > bad.voicedFrames, 'the window held unvoiced frames too');
  assert.equal(result.worst.confident, false);
});

// ---------------------------------------------------------------------------
// (d) margin tie -> confident false
// ---------------------------------------------------------------------------

test('(d) two equally-bad, non-adjacent sections tie -> not confident', () => {
  // Tokens 0 and 3 are equally flat and NOT adjacent, so they cannot merge.
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => (
        (inToken(progress, 0) || inToken(progress, 3)) ? { pitchHz: 145 } : {}
      ),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });

  assert.ok(result.worst, 'a leader is still reported');
  assert.equal(result.worst.confident, false, 'a tie must never blame one of the two');
  assert.ok(
    result.worst.margin < SECTION_SCORE_MARGIN,
    `expected margin < ${SECTION_SCORE_MARGIN}, got ${result.worst.margin}`,
  );
});

test('(d2) a near-tie inside one quantum is still not confident', () => {
  // Token 0 is 4.49 st flat; token 3 is 3.99 st flat — half a semitone apart,
  // i.e. inside the one-audible-miss margin.
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => {
        if (inToken(progress, 0)) return { pitchHz: 145 };
        if (inToken(progress, 3)) return { pitchHz: 149.3 };
        return {};
      },
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });

  assert.ok(result.worst.margin > 0, 'there IS a leader');
  assert.ok(result.worst.margin < SECTION_SCORE_MARGIN, 'but not by one audible miss');
  assert.equal(result.worst.confident, false);
});

// ---------------------------------------------------------------------------
// (e) token/timeline misalignment -> clamped, no throw
// ---------------------------------------------------------------------------

test('(e) token fractions beyond the timeline duration are clamped, never thrown', () => {
  const tokens = [
    { text: 'over', startProgress: 0, endProgress: 0.5 },
    { text: 'the', startProgress: 0.5, endProgress: 3.4 },     // way past the end
    { text: 'edge', startProgress: 8.1, endProgress: 12.0 },   // entirely past it
  ];
  let result;
  assert.doesNotThrow(() => {
    result = scoreTakeSections({
      timeline: buildTimeline(),
      tokens,
      target: TARGET,
      durationMs: 2000,
    });
  });
  assert.equal(result.sections.length, 3, 'no token is silently dropped');
  for (const section of result.sections) {
    assert.ok(Number.isFinite(section.score), 'every score stays finite');
    assert.ok(section.startProgress >= 0 && section.startProgress <= 1);
    assert.ok(section.endProgress >= 0 && section.endProgress <= 1);
  }
});

test('(e2) negative, reversed and non-numeric fractions fall back to the uniform slice', () => {
  const tokens = [
    { text: 'a', startProgress: -4, endProgress: 0.2 },
    { text: 'b', startProgress: 0.9, endProgress: 0.1 },       // reversed
    { text: 'c', startProgress: 'nonsense', endProgress: null },
  ];
  const result = scoreTakeSections({
    timeline: buildTimeline(),
    tokens,
    target: TARGET,
    durationMs: 2000,
  });
  assert.equal(result.sections.length, 3);
  // Falling back to uniform thirds means every frame lands in exactly one token.
  const totalFrames = result.sections.reduce((sum, s) => sum + s.frames, 0);
  assert.equal(totalFrames, 100, 'uniform fallback partitions the timeline exactly');
});

test('R7 the timeline defines its own span; a disagreeing durationMs cannot squeeze the windows', () => {
  // A trimmed take: the frames cover 0-2000 ms while durationMs still reports
  // the untrimmed 4000 ms. Deferring to durationMs would map every frame into
  // the first half of the take, starve the last tokens, and blame the wrong
  // words. The timeline's own endpoints are authoritative.
  const timeline = buildTimeline({ frameCount: 80, durationMs: 2000 });
  const result = scoreTakeSections({
    timeline,
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 4000,
  });
  const perSection = result.sections.map((s) => s.frames);
  assert.deepEqual(perSection, [16, 16, 16, 16, 16], 'frames must spread evenly across all five tokens');

  // Offset timeline: it starts at 5000 ms rather than 0. Same requirement.
  const offset = timeline.map((frame) => ({ ...frame, t: frame.t + 5000 }));
  const offsetResult = scoreTakeSections({
    timeline: offset,
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });
  assert.deepEqual(
    offsetResult.sections.map((s) => s.frames),
    [16, 16, 16, 16, 16],
    'an offset timeline must not pile every frame into the last token',
  );

  // And the fault it prevents, made concrete: the flat word must still be found
  // at its true position even when durationMs is wrong by 2x.
  const flat = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 80, durationMs: 2000,
      shape: (progress) => (inToken(progress, 3) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 4000,
    metrics: USABLE_METRICS,
  });
  assert.equal(flat.worst.text, 'fox', 'the right word is named despite a wrong durationMs');
  assert.equal(flat.worst.confident, true);
});

test('(e3) a timeline with no usable timestamps falls back to frame index position', () => {
  const timeline = buildTimeline({ frameCount: 50 }).map((frame) => ({ ...frame, t: 0 }));
  const result = scoreTakeSections({
    timeline,
    tokens: cardTokens(),
    target: TARGET,
    durationMs: null,
  });
  const totalFrames = result.sections.reduce((sum, s) => sum + s.frames, 0);
  assert.equal(totalFrames, 50, 'index fallback still partitions every frame');
});

// ---------------------------------------------------------------------------
// (f) merged adjacent weak tokens
// ---------------------------------------------------------------------------

test('(f) adjacent weak tokens on the same axis merge into one fragment', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => (
        (inToken(progress, 1) || inToken(progress, 2)) ? { pitchHz: 145 } : {}
      ),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });

  const fragment = result.sections.find((section) => section.merged);
  assert.ok(fragment, 'the two adjacent flat words must become one fragment');
  assert.equal(fragment.tokenStart, 1);
  assert.equal(fragment.tokenEnd, 2);
  assert.equal(fragment.text, 'quick brown');
  assert.equal(result.sections.length, 4, '5 tokens -> 4 sections after one merge');

  assert.equal(result.worst.tokenStart, 1);
  assert.equal(result.worst.tokenEnd, 2);
  assert.equal(result.worst.confident, true);
});

test('(f2) a merged fragment never exceeds MAX_FRAGMENT_TOKENS', () => {
  // All five tokens are flat; the cap must stop the fragment at three.
  const result = scoreTakeSections({
    timeline: buildTimeline({ shape: () => ({ pitchHz: 145 }) }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });
  for (const section of result.sections) {
    const span = section.tokenEnd - section.tokenStart + 1;
    assert.ok(
      span <= MAX_FRAGMENT_TOKENS,
      `fragment spanned ${span} tokens, cap is ${MAX_FRAGMENT_TOKENS}`,
    );
  }
});

test('(f3) adjacent weak tokens on DIFFERENT axes do not merge', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => {
        if (inToken(progress, 1)) return { pitchHz: 145 };          // pitch, under
        if (inToken(progress, 2)) return { weightScore: 0.95 };     // weight, over
        return {};
      },
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  });
  assert.equal(result.sections.length, 5, 'a mixed-axis pair is not one drillable fragment');
  assert.ok(result.sections.every((s) => !s.merged));
});

test('(f4) a whole-phrase "section" is never confidently blamed', () => {
  // Three tokens, all flat, all one axis -> they merge into a single fragment
  // that spans the entire line. That is a whole-take verdict, not a
  // localization, so phase C must not be told to isolate the whole sentence.
  const result = scoreTakeSections({
    timeline: buildTimeline({ shape: () => ({ pitchHz: 145 }) }),
    tokens: cardTokens(['Hold', 'the', 'line']),
    target: TARGET,
    durationMs: 2000,
  });
  assert.equal(result.sections.length, 1);
  assert.equal(result.worst.tokenStart, 0);
  assert.equal(result.worst.tokenEnd, 2);
  assert.equal(result.worst.confident, false, 'the whole line is not a section');
});

// ---------------------------------------------------------------------------
// REGRESSIONS from the independent review — each reproduced before it was fixed
// ---------------------------------------------------------------------------

test('R1 adjacent words on OPPOSITE sides of one band never merge and never cancel', () => {
  // The reproduced failure: "my" 1.74 st UNDER and "voice" 1.62 st OVER merged
  // on axis equality alone; their combined median landed back inside the band,
  // the fragment scored 0, both words vanished from the ranking, and "lovely"
  // (1.14 st under — the MILDEST miss on the take) was named confident:true.
  const words = ['my', 'voice', 'sounds', 'lovely'];
  const hzAt = (progress) => {
    if (progress < 0.25) return 170;   // under the 188 floor
    if (progress < 0.5) return 280;    // over the 255 ceiling
    if (progress < 0.75) return 210;   // inside
    return 176;                        // mildly under
  };
  const result = scoreTakeSections({
    timeline: buildTimeline({ frameCount: 80, shape: (progress) => ({ pitchHz: hzAt(progress) }) }),
    tokens: cardTokens(words),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });

  assert.equal(result.sections.length, 4, 'no token may be swallowed by a cancelling merge');
  assert.ok(result.sections.every((s) => !s.merged), 'opposite-side neighbours must not merge');

  const my = result.sections[0];
  const voice = result.sections[1];
  assert.equal(my.direction, 'under');
  assert.equal(voice.direction, 'over');
  assert.ok(my.score > 0 && voice.score > 0, 'both bad words keep their scores');

  // "lovely" is the mildest miss, so it must not out-rank the two real ones.
  const lovely = result.sections[3];
  assert.ok(my.score > lovely.score, 'the genuinely worst word must outrank the mildest');
  assert.ok(voice.score > lovely.score);
  assert.notEqual(result.worst.text, 'lovely', 'the mildest word must never be blamed');
});

test('R1b same-direction neighbours still merge (the guard did not kill the feature)', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => ((inToken(progress, 1) || inToken(progress, 2)) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  const fragment = result.sections.find((s) => s.merged);
  assert.ok(fragment, 'two words flat on the SAME side must still merge');
  assert.equal(fragment.text, 'quick brown');
});

test('R2 an omitted metrics argument fails the usability gate rather than passing it', () => {
  // The shared resolver treats an ABSENT measurement as usable on purpose (an
  // absent take must not be accused of a capture fault). That is right for "may
  // this take be scored"; it is wrong for "may I name one word". So this module
  // requires positive evidence of measurement quality before naming anything.
  const base = {
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  };

  assert.equal(scoreTakeSections(base).worst.confident, false, 'no metrics -> not confident');
  assert.equal(scoreTakeSections({ ...base, metrics: {} }).worst.confident, false, 'empty metrics -> not confident');
  assert.equal(scoreTakeSections({ ...base, metrics: null }).worst.confident, false, 'null metrics -> not confident');
  assert.equal(
    scoreTakeSections({ ...base, metrics: USABLE_METRICS }).worst.confident,
    true,
    'positive evidence of a usable measurement -> confident',
  );
});

test('R3 worst stays POPULATED with confident:false when a gate fails — confident is the predicate', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: { measurementAvailable: false, measurementRejectionReasons: ['no_voiced_frames'] },
  });
  // The documented contract: not null, but not nameable either.
  assert.notEqual(result.worst, null, 'diagnostics survive a failed gate');
  assert.equal(result.worst.confident, false);
  assert.equal(typeof result.worst.text, 'string');
  // The consumer-side idiom the JSDoc prescribes.
  const nameable = result.worst && result.worst.confident ? result.worst : null;
  assert.equal(nameable, null);
});

test('R4 a non-contiguous supplied grid is rejected and falls back to a true tiling', () => {
  // [0,0.3] and [0.6,1.0] are each well-formed and ordered, yet lose 30% of the
  // take between them. Individually-valid windows are not a tiling.
  const result = scoreTakeSections({
    timeline: buildTimeline(),
    tokens: [
      { text: 'first', startProgress: 0, endProgress: 0.3 },
      { text: 'second', startProgress: 0.6, endProgress: 1 },
    ],
    target: TARGET,
    durationMs: 2000,
  });
  const covered = result.sections.reduce((sum, s) => sum + s.frames, 0);
  assert.equal(covered, 100, 'every frame must belong to exactly one section');
  assert.equal(result.sections[0].endProgress, 0.5, 'fell back to uniform halves');

  // A grid that stops short of the end is equally rejected.
  const short = scoreTakeSections({
    timeline: buildTimeline(),
    tokens: [
      { text: 'a', startProgress: 0, endProgress: 0.4 },
      { text: 'b', startProgress: 0.4, endProgress: 0.8 },
    ],
    target: TARGET,
    durationMs: 2000,
  });
  assert.equal(short.sections.reduce((sum, s) => sum + s.frames, 0), 100);
  assert.equal(short.sections[1].endProgress, 1, 'fell back to uniform halves');
});

test('R5 the evidence floor counts samples on the BLAMED axis, not raw voiced frames', () => {
  // 20 voiced frames in the window, but only ONE carries a usable pitch value.
  // A median of one sample is not evidence, however "voiced" the window looks.
  let seen = 0;
  const result = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => {
        if (!inToken(progress, 2)) return {};
        seen += 1;
        return seen === 1 ? { pitchHz: 120 } : { pitchHz: null };
      },
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  const bad = result.sections.find((s) => s.tokenStart === 2);
  assert.equal(bad.voicedFrames, 20, 'the window IS fully voiced');
  assert.equal(bad.axisSampleCount, 1, 'but only one frame backs the pitch median');
  assert.equal(result.worst.confident, false, 'one sample must never be confident');
});

test('R6 an UNMEASURED runner-up cannot hand the leader a free margin', () => {
  // Token 1 has no usable pitch at all, so it scores 0 by default. That must not
  // read as "clearly fine" — it is unknown, and unknown cannot establish the
  // separation the margin gate is testing for.
  const result = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => {
        if (inToken(progress, 0, 2)) return { pitchHz: 176 };            // mild miss, measured
        return { voiced: false, pitchHz: null, resonanceScore: null, weightScore: null };
      },
    }),
    tokens: cardTokens(['first', 'second']),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  assert.ok(result.worst, 'a leader is still reported');
  assert.equal(result.worst.confident, false, 'no measured rival -> no confident blame');
});

test('R8 the usability gate tests for EVIDENCE, not merely a non-empty object', () => {
  const base = {
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
  };
  // Truthy, non-empty, and says nothing whatsoever about measurement quality.
  assert.equal(
    scoreTakeSections({ ...base, metrics: { someUnrelatedKey: 1 } }).worst.confident,
    false,
    'an object with no measurement fields must not satisfy the gate',
  );
  assert.equal(scoreTakeSections({ ...base, metrics: [] }).worst.confident, false);
  assert.equal(scoreTakeSections({ ...base, metrics: 'nope' }).worst.confident, false);
  assert.equal(scoreTakeSections({ ...base, metrics: 0 }).worst.confident, false);
  // The shapes the resolver genuinely accepts all still work.
  assert.equal(scoreTakeSections({ ...base, metrics: USABLE_METRICS }).worst.confident, true);
  assert.equal(scoreTakeSections({ ...base, metrics: { advanced: USABLE_METRICS } }).worst.confident, true);
  assert.equal(
    scoreTakeSections({ ...base, metrics: { metrics: { advanced: USABLE_METRICS } } }).worst.confident,
    true,
  );
  // A single genuine field is evidence, and a REJECTING one still rejects.
  assert.equal(scoreTakeSections({ ...base, metrics: { measurementAvailable: true } }).worst.confident, true);
  assert.equal(scoreTakeSections({ ...base, metrics: { measurementAvailable: false } }).worst.confident, false);
});

test('R9 the margin baseline is the TOP rival, so a higher-scoring rival cannot be skipped', () => {
  // Token 0 is badly flat (pitch). Token 1 is badly dark (resonance) and carries
  // only ONE usable pitch sample. Scanning past token 1 to a clean token would
  // compare the leader against a section it already beat and inflate the margin;
  // token 1 is the real competitor and it cannot be judged on the pitch axis.
  let pitchSamplesInToken1 = 0;
  const result = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => {
        if (inToken(progress, 0)) return { pitchHz: 145 };
        if (inToken(progress, 1)) {
          pitchSamplesInToken1 += 1;
          return { pitchHz: pitchSamplesInToken1 === 1 ? 210 : null, resonanceScore: 0 };
        }
        return {};
      },
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });

  const rival = result.sections.find((s) => s.tokenStart === 1);
  assert.equal(rival.axis, 'resonance', 'the rival is genuinely bad, on another axis');
  assert.ok(rival.score > 0);
  assert.equal(rival.axisSampleCounts.pitch, 1, 'and it is unmeasurable on the leader axis');
  assert.equal(result.worst.confident, false, 'an unjudgeable top rival blocks confidence');
});

test('R10 a fragment with no nameable text is never confident (witness and prompt must agree)', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline({
      frameCount: 80,
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(['The', 'quick', '   ', 'fox', 'ran']),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  assert.equal(result.worst.tokenStart, 2, 'the blank token still leads the scoring');
  assert.equal(
    result.worst.confident,
    false,
    'an unnameable fragment cannot be isolated or spoken about, so it cannot be confident',
  );
});

test('R11 the documented gate COUNT matches the implemented one, in every place it is stated', () => {
  // Two review rounds were blocked for comments that stated a contract the code
  // did not honor, and the gate count drifted again the moment a fifth gate was
  // added. Numbers in prose rot silently, so this asserts them mechanically.
  const fs = require('node:fs');
  const scorerSrc = fs.readFileSync(require.resolve('./section-scorer.js'), 'utf8');
  const builderSrc = fs.readFileSync(require.resolve('./signal-builder.js'), 'utf8');

  // The truth: how many conditions are ANDed into `confident`.
  const confidentLine = scorerSrc.match(/const confident = Boolean\(([^)]*)\)/);
  assert.ok(confidentLine, 'the confident expression must be findable');
  const conjuncts = confidentLine[1].split('&&').map((part) => part.trim()).filter(Boolean);
  const implemented = conjuncts.length;
  assert.ok(implemented >= 4, `sanity: expected several gates, found ${implemented}`);

  // Every gate must carry a numbered comment, numbered 1..N with no gaps.
  const labels = [...scorerSrc.matchAll(/^\s*\/\/ Gate (\d+):/gm)].map((m) => Number(m[1]));
  assert.deepEqual(
    labels.sort((a, b) => a - b),
    Array.from({ length: implemented }, (_unused, i) => i + 1),
    `each of the ${implemented} conjuncts in \`confident\` needs its own "Gate N:" comment`,
  );

  // And the prose count must agree, in both files that state it.
  const WORDS = { 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' };
  const word = WORDS[implemented];
  assert.ok(word, `add ${implemented} to the WORDS map`);
  const stale = Object.entries(WORDS)
    .filter(([count]) => Number(count) !== implemented)
    .map(([, other]) => other);

  for (const [name, src] of [['section-scorer.js', scorerSrc], ['signal-builder.js', builderSrc]]) {
    const gateProse = [...src.matchAll(/(\w+) (?:absolute gates|confident gates|gates\b)/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((token) => Object.values(WORDS).includes(token));
    assert.ok(gateProse.length > 0, `${name} should document the gate count`);
    for (const token of gateProse) {
      assert.equal(
        stale.includes(token),
        false,
        `${name} says "${token} gates" but ${implemented} are implemented`,
      );
      assert.equal(token, word, `${name} must say "${word} gates"`);
    }
  }
});

// ---------------------------------------------------------------------------
// null-safety contract
// ---------------------------------------------------------------------------

test('absent timeline / tokens / target return the empty result, never a throw', () => {
  const cases = [
    {},
    { timeline: null, tokens: null, target: null },
    { timeline: buildTimeline(), tokens: cardTokens(), target: null },
    { timeline: buildTimeline(), tokens: null, target: TARGET },
    { timeline: null, tokens: cardTokens(), target: TARGET },
    { timeline: [], tokens: [], target: TARGET },
    { timeline: 'nope', tokens: 42, target: TARGET },
    { timeline: [null, undefined, 7], tokens: cardTokens(), target: TARGET },
  ];
  for (const input of cases) {
    let result;
    assert.doesNotThrow(() => { result = scoreTakeSections(input); }, JSON.stringify(input));
    assert.deepEqual(result.sections, [], JSON.stringify(input));
    assert.equal(result.worst, null, JSON.stringify(input));
  }
  assert.doesNotThrow(() => scoreTakeSections());
});

test('a target with unusable bands scores no axis rather than inventing one', () => {
  const result = scoreTakeSections({
    timeline: buildTimeline(),
    tokens: cardTokens(),
    target: { pitchFloorHz: null, pitchCeilingHz: null, resonanceFloor: 0.5, resonanceCeiling: 0.5 },
    target_note: 'degenerate resonance band (floor === ceiling)',
    durationMs: 2000,
  });
  assert.equal(result.sections.length, 5);
  assert.ok(result.sections.every((s) => s.axis === null));
  assert.equal(result.worst, null);
});

// ---------------------------------------------------------------------------
// the measurement-usability gate is REUSED, not re-implemented
// ---------------------------------------------------------------------------

test('an unusable measurement blocks confidence even on a blatant miss', () => {
  const base = {
    timeline: buildTimeline({
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  };

  assert.equal(scoreTakeSections(base).worst.confident, true, 'control: confident with a usable measurement');

  const rejected = scoreTakeSections({
    ...base,
    metrics: { measurementAvailable: false, measurementRejectionReasons: ['no_voiced_frames'] },
  });
  assert.equal(rejected.worst.confident, false, 'a rejected measurement can never name a fragment');
});

// ---------------------------------------------------------------------------
// cue-sheet tokens (the shape that DOES carry startProgress/endProgress)
// ---------------------------------------------------------------------------

test('cue-sheet tokens carrying startProgress/endProgress are honored verbatim', () => {
  const { buildVoiceCueSheet } = require('../voice-cue-sheet');
  const sheet = buildVoiceCueSheet({ phrase: 'The quick brown fox ran', targetPreset: 'cute-feminine' });
  assert.ok(sheet && Array.isArray(sheet.tokens) && sheet.tokens.length === 5);
  // The real cue-sheet fractions ARE the uniform word-index fractions
  // (voice-cue-sheet.js:803-804) — this pins that fact so a future change to
  // that formula cannot silently alter section boundaries.
  assert.equal(sheet.tokens[0].startProgress, 0);
  assert.equal(sheet.tokens[0].endProgress, 0.2);
  assert.equal(sheet.tokens[4].startProgress, 0.8);
  assert.equal(sheet.tokens[4].endProgress, 1);

  const fromSheet = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: sheet.tokens,
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  const fromCard = scoreTakeSections({
    timeline: buildTimeline({
      shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
    }),
    tokens: cardTokens(),
    target: TARGET,
    durationMs: 2000,
    metrics: USABLE_METRICS,
  });
  assert.equal(fromSheet.worst.tokenStart, fromCard.worst.tokenStart);
  assert.equal(fromSheet.worst.text, fromCard.worst.text);
});

// ---------------------------------------------------------------------------
// the constant's real anchor: the 80-frame attempt-artifact cap
// ---------------------------------------------------------------------------

test('the attempt-artifact timeline cap is 80 frames — the anchor for MIN_SECTION_VOICED_FRAMES', () => {
  // MIN_SECTION_VOICED_FRAMES is derived from 80/wordCount, NOT from a frame
  // rate (see the module header). voice-session-state.js:918-921 passes an
  // explicit 80 that overrides normalizeVoiceDetailedTimeline's 160 default, so
  // a change there silently changes how often the evidence floor binds. Pin it.
  const { createVoiceSessionStateRuntime } = require('../voice-session-state');
  const stateRuntime = createVoiceSessionStateRuntime({});
  const frames = (count) => Array.from({ length: count }, (_unused, i) => ({
    t: i * 20, voiced: true, pitchHz: 210, pitchScore: 0.9,
    resonanceScore: 0.6, weightScore: 0.2, confidence: 0.9, loudnessDb: -20,
  }));
  const normalize = (count) => stateRuntime.normalizeVoiceAttemptArtifact({
    attemptArtifactId: 'cap-probe',
    voiceSessionId: 'vs-cap',
    finalizedAt: Date.now(),
    metrics: { advanced: {} },
    timeline: frames(count),
  })?.timeline?.length;

  assert.equal(normalize(50), 50, 'under the cap, every frame survives');
  assert.equal(normalize(80), 80, 'the cap itself is 80');
  assert.equal(normalize(400), 80, 'anything larger is resampled down to 80');

  // With 80 frames and the drill-pack median of 5 words, a fully-voiced token
  // holds 16 frames — comfortably above the floor, which is the intended
  // relationship. If this ever drops below the floor the scorer goes silent.
  assert.ok(80 / 5 > MIN_SECTION_VOICED_FRAMES, 'a median-length line must clear the floor');
});

// ---------------------------------------------------------------------------
// (g)/(h) signal + renderer integration
// ---------------------------------------------------------------------------

const SESSION_STARTED_AT = 1_700_000_000_000;

/** A voiceState carrying a fresh, usable take with one flat word. */
function voiceStateWithTake({ finalizedAt = SESSION_STARTED_AT + 5_000, flatToken = 2 } = {}) {
  const timeline = buildTimeline({
    shape: (progress) => (flatToken == null || !inToken(progress, flatToken) ? {} : { pitchHz: 145 }),
  });
  const advanced = {
    measurementAvailable: true,
    sampleCount: timeline.length,
    voicedFramePct: 1,
    confidentFramePct: 0.95,
    scoreConfidence: 0.9,
    captureReliability: 0.9,
    snrDb: 24,
    clippingPct: 0,
    pitchValidFrameCount: timeline.length,
    medianPitchHz: 205,
  };
  const summary = {
    voiceSessionId: 'vs-phaseB',
    durationMs: 2000,
    targetPreset: 'cute-feminine',
    target: { ...TARGET },
    metrics: { pitchHz: 205, resonance: 0.6, weight: 0.2, advanced },
    issues: [],
  };
  return {
    sessionStartedAt: SESSION_STARTED_AT,
    targetPreset: 'cute-feminine',
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: summary,
    lastAttemptArtifact: {
      attemptArtifactId: 'aa-phaseB',
      voiceSessionId: 'vs-phaseB',
      finalizedAt,
      target: { ...TARGET },
      metrics: summary.metrics,
      durationMs: 2000,
      timeline,
    },
    voiceInputRuntime: { previousInputTurnAt: SESSION_STARTED_AT + 1_000 },
  };
}

function buildPhaseBSignal(overrides = {}) {
  return buildSignal({
    voiceState: voiceStateWithTake(overrides.take || {}),
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
    ...overrides.signal,
  });
}

test('(g) STALE take evidence produces no sections at all', () => {
  // Finalized BEFORE this turn's window -> the freshness gate strips the take.
  const stale = buildSignal({
    voiceState: voiceStateWithTake({ finalizedAt: SESSION_STARTED_AT + 500 }),
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });

  assert.equal(stale.decisionWitness.intent.takeFreshness.fresh, false);
  assert.equal(stale.decisionWitness.intent.takeFreshness.gated, true);
  assert.equal(stale.takeSections, undefined, 'a stale take must not localize blame');
  assert.equal(stale.decisionWitness.takeSections, undefined, 'and must log no section witness');
  assert.equal(buildRendererUserMessage(stale).includes('Weak section'), false);
});

test('(g2) a FRESH take with the same data does produce sections', () => {
  const fresh = buildPhaseBSignal();
  assert.equal(fresh.decisionWitness.intent.takeFreshness.fresh, true);
  assert.ok(fresh.takeSections, 'a fresh take + card tokens must localize');
  assert.equal(fresh.takeSections.sectionCount, 5);
  assert.equal(fresh.takeSections.alignment, 'uniform-word-index');
});

test('(g3) without card tokens nothing is attached and nothing is logged', () => {
  const noTokens = buildSignal({
    voiceState: voiceStateWithTake(),
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });
  assert.equal(noTokens.takeSections, undefined);
  assert.equal(noTokens.decisionWitness.takeSections, undefined);
});

test('(h) a confident worst renders exactly one Weak-section line', () => {
  const signal = buildPhaseBSignal();
  assert.equal(signal.takeSections.worst.confident, true);

  const message = buildRendererUserMessage(signal);
  const weakLines = message.split('\n').filter((line) => line.startsWith('Weak section:'));
  assert.equal(weakLines.length, 1, 'exactly one line, never two');

  const line = weakLines[0];
  assert.equal(line, 'Weak section: "brown" — pitch dipped too low there');

  // Product laws, checked on the rendered string itself rather than hoped for.
  assert.equal(/\d/.test(line), false, 'no numbers in the rendered section line');
  assert.equal(line.includes('\n'), false, 'stays one line');
  assert.match(line, /pitch|voice|sound|throat/, 'articulatory / body register');
  assert.equal(
    /\b(practice|homework|later|at home|tomorrow|straw|mirror|cup|water|device|app)\b/i.test(line),
    false,
    'no homework and no equipment',
  );
});

test('(h1b) every renderer suppression gate holds, and a confident worst renders one line', () => {
  // Note the schema sentinel: renderer-client gates on `signal.schema`
  // (signal-schema.js isV2), NOT on a `version` field. A fixture that sets
  // `version` instead leaves v2 false, which makes takeUsable default to true
  // and hides the takeQuality gate — that mistake produced a false failure
  // while this battery was being written, so the sentinel is used explicitly.
  const { COACHING_SIGNAL_SCHEMA } = require('./signal-schema');
  const make = (over = {}) => ({
    schema: COACHING_SIGNAL_SCHEMA,
    policy: { shouldCorrect: true },
    takeQuality: { usable: true },
    takeSections: {
      worst: {
        tokenStart: 1, tokenEnd: 2, text: 'quick brown',
        axis: 'pitch', direction: 'under', confident: true,
        margin: 3, voicedFrames: 16, score: 3,
      },
      sectionCount: 5,
      alignment: 'uniform-word-index',
    },
    ...over,
  });
  const countLines = (signal) => buildRendererUserMessage(signal)
    .split('\n').filter((line) => line.startsWith('Weak section:')).length;

  assert.equal(countLines(make()), 1, 'the confident case renders exactly one line');

  const suppressed = {
    'unconfident worst': make({ takeSections: { ...make().takeSections, worst: { ...make().takeSections.worst, confident: false } } }),
    'null worst': make({ takeSections: { worst: null, sectionCount: 5 } }),
    'no takeSections block': make({ takeSections: undefined }),
    'shouldCorrect false': make({ policy: { shouldCorrect: false } }),
    'shouldCorrect missing': make({ policy: {} }),
    'take not usable': make({ takeQuality: { usable: false } }),
    'blank fragment text': make({ takeSections: { ...make().takeSections, worst: { ...make().takeSections.worst, text: '   ' } } }),
    'axis with no phrasing': make({ takeSections: { ...make().takeSections, worst: { ...make().takeSections.worst, axis: 'prosody' } } }),
    'direction with no phrasing': make({ takeSections: { ...make().takeSections, worst: { ...make().takeSections.worst, direction: 'sideways' } } }),
  };
  for (const [name, signal] of Object.entries(suppressed)) {
    assert.equal(countLines(signal), 0, `${name} must render no section line`);
  }
});

test('(h1c) every axis/direction phrasing obeys the register laws', () => {
  const { COACHING_SIGNAL_SCHEMA } = require('./signal-schema');
  for (const axis of ['pitch', 'resonance', 'weight']) {
    for (const direction of ['under', 'over']) {
      const rendered = buildRendererUserMessage({
        schema: COACHING_SIGNAL_SCHEMA,
        policy: { shouldCorrect: true },
        takeQuality: { usable: true },
        takeSections: {
          worst: {
            tokenStart: 1, tokenEnd: 2, text: 'quick brown',
            axis, direction, confident: true, margin: 3, voicedFrames: 16, score: 3,
          },
          sectionCount: 5,
          alignment: 'uniform-word-index',
        },
      });
      const lines = rendered.split('\n').filter((line) => line.startsWith('Weak section:'));
      assert.equal(lines.length, 1, `${axis}/${direction} should render one line`);
      const line = lines[0];
      assert.equal(/\d/.test(line), false, `${axis}/${direction} must carry no number`);
      assert.equal(
        /\b(practice|homework|later|at home|on your own|tomorrow|come back|next time)\b/i.test(line),
        false,
        `${axis}/${direction} must not send the learner away`,
      );
      assert.equal(
        /\b(straw|mirror|cup|water|bottle|phone|device|app|headphone|microphone)\b/i.test(line),
        false,
        `${axis}/${direction} must not require equipment`,
      );
      assert.match(
        line,
        /\b(pitch|voice|sound|throat|band|weight|forward|thin|light|tongue)\b/,
        `${axis}/${direction} must speak in the articulatory/body register`,
      );
    }
  }
});

test('(h2) an UNCONFIDENT worst renders nothing', () => {
  // Two equally-flat, non-adjacent words -> a tie -> unconfident.
  const timeline = buildTimeline({
    shape: (progress) => ((inToken(progress, 0) || inToken(progress, 3)) ? { pitchHz: 145 } : {}),
  });
  const state = voiceStateWithTake();
  state.lastAttemptArtifact.timeline = timeline;

  const signal = buildSignal({
    voiceState: state,
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });

  assert.ok(signal.takeSections, 'the sections block is still attached');
  assert.equal(signal.takeSections.worst.confident, false);
  assert.equal(
    buildRendererUserMessage(signal).includes('Weak section'),
    false,
    'an unconfident verdict must render nothing',
  );
});

test('(h3) a clean take attaches sections but renders no line', () => {
  const state = voiceStateWithTake({ flatToken: null });
  const signal = buildSignal({
    voiceState: state,
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });
  assert.ok(signal.takeSections);
  assert.equal(signal.takeSections.worst, null);
  assert.equal(buildRendererUserMessage(signal).includes('Weak section'), false);
});

test('(h4) the witness carries the worst-section fields only when sections were computed', () => {
  const withSections = buildPhaseBSignal();
  const w = withSections.decisionWitness.takeSections;
  assert.ok(w, 'sections computed -> witness present');
  assert.equal(w.worstTokenStart, 2);
  assert.equal(w.worstTokenEnd, 2);
  assert.equal(w.worstAxis, 'pitch');
  assert.equal(w.worstConfident, true);
  assert.equal(w.sectionCount, 5);
  assert.equal(w.alignment, 'uniform-word-index');

  // Takeless turn: no artifact at all -> the witness gains zero fields.
  const takeless = buildSignal({
    voiceState: { sessionStartedAt: SESSION_STARTED_AT, targetPreset: 'cute-feminine' },
    userMessage: 'hello',
    practiceMode: 'conversation',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    now: SESSION_STARTED_AT + 6_000,
  });
  assert.equal(takeless.decisionWitness.takeSections, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(takeless.decisionWitness, 'takeSections'),
    false,
    'zero new witness keys on a takeless turn',
  );
});

// ---------------------------------------------------------------------------
// (i) the RUNTIME witness — driven through a real coach turn
// ---------------------------------------------------------------------------

/**
 * The worst_section_* fields live only in voice-standalone-runtime.js's
 * coach_gates emitter, which no unit test reaches. This drives an actual coach
 * turn against a mock trainer so the field mapping, the `noteworthy` clause that
 * lets the line fire on an otherwise-clean turn, and the card-store joinery are
 * all covered by a regression rather than by a one-off probe.
 */
test('(i) a real coach turn logs coach_gates carrying the worst-section fields', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createVoiceStandaloneRuntime } = require('../voice-standalone-runtime');

  const VOICE_SESSION_ID = 'vs-phaseb-witness';
  const takeOneshotPath = `/api/v1/voice/sessions/${VOICE_SESSION_ID}/take-oneshot`;
  const logLines = [];
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-phaseb-witness-'));

  const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  // 80 frames; token index 2 ("brown") sits 4.49 semitones under the floor.
  const artifactTimeline = buildTimeline({
    frameCount: 80,
    shape: (progress) => (inToken(progress, 2) ? { pitchHz: 145 } : {}),
  });
  const takeAdvanced = { ...USABLE_METRICS, sampleCount: 80, medianPitchHz: 205, quality: {}, formantLite: {} };
  const takeMetrics = () => ({
    meanPitchHz: 196, resonanceScore: 0.6, weightScore: 0.2, advanced: { ...takeAdvanced },
  });

  try {
    const runtime = createVoiceStandaloneRuntime({
      stateRoot,
      disableSessionPersistence: true,
      learnerContextRoot: path.join(stateRoot, 'learner-context'),
      logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
      fetchImpl: async (url, options = {}) => {
        const target = String(url);
        if (target.includes(takeOneshotPath)) {
          const body = JSON.parse(options.body || '{}');
          return jsonResponse(200, {
            voiceSessionId: VOICE_SESSION_ID,
            status: 'ready',
            summary: {
              voiceSessionId: VOICE_SESSION_ID,
              durationMs: 2000,
              targetPreset: 'cute-feminine',
              metrics: takeMetrics(),
              target: { ...TARGET },
              issues: [],
              nextDrills: [],
            },
            attemptArtifact: {
              attemptArtifactId: 'aa-phaseb-witness',
              voiceSessionId: VOICE_SESSION_ID,
              sloaneSessionId: body.sloaneSessionId || null,
              targetPreset: 'cute-feminine',
              target: { ...TARGET },
              finalizedAt: Date.now(),
              durationMs: 2000,
              metrics: takeMetrics(),
              reliabilityFlags: [],
              timeline: artifactTimeline,
            },
          });
        }
        if (target.includes('/api/v1/voice/sessions/start')) {
          return jsonResponse(200, {
            voiceSessionId: VOICE_SESSION_ID,
            status: 'ready',
            targetPreset: 'cute-feminine',
            targetSource: 'built-in',
            createdAt: Date.now(),
          });
        }
        return jsonResponse(200, {});
      },
      voiceInputAsrBridge: {
        getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
        transcribeAudio: async () => ({
          success: true,
          transcript: 'The quick brown fox ran',
          confidence: 0.95,
          providerStyle: 'simple',
          transcriptSource: 'backend-asr',
        }),
      },
    });

    const app = runtime.appCompatibilityRouteHandlers;
    const handlers = runtime.voiceOperationRouteHandlers;
    const started = await app.startSession({ sessionId: 'phaseb-witness', studentId: 'phaseb-user' });
    const sessionId = started.sessionId || 'phaseb-witness';
    await handlers.startVoiceSession({ sessionId, targetPreset: 'cute-feminine' });

    // The active card is what the scorer slices the timeline by.
    runtime.practiceCards.createCard(sessionId, {
      phrase: FIVE_TOKENS.join(' '),
      focus: { axis: 'pitch', direction: 'keep the pitch settled' },
      targetPreset: 'cute-feminine',
      source: 'tutor',
    });

    // Land a take through the live-turn path. Full-amplitude alternating PCM,
    // the same fixture shape voice-coach-take-leg.test.js uses, so it survives
    // the voice trim.
    const samples = Math.round((16000 * 900) / 1000);
    const pcm = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i += 1) pcm.writeInt16LE(i % 2 ? 9000 : -9000, i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);

    await handlers.submitVoiceInputTurn({
      sessionId,
      requestedProvider: 'backend',
      captureProvider: 'backend',
      audioFormat: 'wav',
      mimeType: 'audio/wav',
      filename: 'voice-input.wav',
      transcriptSource: 'backend-live',
      capturedAt: Date.now(),
    }, {
      audioBuffer: Buffer.concat([header, pcm]),
      pcmBuffer: pcm,
      shouldCommit: () => true,
    });

    const voiceState = runtime.sessions.get(sessionId).voiceState;
    assert.ok(voiceState.lastAttemptArtifact, 'the take must have landed');
    assert.equal(
      voiceState.lastAttemptArtifact.timeline.length, 80,
      'the artifact timeline arrives at the documented 80-frame cap',
    );

    logLines.length = 0;
    await handlers.processVoiceCoachRuntime({ sessionId, message: 'How did that line sound?' });

    const gates = logLines.filter((line) => line && line.event === 'coach_gates');
    assert.equal(gates.length, 1, 'exactly one coach_gates line for the turn');
    const gate = gates[0];
    // The turn is otherwise unremarkable (no strain, no misses, no metric
    // failures), so this line only exists because a confident weak section made
    // it noteworthy — that clause is what this asserts.
    assert.deepEqual(gate.metric_failures, [], 'nothing else made this turn noteworthy');
    assert.equal(gate.strain_tier, null);
    assert.equal(gate.worst_section_tokens, '2-2');
    assert.equal(gate.worst_section_axis, 'pitch');
    assert.equal(gate.worst_section_confident, true);
    assert.equal(gate.worst_section_count, 5);
    assert.equal(gate.worst_section_alignment, 'uniform-word-index');
  } finally {
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('(i2) a takeless coach turn adds NO worst_section keys to coach_gates', () => {
  // The runtime spreads the fields only when decisionWitness.takeSections exists,
  // and that only exists when the scorer ran. Asserted at the witness boundary
  // (the runtime spread is `...(takeSections ? {...} : {})`), so an absent
  // witness block provably contributes zero keys to the logged line.
  const takeless = buildSignal({
    voiceState: { sessionStartedAt: SESSION_STARTED_AT, targetPreset: 'cute-feminine' },
    userMessage: 'hello',
    practiceMode: 'conversation',
    targetPreset: 'cute-feminine',
    cardTokens: cardTokens(),
    now: SESSION_STARTED_AT + 6_000,
  });
  assert.equal(takeless.decisionWitness.takeSections, undefined);
  const spread = { ...(takeless.decisionWitness.takeSections ? { worst_section_axis: 'x' } : {}) };
  assert.deepEqual(Object.keys(spread), [], 'zero added keys on a takeless turn');
});

test('(h5) phase B is ADVISORY — it changes no intent, policy or safety field', () => {
  const withTokens = buildPhaseBSignal();
  const withoutTokens = buildSignal({
    voiceState: voiceStateWithTake(),
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });

  assert.deepEqual(withTokens.policy, withoutTokens.policy, 'policy must be untouched');
  assert.deepEqual(withTokens.coachingDecision, withoutTokens.coachingDecision);
  assert.deepEqual(withTokens.safety, withoutTokens.safety);
  assert.equal(
    withTokens.decisionWitness.intent.resolved,
    withoutTokens.decisionWitness.intent.resolved,
    'intent must not move on this wave',
  );
});
