'use strict';

/**
 * 2026-07-27 MTF-ONLY — the RETIRED-TARGET SWEEP.
 *
 * Why this file exists, and why it is not shaped like the other tests.
 *
 * SCOPE RULING (product owner, 2026-07-27): "there's never a female to male
 * route. the only thing supported is strictly male to female." A masculinizing
 * target is therefore CORRUPT INPUT — not a legacy lane that deserves graceful
 * handling. The four stored sessions that carried one have been deleted, and
 * the compatibility shim that used to rewrite a retired id to the neutral lane
 * has been removed with them.
 *
 * So the property this file pins FLIPPED. It used to be "a retired id resolves
 * to neutral, never feminizing". It is now:
 *
 *   NO SPECIAL HANDLING. A retired id must be treated EXACTLY as any other
 *   unrecognised string, everywhere, and be REJECTED at the boundaries that
 *   validate a target at all.
 *
 * Equivalence is the falsifiable form of "no special handling": if any surface
 * grows a masc/ftm branch — a resolver, an alias, a fallback lane, a special
 * label — its output stops matching the unrecognised-control's output and this
 * file fails. That catches a re-introduced shim as reliably as the old shape
 * caught a missing one.
 *
 * The three-layer structure is UNCHANGED, because the reason for it is
 * unchanged: the original defect appeared at six independent sites in one
 * changeset, and each repair round fixed the listed sites then wrongly claimed
 * the list was complete. A test that PINS KNOWN SITES cannot catch the site
 * nobody listed, so this file is built the other way round:
 *
 *   1. BEHAVIOURAL SWEEP — drive retired ids through every public
 *      content-selection entry point and assert the output is identical to the
 *      unrecognised control's. Adding a preset arm to an existing sink is
 *      caught here without editing this file.
 *   2. COVERAGE GUARD — reflectively discover every exported function whose
 *      source handles a target enum, and FAIL if one is neither swept above nor
 *      explicitly excused with a reason. This is the layer that catches the
 *      site nobody listed: a NEW exported content-selection function trips it
 *      automatically.
 *   3. PROMPT GUARD — assert no built model prompt TEACHES the retired
 *      direction, and that the retired id gets no special prompt treatment.
 *
 * If you add a sink and this file fails: sweep it, do not just add it to the
 * excused list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { canonicalizeDirection, coachingDirectionFromPreset } = require('./voice-target-identity');

// Every retired label the stored corpus and the old dataset generator can hold.
const RETIRED_TARGETS = [
  'masculine',
  'masculinizing',
  'masc-natural',
  'masc-deep',
  'masc-warm',
  'masc-bright',
  'ftm',
  'MASC-Natural', // casing must not matter
  '  masculine  ', // stored values are not always trimmed
  // Retired 2026-07-30 with the MTF-only narrowing. Adding them HERE, rather
  // than merely deleting them from the registries, is what turns "absent" into
  // "indistinguishable from an unrecognised value" — the property that actually
  // matters, and the one the masculine removal needed three review rounds to
  // reach. Every sink and gateway below now drives these two as well.
  'androgynous',
  'gender-neutral',
  'Gender-Neutral', // casing must not matter here either
  '  androgynous  ', // nor whitespace in a stored value
];

// The CONTROL. A string that is not a live preset and is not retired — i.e. the
// treatment every unrecognised value gets. A retired id must be indistinguishable
// from this.
const UNKNOWN_CONTROL = 'mystery-voice';

// Retired ids must never be GENERATED into selected content. (A container that
// echoes the caller's own value back is a different case — see CONTAINER_SINKS.)
const RETIRED_PATTERN = /masculin|\bftm\b|masc-|androgyn|gender-neutral|andro-|\bneutral-/i;

/** Capture a call's outcome — value OR throw — so equivalence compares both. */
async function outcomeOf(invoke, id) {
  try {
    return { ok: true, value: JSON.parse(JSON.stringify(await invoke(id) ?? null)) };
  } catch (error) {
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
}

/**
 * Two values in these payloads vary with the INPUT STRING (or the clock) rather
 * than with any lane decision, so they are masked before comparison. Masking
 * anything else would blunt the guard, so both are justified here:
 *
 *  - `card_<base36 time>_<counter>_<random>` — lessons/practice-cards builds the
 *    id from Date.now(), a module counter and Math.random(). No preset input at
 *    all; two calls one millisecond apart already differ.
 *  - `vt1:<sha256>` — voice-target-identity hashes [version, source, targetPreset]
 *    into the targetKey. It differs for ANY two distinct target strings by
 *    design; that is the identity key doing its job, not a coaching decision.
 *  - `promptTokens` (added round 4, with coachingTurn) — a token-count estimate
 *    of the prompt STRING. It moves with the LENGTH of the echoed style label,
 *    so 'masculine' (2875) and 'mystery-voice' (2876) differ by one token with
 *    byte-identical prompts. Masking it blunts nothing, because the prompt text
 *    it counts is itself in the compared payload (`messages`): any real content
 *    difference still fails the comparison through those. Measured before
 *    masking: all 9 retired ids differ from the control ONLY here.
 */
const VOLATILE_FIELDS = [
  [/card_[a-z0-9]+_[a-z0-9]+_[a-f0-9]+/g, 'card_<NONDETERMINISTIC>'],
  [/vt1:[a-f0-9]{64}/g, 'vt1:<TARGET-KEY-HASH>'],
  [/"promptTokens":\s*\d+/g, '"promptTokens":<PROMPT-LENGTH-DERIVED>'],
];

/**
 * Compare a retired-target outcome against the unrecognised control's, after
 * substituting the echoed id so a sink that legitimately carries the caller's
 * own value still compares equal. Anything left over is a genuine behavioural
 * difference — i.e. special handling.
 */
function assertSameAsUnknown(label, retiredOutcome, controlOutcome, id) {
  const normalize = (outcome) => {
    let text = JSON.stringify(outcome)
      .split(JSON.stringify(id).slice(1, -1)).join(UNKNOWN_CONTROL)
      .split(JSON.stringify(id.trim()).slice(1, -1)).join(UNKNOWN_CONTROL);
    for (const [pattern, placeholder] of VOLATILE_FIELDS) text = text.replace(pattern, placeholder);
    return text;
  };
  assert.equal(
    normalize(retiredOutcome), normalize(controlOutcome),
    `${label}: a retired target is handled DIFFERENTLY from an unrecognised one — `
    + 'that is the special-casing the scope ruling removed.\n'
    + `  retired("${id}"): ${JSON.stringify(retiredOutcome).slice(0, 400)}\n`
    + `  control("${UNKNOWN_CONTROL}"): ${JSON.stringify(controlOutcome).slice(0, 400)}`,
  );
}

// ---------------------------------------------------------------------------
// Layer 0 — the identity layer still FAILS CLOSED on a retired value
// ---------------------------------------------------------------------------

test('the identity layer refuses to claim a direction for a retired value', () => {
  for (const id of RETIRED_TARGETS) {
    // canonicalizeDirection: the retired direction labels are simply not in the
    // whitelist, so they yield '' and the caller pushes missing_target_direction.
    assert.equal(canonicalizeDirection(id), '', `canonicalizeDirection("${id}") must fail closed`);
  }
});

test('a CUSTOM identity carrying a retired preset fails closed on direction', () => {
  const identity = require('./voice-target-identity');
  for (const id of RETIRED_TARGETS) {
    const result = identity.resolveVoiceTargetIdentity({
      targetSource: 'custom', targetPreset: id, targetProfileId: 'p1',
      pitchFloorHz: 150, pitchCeilingHz: 300, resonanceFloor: 0.2, resonanceCeiling: 0.8,
      weightFloor: 0.1, weightCeiling: 0.6,
    });
    assert.equal(result.valid, false, `custom identity for "${id}" must be invalid`);
    assert.ok(
      result.reasons.includes('missing_target_direction'),
      `custom identity for "${id}" must fail closed on direction, got ${result.reasons.join(', ')}`,
    );
  }
  // A live preset on the same shape is valid — the failure is the retired value,
  // not the shape.
  assert.equal(identity.resolveVoiceTargetIdentity({
    targetSource: 'custom', targetPreset: 'soft-feminine', targetProfileId: 'p1',
    pitchFloorHz: 150, pitchCeilingHz: 300, resonanceFloor: 0.2, resonanceCeiling: 0.8,
    weightFloor: 0.1, weightCeiling: 0.6,
  }).valid, true);
});

test('the coaching direction helper gives a retired id no special lane', () => {
  for (const id of RETIRED_TARGETS) {
    assert.equal(
      coachingDirectionFromPreset(id), coachingDirectionFromPreset(UNKNOWN_CONTROL),
      `coachingDirectionFromPreset("${id}") must match an unrecognised preset`,
    );
  }
  // The live lane is unchanged. Deleted 2026-07-30: two asserts pinning
  // 'androgynous' and 'gender-neutral' to a 'neutral' lane. Those presets are
  // retired now — they are listed in RETIRED_TARGETS above and are covered by the
  // equivalence loop, so asserting a live lane for them would contradict it.
  assert.equal(coachingDirectionFromPreset('cute-feminine'), 'feminine');
  assert.equal(coachingDirectionFromPreset(UNKNOWN_CONTROL), 'feminine');
});

// ---------------------------------------------------------------------------
// Layer 1 — behavioural sweep over every public content-selection entry point
// ---------------------------------------------------------------------------

const policy = require('./voice-tutor-runtime-policy');
const cueSheet = require('./voice-cue-sheet');
const drills = require('./voice-drills');
const cockpit = require('./voice-cockpit-lines');
const cards = require('./lessons/practice-cards');
const planner = require('./lessons/lesson-planner');
const renderer = require('./coaching/renderer-client');
const signalSchema = require('./coaching/signal-schema');
const { buildCoachingSignal } = signalSchema;
const sessionState = require('./voice-session-state');
const signalBuilder = require('./coaching/signal-builder');
const sectionLoop = require('./coaching/section-loop');
const deepTutorAdapter = require('./deeptutor-voice-adapter');
const studentEvaluations = require('./voice-student-evaluations');
const learnerContext = require('./learner-context-service');
const identity = require('./voice-target-identity');
const standaloneRuntimeModule = require('./voice-standalone-runtime');
// 2026-07-27 (round 4): two more modules that read a target enum but were not
// listed. `coaching/sanitizer` held a surviving `styleTarget.includes('masc')`
// branch that nothing in this file could see; `coaching/index` re-exports the
// pipeline AND owns `coachingTurn`, which reads targetPreset in its own body.
const sanitizer = require('./coaching/sanitizer');
const coachingIndex = require('./coaching/index');

// ---------------------------------------------------------------------------
// The GATEWAY harness.
//
// Round 3 found a start-practice regression the sweep could not see: the four
// stored masculinizing sessions 400'd at /api/v1/voice/sessions/start because
// the gateway forwarded their retired preset RAW to an analyzer whose
// `normalize_target_preset` now RAISES on it. The sink lived inside
// `createVoiceStandaloneRuntime`, a closure the old `Object.entries(module)`
// reflection could never reach.
//
// So the sweep instantiates the runtime and drives its route handlers against a
// stub analyzer that enforces the SAME preset gate as the real one — and the
// live preset list is read out of the DSP source rather than restated here, for
// the same anti-drift reason preset-parity.test.ts reads it.
// ---------------------------------------------------------------------------

function readDspPresetIds() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'voice-trainer', 'src', 'services', 'audio_analysis.py'),
    'utf8',
  );
  const block = source.match(/TARGET_PROFILES:[^=]*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'Could not locate TARGET_PROFILES in audio_analysis.py');
  const ids = Array.from(block[1].matchAll(/^\s{4}"([a-z0-9-]+)":\s*VoiceTargetProfile\(/gm))
    .map((match) => match[1]);
  assert.ok(ids.length > 0, 'Parsed TARGET_PROFILES but found no preset ids');
  return new Set(ids);
}

