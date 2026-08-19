'use strict';

// 2026-07-19 zero-friction wave: renderer prompt rules for sessionScope
// (quiet/silent tier + eyesFree echo-first), takeKind + kindMetrics lines with
// the siren honest-ceiling note, per-kind targetFit suppression, the per-rep
// complete-reaction rule, and the deterministic per-take fallback templates.
// Owner laws asserted on EVERY new prompt/template string: TIME-BLIND (no
// minutes/timer/duration words), zero props, no plan-progress, no "one more"
// pressure in templates. Prediction: all assertions pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildRendererSystemPrompt, buildRendererUserMessage } = require('./renderer-client');
const { buildCoachingSignal } = require('./signal-schema');
const {
  buildFallbackReply,
  buildPerTakeFallback,
  QUIET_SCOPE_FALLBACK,
  SILENT_SCOPE_FALLBACK,
} = require('./index');

const TIME_WORDS = /\b(minutes?|mins?|seconds?|secs?|hours?|timers?|countdown|clock|stopwatch|duration|time left|time's up|out of time|how long)\b/i;
const PROP_WORDS = /\b(straws?|pencils?|spoons?|candles?|tissues?|mirrors?|balloons?|kazoos?|cup of)\b/i;
const PLAN_PROGRESS = /\b(next we have to|we still need|next up we|remaining (?:points?|items?|steps?|drills?)|left to do|plan progress|off the plan|check(?:ing)? off)\b/i;
const ONE_MORE_PRESSURE = /\b(one more\?|just one more)\b/i;

function v2Signal(overrides = {}) {
  return buildCoachingSignal(overrides);
}

test('coach renderer has a fixed no-scroll response budget', () => {
  const prompt = buildRendererSystemPrompt(false);
  assert.match(prompt, /maximum of two sentences and 45 spoken words/i);
  assert.match(prompt, /never end mid-sentence/i);
  assert.match(prompt, /short clauses and clear punctuation for audible pauses/i);
  assert.match(prompt, /key technique word.*stress it naturally/i);
});

test('quiet tier -> hums/soft-onset directive + the acknowledgment line is offered', () => {
  const um = buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'quiet' } }));
  assert.match(um, /Scope: QUIET/);
  assert.match(um, /hums/i);
  assert.match(um, /Quiet works\. Humming and listening carry the same practice\./);
});

test('silent tier -> listening/planning register + its acknowledgment line', () => {
  const um = buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'silent' } }));
  assert.match(um, /Scope: SILENT/);
  assert.match(um, /Just listening is a real session\. I'll play; you judge by ear\./);
  assert.match(um, /no repeat-after-me/i);
});

test('full tier -> no scope directive; eyesFree -> echo-first rule', () => {
  const full = buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'full' } }));
  assert.doesNotMatch(full, /Scope: (QUIET|SILENT)/);
  assert.doesNotMatch(full, /EyesFree:/);

  const eyesFree = buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'full', eyesFree: true } }));
  assert.match(eyesFree, /EyesFree:/);
  assert.match(eyesFree, /repeat after you/i);            // coach says the phrase first
  assert.match(eyesFree, /8 words or fewer/);             // short phrases
  assert.match(eyesFree, /Never tell them to read/i);     // never instruct reading the screen
});

test('takeKind + kindMetrics lines; siren ceiling note is honest and conditional', () => {
  const flagged = buildRendererUserMessage(v2Signal({
    takeKind: 'siren',
    kindMetrics: { rangeSt: 14.2, glideSmoothness: 0.81, hitPitchCeiling: true, topNoteStrainFlag: false },
  }));
  assert.match(flagged, /TakeKind: siren/);
  assert.match(flagged, /range=14\.2st/);
  assert.match(flagged, /glide=0\.81/);
  assert.match(flagged, /KindNote: they touched the top of their pitch range/);
  assert.match(flagged, /never under-report/i);

  const unflagged = buildRendererUserMessage(v2Signal({
    takeKind: 'siren',
    kindMetrics: { rangeSt: 9.1, glideSmoothness: 0.6, hitPitchCeiling: false, topNoteStrainFlag: false },
  }));
  assert.doesNotMatch(unflagged, /KindNote: they touched/);

  // phrase stays compact: no TakeKind line at all
  const phrase = buildRendererUserMessage(v2Signal({ takeKind: 'phrase' }));
  assert.doesNotMatch(phrase, /TakeKind:/);
});

