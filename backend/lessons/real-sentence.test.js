'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SENTENCE_LEN,
  SUGGESTION_COUNT,
  REAL_SENTENCES_CAP,
  localDateString,
  normalizeRealSentenceEntry,
  normalizeRealSentences,
  findTodaysSentence,
  findPendingDebrief,
  buildSuggestions,
  createRealSentenceEntry,
  computeHeldRatio,
  evaluateReadiness,
  outcomeCoachLine,
  whatWorkedEntryForOutcome,
  pendingDebriefGreetingLine,
} = require('./real-sentence');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-11T12:00:00');
const TODAY = localDateString(NOW);
const YESTERDAY = localDateString(NOW - DAY);
const TWO_AGO = localDateString(NOW - 2 * DAY);

test('real-sentence — entry normalize + create', async (t) => {
  await t.test('createRealSentenceEntry caps at 120 chars and stamps today', () => {
    const long = 'x'.repeat(200);
    const e = createRealSentenceEntry(long, NOW);
    assert.equal(e.text.length, MAX_SENTENCE_LEN);
    assert.equal(e.pickedAt, TODAY);
    assert.equal(e.status, 'picked');
    assert.equal(e.outcome, null);
  });

  await t.test('createRealSentenceEntry returns null for empty', () => {
    assert.equal(createRealSentenceEntry('   ', NOW), null);
    assert.equal(createRealSentenceEntry('', NOW), null);
  });

  await t.test('normalizeRealSentenceEntry drops empties + coerces bad status/outcome', () => {
    assert.equal(normalizeRealSentenceEntry({ text: '' }), null);
    const e = normalizeRealSentenceEntry({ text: 'Hi.', status: 'bogus', outcome: 'nope' });
    assert.equal(e.status, 'picked');
    assert.equal(e.outcome, null);
  });

  await t.test('normalizeRealSentences caps at 60, preserves order', () => {
    const big = Array.from({ length: 80 }, (_, i) => ({ text: `s${i}`, pickedAt: TODAY }));
    const out = normalizeRealSentences(big);
    assert.equal(out.length, REAL_SENTENCES_CAP);
    assert.equal(out[0].text, 's0');
  });
});

test('real-sentence — todaysSentence + pendingDebrief', async (t) => {
  // Newest-first list.
  const list = [
    { id: 'a', text: 'today line', pickedAt: TODAY, status: 'picked', outcome: null, note: '' },
    { id: 'b', text: 'yesterday open', pickedAt: YESTERDAY, status: 'ready', outcome: null, note: '' },
    { id: 'c', text: 'two ago open', pickedAt: TWO_AGO, status: 'picked', outcome: null, note: '' },
  ];

  await t.test('todaysSentence = first entry pickedAt === today', () => {
    assert.equal(findTodaysSentence(list, NOW).id, 'a');
    assert.equal(findTodaysSentence([], NOW), null);
  });

  await t.test('pendingDebrief = newest pre-today still-open entry (only the most recent)', () => {
    const p = findPendingDebrief(list, NOW);
    assert.equal(p.id, 'b', 'should pick yesterday, not the older two-ago');
  });

  await t.test('pendingDebrief ignores debriefed entries', () => {
    const debriefed = [
      { id: 'b', text: 'yd', pickedAt: YESTERDAY, status: 'debriefed', outcome: 'said-well', note: '' },
      { id: 'c', text: 'older open', pickedAt: TWO_AGO, status: 'picked', outcome: null, note: '' },
    ];
    assert.equal(findPendingDebrief(debriefed, NOW).id, 'c');
  });

  await t.test('today entry is never a pendingDebrief', () => {
    const onlyToday = [{ id: 'a', text: 't', pickedAt: TODAY, status: 'picked', outcome: null, note: '' }];
    assert.equal(findPendingDebrief(onlyToday, NOW), null);
  });
});

test('real-sentence — suggestions', async (t) => {
  await t.test('exactly 3, deterministic, name intro first', () => {
    const s = buildSuggestions({ displayName: 'Robin', topics: ['cycling'], hobbies: ['piano'] }, []);
    assert.equal(s.length, SUGGESTION_COUNT);
    assert.match(s[0], /Robin/);
    // Deterministic: same inputs -> same output.
    const s2 = buildSuggestions({ displayName: 'Robin', topics: ['cycling'], hobbies: ['piano'] }, []);
    assert.deepEqual(s, s2);
  });

  await t.test('never repeats the last 10 picked (case-insensitive)', () => {
    const recent = [{ text: 'A flat white, please.', pickedAt: TODAY }];
    const s = buildSuggestions({}, recent);
    assert.equal(s.length, SUGGESTION_COUNT);
    assert.ok(!s.some((x) => x.toLowerCase() === 'a flat white, please.'));
  });

  await t.test('always returns 3 even when profile empty (everyday backfill)', () => {
    const s = buildSuggestions({}, []);
    assert.equal(s.length, SUGGESTION_COUNT);
  });

  await t.test('suggestions are within the char cap', () => {
    const s = buildSuggestions({ displayName: 'x'.repeat(200) }, []);
    for (const line of s) assert.ok(line.length <= MAX_SENTENCE_LEN);
  });
});