const LIVE_DSP_PRESETS = readDspPresetIds();

/** Records every outbound trainer body so the sweep can scan what we SENT. */
function createAnalyzerStub() {
  const outbound = [];
  async function fetchImpl(url, init = {}) {
    const body = init.body ? JSON.parse(init.body) : null;
    outbound.push({ url: String(url), body });
    const json = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      async json() { return payload; },
      async text() { return JSON.stringify(payload); },
    });
    // The real gate: services/voice-trainer/src/services/audio_analysis.py
    // `normalize_target_preset` raises ValueError on an unknown preset, and the
    // routers map that to HTTP 400. A retired id is now exactly that.
    const requested = body && typeof body.targetPreset === 'string' ? body.targetPreset.trim() : '';
    if (requested && !LIVE_DSP_PRESETS.has(requested)) {
      return json(400, { detail: `Unknown target preset "${requested}".` });
    }
    if (/\/api\/v1\/voice\/sessions\/start$/.test(url)) {
      return json(200, {
        voiceSessionId: 'analyzer-session-1',
        sloaneSessionId: body?.sloaneSessionId || null,
        targetPreset: requested || 'cute-feminine',
        referenceClipId: body?.referenceClipId ?? null,
        targetSource: body?.targetSource || 'built-in',
        targetProfileId: body?.targetProfileId ?? null,
        analysisVersion: null,
        lessonId: body?.lessonId ?? null,
        status: 'ready',
        streamUrl: null,
        createdAt: Date.now(),
      });
    }
    if (/\/end$/.test(url)) return json(200, { status: 'ended' });
    return json(404, { detail: 'stub: unrouted' });
  }
  return { fetchImpl, outbound };
}

function makeGatewayHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-retired-sweep-'));
  const stub = createAnalyzerStub();
  const sessions = new Map();
  const runtime = standaloneRuntimeModule.createVoiceStandaloneRuntime({
    sessions,
    disableSessionPersistence: true,
    stateRoot: root,
    logger: false,
    fetchImpl: stub.fetchImpl,
  });
  return { root, runtime, sessions, outbound: stub.outbound };
}

const gateway = makeGatewayHarness();
test.after(() => fs.rmSync(gateway.root, { recursive: true, force: true }));

/** Seed a stored session whose persisted target is a retired id. */
function seedRetiredSession(targetPreset, extraVoiceState = {}) {
  const id = `sweep-${Math.random().toString(36).slice(2)}`;
  gateway.sessions.set(id, {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    voiceState: gateway.runtime.voiceStateRuntime.buildDefaultVoiceState({
      targetPreset,
      targetSource: 'built-in',
      ...extraVoiceState,
    }),
  });
  return id;
}

/**
 * The swept sinks. `name` must match the module-qualified export name used by
 * the coverage guard below.
 */
