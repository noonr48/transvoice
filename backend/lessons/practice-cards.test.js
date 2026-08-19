'use strict';

// Direction-aware focus statements (2026-07-19): buildFocusStatement used to
// hardcode the feminine lane for every preset — a masculine-target card carried
// "tongue sides on the upper back teeth". These tests pin the focus-statement
// matrix and prove the preset flows through every card creation path.
//
// 2026-07-30 MTF-ONLY: `androgynous` and `gender-neutral` were removed, so
// `resolveTargetDirection` can no longer return anything but 'feminine' and the
// matrix is 4 axes x 1 direction. That has a consequence worth stating plainly,
// because it decided how the tests below were repaired: the focus STATEMENT can
// no longer witness targetPreset threading at all — every preset now yields the
// same statement, so a version of those tests written against statements would
// pass even if createCard dropped the preset entirely. They are re-pointed to the
// card's TOKENS, which still differ per preset (4 distinct token signatures
// across the 5 live presets), so they can still fail. Each change is annotated at
// its site with what the deleted assertions used to prove.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PracticeCardStore,
  createCard,
  buildFocus,
  buildCardTokens,
  CARD_FOCUS_AXES,
} = require('./practice-cards');
const { PRESET_PROFILES } = require('../voice-cue-sheet');

// One representative preset per surviving direction lane. The 'neutral' entry
// ('gender-neutral') was DELETED 2026-07-30 with the preset itself.
const PRESET_BY_DIRECTION = {
  feminine: 'cute-feminine',
};

// The full expected matrix — feminine keeps the original statements verbatim.
//
// DELETED 2026-07-30 — the whole `neutral` lane of this table:
//   pitch:     'Today: keep the pitch resting in the middle — comfortable and steady'
//   resonance: 'Today: keep the resonance centered — even and clear'
//   weight:    'Today: keep the weight balanced — steady, never pressed'
//   prosody:   'Today: let the phrase move naturally and land level'
// It proved a neutral-target card spoke in the balanced/centered register instead
// of carrying a feminine cue. `androgynous` and `gender-neutral` were removed from
// PRESET_PROFILES, so no preset resolves to the neutral lane and no call can reach
// those four statements. (They are still PRESENT but unreachable in
// FOCUS_STATEMENTS_BY_DIRECTION.neutral in practice-cards.js — dead source, not
// touched here.) They are NOT re-pointed to a feminine preset: the assertions
// exist to prove the two registers DIFFER, and there is only one register left.
const EXPECTED_STATEMENTS = {
  feminine: {
    pitch: 'Today: keep the pitch settled and steady',
    // 2026-07-27 cue-vocabulary law: were 'Today: keep the brightness forward'
    // and 'Today: keep the voice light and easy'. Both were quality-only
    // statements — MEASURED, the first fires CUE_VOCABULARY_RULES `quality_noun`
    // and the second `quality_before_sound`. The replacements name a body part
    // and the check that reads it (spec §3 signals 1 and 3).
    resonance: 'Today: tongue sides on the upper back teeth',
    weight: 'Today: make the buzz under your palm weaker, not quieter',
    prosody: 'Today: let the phrase lift and stay alive',
  },
};

test('buildFocus covers the full 4-axis statement matrix for every live direction', () => {
  for (const [direction, targetPreset] of Object.entries(PRESET_BY_DIRECTION)) {
    for (const axis of CARD_FOCUS_AXES) {
      const focus = buildFocus({ axis, targetPreset });
      assert.equal(
        focus.statement,
        EXPECTED_STATEMENTS[direction][axis],
        `${direction}/${axis} statement`,
      );
      assert.equal(focus.axis, axis);
    }
  }
  // The matrix must cover every direction a live preset can actually resolve to —
  // derived, so adding a direction back to PRESET_PROFILES without adding its
  // statements here fails instead of silently falling through to feminine.
  const liveDirections = [...new Set(Object.values(PRESET_PROFILES).map((p) => p.direction))].sort();
  assert.deepEqual(liveDirections, Object.keys(EXPECTED_STATEMENTS).sort());
  // ...and every axis is covered for each of them, so a missing entry cannot read
  // as a pass via `undefined === undefined`.
  for (const lane of Object.values(EXPECTED_STATEMENTS)) {
    assert.deepEqual(Object.keys(lane).sort(), [...CARD_FOCUS_AXES].sort());
  }
});

