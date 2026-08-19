'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeCoachReply } = require('./sanitizer');

function signal(overrides = {}) {
  return {
    mode: 'coaching',
    policy: {
      coachingAction: 'coach',
      shouldCorrect: true,
      avoidTopics: [],
      ...(overrides.policy || {}),
    },
    personalization: {
      preferencePolicy: {
        ids: [],
        maxSpokenWords: 45,
        maxCueCount: null,
        ...(overrides.personalization?.preferencePolicy || {}),
      },
      dueReviewFocus: overrides.personalization?.dueReviewFocus || null,
    },
    coachingDecision: overrides.coachingDecision,
    coachMove: overrides.coachMove,
    doNotSay: overrides.doNotSay || [],
  };
}

test('post-filter core-loop repair never speaks imported unsafe cue wording', () => {
  const reply = sanitizeCoachReply('Okay.', signal({
    personalization: {
      dueReviewFocus: 'squeeze your throat',
      preferencePolicy: { ids: [], maxSpokenWords: 45 },
    },
    coachingDecision: {
      recommendedDrill: { instruction: 'Squeeze your throat and force the pitch.' },
    },
    coachMove: { cue: 'Hold your larynx in place.' },
  }));

  assert.equal(reply, 'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins.');
  assert.doesNotMatch(reply, /squeeze|force (?:the|your)|hold your larynx/i);
});

test('session-control stripping does not turn BREATHER or CONVERSE into coaching', () => {
  for (const coachingAction of ['breather', 'converse']) {
    const reply = sanitizeCoachReply(
      'Take a break and come back later.',
      signal({ policy: { coachingAction, shouldCorrect: false, avoidTopics: [] } }),
    );
    assert.equal(reply, 'I’m listening.');
    assert.doesNotMatch(reply, /displayed line|next sound|practice|take a break/i);
  }
});

test('maxSpokenWords keeps only complete sentences within the canonical bound', () => {
  const reply = sanitizeCoachReply(
    'This first complete sentence has exactly eight calm spoken words. This second sentence would make the response exceed the requested limit. A third sentence must never be spoken.',
    signal({
      policy: { coachingAction: 'converse', shouldCorrect: false, avoidTopics: [] },
      personalization: {
        preferencePolicy: { ids: ['brevity'], maxSpokenWords: 12 },
      },
    }),
  );

  assert.equal(reply, 'This first complete sentence has exactly eight calm spoken words.');
  assert.ok((reply.match(/\S+/g) || []).length <= 12);
  assert.match(reply, /[.!?]$/);
});

test('canonical cue preferences remove imagery and bound the turn to one correction', () => {
  const reply = sanitizeCoachReply(
    'Imagine a balloon lifting the sound. Use a smaller vowel on the displayed line. Add more weight on the ending.',
    signal({
      personalization: {
        preferencePolicy: {
          ids: ['concrete-over-imagery', 'fewer-corrections', 'gentle-tone'],
          maxSpokenWords: 24,
          maxCueCount: 1,
        },
      },
    }),
  );

  assert.doesNotMatch(reply, /imagine|balloon|displayed line/i);
  assert.match(reply, /I hear you|gently/i);
  // 2026-07-28: "Use a smaller vowel" names no body action, so the cue-shape law
  // (which the APP_SURFACE 'displayed' exemption used to shield — the hole is
  // closed) eats it and the turn substitutes the code-owned plain cue. One
  // actionable cue, no jargon, inside the word bound.
  assert.match(reply, /practice sentence/i);
  const sentences = reply.match(/[^.!?]+[.!?]+/g) || [];
  assert.ok(sentences.length <= 2, `expected the one-correction bound, got: ${reply}`);
});