const SINKS = [
  ['voice-tutor-runtime-policy.normalizeVoiceTutorTargetPreset', (p) => policy.normalizeVoiceTutorTargetPreset(p)],
  ['voice-tutor-runtime-policy.getVoiceTutorStyleTarget', (p) => policy.getVoiceTutorStyleTarget(p)],
  ['voice-tutor-runtime-policy.getVoiceTutorTargetDirection', (p) => policy.getVoiceTutorTargetDirection(p)],
  ['voice-tutor-runtime-policy.buildVoiceTutorRuntimePolicyLines', (p) => policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: p })],
  ['voice-cue-sheet.buildVoiceCueSheet', (p) => cueSheet.buildVoiceCueSheet({ phrase: 'yeah no worries', targetPreset: p })],
  ['voice-cue-sheet.normalizeTargetPreset', (p) => cueSheet.normalizeTargetPreset(p)],
  // NEWLY VISIBLE after the 2026-07-29 lens widening, and named by an
  // independent sweep as one of the two structural analogues of the nine leak
  // sites from the masculine removal: an exported, direction-defaulting-to-
  // feminine selector that the old /targetPreset|styleTarget/ lens could not see.
  // getCueLane is the SOLE lane selector for 13 LANE_* cue tables.
  ['voice-cue-sheet.getCueLane', (p) => cueSheet.getCueLane(p)],
  // The other one: `DIRECTION_ACTIVE_DRILL_PITCH_LINES[direction] || .feminine`.
  ['voice-tutor-runtime-policy.buildVoiceTutorPracticeModeLines', (p) => policy.buildVoiceTutorPracticeModeLines(
    'active_drill',
    { direction: policy.getVoiceTutorTargetDirection(p) },
  )],
  ['voice-drills.getVoiceDrillPack', (p) => drills.getVoiceDrillPack(p)],
  ['voice-drills.getVoiceDrillById', (p) => drills.getVoiceDrillById(p, 'nope')],
  ['voice-drills.recommendVoiceDrillIds', (p) => drills.recommendVoiceDrillIds({ targetPreset: p })],
  ['voice-cockpit-lines.pickVoiceCockpitCatalogLine', (p) => cockpit.pickVoiceCockpitCatalogLine({ targetPreset: p })],
  ['voice-cockpit-lines.buildVoiceCockpitLines', (p) => cockpit.buildVoiceCockpitLines({ targetPreset: p })],
  ['lessons/practice-cards.buildFocus', (p) => ['resonance', 'weight', 'pitch', 'prosody'].map((axis) => cards.buildFocus({ axis, targetPreset: p }))],
  ['lessons/practice-cards.createCard', (p) => cards.createCard({ sessionId: 's', phrase: 'I would love a coffee', targetPreset: p })],
  ['lessons/practice-cards.buildCardTokens', (p) => cards.buildCardTokens('I would love a coffee', { targetPreset: p })],
  ['lessons/practice-cards.findSimplerPhrase', (p) => cards.findSimplerPhrase('a longer phrase to simplify', 'resonance', p)],
  ['coaching/renderer-client.buildRendererUserMessage', (p) => renderer.buildRendererUserMessage(
    buildCoachingSignal({ mode: 'active_drill', styleTarget: p }),
  )],
  // SWEPT 2026-07-29, clearing its lens-widening debt. It branches on
  // `metricContract.target.direction === 'neutral'` for BOTH a knowledge-point
  // TITLE and its CUE (lessons/lesson-planner.js:443, :451), so it is squarely on
  // the axis the neutral-preset removal moves along — not a false match.
  //
  // Three gates sit in front of that branch: scope tier 'quiet' and 'listening'
  // return early, and there is a measurement gate. Passing `null` for
  // sessionScope defaults the tier to 'full', and the metrics bag below is the
  // same one the behavioural sweeps already use. Verified it genuinely reaches
  // the branch: 'androgynous' yields "Balanced Target Placement" while
  // 'cute-feminine' yields "Hold the Whole Target" — the payloads really differ,
  // so an unswept retirement here would have been visible in a lesson.
  ['lessons/lesson-planner.buildFallbackLesson', (p) => planner.buildFallbackLesson({
    targetPreset: p,
    lastSummary: {
      targetPreset: p,
      metrics: {
        meanPitchHz: 150,
        weightMean: 0.45,
        resonanceMean: 0.28,
        advanced: { measurementAvailable: true },
      },
    },
  }, null)],
  // --- coaching/sanitizer (BLIND to this sweep until R4) ---
  //
  // The reflective coverage guard below CANNOT reach this class on its own, and
  // that is exactly why round 4 found a surviving `masc` branch here by hand:
  // the deciding helper (`deriveDirection`) is module-private, and the exported
  // `sanitizeCoachReply` takes a signal OBJECT, so its source text contains
  // neither `targetPreset` nor `styleTarget` and the guard's regex never
  // matches it. Listing the module alone therefore changes nothing — the sink
  // below is what actually makes the class visible. Drive it with a reply that
  // carries BOTH directions' cues so a direction-dependent filter shows up as a
  // difference from the unrecognised control.
  ['coaching/sanitizer.sanitizeCoachReply', (p) => sanitizer.sanitizeCoachReply(
    'Lower the larynx and add chest resonance. Now brighten it and keep the weight light.',
    { mode: 'active_drill', styleTarget: p, directionSource: 'target' },
  )],
  // --- coaching/index.coachingTurn (BLIND to this sweep until R4) ---
  //
  // `coachingTurn` reads targetPreset in its own body and is the app's main
  // coach path. It takes an injectable `callModel`, so it is DRIVEN here rather
  // than excused: a stub model makes the whole turn deterministic.
  ['coaching/index.coachingTurn', (p) => coachingIndex.coachingTurn({
    voiceState: { targetPreset: p },
    learnerContext: null,
    lessonState: null,
    userMessage: 'how did that sound',
    targetPreset: p,
    callModel: async () => ({ text: 'Keep it light and forward, then hold it.' }),
  })],
  // --- coaching signal + card builders (were BLIND to this sweep until R3) ---
  ['coaching/signal-builder.deriveDirectionHintFromTarget', (p) => signalBuilder.deriveDirectionHintFromTarget(p)],
  ['coaching/signal-builder.resolveCoachingDirection', (p) => signalBuilder.resolveCoachingDirection(null, p)],
  ['coaching/signal-builder.resolveMetricContract', (p) => signalBuilder.resolveMetricContract({ targetPreset: p }, { targetPreset: p })],
  ['coaching/signal-builder.buildLearnerMemo', (p) => signalBuilder.buildLearnerMemo({ profile: {} }, { targetPreset: p })],
  ['coaching/signal-builder.buildSignal', (p) => signalBuilder.buildSignal({
    voiceState: { targetPreset: p, targetSource: 'built-in' },
    targetPreset: p,
    userMessage: 'how did that sound?',
  })],
  ['coaching/signal-schema.buildCoachingSignal', (p) => signalSchema.buildCoachingSignal({ styleTarget: p })],
  ['coaching/section-loop.buildFragmentCardSpec', (p) => sectionLoop.buildFragmentCardSpec(
    { axis: 'resonance', fragmentText: 'I would love a coffee' }, { targetPreset: p },
  )],
  ['deeptutor-voice-adapter.normalizeCoachBrief', (p) => deepTutorAdapter.normalizeCoachBrief({ targetPreset: p, styleTarget: p })],
  ['deeptutor-voice-adapter.buildDeepTutorVoiceGuideRecords', (p) => deepTutorAdapter.buildDeepTutorVoiceGuideRecords({
    voiceState: { targetPreset: p, activeLine: { targetPreset: p, text: 'hello there' } },
  })],
  ['voice-student-evaluations.buildVoiceStudentModelEvaluations', (p) => studentEvaluations.buildVoiceStudentModelEvaluations({
    summary: {
      targetPreset: p,
      metrics: { meanPitchHz: 150, weightMean: 0.45, resonanceMean: 0.28, advanced: { measurementAvailable: true } },
      target: { targetPreset: p },
    },
    voiceState: { targetPreset: p },
    thresholds: sessionState.createVoiceSessionStateRuntime({}).getVoiceStudentPresetTargets(p),
    concepts: {},
  })],
  ['learner-context-service.normalizeCoachCheckpoint', (p) => learnerContext.normalizeCoachCheckpoint({
    sessionId: 's', targetBinding: { targetPreset: p, targetSource: 'built-in' },
  }).targetBinding],
  // --- identity layer. It FAILS CLOSED rather than resolving, so the only
  // property swept here is the one that matters: it never answers 'feminine'
  // and never echoes a retired id into a direction. ---
  ['voice-target-identity.coachingDirectionFromPreset', (p) => identity.coachingDirectionFromPreset(p)],
  ['voice-target-identity.resolveVoiceTargetIdentity', (p) => identity.resolveVoiceTargetIdentity({
    targetSource: 'built-in', targetPreset: p,
  }).reasons],
  ['voice-target-identity.resolveVoiceTargetIdentityFromAttempt', (p) => identity.resolveVoiceTargetIdentityFromAttempt(
    { targetPreset: p }, { targetPreset: p, targetSource: 'built-in' },
  ).reasons],
  ['voice-target-identity.isVoiceRecordComparableToTarget', (p) => identity.isVoiceRecordComparableToTarget(
    { targetPreset: p, targetSource: 'built-in' },
    identity.resolveVoiceTargetIdentity({ targetSource: 'built-in', targetPreset: p }),
  )],
  // --- voice-session-state, reflected off the INSTANTIATED runtime ---
  ['voice-session-state@runtime.getVoiceStudentPresetTargets', (p) => gateway.runtime.voiceStateRuntime.getVoiceStudentPresetTargets(p)],
  ['voice-session-state@runtime.buildDefaultVoiceState', (p) => gateway.runtime.voiceStateRuntime.buildDefaultVoiceState({ targetPreset: p }).activeLine],
  ['voice-session-state@runtime.normalizeVoiceState', (p) => gateway.runtime.voiceStateRuntime.normalizeVoiceState({ targetPreset: p }).activeLine],
  ['voice-session-state@runtime.buildVoiceStudentModelEvaluations', (p) => gateway.runtime.voiceStateRuntime.buildVoiceStudentModelEvaluations(
    {
      targetPreset: p,
      metrics: { meanPitchHz: 150, weightMean: 0.45, resonanceMean: 0.28, advanced: { measurementAvailable: true } },
      target: { targetPreset: p },
    },
    { targetPreset: p },
  )],
];