test('real-sentence — held-ratio computation', async (t) => {
  await t.test('priority 1: phraseComparison.checkpoints (corridorHoldScore)', () => {
    const take = {
      phraseComparison: {
        checkpoints: [
          { corridorHoldScore: 0.9 },
          { corridorHoldScore: 0.8 },
          { corridorHoldScore: 0.3 }, // below threshold
        ],
      },
    };
    // 2 of 3 held.
    assert.ok(Math.abs(computeHeldRatio(take) - 2 / 3) < 1e-9);
  });

  await t.test('falls back to pathMatchScore when corridorHold absent', () => {
    const take = { phraseComparison: { checkpoints: [{ pathMatchScore: 0.7 }, { pathMatchScore: 0.5 }] } };
    assert.equal(computeHeldRatio(take), 0.5);
  });

  await t.test('priority 2: DSP timeline (voiced frames, pitchScore)', () => {
    const take = {
      attemptArtifact: {
        timeline: [
          { voiced: true, pitchScore: 0.9 },
          { voiced: true, pitchScore: 0.2 },
          { voiced: false, pitchScore: 0.9 }, // unvoiced -> not counted
        ],
      },
    };
    assert.equal(computeHeldRatio(take), 0.5); // 1 of 2 voiced
  });

  await t.test('priority 3: targetHitPct/100', () => {
    const take = { summary: { metrics: { targetHitPct: 80 } } };
    assert.equal(computeHeldRatio(take), 0.8);
  });

  await t.test('priority 3 accepts canonical targetHitPct fractions', () => {
    const take = { summary: { metrics: { targetHitPct: 0.8 } } };
    assert.equal(computeHeldRatio(take), 0.8);
  });

  await t.test('measurement-unavailable takes have no held-ratio evidence', () => {
    const take = {
      phraseComparison: { checkpoints: [{ corridorHoldScore: 0.99 }] },
      summary: {
        metrics: {
          targetHitPct: 0.99,
          advanced: {
            measurementAvailable: false,
            measurementRejectionReasons: ['no_voiced_frames'],
          },
        },
      },
    };
    assert.equal(computeHeldRatio(take), null);
  });

  await t.test('null when nothing available', () => {
    assert.equal(computeHeldRatio({}), null);
    assert.equal(computeHeldRatio({ phraseComparison: { checkpoints: [] } }), null);
  });
});

test('real-sentence — readiness heuristic (advisory)', async (t) => {
  const goodTake = { phraseComparison: { checkpoints: [{ corridorHoldScore: 0.9 }, { corridorHoldScore: 0.8 }] } };
  const roughTake = { phraseComparison: { checkpoints: [{ corridorHoldScore: 0.3 }, { corridorHoldScore: 0.2 }] } };

  await t.test('ready when >=2 takes today AND held-ratio >= 0.7', () => {
    const r = evaluateReadiness({ takesToday: 2, take: goodTake });
    assert.equal(r.ready, true);
    assert.equal(r.heldRatio, 1);
  });

  await t.test('not ready with only 1 take today', () => {
    assert.equal(evaluateReadiness({ takesToday: 1, take: goodTake }).ready, false);
  });

  await t.test('not ready when held-ratio < 0.7', () => {
    assert.equal(evaluateReadiness({ takesToday: 3, take: roughTake }).ready, false);
  });

  await t.test('not ready when held-ratio unavailable', () => {
    assert.equal(evaluateReadiness({ takesToday: 5, take: {} }).ready, false);
  });
});

test('real-sentence — outcome templates (no negatives)', async (t) => {
  await t.test('said-well names the carried sentence', () => {
    const line = outcomeCoachLine('said-well', 'A flat white, please.');
    assert.match(line, /A flat white, please\./);
  });

  await t.test('said-rough is warm + nerve-acknowledging', () => {
    assert.match(outcomeCoachLine('said-rough'), /took nerve/i);
  });

  await t.test('not-said is gentle, no guilt', () => {
    const line = outcomeCoachLine('not-said');
    assert.match(line, /still yours/i);
    assert.ok(!/fail|missed|broke|streak/i.test(line));
  });

  await t.test('whatWorked entry only for said-well shape', () => {
    assert.equal(whatWorkedEntryForOutcome('A flat white, please.'), 'real sentence carried: A flat white, please.');
  });
});

test('real-sentence — greeting follow-up line', async (t) => {
  await t.test('asks about the pending sentence by text', () => {
    const line = pendingDebriefGreetingLine({ text: 'A flat white, please.', status: 'ready' });
    assert.match(line, /A flat white, please\./);
    assert.match(line, /moment/i);
  });

  await t.test('empty when no pending', () => {
    assert.equal(pendingDebriefGreetingLine(null), '');
    assert.equal(pendingDebriefGreetingLine({ text: '' }), '');
  });
});
