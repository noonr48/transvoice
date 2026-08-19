'use strict';

// v4 tutor-memory: the signal-builder memo additions — relevance-first whatWorked,
// daysSinceLastSession, focusHistory — and the gap-aware continuity greeting.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSignal,
  buildLearnerMemo,
  pickBaseline,
  buildContinuityGreeting,
  focusToAxis,
  selectWhatWorked,
  deriveFocusHistory,
  daysBetween,
  describeGap,
  resolveCoachPreferencePolicy,
} = require('./signal-builder');

const DAY = 86_400_000;

test('v4 signal-builder memo helpers', async (t) => {
  await t.test('focusToAxis maps rich focuses to the 4-axis vocab', () => {
    assert.equal(focusToAxis('pitch_floor'), 'pitch');
    assert.equal(focusToAxis('pitch_lower'), 'pitch');
    assert.equal(focusToAxis('pitch_stability'), 'pitch');
    assert.equal(focusToAxis('resonance_forward'), 'resonance');
    assert.equal(focusToAxis('vocal_weight'), 'weight');
    assert.equal(focusToAxis('phrase_ending'), 'prosody');
    assert.equal(focusToAxis('speech_rate'), 'prosody');
    // unmapped -> null (relevance ordering then falls back to newest-first)
    // 2026-07-26: axis renamed breath_flow -> tone_clarity; both stay unmapped.
    assert.equal(focusToAxis('tone_clarity'), null);
    assert.equal(focusToAxis('breath_flow'), null);
    assert.equal(focusToAxis('strain_reduction'), null);
    assert.equal(focusToAxis(''), null);
    assert.equal(focusToAxis(undefined), null);
  });

  await t.test('selectWhatWorked is RELEVANCE-FIRST: current-axis matches first, then newest', () => {
    const wins = [
      { text: 'newest, no axis', axis: null },
      { text: 'pitch win (older)', axis: 'pitch' },
      { text: 'resonance win', axis: 'resonance' },
      { text: 'another pitch win (oldest)', axis: 'pitch' },
    ];
    // current axis = resonance -> the resonance win leads, rest keep order.
    const r = selectWhatWorked(wins, 3, 'resonance');
    assert.equal(r[0], 'resonance win');
    // current axis = pitch -> both pitch wins lead in their existing order.
    const p = selectWhatWorked(wins, 3, 'pitch');
    assert.deepEqual(p.slice(0, 2), ['pitch win (older)', 'another pitch win (oldest)']);
    // no axis -> newest-first (input order) preserved.
    const n = selectWhatWorked(wins, 2, null);
    assert.deepEqual(n, ['newest, no axis', 'pitch win (older)']);
    // back-compat: plain strings are accepted (axis null).
    const s = selectWhatWorked(['a', 'b'], 2, 'pitch');
    assert.deepEqual(s, ['a', 'b']);
  });

  await t.test('daysBetween + deriveFocusHistory', () => {
    const now = 1_700_000_000_000;
    assert.equal(daysBetween(now - 10 * DAY, now), 10);
    assert.equal(daysBetween(now, now), 0);
    assert.equal(daysBetween('', now), null);
    assert.equal(daysBetween(0, now), null);

    // sessions are newest-LAST; focusHistory is newest-first, distinct, max 3.
    const sessions = [
      { focusAxis: 'pitch' },
      { focusAxis: 'pitch' },
      { focusAxis: 'resonance' },
      { focusAxis: 'weight' },
      { focusAxis: 'resonance' }, // newest
    ];
    assert.deepEqual(deriveFocusHistory(sessions, 3), ['resonance', 'weight', 'pitch']);
  });

  await t.test('buildLearnerMemo surfaces daysSinceLastSession + focusHistory + relevant wins', () => {
    const now = 1_700_000_000_000;
    const ctx = {
      masteryLevel: 'intermediate',
      profile: { displayName: 'Mara', topics: ['phone calls'] },
      whatWorked: [
        { text: 'forward resonance held', axis: 'resonance', date: '2026-05-01' },
        { text: 'lighter onset', axis: 'weight', date: '2026-05-20' },
      ],
      sessions: [{ focusAxis: 'weight' }, { focusAxis: 'resonance' }],
      lastSessionAt: now - 3 * DAY,
    };
    const memo = buildLearnerMemo(ctx, { currentAxis: 'resonance', now });
    assert.equal(memo.fields.daysSinceLastSession, 3);
    assert.deepEqual(memo.fields.focusHistory, ['resonance', 'weight']);
    // relevance-first: the resonance win leads even though it's older.
    assert.equal(memo.fields.whatWorked[0], 'forward resonance held');
    assert.match(memo.text, /Days since last session: 3 days/);
    assert.match(memo.text, /Recent focus: resonance, weight/);
  });

  await t.test('buildLearnerMemo with no session log: daysSinceLastSession null, no time line', () => {
    const memo = buildLearnerMemo({ profile: { displayName: 'Sam' } });
    assert.equal(memo.fields.daysSinceLastSession, null);
    assert.deepEqual(memo.fields.focusHistory, []);
    assert.ok(!/Days since last session/.test(memo.text));
  });

  await t.test('v5 recall-wiring: surfaces coachPreferences + recent moments (cap 2), top-level + nested, empty-safe', () => {
    const ctx = {
      profile: { displayName: 'Mara' },
      coachPreferences: [
        { text: 'imagery cues confuse me — prefer physical', date: '2026-05-01' },
        { text: 'do not over-praise', date: '2026-05-10' },
      ],
      moments: [
        { kind: 'gendered-right', text: "got ma'am'd on the phone", date: '2026-05-20' },
        { kind: 'hard-moment', text: 'misgendered at the counter', date: '2026-05-18' },
        { kind: 'milestone', text: 'first forward resonance', date: '2026-05-01' },
      ],
    };
    const memo = buildLearnerMemo(ctx);
    assert.deepEqual(memo.fields.coachPreferences, ['imagery cues confuse me — prefer physical', 'do not over-praise']);
    assert.match(memo.text, /Coaching preferences: imagery cues confuse me/);
    // v6 SAFETY: hard-moments are NEVER recited (excluded); joy-biased; capped at 2.
    assert.equal(memo.fields.recentMoments.length, 2);
    assert.deepEqual(memo.fields.recentMoments, ["got ma'am'd on the phone", 'first forward resonance']);
    assert.equal(memo.fields.recentHardMoment, true);
    assert.ok(!/misgendered at the counter/.test(memo.text), 'the hard moment is excluded from the memo');
    assert.match(memo.text, /Recent moments: got ma'am'd on the phone/);
    // read from the NESTED snapshot block too (frontend reads response.learnerContext)
    const nested = buildLearnerMemo({ learnerContext: { coachPreferences: [{ text: 'go slower' }], moments: [{ text: 'nailed it' }] } });
    assert.deepEqual(nested.fields.coachPreferences, ['go slower']);
    assert.deepEqual(nested.fields.recentMoments, ['nailed it']);
    // empty-safe: no memory => empty arrays, no lines
    const empty = buildLearnerMemo({ profile: { displayName: 'Sam' } });
    assert.deepEqual(empty.fields.coachPreferences, []);
    assert.deepEqual(empty.fields.recentMoments, []);
    assert.ok(!/Coaching preferences|Recent moments/.test(empty.text));
  });

  await t.test('v6: buildLearnerMemo surfaces hobbies + struggles into the coach memo', () => {
    const memo = buildLearnerMemo({
      profile: { displayName: 'Mara', topics: ['phone calls'], hobbies: ['singing in her band', 'hiking'] },
      struggles: ['pitch drops at phrase ends', 'runs out of breath'],
    });
    assert.deepEqual(memo.fields.hobbies, ['singing in her band', 'hiking']);
    assert.ok(memo.lines.some((l) => l === 'Hobbies: singing in her band, hiking'));
    assert.equal(memo.fields.struggles.length, 2); // cap 2
    assert.ok(memo.lines.some((l) => l.startsWith('Struggles: pitch drops at phrase ends')));
    // accepts a {text} struggle shape + the nested snapshot block
    const nested = buildLearnerMemo({ learnerContext: { struggles: [{ text: 'tense jaw' }] }, profile: { hobbies: ['art'] } });
    assert.deepEqual(nested.fields.struggles, ['tense jaw']);
    assert.deepEqual(nested.fields.hobbies, ['art']);
    // empty-safe: no hobbies/struggles => empty arrays, no lines
    const empty = buildLearnerMemo({ profile: { displayName: 'Sam' } });
    assert.deepEqual(empty.fields.hobbies, []);
    assert.deepEqual(empty.fields.struggles, []);
    assert.ok(!/Hobbies:|Struggles:/.test(empty.text));
  });

  await t.test('v6 SAFETY: hard-moments are NEVER recited; joy surfaces; Sensitivity flag set', () => {
    const memo = buildLearnerMemo({
      profile: { displayName: 'Mara', pronouns: 'she/her', direction: 'mtf', goal: 'sound like myself on the phone' },
      moments: [
        { kind: 'hard-moment', text: 'misgendered by my mom and it crushed me', date: '2026-06-14' },
        { kind: 'gendered-right', text: "got ma'am'd on the phone — felt amazing", date: '2026-06-13' },
        { kind: 'milestone', text: 'first forward resonance', date: '2026-06-10' },
      ],
    });
    // the hard moment NEVER appears anywhere in the memo handed to the coach
    assert.ok(!/misgendered by my mom/.test(memo.text), 'hard moment must not be recited');
    assert.ok(!memo.fields.recentMoments.some((m) => /misgendered/.test(m)));
    // joy-biased: the gendered-right moment leads the recital
    assert.equal(memo.fields.recentMoments[0], "got ma'am'd on the phone — felt amazing");
    // the PRIVATE soften-tone signal is set + a discreet Sensitivity line that carries NO trauma content
    assert.equal(memo.fields.recentHardMoment, true);
    assert.ok(memo.lines.some((l) => l.startsWith('Sensitivity:')));
    assert.ok(!/misgendered/.test(memo.text), 'no trauma content anywhere in the memo');
    // identity anchors surface (pronouns = HARD constraint)
    assert.equal(memo.fields.pronouns, 'she/her');
    assert.ok(memo.lines.includes('Pronouns: she/her'));
    assert.ok(memo.lines.includes('Goal: sound like myself on the phone'));
    // no hard moment => no Sensitivity line, joy still recited
    const calm = buildLearnerMemo({ profile: { displayName: 'Sam' }, moments: [{ kind: 'milestone', text: 'nailed it' }] });
    assert.equal(calm.fields.recentHardMoment, false);
    assert.ok(!/Sensitivity:/.test(calm.text));
    assert.equal(calm.fields.recentMoments[0], 'nailed it');
  });

  await t.test('v6: avoid line surfaces, concept-id slugs humanized', () => {
    const memo = buildLearnerMemo({ profile: { displayName: 'A' }, avoid: ['pushing chest_voice', 'breathy_shortcut'] });
    assert.deepEqual(memo.fields.avoid, ['pushing chest voice', 'breathy shortcut']);
    assert.ok(memo.lines.some((l) => l === 'Avoid: pushing chest voice; breathy shortcut'));
    // empty-safe
    assert.deepEqual(buildLearnerMemo({ profile: { displayName: 'B' } }).fields.avoid, []);
  });

  await t.test('v6: pickBaseline reads baseline from outer-or-nested snapshot, else null', () => {
    assert.deepEqual(pickBaseline({ baseline: { pitchMedianDeltaSt: 2 } }), { pitchMedianDeltaSt: 2 });
    assert.deepEqual(pickBaseline({ learnerContext: { baseline: { weightDeltaPct: -5 } } }), { weightDeltaPct: -5 });
    assert.equal(pickBaseline({ profile: { displayName: 'Sam' } }), null);
    assert.equal(pickBaseline(null), null);
  });

  await t.test('v6: canonical preference IDs produce deterministic coach policy effects', () => {
    const learnerContext = {
      coachPreferences: [
        { id: 'slower-pace', text: 'Prefers a slower coaching pace' },
        { id: 'brevity', text: 'Prefers brief coaching' },
        { id: 'fewer-corrections', text: 'Prefers fewer corrections at once' },
        { id: 'concrete-over-imagery', text: 'Prefers concrete physical cues' },
        { id: 'direct-feedback', text: 'Prefers direct feedback' },
      ],
    };
    const policy = resolveCoachPreferencePolicy(learnerContext);
    assert.equal(policy.speechRate, 0.65);
    assert.equal(policy.maxSpokenWords, 24);
    assert.equal(policy.maxCueCount, 1);
    assert.equal(policy.correctionDensity, 'minimal');
    assert.equal(policy.cueStyle, 'concrete-physical');
    assert.equal(policy.preferredTone, 'direct, concise, respectful');
    assert.ok(policy.doNotSay.includes('metaphor'));

    const signal = buildSignal({ voiceState: {}, learnerContext });
    assert.equal(signal.policy.maxCueCount, 1);
    assert.equal(signal.personalization.preferencePolicy.speechRate, 0.65);
    assert.equal(signal.personalization.preferredTone, 'direct, concise, respectful');
    assert.ok(signal.doNotSay.includes('imagery'));
  });

  await t.test('v6: the first due review becomes an explicit application directive', () => {
    const signal = buildSignal({
      voiceState: {},
      learnerContext: {
        reviewQueue: [
          { conceptId: 'breath_support', name: 'breath support' },
          { conceptId: 'intonation_variety', name: 'intonation variety' },
        ],
      },
    });
    assert.equal(signal.personalization.dueReviewFocus, 'breath support');
    assert.deepEqual(
      signal.personalization.learnerMemoFields.reviewNext,
      ['breath support', 'intonation variety'],
    );
  });
});

