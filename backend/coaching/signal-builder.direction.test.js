'use strict';

/**
 * 2026-07-26 breath-nag repair — the coaching-signal half.
 *
 * Covers the four defects that made the live coach repeat "keep the breath
 * steady" on nearly every turn:
 *   1. No Direction line was ever rendered, so the renderer's system prompt sat
 *      permanently in its "unsure of the learner's direction" branch and fell
 *      back to the (breath-flavoured) neutral cue set.
 *   2. `Number(risk) || null` collapsed a legitimate 0 risk to "missing".
 *   3. An unmapped focus silently became the phrase_ending drill — the exact
 *      cue the fine-tune already over-produces.
 *   4. The focus axis was named 'breath_flow' although the metric measures
 *      glottal closure, not breathing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCoachingDirection,
  deriveDirectionHintFromTarget,
  buildLearnerMemo,
  recommendDrillForFocus,
  buildSuccessCriteria,
  buildSignal,
  primaryIssueToFocus,
  detectIssues,
} = require('./signal-builder');
const { buildRendererUserMessage, buildRendererSystemPrompt } = require('./renderer-client');
const { FOCUS_AXES, COACHING_SIGNAL_SCHEMA } = require('./signal-schema');

// ---------------------------------------------------------------------------
// Direction resolution
// ---------------------------------------------------------------------------

// RE-POINTED 2026-07-30. This test was NOT in the failing set and was passing —
// but it had stopped WITNESSING what it claims. It used 'androgynous' and
// 'gender-neutral' as the targets, and those are now removed ids that supply NO
// hint at all (measured: `resolveCoachingDirection({profile:{}}, 'androgynous')`
// -> {direction:null, source:null}). With nothing on the other side of the
// contest, `source === 'profile'` was the only possible answer and would hold
// even if the precedence were reversed. Re-pointed to a LIVE preset, which does
// supply a competing hint, so the profile has something real to beat.
test('explicit learner direction ALWAYS wins over the target-derived hint', () => {
  // A live target that WOULD have answered on its own. Asserted first, so the
  // contest is proven to exist before the override is claimed — this line is what
  // stops the test from silently becoming unfalsifiable again.
  const LIVE = 'soft-feminine';
  assert.equal(resolveCoachingDirection({ profile: {} }, LIVE).source, 'target');

  // ...and the profile overrides it.
  const resolved = resolveCoachingDirection({ profile: { direction: 'mtf' } }, LIVE);
  assert.equal(resolved.direction, 'feminizing');
  assert.equal(resolved.source, 'profile');

  // Same through the nested learnerContext shape.
  const nested = resolveCoachingDirection(
    { learnerContext: { profile: { direction: 'mtf' } } },
    'cute-feminine',
  );
  assert.equal(nested.direction, 'feminizing');
  assert.equal(nested.source, 'profile');

  // A REMOVED preset keeps the old coverage as its own case: it supplies no hint,
  // so the profile is the only source — worth pinning, but it is not a precedence
  // test, which is exactly why it could not stand in for one above.
  for (const removed of ['androgynous', 'gender-neutral']) {
    const overRemoved = resolveCoachingDirection({ profile: { direction: 'mtf' } }, removed);
    assert.equal(overRemoved.direction, 'feminizing', removed);
    assert.equal(overRemoved.source, 'profile', removed);
  }
});

test('a retired ftm direction claims NOTHING — it is never coerced to feminizing', () => {
  // 2026-07-26 MTF-ONLY. The wrong-direction guard this file exists for now cuts
  // the other way: a stored masculinizing profile must not inherit the only
  // surviving direction. It yields null, and the renderer omits the line.
  const retired = resolveCoachingDirection({ profile: { direction: 'ftm' } }, 'androgynous');
  assert.equal(retired.direction, null);
  assert.equal(retired.source, null);

  const retiredPreset = resolveCoachingDirection({ profile: {} }, 'masculine');
  assert.equal(retiredPreset.direction, null);
  assert.equal(retiredPreset.source, null);
});

test('with no stated direction the selected voice target supplies the hint', () => {
  for (const preset of [
    'cute-feminine',
    'everyday-feminine',
    'bright-playful',
    'australian-bright-feminine',
    'soft-feminine',
  ]) {
    const resolved = resolveCoachingDirection({ profile: {} }, preset);
    assert.equal(resolved.direction, 'feminizing', preset);
    assert.equal(resolved.source, 'target', preset);
  }
  // 2026-07-30: these two were REMOVED from every registry, so they are no longer
  // "neutral styles" — they are unrecognised ids. The assertion is unchanged and
  // is now the more valuable of the two readings: a removed preset must supply no
  // direction hint, exactly like any other string the app does not know. Kept
  // separate from the unknown-preset loop below so the removed ids are named
  // explicitly and cannot quietly stop being covered.
  for (const preset of ['androgynous', 'gender-neutral']) {
    const neutral = resolveCoachingDirection({ profile: {} }, preset);
    assert.equal(neutral.direction, null, preset);
    assert.equal(neutral.source, null, preset);
  }
});

test('ambiguous or unknown styles produce NO hint — a direction is never invented', () => {
  // 2026-07-30: these were neutral styles until they were removed from every
  // registry. Either way the required behaviour is the same and is worth pinning
  // by name — no direction is invented for them, because inventing one could
  // produce a wrong-direction technique cue.
  for (const preset of ['androgynous', 'gender-neutral']) {
    assert.equal(deriveDirectionHintFromTarget(preset), null, preset);
    const resolved = resolveCoachingDirection({ profile: {} }, preset);
    assert.equal(resolved.direction, null, preset);
    assert.equal(resolved.source, null, preset);
  }
  // Unrecognized / absent presets likewise.
  for (const preset of ['x', 'totally-unknown-preset', '', null, undefined]) {
    assert.equal(deriveDirectionHintFromTarget(preset), null, String(preset));
    assert.equal(resolveCoachingDirection({ profile: {} }, preset).source, null, String(preset));
  }
  // 'unspecified' is treated as unset, not as a direction.
  const unspecified = resolveCoachingDirection(
    { profile: { direction: 'unspecified' } },
    'androgynous',
  );
  assert.equal(unspecified.direction, null);
  assert.equal(unspecified.source, null);
});

// ---------------------------------------------------------------------------
// Direction line: memo
// ---------------------------------------------------------------------------

test('the learner memo RENDERS a Direction line (it was only ever a hidden field)', () => {
  const stated = buildLearnerMemo(
    { profile: { displayName: 'Sam', direction: 'mtf' } },
    { targetPreset: 'cute-feminine' },
  );
  assert.ok(stated.lines.includes('Direction: feminizing'), stated.lines.join(' | '));
  assert.equal(stated.fields.practiceDirection, 'feminizing');
  assert.equal(stated.fields.practiceDirectionSource, 'profile');

  const derived = buildLearnerMemo(
    { profile: { displayName: 'Sam' } },
    { targetPreset: 'soft-feminine' },
  );
  // Worded as the learner's practice direction plus where it came from.
  assert.ok(
    derived.lines.includes('Direction: feminizing (from selected voice target)'),
    derived.lines.join(' | '),
  );
  assert.equal(derived.fields.practiceDirectionSource, 'target');

  // A RETIRED masculinizing target supplies no hint at all — the Direction line
  // is omitted rather than invented (2026-07-26 MTF-only).
  const retired = buildLearnerMemo(
    { profile: { displayName: 'Sam' } },
    { targetPreset: 'masculine' },
  );
  assert.equal(retired.lines.some((l) => l.startsWith('Direction:')), false, retired.lines.join(' | '));
  assert.equal(retired.fields.practiceDirection, null);

  const unknown = buildLearnerMemo(
    { profile: { displayName: 'Sam' } },
    { targetPreset: 'androgynous' },
  );
  assert.equal(unknown.lines.some((l) => l.startsWith('Direction:')), false);
  assert.equal(unknown.fields.practiceDirection, null);
});

// ---------------------------------------------------------------------------
// Direction line: renderer user message + system prompt
// ---------------------------------------------------------------------------

function v2Signal(overrides = {}) {
  return {
    schema: COACHING_SIGNAL_SCHEMA,
    mode: 'active_drill',
    styleTarget: 'cute-feminine',
    policy: { shouldCorrect: true, coachingAction: 'coach' },
    personalization: {},
    ...overrides,
  };
}

test('the renderer prints a Direction line when the direction is known', () => {
  const stated = buildRendererUserMessage(v2Signal({
    direction: 'feminizing',
    directionSource: 'profile',
  }));
  assert.ok(stated.includes('\nDirection: feminizing'), stated);
  assert.equal(stated.includes('(from selected voice target)'), false);

  const derived = buildRendererUserMessage(v2Signal({
    styleTarget: 'masculine',
    direction: 'masculinizing',
    directionSource: 'target',
  }));
  assert.ok(derived.includes('Direction: masculinizing (from selected voice target)'), derived);
});

test('an unknown direction prints NO Direction line rather than guessing', () => {
  // The legacy `direction` default (feminizing for any unmapped preset) must not
  // leak into the visible hint — directionSource is the strict gate.
  const unsourced = buildRendererUserMessage(v2Signal({
    styleTarget: 'x',
    direction: 'feminizing',
    directionSource: null,
  }));
  assert.equal(unsourced.includes('Direction:'), false, unsourced);

  const none = buildRendererUserMessage(v2Signal({ direction: null, directionSource: null }));
  assert.equal(none.includes('Direction:'), false, none);
});

test('buildSignal populates directionSource end-to-end for the renderer', () => {
  const known = buildSignal({
    voiceState: null,
    learnerContext: { profile: {} },
    targetPreset: 'cute-feminine',
  });
  assert.equal(known.directionSource, 'target');
  assert.equal(known.direction, 'feminizing');
  assert.ok(buildRendererUserMessage(known).includes('Direction: feminizing (from selected voice target)'));

  const stated = buildSignal({
    voiceState: null,
    learnerContext: { profile: { direction: 'mtf' } },
    targetPreset: 'androgynous',
  });
  assert.equal(stated.directionSource, 'profile');
  assert.equal(stated.direction, 'feminizing');

  const ambiguous = buildSignal({
    voiceState: null,
    learnerContext: { profile: {} },
    targetPreset: 'androgynous',
  });
  assert.equal(ambiguous.directionSource, null);
  assert.equal(buildRendererUserMessage(ambiguous).includes('Direction:'), false);
});

test('the system prompt no longer claims a direction it was never given, and drops breath from the no-direction set', () => {
  const prompt = buildRendererSystemPrompt(false);
  // The false claim is gone.
  assert.equal(prompt.includes('the learner states their goal direction in the turn'), false);
  // RE-POINTED 2026-07-30. This was `prompt.includes('when a "Direction:" line is
  // present')`, a clause on the DIRECTION CONSTRAINT line. That line was rewritten
  // by the MTF-only removal (backend/coaching/renderer-client.js): with
  // `androgynous` and `gender-neutral` gone, no learner has a non-gendered target,
  // so the constraint states the single goal direction outright instead of gating
  // it on the line's presence. The PROPERTY being pinned is unchanged and still
  // load-bearing — the prompt must tell the model what to do when the turn carries
  // NO Direction line, rather than assuming the learner supplied one — so the
  // assertion is re-pointed to the sentence that now carries it. Kept as an
  // exact-substring check, not loosened to /Direction:/, which the user message
  // format would satisfy on its own.
  assert.ok(prompt.includes('When a turn carries no "Direction:" line'), prompt.slice(-800));
  // The single line that made the coach say "breath" on every unsure turn.
  // 2026-07-26: this cue set is ARTICULATOR-based, not state-based.
  assert.ok(prompt.includes('(loose jaw, easy lips, gentle start)'));
  assert.equal(/direction-neutral cue \(breath/.test(prompt), false);
  // The prompt must not coach breathing itself in that branch either.
  assert.ok(prompt.includes('Never coach breathing itself.'));
  // Positive specificity rubric is present with worked examples.
  assert.ok(prompt.includes('PHYSICAL ACTION'));
  assert.ok(prompt.includes('WHAT SUCCESS SOUNDS LIKE'));
  assert.ok(prompt.includes('no air before the sound'));
});

// ---------------------------------------------------------------------------
// 2026-07-26: articulatory register + the no-name law
// ---------------------------------------------------------------------------

// 2026-07-26: WIDENED from ARTICULATOR to BODY PART on the owner's refinement —
// "it's probably not mouth clues, either but think about body posture, or just
// physical way for us to get closer to our goal." The demand is unchanged in
// strength (a cue must still name a physical action of a named part, and imagery
// is still forbidden); only the inventory grew from the mouth to the whole body.
// The articulator half is asserted here still; the body half is pinned in
// voice-coach-product-law-prompt.test.js.
test('the system prompt demands NAMED-BODY-PART actions and rejects imagery-only cues', () => {
  const prompt = buildRendererSystemPrompt(false);
  // The rubric names the part, not just "an action".
  assert.ok(prompt.includes('BODY PART'), 'rubric demands a named BODY PART');
  assert.match(prompt, /Never name a state without a physical action/);
  assert.match(prompt, /Articulators: the tongue/);
  for (const articulator of ['tongue', 'lips', 'jaw', 'soft palate']) {
    assert.ok(prompt.includes(articulator), `prompt names the ${articulator}`);
  }
  // ...and the widened inventory is present alongside them, not instead of them.
  for (const bodyPart of ['shoulders', 'neck', 'chin', 'chest']) {
    assert.ok(prompt.includes(bodyPart), `prompt names the ${bodyPart}`);
  }
  // Worked examples speak the training corpus's own register, at both levels.
  assert.match(prompt, /Lift the back of your tongue toward the roof of your mouth/);
  assert.match(prompt, /Spread your lips slightly/);
  assert.match(prompt, /Let your shoulders drop away from your ears/);
  // Imagery-only cues are explicitly named and forbidden.
  assert.match(prompt, /Bad: imagery with no body in it/);
  assert.ok(prompt.includes('"let the words out"'), 'the exact imagery failure mode is named');
  // The examples must not be mistaken for a direction instruction.
  assert.match(prompt, /These examples show the REGISTER, not the direction/);
});

test('the coach is forbidden from ever addressing the learner by name', () => {
  const prompt = buildRendererSystemPrompt(false);
  assert.match(prompt, /NEVER address the learner by name/);
  assert.match(prompt, /speak to them directly as "you"/);
  // The old permission to personalize BY NAME is gone from both surfaces.
  assert.doesNotMatch(prompt, /profile details such as name/i);
  const rendered = buildRendererUserMessage(v2Signal({
    personalization: { learnerMemo: 'LearnerMemo\nPronouns: she/her' },
  }));
  assert.doesNotMatch(rendered, /data-only personalization \(name/i);
  assert.match(rendered, /Never address the learner by name/);
});

test('the learner memo the model sees carries no Name line, while the fields keep it', () => {
  const memo = buildLearnerMemo({
    profile: { displayName: 'Mara', pronouns: 'she/her', topics: ['phone calls'] },
  });
  // Model-visible surface: the memo TEXT (renderer renders personalization.learnerMemo).
  assert.doesNotMatch(memo.text, /^Name:/m);
  assert.doesNotMatch(memo.text, /Mara/);
  assert.equal(memo.lines.some((line) => line.startsWith('Name:')), false);
  // Persistence/UI surface: fields keep the display name.
  assert.equal(memo.fields.displayName, 'Mara');
  // The rest of the memo is untouched.
  assert.match(memo.text, /Pronouns: she\/her/);
  assert.match(memo.text, /Topics: phone calls/);
});

test('the deterministic coaching strings speak in articulators, not imagery', () => {
  // One drill rewrite asserted verbatim.
  assert.equal(
    recommendDrillForFocus('resonance_forward', '', null, {}).instruction,
    'Hum the line on "m" or "n" first and feel the buzz on your lips and behind your top teeth, then open into the words and keep the buzz there.',
  );
  // Every built-in drill instruction names a BODY ACTION: an oral articulator,
  // or — for the closure axis, which is laryngeal — the gentle "uh" catch.
  const ARTICULATOR = /\b(?:tongue|lips?|jaw|mouth|teeth|palate)\b/i;
  const CLOSURE_CATCH = /gentle "uh"/i;
  for (const focus of [
    'pitch_floor', 'pitch_lower', 'pitch_stability', 'resonance_forward',
    'vocal_weight', 'tone_clarity', 'strain_reduction', 'speech_rate', 'phrase_ending',
  ]) {
    const { instruction } = recommendDrillForFocus(focus, '', null, {});
    assert.ok(
      ARTICULATOR.test(instruction) || CLOSURE_CATCH.test(instruction),
      `${focus} drill names a body action, got: ${instruction}`,
    );
    assert.doesNotMatch(instruction, /^(?:Think of|Imagine|Picture)\b/i, `${focus} drill is not imagery-first`);
  }
  // Hard laws survive: closure is a gentle catch, never a press or a force.
  const closure = recommendDrillForFocus('tone_clarity', '', null, {}).instruction;
  assert.match(closure, /tiny, gentle "uh"/);
  assert.doesNotMatch(closure, /\b(?:press|pressed|force|forcing|squeeze|push)\b/i);
});

test('every standing product law survives the prompt edits', () => {
  const prompt = buildRendererSystemPrompt(false);
  // Learner-owned session lifetime; never suggest a break.
  assert.ok(prompt.includes('The learner alone controls session Start/Stop.'));
  assert.ok(prompt.includes('Never recommend stopping, ending for today, resting, taking a break, or coming back later.'));
  // No metric values in speech unless plainEvidence carries them.
  assert.ok(prompt.includes('Do not mention raw metrics unless the signal explicitly includes them in plainEvidence.'));
  // Not a messaging product.
  assert.ok(prompt.includes('Never ask the learner to type, text, send a message, read a thread, or use a chat control.'));
  // No counting / plan-progress pressure.
  assert.ok(prompt.includes('Never pressure the learner with counting language'));
  // Safety floor.
  assert.ok(prompt.includes('Never suggest pain, squeezing, forcing larynx height, whispering, or pushing through fatigue.'));
});

// ---------------------------------------------------------------------------
// Zero-preserving risk parse
// ---------------------------------------------------------------------------

function riskState(quality) {
  return {
    targetPreset: 'cute-feminine',
    lastSummary: { metrics: { advanced: { quality } } },
  };
}

test('a legitimate ZERO risk survives parsing (it used to collapse to null)', () => {
  const detected = detectIssues(riskState({ breathyRisk: 0, strainRisk: 0 }), 'active_drill');
  // 0 is a real, GOOD measurement: it must not fire an issue...
  assert.equal(detected.primaryIssue, null);
  assert.equal(detected.plainEvidence, '');
  // ...and it must not be indistinguishable from a missing measurement either:
  // the signal carries the 0 through instead of a null.
  const signal = buildSignal({
    voiceState: riskState({ breathyRisk: 0, strainRisk: 0 }),
    targetPreset: 'cute-feminine',
  });
  assert.equal(signal.audioMetrics.breathyRisk, 0);
  assert.equal(signal.audioMetrics.strainRisk, 0);
});

test('genuinely missing risks stay null and fire nothing (DSP may now return null more often)', () => {
  for (const quality of [{}, { breathyRisk: null, strainRisk: null }, { breathyRisk: '', strainRisk: 'nope' }]) {
    const detected = detectIssues(riskState(quality), 'active_drill');
    assert.equal(detected.primaryIssue, null, JSON.stringify(quality));
  }
});

test('a risk above the floored warn bar still fires, with closure wording not breath wording', () => {
  const detected = detectIssues(riskState({ breathyRisk: 0.8 }), 'active_drill');
  assert.equal(detected.primaryIssue, 'breathy_quality', 'high breathy risk must still be detected');
  assert.match(detected.plainEvidence, /closure/i);
  assert.doesNotMatch(detected.plainEvidence, /breath/i);
});

// ---------------------------------------------------------------------------
// Focus rename: breath_flow -> tone_clarity
// ---------------------------------------------------------------------------

test("the focus axis is 'tone_clarity'; 'breath_flow' is gone from the schema", () => {
  assert.ok(FOCUS_AXES.includes('tone_clarity'));
  assert.equal(FOCUS_AXES.includes('breath_flow'), false);
  // The ISSUE key is deliberately unchanged (wide ripple: safety-gates,
  // guardian, view-model) — only the focus axis was renamed.
  assert.equal(primaryIssueToFocus('breathy_quality'), 'tone_clarity');
});

test('every tone_clarity string is closure/clarity language with an action in it', () => {
  const drill = recommendDrillForFocus('tone_clarity', '', null, {});
  assert.equal(drill.id, 'starter-clean-onset');
  // 2026-07-26: closure is now stated as the gentle fold-contact action itself
  // ("a tiny, gentle 'uh'") rather than the abstract "clean, focused tone".
  assert.match(drill.instruction, /tiny, gentle "uh"/i);
  assert.match(drill.instruction, /clean contact/i);
  assert.doesNotMatch(drill.instruction, /breath/i);
  const wins = buildSuccessCriteria('tone_clarity', {});
  assert.ok(wins.length > 0);
  for (const win of wins) assert.doesNotMatch(win, /breath/i);
  assert.ok(wins.some((w) => /clear|airy/i.test(w)));
  // The retired name yields nothing at all now (no silent aliasing).
  assert.equal(recommendDrillForFocus('breath_flow', '', null, {}).instruction, '');
  assert.deepEqual(buildSuccessCriteria('breath_flow', {}), []);
});

// ---------------------------------------------------------------------------
// Unmapped focus: no drill material + a visible witness
// ---------------------------------------------------------------------------

function captureWitness(fn) {
  const original = console.log;
  const events = [];
  console.log = (...args) => { events.push(args[0]); };
  try {
    return { result: fn(), events };
  } finally {
    console.log = original;
  }
}

test('an unmapped focus produces NO drill and NO win — never the phrase_ending fallback', () => {
  const { result: drill, events } = captureWitness(
    () => recommendDrillForFocus('some_unmapped_axis', 'hello there friend', null, {}),
  );
  // The old code returned the phrase_ending drill here, which is the exact cue
  // the fine-tuned renderer already over-produces.
  assert.equal(drill.instruction, '');
  assert.equal(drill.successCriteria, '');
  assert.equal(drill.id, null);
  assert.doesNotMatch(JSON.stringify(drill), /last few words|energy through/i);
  // Starvation is visible, not silent.
  const witness = events.find((e) => e && e.event === 'coach_focus_unmapped');
  assert.ok(witness, 'a coach_focus_unmapped witness must be emitted');
  assert.equal(witness.focus, 'some_unmapped_axis');
  assert.equal(witness.surface, 'recommendDrillForFocus');

  const { result: wins, events: winEvents } = captureWitness(
    () => buildSuccessCriteria('some_unmapped_axis', {}),
  );
  assert.deepEqual(wins, []);
  assert.ok(winEvents.some((e) => e && e.event === 'coach_focus_unmapped' && e.surface === 'buildSuccessCriteria'));
});

test("focus 'none' stays a clean no-op and emits no starvation witness", () => {
  const { result: drill, events } = captureWitness(() => recommendDrillForFocus('none', '', null, {}));
  assert.equal(drill.instruction, '');
  assert.deepEqual(events.filter((e) => e && e.event === 'coach_focus_unmapped'), []);
  const { result: wins, events: winEvents } = captureWitness(() => buildSuccessCriteria('none', {}));
  assert.deepEqual(wins, []);
  assert.deepEqual(winEvents.filter((e) => e && e.event === 'coach_focus_unmapped'), []);
});

test('the renderer degrades gracefully when an unmapped focus starved the drill', () => {
  // decisionIsActionable already gates on intent; the Drill/Win lines are
  // printed only when non-empty, so the turn keeps Focus + Reason and simply
  // omits the (absent) drill instead of asserting a wrong one.
  const message = buildRendererUserMessage(v2Signal({
    coachingDecision: {
      intent: 'single_actionable_cue',
      primaryFocus: 'some_unmapped_axis',
      reason: 'Something shifted.',
      recommendedDrill: recommendDrillForFocus('some_unmapped_axis', '', null, {}),
      successCriteria: buildSuccessCriteria('some_unmapped_axis', {}),
    },
    takeQuality: { usable: true },
  }));
  assert.ok(message.includes('Focus: some_unmapped_axis'), message);
  assert.ok(message.includes('Reason: Something shifted.'), message);
  assert.equal(message.includes('Drill:'), false, message);
  assert.equal(message.includes('Win:'), false, message);
});

// ---------------------------------------------------------------------------
// Review follow-ups (2026-07-26).
// ---------------------------------------------------------------------------

test('tunnelHoldPct of exactly 0 — the WORST phrase ending — must fire an issue', () => {
  // Found in independent review: `Number(x) || null` collapsed a 0% tunnel hold
  // to "no measurement", so the worst possible ending silently produced NO
  // issue while 1% did. Same defect class as the risk parse above.
  const state = (tunnelHoldPct) => ({
    targetPreset: 'cute-feminine',
    phraseComparison: { tunnelHoldPct },
    lastSummary: { metrics: { advanced: {} } },
  });
  assert.equal(detectIssues(state(0), 'active_drill').primaryIssue, 'phrase_ending_instability');
  assert.equal(detectIssues(state(1), 'active_drill').primaryIssue, 'phrase_ending_instability');
  assert.equal(detectIssues(state(64), 'active_drill').primaryIssue, 'phrase_ending_instability');
  // 65 and above is a healthy hold — still no issue.
  assert.equal(detectIssues(state(65), 'active_drill').primaryIssue, null);
  // Genuinely absent stays absent.
  for (const missing of [null, undefined, '', 'nope']) {
    assert.equal(detectIssues(state(missing), 'active_drill').primaryIssue, null, String(missing));
  }
  // A 0% hold is the most confident possible reading, not the least.
  assert.ok(detectIssues(state(0), 'active_drill').confidence > detectIssues(state(60), 'active_drill').confidence);
});

test('no `Number(x) || null` zero-collapse remains in the detectIssues metric block', () => {
  // Guards the whole class rather than the four known sites: a 0 for any of
  // these inputs must be treated as a real (bad) measurement.
  const base = { targetPreset: 'cute-feminine', lastSummary: { metrics: { advanced: { quality: {} } } } };
  const withQuality = (quality) => ({ ...base, lastSummary: { metrics: { advanced: { quality } } } });
  // breathy/strain 0 = clean take -> no issue (0 preserved, just below the bar).
  assert.equal(detectIssues(withQuality({ breathyRisk: 0, strainRisk: 0 }), 'active_drill').primaryIssue, null);
  // ...and a high value still fires, proving the parse did not simply null everything.
  assert.equal(detectIssues(withQuality({ breathyRisk: 0.8 }), 'active_drill').primaryIssue, 'breathy_quality');
});

// ---------------------------------------------------------------------------
// 2026-07-26 DIRECTION-SURVIVAL LAW (the coverage gap that let three defects
// ship green). Every code-owned deterministic cue is eventually handed to a
// learner whose direction the cue-selection code may not know:
//   - cueForDueReview is keyed off a PERSISTED review-queue label;
//   - buildCoachMove's signature carries no direction at all;
//   - several drill defaults have no direction variant.
// Downstream, sanitizeCoachReply runs the cross-direction stripper, which
// deletes any sentence that reads as a wrong-direction technique cue. So a
// deterministic cue that is NOT direction-neutral gets deleted, and the turn
// reaches the learner with no action in it — the exact failure the core-loop
// repair exists to prevent. This test pins that: every code-owned cue must
// survive BOTH directions intact.
// ---------------------------------------------------------------------------

const {
  sanitizeCoachReply,
  resolveCoreLoopRepairReply: repairReply,
  SAFE_FALLBACK: SAFE,
  LOW_EFFORT_CUE: LOW,
} = require('./sanitizer');

function codeOwnedCues() {
  const out = [];
  for (const focus of [
    'pitch_floor', 'pitch_lower', 'pitch_stability', 'resonance_forward',
    'vocal_weight', 'tone_clarity', 'strain_reduction', 'speech_rate', 'phrase_ending',
  ]) {
    out.push(['drill:' + focus, recommendDrillForFocus(focus, '', null, {}).instruction]);
  }
  out.push(['drill:resonance_forward/too_bright',
    recommendDrillForFocus('resonance_forward', '', null, { resonance: { status: 'too_bright' } }).instruction]);
  out.push(['drill:vocal_weight/too_light',
    recommendDrillForFocus('vocal_weight', '', null, { weight: { status: 'too_light' } }).instruction]);
  for (const label of [
    'intonation', 'pitch floor', 'resonance', 'tone_clarity',
    'vocal weight', 'pronunciation', 'an unrecognized persisted label',
  ]) {
    out.push(['dueReview:' + label, repairReply('padding only', {
      policy: { coachingAction: 'coach', shouldCorrect: true },
      personalization: { dueReviewFocus: label },
    }).reply]);
  }
  // buildCoachMove's every cue, across every intent and primary issue. These
  // were omitted from the first version of this guard, and they are the single
  // biggest exposure: buildCoachMove's signature carries no direction at all.
  // (At 90ab6f5 four of them were stripped for one direction or the other.)
  const { buildCoachMove } = require('./signal-builder');
  const INTENTS = [
    'stop_and_reset', 'repair_capture', 'continue_conversation',
    'single_actionable_cue', 'acknowledge_win', 'reflection_summary', 'lesson_transition',
  ];
  const PRIMARY_ISSUES = [
    'voice_weight_heavy', 'voice_weight_light', 'resonance_slightly_back',
    'resonance_too_forward', 'phrase_ending_instability', 'pitch_falling_at_end',
    'breathy_quality', 'strain_risk', 'spectral_tilt_dark', 'pitch_floor_under_target',
    'pitch_above_target', 'pitch_unstable', 'an_unmapped_issue',
  ];
  // reflection_summary and lesson_transition are EXCLUDED on purpose. Their
  // "cue" is a model-facing instruction about the kind of turn this is
  // ("Summarize what changed and pick one focus for the next line.", "Introduce the
  // next lesson step."), not an articulatory cue spoken to the learner — so the
  // core-loop repair rightly rejects them on a COACH turn, which is a different
  // mechanism from the direction law this test pins. Their direction-safety is
  // asserted separately below, against the stripper alone.
  const META_INTENTS = new Set(['reflection_summary', 'lesson_transition']);
  for (const intent of INTENTS) {
    if (META_INTENTS.has(intent)) continue;
    const issueSet = intent === 'single_actionable_cue' ? PRIMARY_ISSUES : [null];
    for (const primaryIssue of issueSet) {
      const move = buildCoachMove({
        intent,
        issues: { primaryIssue },
        safety: {},
        mode: 'active_drill',
        voiceState: {},
      });
      out.push([`coachMove:${intent}${primaryIssue ? '/' + primaryIssue : ''}`, move.cue]);
    }
  }
  out.push(['SAFE_FALLBACK', SAFE]);
  out.push(['LOW_EFFORT_CUE', LOW]);
  return out.filter(([, cue]) => cue);
}

test('every code-owned cue survives BOTH directions — no learner is left without an action', () => {
  const cues = codeOwnedCues();
  // Drills + overrides + due-review + both fallbacks + every buildCoachMove cue.
  assert.ok(cues.length >= 30, `expected the full cue set, got ${cues.length}`);
  for (const [label, cue] of cues) {
    for (const direction of ['feminizing', 'masculinizing']) {
      const out = sanitizeCoachReply(cue, {
        direction,
        policy: { coachingAction: 'coach', shouldCorrect: true },
        personalization: {},
      }, { witness: {} });
      // FULL equality, not a prefix: a prefix check passes even when a trailing
      // sentence or clause has been deleted.
      assert.equal(
        out,
        cue,
        `${label} did not survive intact for a ${direction} learner.\n  cue: ${cue}\n  got: ${out}`,
      );
    }
  }
});

test('the model-facing turn-type cues are direction-safe too', () => {
  // These never reach the learner as a spoken articulatory cue, but they DO pass
  // through the cross-direction stripper, so they must still be neutral.
  const { buildCoachMove } = require('./signal-builder');
  for (const intent of ['reflection_summary', 'lesson_transition']) {
    const { cue } = buildCoachMove({ intent, issues: {}, safety: {}, mode: 'reflection', voiceState: {} });
    assert.ok(cue, `${intent} produces a cue`);
    for (const direction of ['feminizing', 'masculinizing']) {
      const out = sanitizeCoachReply(cue, {
        direction,
        policy: { coachingAction: 'converse', shouldCorrect: false },
        personalization: {},
      }, { witness: {} });
      assert.equal(out, cue, `${intent} was altered for a ${direction} learner`);
    }
  }
});

test('a masculinizing learner with an intonation review still receives a real cue', () => {
  // Regression pin: a RISING-ending cue is a feminizing device, so wording this
  // as "step up" collapsed the whole turn to a bare acknowledgment.
  const reply = sanitizeCoachReply('I am so glad you are here.', {
    direction: 'masculinizing',
    policy: { coachingAction: 'gentle', shouldCorrect: true },
    personalization: { dueReviewFocus: 'intonation variety' },
  }, { witness: {} });
  assert.notEqual(reply.trim(), 'I hear you.');
  assert.match(reply, /pitch change/i);
  assert.doesNotMatch(reply, /step up|rise|rising/i);
});

test('the learner still owns session lifetime — rest-suggesting replies are replaced', () => {
  // Regression pin for ACTIONABLE_CUE_PATTERN: adding 'rest' as a cue verb made
  // these read as legitimate coaching and pass through verbatim.
  for (const reply of [
    'You can rest the voice whenever you like.',
    'Take your time and rest your throat.',
    'Rest the voice now and pick it up later.',
  ]) {
    const out = sanitizeCoachReply(reply, {
      policy: { coachingAction: 'coach', shouldCorrect: true },
      personalization: {},
    }, { witness: {} });
    assert.notEqual(out, reply, `rest-suggesting reply passed through: ${reply}`);
  }
});