test('per-kind targetFit suppression: hum has no resonance line, trill no "unstable", silent kinds no targetFit', () => {
  const targetFit = {
    pitch: { status: 'unstable', medianHz: 180 },
    resonance: { status: 'too_dark', evidence: 'Resonance 48% — target 60%, could be more forward.' },
    weight: { status: 'target', evidence: 'Voice weight 40% in target zone.' },
  };
  const hum = buildRendererUserMessage(v2Signal({ takeKind: 'hum_sovt', targetFit }));
  assert.doesNotMatch(hum, /Resonance: too_dark/);
  assert.match(hum, /Weight: target/); // weight stays — only the lying read is hidden

  const trill = buildRendererUserMessage(v2Signal({ takeKind: 'trill', targetFit }));
  assert.doesNotMatch(trill, /pitch=unstable/);

  const ear = buildRendererUserMessage(v2Signal({ takeKind: 'ear_training', targetFit }));
  assert.doesNotMatch(ear, /TargetFit:/);
  const silent = buildRendererUserMessage(v2Signal({ takeKind: 'silent', targetFit }));
  assert.doesNotMatch(silent, /TargetFit:/);

  // a phrase take keeps every line (no over-suppression)
  const phrase = buildRendererUserMessage(v2Signal({ takeKind: 'phrase', targetFit }));
  assert.match(phrase, /Resonance: too_dark/);
  assert.match(phrase, /pitch=unstable/);
});

test('system prompt locks voice-only entry and learner-owned session lifetime', () => {
  const sp = buildRendererSystemPrompt(false);
  assert.match(sp, /complete in itself/i);
  assert.match(sp, /not a text chat or messaging exchange/i);
  assert.match(sp, /learner alone controls session Start\/Stop/i);
  assert.match(sp, /Never recommend stopping/i);
  assert.match(sp, /No session-management closure or padding/i);
  assert.match(sp, /emotional acknowledgment is at most one short clause/i);
  assert.match(sp, /Without usable evidence, make no performance claim/i);
  assert.match(sp, /Never pressure the learner with counting language/i);
  assert.match(sp, /Never reference remaining plan items or plan progress/i);
});

test('canonical learner preferences become explicit renderer constraints', () => {
  const signal = v2Signal({
    personalization: {
      preferredTone: 'direct, concise, respectful',
      preferencePolicy: {
        ids: ['slower-pace', 'direct-feedback', 'fewer-corrections'],
        pacing: 'slow',
        maxSpokenWords: 24,
        correctionDensity: 'minimal',
        cueStyle: 'concrete-physical',
      },
      dueReviewFocus: 'vocal weight',
    },
  });
  const rendered = buildRendererUserMessage(signal);
  assert.match(rendered, /Tone: direct, concise, respectful/);
  assert.match(rendered, /PreferencePolicy: max 24 spoken words; slow pacing; minimal correction density; concrete-physical cues/);
  assert.match(rendered, /shorter clauses and extra punctuation/i);
  assert.match(rendered, /literal articulator instructions only \(tongue, lips, jaw, soft palate\); no imagery or metaphor/i);
  assert.match(rendered, /be direct, blunt, concise, and respectful/i);
  assert.match(rendered, /no more than one correction/i);
  assert.match(rendered, /Scheduled review focus: how heavy or rumbly the sound is\./);
});