test('voice-only entry keeps time memory silent', async (t) => {
  const now = 1_700_000_000_000;

  await t.test('gap >= 7 days remains structured memory, not spoken padding', () => {
    const g = buildContinuityGreeting({
      profile: { displayName: 'Mara' },
      lastSessionAt: now - 21 * DAY, // ~3 weeks
      whatWorked: [{ text: 'forward resonance held', axis: 'resonance', date: '' }],
    }, { now });
    assert.equal(g.line1, '');
    assert.equal(g.line2, '');
    assert.equal(g.autoSpeak, false);
    assert.equal(g.entryPolicy, 'resume-core-practice');
  });

  await t.test('gap of exactly 7 days also produces no entry speech', () => {
    const g = buildContinuityGreeting({ lastSessionAt: now - 7 * DAY }, { now });
    assert.deepEqual(g.lines, []);
    assert.equal(g.text, '');
  });

  await t.test('gap 1-6 days produces no continuity message', () => {
    const g = buildContinuityGreeting({
      profile: { displayName: 'Mara' },
      lastSessionAt: now - 3 * DAY,
      whatWorked: [{ text: 'Forward resonance held', axis: 'resonance', date: '' }],
    }, { now });
    assert.equal(g.line2, '');
    assert.equal(g.scopeAsk, null);
  });

  await t.test('no prior session starts core practice without greeting or warm-up', () => {
    const g = buildContinuityGreeting({ profile: {} }, { now });
    assert.equal(g.text, '');
    assert.equal(g.autoSpeak, false);
  });

  await t.test('describeGap phrasing', () => {
    assert.equal(describeGap(1), '1 day');
    assert.equal(describeGap(3), '3 days');
    assert.equal(describeGap(7), 'a week');
    assert.equal(describeGap(14), '2 weeks');
    assert.equal(describeGap(20), '3 weeks'); // rounds
  });
});