/**
 * Sinks whose output legitimately ECHOES the caller's own target back — signal
 * envelopes, metric contracts, card specs, stored bindings, and the prompt LABEL
 * lines. The equivalence comparison already tolerates that: it substitutes the
 * echoed id before comparing, so a container that carries the value through is
 * equal to the control, while a sink that SELECTS different content is not.
 *
 * They get one extra assertion the others cannot have: the retired value must be
 * echoed, not silently rewritten to something the learner never chose. That is
 * the surviving half of the old house law — the app must never substitute a
 * target — and it is what makes "no special handling" the strict reading rather
 * than a licence to rewrite user data.
 */
const ECHOING_SINKS = new Set([
  'coaching/signal-builder.resolveMetricContract',
  'coaching/signal-schema.buildCoachingSignal',
  'coaching/section-loop.buildFragmentCardSpec',
  'learner-context-service.normalizeCoachCheckpoint',
]);

for (const [name, invoke] of SINKS) {
  test(`retired target gets NO special handling: ${name}`, async () => {
    const control = await outcomeOf(invoke, UNKNOWN_CONTROL);
    for (const id of RETIRED_TARGETS) {
      const retired = await outcomeOf(invoke, id);
      assertSameAsUnknown(name, retired, control, id);
      if (ECHOING_SINKS.has(name)) {
        const carried = JSON.stringify(retired.value ?? '');
        assert.ok(
          carried.includes(JSON.stringify(id).slice(1, -1))
          || carried.includes(JSON.stringify(id.trim()).slice(1, -1))
          || !RETIRED_PATTERN.test(carried),
          `${name}("${id}") altered the carried target instead of echoing it verbatim -> ${carried.slice(0, 300)}`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Layer 1b — the GATEWAY sweep.
//
// These sinks are route handlers on the instantiated runtime, so they are swept
// by DRIVING them, and the scan covers BOTH what they return AND every body
// they sent to the analyzer. The outbound half is the half that was missing:
// startVoiceSession's return value never named the retired preset, but the
// request body did — and the analyzer answered 400, so the learner's stored
// masculinizing session simply could not start practice.
// ---------------------------------------------------------------------------

const GATEWAY_SINKS = [
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.startVoiceSession', async (p) => {
    const sessionId = seedRetiredSession(p);
    return gateway.runtime.voiceOperationRouteHandlers.startVoiceSession({ sessionId });
  }],
  ['voice-standalone-runtime@runtime.appCompatibilityRouteHandlers.startSession', async (p) => (
    gateway.runtime.appCompatibilityRouteHandlers.startSession({ targetPreset: p })
  )],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.updateVoiceSessionPreset', async (p) => {
    const sessionId = seedRetiredSession('cute-feminine');
    return gateway.runtime.voiceOperationRouteHandlers.updateVoiceSessionPreset({ sessionId, targetPreset: p });
  }],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.getVoiceDrills', async (p) => {
    const sessionId = seedRetiredSession(p);
    return gateway.runtime.voiceOperationRouteHandlers.getVoiceDrills({ sessionId });
  }],
  // Self-practice reaches the drill packs by a SECOND path that does not go
  // through getVoiceDrills, so it is a sink in its own right. It is swept the
  // same way — seed a retired preset on the session and let the handler recover
  // it — because the interesting question is identical: can a retired target
  // reach feminizing content? (It should not: the module refuses any preset that
  // is not a live pack key, rather than falling back to cute-feminine the way
  // getVoiceDrills deliberately does.)
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.listSelfPracticeDrills', async (p) => {
    const sessionId = seedRetiredSession(p);
    return gateway.runtime.voiceOperationRouteHandlers.listSelfPracticeDrills({ sessionId });
  }],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.selectVoiceDrill', async (p) => {
    const sessionId = seedRetiredSession(p);
    return gateway.runtime.voiceOperationRouteHandlers.selectVoiceDrill({ sessionId, lessonId: null });
  }],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.updateVoiceCockpitLine', async (p) => {
    const sessionId = seedRetiredSession(p);
    return gateway.runtime.voiceOperationRouteHandlers.updateVoiceCockpitLine({ sessionId });
  }],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.updateVoiceSessionReference', async (p) => {
    const sessionId = seedRetiredSession(p, { referenceClipId: 'clip-1', targetSource: 'reference' });
    // The stub has no reference clip, so this REJECTS downstream — deliberately.
    // What is being swept is the outbound body it built on the way there, which
    // is where the retired preset used to reach /api/v1/voice/target/profile.
    try {
      return await gateway.runtime.voiceOperationRouteHandlers.updateVoiceSessionReference({
        sessionId, referenceClipId: 'clip-1',
      });
    } catch {
      return null;
    }
  }],
];

for (const [name, invoke] of GATEWAY_SINKS) {
  test(`retired target gets NO special handling at the gateway: ${name}`, async () => {
    // A gateway payload carries session ids and timestamps that differ per call,
    // so full deep-equality is not the right instrument here. What IS comparable
    // — and is where the whole defect class lived — is the OUTBOUND body: what
    // the gateway decided to send the analyzer. A retired id must be forwarded
    // verbatim, exactly as an unrecognised one is, with no resolver in between.
    const outboundFor = async (id) => {
      const before = gateway.outbound.length;
      try {
        await invoke(id);
      } catch {
        // A rejection is a legitimate outcome — see the fail-closed test below.
      }
      return gateway.outbound.slice(before).map((call) => ({
        url: call.url,
        targetPreset: call.body?.targetPreset ?? null,
      }));
    };
    const control = await outboundFor(UNKNOWN_CONTROL);
    for (const id of RETIRED_TARGETS) {
      const retired = await outboundFor(id);
      assert.equal(
        JSON.stringify(retired).split(id).join(UNKNOWN_CONTROL)
          .split(id.trim()).join(UNKNOWN_CONTROL),
        JSON.stringify(control),
        `${name}("${id}") sent the analyzer a different request shape than an unrecognised preset — `
        + 'a resolver has crept back in',
      );
      for (const call of retired) {
        assert.ok(
          call.targetPreset === null
          || call.targetPreset === id
          || call.targetPreset === id.trim()
          || !RETIRED_PATTERN.test(String(call.targetPreset)),
          `${name}("${id}") REWROTE the outbound preset to "${call.targetPreset}" instead of `
          + 'forwarding what was stored',
        );
      }
    }
  });
}