test('due review applies to coaching actions but never bulldozes a breather or conversation', () => {
  for (const coachingAction of ['coach', 'gentle', 'adapt']) {
    const rendered = buildRendererUserMessage(v2Signal({
      policy: { coachingAction, shouldCorrect: true },
      personalization: { dueReviewFocus: 'intonation variety' },
    }));
    assert.match(rendered, /Scheduled review focus: the melody of the sentence\./, coachingAction);
  }
  for (const coachingAction of ['breather', 'converse']) {
    const rendered = buildRendererUserMessage(v2Signal({
      policy: { coachingAction, shouldCorrect: false },
      personalization: { dueReviewFocus: 'intonation variety' },
    }));
    assert.doesNotMatch(rendered, /Scheduled review focus:/, coachingAction);
  }
});

test('deterministic per-take fallbacks stay inside the core loop; scope registers honored', () => {
  const coach = v2Signal({ coachMove: { intent: 'single_actionable_cue', cue: 'Keep the tail of the phrase lifted.' } });
  const reply = buildFallbackReply(coach);
  assert.equal(reply, 'Keep the tail of the phrase lifted.');
  assert.doesNotMatch(reply, /\b(?:stop|rest|break|come back)\b/i);

  // silent session: never a spoken drill cue
  const silent = v2Signal({ sessionScope: { tier: 'silent' }, coachMove: { intent: 'single_actionable_cue', cue: 'Say it brighter.' } });
  assert.equal(buildFallbackReply(silent), SILENT_SCOPE_FALLBACK);

  // quiet session with no cue: the quiet acknowledgment
  const quiet = v2Signal({ sessionScope: { tier: 'quiet' } });
  quiet.coachMove.cue = '';
  assert.equal(buildFallbackReply(quiet), QUIET_SCOPE_FALLBACK);

  // cue-less coach turn is complete without session-management padding
  const bare = buildPerTakeFallback(v2Signal());
  assert.equal(bare, 'Open the first word with a loose jaw and easy lips, and keep that same shape for the rest of the sentence.');
});

test('owner laws over every NEW prompt/template string: time-blind, prop-free; templates carry no plan-progress or pressure', () => {
  // Prompt surfaces (system rules + scope/kind directives as rendered)
  const promptSurfaces = [
    buildRendererSystemPrompt(false),
    buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'quiet', eyesFree: true } })),
    buildRendererUserMessage(v2Signal({ sessionScope: { tier: 'silent' } })),
    buildRendererUserMessage(v2Signal({
      takeKind: 'siren',
      kindMetrics: { rangeSt: 14.2, hitPitchCeiling: true, topNoteStrainFlag: true },
    })),
  ];
  for (const surface of promptSurfaces) {
    assert.doesNotMatch(surface, TIME_WORDS, `time word in prompt surface: ${surface.slice(0, 120)}`);
    assert.doesNotMatch(surface, PROP_WORDS, `prop word in prompt surface: ${surface.slice(0, 120)}`);
  }

  // Deterministic templates: the full law set (incl. plan-progress + pressure)
  const templates = [
    QUIET_SCOPE_FALLBACK,
    SILENT_SCOPE_FALLBACK,
    buildPerTakeFallback(v2Signal()),
    buildFallbackReply(v2Signal({ coachMove: { intent: 'single_actionable_cue', cue: 'Bring the sound forward.' } })),
    buildFallbackReply(v2Signal({ sessionScope: { tier: 'silent' } })),
  ];
  for (const t of templates) {
    assert.doesNotMatch(t, TIME_WORDS, `time word in template: ${t}`);
    assert.doesNotMatch(t, PROP_WORDS, `prop word in template: ${t}`);
    assert.doesNotMatch(t, PLAN_PROGRESS, `plan-progress in template: ${t}`);
    assert.doesNotMatch(t, ONE_MORE_PRESSURE, `pressure in template: ${t}`);
  }
});