test('every canonical preset resolves to its profile direction lane', () => {
  for (const [preset, profile] of Object.entries(PRESET_PROFILES)) {
    const focus = buildFocus({ axis: 'resonance', targetPreset: preset });
    assert.equal(
      focus.statement,
      EXPECTED_STATEMENTS[profile.direction].resonance,
      `${preset} resonance statement follows direction '${profile.direction}'`,
    );
  }
});

test('unknown or missing preset falls back to the feminine lane (legacy default)', () => {
  assert.equal(
    buildFocus({ axis: 'resonance', targetPreset: 'mystery-voice' }).statement,
    EXPECTED_STATEMENTS.feminine.resonance,
  );
  assert.equal(
    buildFocus({ axis: 'weight' }).statement,
    EXPECTED_STATEMENTS.feminine.weight,
  );
});

test('free-text focus and explicit statements still win over the matrix', () => {
  // The preset here is incidental — it only has to resolve to SOME lane so that
  // the override is proven to beat the lane lookup. (2026-07-30: was
  // 'gender-neutral'; re-pointed to a live preset.)
  const fromFocusText = buildFocus({ axis: 'resonance', focusText: 'settle the second word', targetPreset: 'soft-feminine' });
  assert.equal(fromFocusText.statement, 'Today: settle the second word');

  const explicit = buildFocus({ axis: 'pitch', statement: 'one easy pass', targetPreset: 'soft-feminine' });
  assert.equal(explicit.statement, 'Today: one easy pass');
});

// RE-POINTED 2026-07-30, from the focus STATEMENT to the card's TOKENS.
//
// DELETED — the three statement assertions this test used to carry:
//   createCard({... targetPreset: 'gender-neutral', focus: { axis: 'resonance' }})
//     .focus.statement === 'Today: keep the resonance centered — even and clear'
//   createCard({... targetPreset: 'androgynous',    focus: { axis: 'prosody'   }})
//     .focus.statement === 'Today: let the phrase move naturally and land level'
//   createCard({... no targetPreset }).focus.statement === the feminine resonance line
// Together they proved createCard forwards targetPreset far enough to select the
// statement LANE, using a neutral preset as the witness.
//
// WHY NOT JUST SWAP IN A FEMININE PRESET. Because that version could not fail.
// With one direction left, every preset yields the identical statement, so the
// assertion would hold even if createCard dropped targetPreset on the floor —
// which is precisely the regression the test exists to catch. The threading
// CONTRACT is still live and still worth guarding, so it is asserted against the
// observable that still varies: card tokens (4 distinct signatures across the 5
// live presets). Verified to fail when the preset is not forwarded.
test('createCard threads targetPreset into the card it builds', () => {
  const phrase = 'that sounds good to me';
  const presets = Object.keys(PRESET_PROFILES);

  // 1. The preset ARRIVES: each card's tokens match what the token builder
  //    produces for that same preset directly.
  for (const targetPreset of presets) {
    const card = createCard({ phrase, focus: { axis: 'resonance' }, targetPreset });
    assert.deepEqual(
      card.tokens,
      buildCardTokens(phrase, { targetPreset }),
      `${targetPreset} tokens do not match the token builder's output for that preset`,
    );
  }

  // 2. ...and it MATTERS: the presets do not all produce the same card, so step 1
  //    cannot be satisfied by a builder that ignores its argument.
  const signatures = new Set(
    presets.map((targetPreset) => JSON.stringify(
      createCard({ phrase, focus: { axis: 'resonance' }, targetPreset }).tokens,
    )),
  );
  assert.ok(
    signatures.size > 1,
    `every live preset produced an identical card (${signatures.size} signature) — `
    + 'targetPreset is no longer observable, so this test can no longer prove threading',
  );

  // 3. The default preset still behaves as the legacy feminine one.
  const legacy = createCard({ phrase: 'could you say that again?', focus: { axis: 'resonance' } });
  assert.equal(legacy.focus.statement, EXPECTED_STATEMENTS.feminine.resonance);
  assert.deepEqual(
    legacy.tokens,
    buildCardTokens('could you say that again?', { targetPreset: 'cute-feminine' }),
  );
});