test('FAIL CLOSED: a masculinizing target is REJECTED at the analyzer, not coached', async () => {
  // The scope ruling: a masculinizing target is corrupt input and "the existing
  // fail-closed paths are the correct and only response". The analyzer's
  // `normalize_target_preset` raises on any preset outside the live enum and the
  // routers map that to HTTP 400 — the stub enforces the same gate. Starting
  // practice on such a target must therefore FAIL, not silently succeed in some
  // substituted lane.
  for (const stored of ['masculine', 'masc-natural', 'ftm']) {
    const sessionId = seedRetiredSession(stored);
    const before = gateway.outbound.length;
    await assert.rejects(
      () => gateway.runtime.voiceOperationRouteHandlers.startVoiceSession({ sessionId }),
      `starting practice on a "${stored}" target must be rejected, not served`,
    );
    const start = gateway.outbound.slice(before)
      .find((call) => /\/api\/v1\/voice\/sessions\/start$/.test(call.url));
    assert.ok(start, 'no /sessions/start request was made');
    assert.equal(
      start.body.targetPreset, stored,
      'the corrupt target must be forwarded verbatim so the analyzer is the one that rejects it',
    );
    // The learner's stored target is still not rewritten by the attempt.
    assert.equal(gateway.sessions.get(sessionId).voiceState.targetPreset, stored);
  }
  // A live preset is untouched: it reaches the analyzer verbatim and succeeds.
  const feminineId = seedRetiredSession('cute-feminine');
  const before = gateway.outbound.length;
  const payload = await gateway.runtime.voiceOperationRouteHandlers.startVoiceSession({ sessionId: feminineId });
  const feminineStart = gateway.outbound.slice(before)
    .find((call) => /\/api\/v1\/voice\/sessions\/start$/.test(call.url));
  assert.equal(feminineStart.body.targetPreset, 'cute-feminine');
  assert.equal(payload.voiceTrainer.voiceSessionId, 'analyzer-session-1', 'the analyzer session was not created');
  assert.equal(gateway.sessions.get(feminineId).voiceState.targetPreset, 'cute-feminine');
});

test('WRITE GATE: updateVoiceSessionPreset cannot CREATE an invalid stored target', async () => {
  // Round 4 found the hole this test now pins. `updateVoiceSessionPreset` stored
  // ANY string with no enum check and no analyzer round-trip, so the reviewer
  // drove it and made a live session's stored preset "masculine". Every
  // read-side guard downstream is then arguing about a row that should never
  // have existed — and the analyzer never sees this write at all, so the
  // session-start gate does not help.
  //
  // The invariant: an invalid target can never be WRITTEN. Retired ids and the
  // unrecognised control are checked together, because "no special handling"
  // means the retired id must be rejected for being unknown, not for being masc.
  const { voiceOperationRouteHandlers: routes } = gateway.runtime;
  for (const bad of [...RETIRED_TARGETS, UNKNOWN_CONTROL]) {
    const sessionId = seedRetiredSession('cute-feminine');
    const before = gateway.outbound.length;
    await assert.rejects(
      () => routes.updateVoiceSessionPreset({ sessionId, targetPreset: bad }),
      (error) => error?.status === 400,
      `updateVoiceSessionPreset("${bad}") stored an invalid target instead of rejecting it`,
    );
    // The rejection is total: the stored target is untouched and no side effect
    // (analyzer retirement, outbound call) ran on the way to the throw.
    assert.equal(
      gateway.sessions.get(sessionId).voiceState.targetPreset, 'cute-feminine',
      `updateVoiceSessionPreset("${bad}") mutated the stored target on a rejected write`,
    );
    assert.equal(
      gateway.outbound.length, before,
      `updateVoiceSessionPreset("${bad}") made an outbound call on a rejected write`,
    );
  }
  // The other half: every LIVE preset still writes, unchanged. Without this the
  // gate could pass by rejecting everything.
  for (const live of Object.keys(cueSheet.PRESET_PROFILES)) {
    const sessionId = seedRetiredSession('cute-feminine');
    await routes.updateVoiceSessionPreset({ sessionId, targetPreset: live });
    assert.equal(
      gateway.sessions.get(sessionId).voiceState.targetPreset, live,
      `updateVoiceSessionPreset("${live}") failed to store a LIVE preset`,
    );
  }
  // An empty/absent target keeps its documented default rather than erroring.
  const defaulted = seedRetiredSession('soft-feminine');
  await routes.updateVoiceSessionPreset({ sessionId: defaulted, targetPreset: '' });
  assert.equal(gateway.sessions.get(defaulted).voiceState.targetPreset, 'cute-feminine');
});

test('WRITE GATE: startVoiceSession cannot CREATE an invalid stored target', async () => {
  // Round 5 found the OTHER half of the round-4 hole. The enum check lived only
  // in updateVoiceSessionPreset, so session CREATE was still an unguarded write
  // sink: startVoiceSession -> getOrCreateSession -> createSession ->
  // persistSessionsSafely persists the row FIRST, and the analyzer round-trip
  // that rejects the preset happens after. Measured before the fix: the request
  // answered 400 and the store still held `targetPreset: "masculine"`.
  //
  // Two doors into the same field are covered: the flat `targetPreset` body
  // field, and a whole `voiceState` object (buildDefaultVoiceState spreads
  // `...overrides` with no enum check, so voiceState.targetPreset lands in the
  // stored row verbatim).
  const { voiceOperationRouteHandlers: routes } = gateway.runtime;
  const doors = [
    ['targetPreset', (sessionId, bad) => ({ sessionId, targetPreset: bad })],
    ['voiceState.targetPreset', (sessionId, bad) => ({ sessionId, voiceState: { targetPreset: bad, targetSource: 'built-in' } })],
  ];
  for (const [door, buildBody] of doors) {
    for (const bad of [...RETIRED_TARGETS, UNKNOWN_CONTROL, '__proto__', 'constructor']) {
      const sessionId = `sweep-start-${Math.random().toString(36).slice(2)}`;
      const before = gateway.outbound.length;
      await assert.rejects(
        () => routes.startVoiceSession(buildBody(sessionId, bad)),
        (error) => error?.status === 400,
        `startVoiceSession(${door}="${bad}") did not reject with 400`,
      );
      // The whole point of round 5: the REJECTION MUST LEAVE NO ROW BEHIND.
      assert.equal(
        gateway.sessions.has(sessionId), false,
        `startVoiceSession(${door}="${bad}") persisted a session row on a rejected write`,
      );
      assert.equal(
        gateway.outbound.length, before,
        `startVoiceSession(${door}="${bad}") made an outbound call on a rejected write`,
      );
    }
  }
  // An EXISTING session must not be mutated by a rejected start either.
  for (const bad of [...RETIRED_TARGETS, UNKNOWN_CONTROL]) {
    const sessionId = seedRetiredSession('soft-feminine');
    await assert.rejects(
      () => routes.startVoiceSession({ sessionId, targetPreset: bad }),
      (error) => error?.status === 400,
    );
    assert.equal(
      gateway.sessions.get(sessionId).voiceState.targetPreset, 'soft-feminine',
      `startVoiceSession("${bad}") mutated an existing session's stored target`,
    );
  }
  // The other half: every LIVE preset still starts and still stores, unchanged.
  // Without this the gate could pass by rejecting everything.
  for (const live of Object.keys(cueSheet.PRESET_PROFILES)) {
    const sessionId = `sweep-start-live-${Math.random().toString(36).slice(2)}`;
    const payload = await routes.startVoiceSession({ sessionId, targetPreset: live });
    assert.ok(payload, `startVoiceSession("${live}") returned nothing`);
    assert.equal(
      gateway.sessions.get(sessionId).voiceState.targetPreset, live,
      `startVoiceSession("${live}") failed to store a LIVE preset`,
    );
  }
  // An empty/absent target keeps its documented default rather than erroring.
  const defaulted = `sweep-start-default-${Math.random().toString(36).slice(2)}`;
  await routes.startVoiceSession({ sessionId: defaulted, targetPreset: '' });
  assert.equal(gateway.sessions.get(defaulted).voiceState.targetPreset, 'cute-feminine');
});

test('WRITE GATE: POST /session/start (app compatibility) cannot CREATE an invalid stored target', async () => {
  // The THIRD create sink, found while closing round 5. appCompatibilityRouteHandlers
  // .startSession passes `body.targetPreset` straight into createSession, so it was a
  // second unguarded door into the same store even after startVoiceSession was gated.
  // The check now lives in createSession itself — the choke point every create path
  // funnels through — which is what makes this sink covered rather than patched.
  const app = gateway.runtime.appCompatibilityRouteHandlers;
  for (const bad of [...RETIRED_TARGETS, UNKNOWN_CONTROL]) {
    const sessionId = `sweep-appstart-${Math.random().toString(36).slice(2)}`;
    await assert.rejects(
      () => app.startSession({ sessionId, targetPreset: bad, forceNewSession: true }),
      (error) => error?.status === 400,
      `appCompatibility.startSession("${bad}") did not reject with 400`,
    );
    assert.equal(
      gateway.sessions.has(sessionId), false,
      `appCompatibility.startSession("${bad}") persisted a session row on a rejected write`,
    );
  }
  // LIVE presets and the empty default are unaffected.
  for (const live of [...Object.keys(cueSheet.PRESET_PROFILES), '']) {
    const sessionId = `sweep-appstart-live-${Math.random().toString(36).slice(2)}`;
    await app.startSession({ sessionId, targetPreset: live, forceNewSession: true });
    assert.equal(
      gateway.sessions.get(sessionId).voiceState.targetPreset, live || 'cute-feminine',
      `appCompatibility.startSession("${live}") failed to store a LIVE preset`,
    );
  }
});

test('lesson planner prompt gives a retired id no special handling', () => {
  // buildPlanningPrompt(voiceState, learnerContext, sessionScope) — the FIRST
  // arg is the voiceState itself, not a wrapper around it.
  const control = planner.buildPlanningPrompt({ targetPreset: UNKNOWN_CONTROL }, null);
  for (const id of RETIRED_TARGETS) {
    const prompt = planner.buildPlanningPrompt({ targetPreset: id }, null);
    assert.equal(
      prompt.split(id).join(UNKNOWN_CONTROL).split(id.trim()).join(UNKNOWN_CONTROL), control,
      `lesson-planner("${id}") built a different prompt than it does for an unrecognised preset`,
    );
    // Beyond the echoed label, the prompt must not TEACH the retired direction.
    assert.doesNotMatch(
      prompt.split(id).join(UNKNOWN_CONTROL).split(id.trim()).join(UNKNOWN_CONTROL),
      RETIRED_PATTERN,
      `lesson-planner("${id}") generated masculinizing content`,
    );
  }
});

// ---------------------------------------------------------------------------
// Layer 2 — COVERAGE GUARD. The layer that catches the site nobody listed.
// ---------------------------------------------------------------------------

/**
 * Exports genuinely driven by a DEDICATED test above rather than by the generic
 * sink loop, because the loop's contract — "call it with a retired preset and a
 * control preset, then compare" — does not fit them.
 *
 * This is not a second excuse list. An entry here must name the test that drives
 * it, and that test must actually assert something about the retired axis. The
 * difference matters: an excused export is one the removal cannot reach; one of
 * these IS reachable and IS checked, just not by the loop.
 */
const DRIVEN_ELSEWHERE = new Map([
  // Takes no preset at all, so preset-equivalence is vacuous for it. Driven by
  // 'PROMPT GUARD: the coach SYSTEM prompt never names or teaches the retired
  // direction', which asserts both the zero-masculine budget and a tripwire that
  // fires if the prompt still teaches the neutral lane after neutral presets go.
  ['coaching/renderer-client.buildRendererSystemPrompt', 'PROMPT GUARD: the coach SYSTEM prompt never names or teaches the retired direction'],
]);

const SWEPT = new Set([
  ...[...SINKS, ...GATEWAY_SINKS].map(([name]) => name),
  ...DRIVEN_ELSEWHERE.keys(),
]);

/**
 * Excused exports: they mention a target enum but cannot select feminizing
 * content. Every entry needs a REASON. Adding a name here instead of sweeping
 * it is how the previous rounds missed sites — do not do it lightly.
 */
// ---------------------------------------------------------------------------
// DEBT FROM THE 2026-07-29 LENS WIDENING — read before adding to it.
//
// Widening the guard's regex from /targetPreset|styleTarget/ to also catch
// `direction`/`lane`/`presetKey` made 23 exports newly visible. Two of them
// (voice-cue-sheet.getCueLane, voice-tutor-runtime-policy.buildVoiceTutorPractice-
// ModeLines) were swept immediately — an independent sweep had named them as the
// structural analogue of the nine leak sites the masculine removal took three
// review rounds to find.
//
// The other 21 were parked under a placeholder reason, as recorded DEBT, to be
// swept or genuinely excused BEFORE the neutral-preset removal lands — because
// that removal moves along the very axis the widened lens now sees.
//
// THAT DEBT IS NOW CLEARED (2026-07-29). Each was classified by reading its
// code, not its name. The placeholder is gone; if you see it reintroduced,
// someone has parked an export again instead of deciding about it.
// ---------------------------------------------------------------------------
// CLEARED 2026-07-29. Every entry the lens widening exposed has now been
// classified by reading its code, and none is left carrying a placeholder.
// Two genuinely needed sweeping and were swept (lesson-planner.buildFallbackLesson
// into SINKS; renderer-client.buildRendererSystemPrompt as a tripwire in the
// PROMPT GUARD). The rest matched on a DIFFERENT axis that happens to use the
// words "direction" or "lane", and each now says which axis and why.
//
// Three axes wear the word "direction" in this codebase. Keep them apart:
const BAND_POLARITY_AXIS = 'metric BAND POLARITY ("under"|"over"), not gender direction — removing neutral presets does not touch it';
const TAKE_KIND_AXIS = 'take-kind axis; the only match is English prose in a comment ("the deliberate direction to fail in"), not a target value';
const EVIDENCE_LANE_AXIS = 'listening EVIDENCE lanes (analyzer vs ASR), not a voice-target lane; returns a services health map';
// ...and "preset" is two different things: the built-in enum, and the ids of
// analyzer-stored CUSTOM presets (`voice_preset_<hex>_<hex>`), which are disjoint.
const CUSTOM_PRESET_ROW_AXIS = 'matches only on `presetId` — the analyzer-stored CUSTOM preset ROW id, disjoint from the built-in enum. '
  + 'These four are one-line callVoiceTrainer URL forwarders that never read the enum. '
  + 'NOTE: the neutral removal DOES have a consequence for custom presets, but it lands in the Python owner — '
  + 'services/voice-trainer/src/services/target_preset_library.py branches on `base_target.direction == \'neutral\'` at :304 and :328. '
  + 'That file is on the removal checklist; these JS forwarders are not the place to catch it.';