// RE-POINTED 2026-07-30, same reason as above.
//
// DELETED — the statement assertion this test used to carry:
//   applyCardOps('session-direction', [{ op: 'create', ... focus: { axis: 'resonance' }}],
//     { targetPreset: 'gender-neutral' }).card.focus.statement
//       === 'Today: keep the resonance centered — even and clear'
// It proved the ops path reads `context.targetPreset` and passes it into the
// statement lane — a separate entry point from createCard, which is why it has its
// own test. The neutral preset was the witness; with one lane left the statement
// is identical for every preset, so the witness is now the card's tokens.
test('applyCardOps create honors context.targetPreset', () => {
  const phrase = 'what time works for you?';
  const ops = [{ op: 'create', phrase, focus: { axis: 'resonance' } }];
  const cardFor = (targetPreset) => {
    const store = new PracticeCardStore();
    const { card } = store.applyCardOps(`session-${targetPreset}`, ops, { targetPreset });
    assert.ok(card, `${targetPreset} produced no card`);
    return card;
  };

  // The context preset reaches the builder for every live preset...
  for (const targetPreset of Object.keys(PRESET_PROFILES)) {
    assert.deepEqual(
      cardFor(targetPreset).tokens,
      buildCardTokens(phrase, { targetPreset }),
      `context.targetPreset=${targetPreset} did not reach the token builder`,
    );
  }
  // ...and dropping it is observable. Asserted over the WHOLE preset set rather
  // than a hand-picked pair: two presets can legitimately agree on one phrase
  // (cute-feminine and everyday-feminine both read this one as a curious
  // check-in), so a fixed pair would make the test brittle for a reason that has
  // nothing to do with threading.
  const signatures = new Set(
    Object.keys(PRESET_PROFILES).map((targetPreset) => JSON.stringify(cardFor(targetPreset).tokens)),
  );
  assert.ok(
    signatures.size > 1,
    `every live preset produced an identical card through the ops path (${signatures.size} signature) — `
    + 'context.targetPreset is no longer observable, so this test can no longer prove threading',
  );
});

// RE-POINTED 2026-07-30. This test was NOT in the failing set — it was passing
// VACUOUSLY, which is worse, so it is repaired here rather than left as coverage
// that cannot fail. It ran `nextFallbackCard(..., { targetPreset: 'gender-neutral' })`
// and then:
//   - guarded the lane check behind `if (!card.focus.direction)`, and fallback
//     drills ALWAYS carry free-text focus, so that branch never executed;
//   - asserted `!statement.includes('brightness forward')` — a string deleted from
//     the codebase by the 2026-07-27 cue-vocabulary rewrite, so it could not appear.
// Net effect: after the preset was removed the test still passed while asserting
// nothing at all. What it MEANT to prove — a fallback card is built for the
// learner's own preset, not a substituted one — is still live and is asserted
// directly below, against the observable that varies.
test('fallback cards are built for their own preset', () => {
  const phrase = (card) => card.tokens.map((token) => token.text).join(' ');
  const cardFor = (targetPreset) => {
    const store = new PracticeCardStore();
    const card = store.nextFallbackCard(`fallback-${targetPreset}`, { targetPreset });
    assert.ok(card, `${targetPreset} produced no fallback card`);
    return card;
  };

  // Each preset's fallback card is the one its OWN drill pack authored: the
  // card's tokens match the token builder for that preset and that phrase.
  for (const targetPreset of Object.keys(PRESET_PROFILES)) {
    const card = cardFor(targetPreset);
    assert.deepEqual(
      card.tokens,
      buildCardTokens(phrase(card), { targetPreset, focusText: card.focus.direction }),
      `${targetPreset} fallback card was not built with its own preset`,
    );
    assert.ok(card.focus.statement.startsWith('Today: '), `${targetPreset} statement shape`);
  }

  // And the preset genuinely changes the fallback: a store handed two different
  // presets must not return the same card. This is what fails if the preset is
  // dropped and every learner is quietly served the default pack.
  assert.notEqual(
    cardFor('cute-feminine').focus.statement,
    cardFor('soft-feminine').focus.statement,
    'two presets returned the same fallback focus — the preset is not being read',
  );
});

test('no statement in the matrix uses gamification or alarm vocabulary', () => {
  const banned = /\b(streak|score|points|badge|level up|fail|wrong)\b/i;
  for (const lane of Object.values(EXPECTED_STATEMENTS)) {
    for (const statement of Object.values(lane)) {
      assert.ok(!banned.test(statement), `calm copy: "${statement}"`);
      assert.ok(statement.startsWith('Today: '), `statement shape: "${statement}"`);
      assert.ok(statement.length <= 120, `statement length: "${statement}"`);
    }
  }
});