const EXCUSED = new Map([
  ['coaching/renderer-client.renderSectionLoopLine', BAND_POLARITY_AXIS],
  ['coaching/signal-builder.detectIssues', BAND_POLARITY_AXIS],
  ['coaching/signal-builder.recommendDrillForFocus', 'takes (focus, practiceLine, drillRegistry, targetFit) — no preset reaches it; it branches on targetFit statuses, and "direction" appears only in comments'],
  ['coaching/signal-builder.buildCoachMove', 'receives no direction and contains no targetPreset token; its own comment states this'],
  ['coaching/section-loop.resolveSectionLoopTurn', BAND_POLARITY_AXIS],
  ['voice-student-evaluations.buildVoicePhraseCouplingSignals', 'phrase-mimicry placement corridor ("lane" as in laneMatchScore/laneFloor), not a voice-target lane; params are (phraseComparison, thresholds)'],
  ['voice-target-identity.canonicalizeDirection', 'swept by hand in Layer 0 above (canonicalizeDirection must return "" for every retired id); the reflective guard sees it only after the lens widening'],
  ['coaching/index.detectIssues', 're-export; the same function object is EXCUSED under coaching/signal-builder.detectIssues (band-polarity axis) — verified identity, not just the name'],
  ['coaching/index.sanitizeCoachReply', 're-export; the same function object is swept as coaching/sanitizer.sanitizeCoachReply'],
  ['coaching/index.buildRendererSystemPrompt', 're-export; the same function object is driven by the PROMPT GUARD as coaching/renderer-client.buildRendererSystemPrompt'],
  ['voice-standalone-runtime@runtime.stampEngineRecommendedTakeKind', TAKE_KIND_AXIS],
  ['learner-context-service@service.updateLearnerProfile', 'LEARNER-profile direction ("mtf"|"neutral"|"unspecified"), a SEPARATE axis from the target-preset direction — removing neutral presets does not retire the neutral learner lane'],
  ['voice-standalone-runtime@runtime.learnerContextRouteHandlers.updateLearnerContextProfile', 'LEARNER-profile direction axis, not the target-preset axis — see updateLearnerProfile above'],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.duplicateVoiceTargetPreset', CUSTOM_PRESET_ROW_AXIS],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.archiveVoiceTargetPreset', CUSTOM_PRESET_ROW_AXIS],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.restoreVoiceTargetPreset', CUSTOM_PRESET_ROW_AXIS],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.deleteVoiceTargetPreset', CUSTOM_PRESET_ROW_AXIS],
  ['voice-standalone-runtime@runtime.voiceSessionRouteHandlers.getVoiceHealth', EVIDENCE_LANE_AXIS],
  ['voice-session-state@runtime.normalizeVoiceSectionLoopState', BAND_POLARITY_AXIS],
  ['lessons/practice-cards.PracticeCardStore', 'class; its card-building path is swept via createCard/buildFocus'],
  // --- coaching/index re-exports (round 4). These are the SAME function
  // objects as the ones swept under their owning module, re-exported by the
  // barrel; `coaching/index.buildSignal === coaching/signal-builder.buildSignal`
  // is identity-true, so sweeping them twice would test the same code under a
  // second name. coachingTurn — the one function coaching/index actually OWNS —
  // is DRIVEN in the behavioural sweep above, not excused. ---
  ['coaching/index.buildCoachingSignal', 're-export; the same function object is swept as coaching/signal-schema.buildCoachingSignal'],
  ['coaching/index.buildSignal', 're-export; the same function object is swept as coaching/signal-builder.buildSignal'],
  ['coaching/index.buildRendererUserMessage', 're-export; the same function object is swept as coaching/renderer-client.buildRendererUserMessage'],
  ['lessons/lesson-planner.buildPlanningPrompt', 'swept by the dedicated planner test above (needs a 2-arg shape)'],
  // --- factories: reflected as INSTANCES below, which is the whole point of
  // the instance layer. Excusing the factory itself is not a loophole; its
  // closures are swept under their instance name. ---
  ['voice-standalone-runtime.createVoiceStandaloneRuntime', 'factory; its closures are reflected under voice-standalone-runtime@runtime.*'],
  ['voice-session-state.createVoiceSessionStateRuntime', 'factory; its closures are reflected under voice-session-state@runtime.*'],
  ['learner-context-service.createLearnerContextService', 'factory; its closures are reflected under learner-context-service@service.*'],
  ['voice-standalone-runtime.registerStandaloneSupportRoutes', 'express route registrar; it forwards to the runtime handlers swept under voice-standalone-runtime@runtime.*'],
  // --- runtime members that cannot be driven here, each with the specific
  // reason and the swept sink that actually owns the target-enum decision. ---
  ['voice-standalone-runtime@runtime.generateRealtimeCoachReplyStreaming', 'needs a live model + open stream; its only target-enum read is the signal it builds through coaching/signal-builder.buildSignal and voice-cue-sheet.buildVoiceCueSheet, both swept above'],
  ['voice-standalone-runtime@runtime.processCoachReplyCardOps', 'card ops are built by lessons/practice-cards.createCard/buildCardTokens, both swept above; this only forwards the resolved preset into them'],
  ['voice-standalone-runtime@runtime.voiceOperationRouteHandlers.selectVoiceTargetPreset', 'selects a CUSTOM (analyzer-stored) preset by id and echoes back what the analyzer returns; the built-in enum is never read, and a custom preset cannot be a retired built-in id'],
  // --- learner-context-service persistence. These write the learner's OWN
  // stored target into their OWN private record (baseline keying, attempt
  // history). Resolving there would REWRITE user data, which the standing
  // decision forbids; they select no coaching content, and everything that
  // turns a stored target into content or prompt text is swept above. ---
  ['learner-context-service@service.recordVoiceAttempt', 'persists the learner\'s own stored target verbatim into their attempt history (baseline keying); selects no content, and resolving it would rewrite user data'],
  ['learner-context-service@service.setActiveVoiceTarget', 'persists the target binding verbatim; same user-data rule as recordVoiceAttempt'],
  ['learner-context-service@service.getVoiceStudentModelSnapshot', 'reads back the persisted binding verbatim; the coach-facing surface derived from it is coaching/signal-builder.buildLearnerMemo, swept above'],
  ['learner-context-service@service.resetLearnerMemory', 'preserves the exact stored preset across a reset by contract (pinned by learner-context-runtime-control.test.js); selects no content'],
  ['voice-session-state@runtime.buildVoiceSessionSummary', 'renders the learner\'s own stored preset into their session TITLE; it is their data, not coaching content, and it reaches no prompt'],
  ['voice-session-state@runtime.normalizeVoiceAttemptArtifact', 'shape normalizer; it passes the stored target through unchanged and is the reason the identity layer can still see it'],
]);

const MODULES = [
  ['voice-tutor-runtime-policy', policy],
  ['voice-cue-sheet', cueSheet],
  ['voice-drills', drills],
  ['voice-cockpit-lines', cockpit],
  ['lessons/practice-cards', cards],
  ['lessons/lesson-planner', planner],
  ['coaching/renderer-client', renderer],
  // 2026-07-27 (round 3): the guard used to stop at the seven modules above, so
  // three of the four leaks found by hand that round lived in modules it could
  // not see.
  //
  // 2026-07-27 (round 4) CORRECTION: this comment used to end "Every backend
  // module that reads a target enum is listed now." That was a completeness
  // claim the list did not support — `coaching/index` was missing, and its
  // exported `coachingTurn` reads targetPreset in its own body. Both it and
  // `coaching/sanitizer` are added below. The honest statement of what this
  // list gives is narrower, and worth stating exactly:
  //
  //   Listing a module makes its EXPORTED functions visible to the reflective
  //   coverage guard, and only when their source text literally mentions
  //   `targetPreset` or `styleTarget`. A module-private helper reached through
  //   an options object (coaching/sanitizer's `deriveDirection`) is invisible
  //   to it no matter how many modules are listed. That class is covered only
  //   by DRIVING the surface in the behavioural sweep above.
  //
  // So: do not read this list as a completeness proof. It is the guard's field
  // of view; the sweep is the actual coverage.
  ['coaching/signal-builder', signalBuilder],
  ['coaching/signal-schema', signalSchema],
  ['coaching/section-loop', sectionLoop],
  ['deeptutor-voice-adapter', deepTutorAdapter],
  ['voice-student-evaluations', studentEvaluations],
  ['learner-context-service', learnerContext],
  ['voice-target-identity', identity],
  ['voice-session-state', sessionState],
  ['voice-standalone-runtime', standaloneRuntimeModule],
  ['coaching/sanitizer', sanitizer],
  ['coaching/index', coachingIndex],
];

/**
 * The SECOND, structural half of the round-3 finding: `Object.entries(module)`
 * only ever sees a factory's NAME, never the closures it returns. Both runtime
 * factories are therefore INSTANTIATED and reflected over their returned object
 * — one level into their plain-object members, which is where the route
 * handlers (and the start-practice regression) actually live.
 *
 * Nested members that are themselves whole subsystems get their canonical
 * module name instead of a nested path, so a name means one thing everywhere.
 */
const NESTED_PREFIX_ALIASES = new Map([
  ['voiceStateRuntime', 'voice-session-state@runtime'],
  ['learnerContextService', 'learner-context-service@service'],
]);

function reflectionTargets(prefix, object) {
  const targets = [[prefix, object]];
  for (const [key, value] of Object.entries(object)) {
    const isPlainObject = Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
    if (!isPlainObject) continue;
    targets.push([NESTED_PREFIX_ALIASES.get(key) || `${prefix}.${key}`, value]);
  }
  return targets;
}

const INSTANCES = reflectionTargets('voice-standalone-runtime@runtime', gateway.runtime);

test('COVERAGE GUARD: every DRIVEN_ELSEWHERE entry names a test that still exists', () => {
  // DRIVEN_ELSEWHERE lets an export count as covered because a NAMED dedicated
  // test drives it. Nothing checked that the named test was real, so it was an
  // honour system: deleting or renaming that test would silently leave the export
  // marked covered, which is worse than a plain excuse because it reads as proof.
  const source = fs.readFileSync(__filename, 'utf8');
  for (const [exportName, testTitle] of DRIVEN_ELSEWHERE) {
    assert.ok(
      source.includes(`test('${testTitle}'`),
      `DRIVEN_ELSEWHERE says ${exportName} is covered by a test titled "${testTitle}", but no test with that title exists in this file. `
      + 'Either restore/rename the reference, or move the export to SINKS or EXCUSED — do not leave it claiming coverage it does not have.',
    );
  }
});

test('COVERAGE GUARD: every exported target-enum handler is swept or excused', () => {
  const unswept = [];
  const seen = new Set();
  for (const [scopeName, scope] of [...MODULES, ...INSTANCES]) {
    for (const [exportName, value] of Object.entries(scope)) {
      if (typeof value !== 'function') continue;
      // Reflect on the source: does this function handle a stored target enum?
      //
      // WIDENED 2026-07-29, and the reason is the whole point of this guard.
      // The original lens was /targetPreset|styleTarget/ because the retirement
      // it was built for (masculine) moved along the PRESET-ID axis. Retiring the
      // NEUTRAL presets moves along the DIRECTION axis instead — 'feminine' vs
      // 'neutral' — and a function that branches on `direction` or `lane` names
      // neither of those two tokens. So the guard was structurally blind to
      // exactly the sinks that matter next: `getCueLane` (voice-cue-sheet.js, the
      // sole selector for 13 LANE_ tables, defaulting to feminine) and
      // `buildVoiceTutorPracticeModeLines` (voice-tutor-runtime-policy.js,
      // `[direction] || .feminine`). Those are the structural analogue of the
      // nine leak sites the masculine removal took three rounds to find.
      //
      // A guard whose lens is aimed at the LAST retirement's axis is not a guard
      // for the NEXT one. Widen it before the axis moves, not after.
      if (!/targetPreset|styleTarget|presetKey|presetId|\bdirection\b|\blane\b/.test(value.toString())) continue;
      const qualified = `${scopeName}.${exportName}`;
      if (seen.has(qualified)) continue;
      seen.add(qualified);
      if (SWEPT.has(qualified) || EXCUSED.has(qualified)) continue;
      unswept.push(qualified);
    }
  }
  assert.deepEqual(
    unswept, [],
    'These exported functions handle a target enum but are neither swept by the '
    + 'behavioural sweep above nor excused with a reason. A retired target could '
    + 'reach feminizing content through them. Sweep them — do not just excuse them:\n  '
    + unswept.join('\n  '),
  );
});

test('COVERAGE GUARD: the guard can actually SEE inside the runtime factories', () => {
  // A self-check on the guard itself. If the instance reflection ever stops
  // working (a factory stops returning a plain object, a member gets renamed),
  // the coverage guard above would go quietly green while seeing nothing — the
  // exact failure mode round 3 found. These names must remain visible.
  const visible = new Set();
  for (const [scopeName, scope] of INSTANCES) {
    for (const [exportName, value] of Object.entries(scope)) {
      if (typeof value === 'function' && /targetPreset|styleTarget/.test(value.toString())) {
        visible.add(`${scopeName}.${exportName}`);
      }
    }
  }
  for (const required of [
    'voice-standalone-runtime@runtime.voiceOperationRouteHandlers.startVoiceSession',
    'voice-session-state@runtime.getVoiceStudentPresetTargets',
    'learner-context-service@service.recordVoiceAttempt',
  ]) {
    assert.ok(visible.has(required), `instance reflection lost sight of ${required}`);
  }
});

// ---------------------------------------------------------------------------
// Layer 3 — PROMPT GUARD. No built prompt may TEACH the retired direction, and
// a retired id gets no special prompt treatment.
// ---------------------------------------------------------------------------

test('PROMPT GUARD: the coach SYSTEM prompt never names or teaches the retired direction', () => {
  // This one is UNCHANGED by the scope ruling and is the load-bearing half: the
  // system prompt ships on every turn regardless of target, so a masculinizing
  // rule there would reach every learner. Naming the direction at all primes the
  // model to emit its cues, so the budget is zero matches.
  for (const withAudio of [false, true]) {
    const prompt = renderer.buildRendererSystemPrompt(withAudio);
    assert.equal(
      (prompt.match(/masculin|ftm/gi) || []).length, 0,
      `buildRendererSystemPrompt(${withAudio}) names a retired direction; naming it primes the model to emit its cues`,
    );
    // WIDENED 2026-07-29, clearing this export's lens-widening debt.
    //
    // It takes no preset, so it cannot join SINKS — preset-equivalence is vacuous
    // for a function that ignores presets. What it DOES do is emit the neutral
    // lane into every turn's system prompt in its own words: "a learner may
    // instead have a neutral (non-gendered) target" and "give a direction-neutral
    // articulator cue" (coaching/renderer-client.js:230, :247). If the neutral
    // PRESETS are removed while those lines stay, the model is still told to
    // coach a target the app no longer offers.
    //
    // This is a TRIPWIRE, not a ban: the lines are correct while neutral presets
    // exist. It fails the moment they stop existing, which is exactly when
    // someone must come back and rewrite the prompt.
    const teachesNeutralLane = /non-gendered|direction-neutral/i.test(prompt);
    // Asks EVERY preset, not one named guess. There are two neutral presets
    // ('androgynous' and 'gender-neutral'); probing only one would fire this
    // prematurely if the other were removed first, while the prompt still
    // legitimately needed its neutral lines.
    const neutralPresetsStillExist = drills.listVoiceDrillPresetKeys()
      .some((key) => policy.getVoiceTutorTargetDirection(key) === 'neutral');
    assert.equal(
      teachesNeutralLane && !neutralPresetsStillExist, false,
      'buildRendererSystemPrompt still teaches the neutral lane, but no preset resolves to direction "neutral" any more. '
      + 'Rewrite the DIRECTION CONSTRAINT lines in coaching/renderer-client.js — leaving them primes the model to coach a target the app no longer offers.',
    );
  }
});

test('PROMPT GUARD: a retired styleTarget gets no special user-message handling', () => {
  // RE-POINTED 2026-07-27. Was: "the Style line must read gender-neutral" — that
  // was the shim resolving a retired id into a live lane. With the shim gone the
  // Style line echoes whatever it was given, exactly as it does for any
  // unrecognised style.
  //
  // 2026-07-27 (round 4) CORRECTION: this note used to continue "...and a
  // corrupt target never reaches a coach turn because the analyzer rejects it at
  // session start". That was FALSE and is deleted. MEASURED on the real runtime
  // with a seeded `targetPreset: 'masculine'` session: `startVoiceSession` threw
  // 400 (the gate does work), but `getVoiceDrills` RESOLVED with 9 cute-* drills,
  // `selectVoiceDrill` RESOLVED (cute-bright-reset) and `updateVoiceCockpitLine`
  // RESOLVED with a cute-feminine line — all three with ZERO outbound analyzer
  // calls. The analyzer gate covers session START only; it is not a boundary the
  // rest of the runtime sits behind.
  //
  // What this file actually rests on is therefore NOT "the analyzer catches it":
  //   1. the WRITE GATES keep an invalid row out of the store — the JS
  //      `updateVoiceSessionPreset` enum check (WRITE GATE test below) and the
  //      analyzer's `normalize_target_preset` on session start;
  //   2. `get_target_profile` routes through `normalize_target_preset`, so every
  //      analyzer READ path (resume, live frames, finalize) fails closed too;
  //   3. and for anything that still gets a retired id in hand, EQUIVALENCE —
  //      the property this whole file pins: it is treated exactly as any other
  //      unrecognised string, with no masc-shaped branch anywhere.
  // Point 3 is the one this test asserts.
  const signalFor = (styleTarget) => buildCoachingSignal({
    mode: 'active_drill', styleTarget, direction: 'neutral', directionSource: 'target',
  });
  const control = renderer.buildRendererUserMessage(signalFor(UNKNOWN_CONTROL));
  for (const id of RETIRED_TARGETS) {
    const message = renderer.buildRendererUserMessage(signalFor(id));
    const normalized = message.split(id).join(UNKNOWN_CONTROL).split(id.trim()).join(UNKNOWN_CONTROL);
    assert.equal(
      normalized, control,
      `buildRendererUserMessage("${id}") differs from an unrecognised style beyond the echoed label`,
    );
    // Nothing beyond the echoed label may name or teach the retired direction.
    assert.doesNotMatch(normalized, RETIRED_PATTERN, `buildRendererUserMessage("${id}") generated retired content`);
  }
});
