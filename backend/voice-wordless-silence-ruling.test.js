'use strict';

// OWNER RULING 2026-07-27 — "too quiet to measure" is NOT "no sound at all".
//
// A learner who selects a hum drill and makes a sound gets answered. That is
// the whole point of the wordless acknowledgment, and the failure it exists to
// prevent is the one the owner hit in the field: hum, hum again, and the tutor
// never speaks. So a take that is merely UNSCORABLE — real voicing, just under
// the evidence bar — must still earn the heard-only line.
//
// The narrow case that was a fabrication: the analyzer proves NO SIGNAL ARRIVED
// and the coach says "Heard the hum" anyway. Defensible only while the take leg
// never ran and there was no measurement to consult; now there is one, and the
// house law is explicit — only the ANALYZER may confirm a sound.
//
// `no_voiced_frames` ALONE IS NOT THAT PROOF, and an earlier version of this
// file said it was. The flag means "no frame cleared the voicing detector"
// (audio_analysis.py:2173 needs rms >= ~0.012, about -38.4 dBFS), not "nothing
// arrived": MEASURED on a clean 200 Hz hum, -37.8 dBFS is fully voiced while
// -38.6 dBFS emits a flag list byte-identical to digital silence. Gating on the
// flag alone therefore SHIPPED and silenced real quiet hums. Loudness is the
// separator — -38.64 dB for that hum against -100 for silence — so suppression
// now requires the flag AND loudness at the analyzer's own no-signal floor.
//
// These tests pin all three outcomes so a future change cannot quietly collapse
// the distinction in EITHER direction: re-introducing the fabrication, or
// over-suppressing back into the silence bug.
//
// Driven directly rather than through the live-turn harness: that harness stubs
// the analyzer offline (`fetchImpl` throws), so "the analyzer ran and returned
// zero voicing" is not expressible through it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveWordlessPracticeAcknowledgement } = require('./voice-standalone-runtime.js');

function humSession() {
  return {
    voiceState: {
      lessonId: 'cute-hum-sovt',
      practiceMode: 'vocalise',
      activeDrill: { id: 'cute-hum-sovt', kind: 'hum_sovt' },
    },
  };
}

// THE FIXTURE SHAPE IS ITSELF UNDER TEST.
//
// The first version of this file put `reliabilityFlags` at the TOP LEVEL of the
// artifact. That is not where a real take carries them: readAdvancedMetrics
// (voice-measurement-validity.js:38-47) resolves `value.metrics.advanced` first,
// then `value.advanced`, and only then the object itself. Because the guard read
// the top level too, fixture and code agreed on a shape the DSP never produces —
// so every case passed while the guard was INERT in the field.
//
// So the fixture now nests flags exactly where the analyzer puts them, and a
// dedicated case below pins that nesting. If someone "simplifies" the fixture
// back to a flat shape, that case fails.
function take({ outcome = 'analyzed', hasMetrics = false, flags = [], peakLoudnessDb = -20 } = {}) {
  const artifact = {
    metrics: {
      advanced: {
        reliabilityFlags: flags,
        // Loudness is the field that separates "too quiet for the voicing
        // detector" from "nothing arrived". Defaults to a clearly-audible -20
        // so a case must OPT IN to silence rather than inherit it.
        peakLoudnessDb,
        meanLoudnessDb: peakLoudnessDb,
      },
    },
  };
  return {
    outcome,
    hasMetrics,
    takeKind: 'hum_sovt',
    takeKindSource: 'drill',
    attemptArtifactId: 'attempt-fixture',
    summary: artifact,
    attemptArtifact: artifact,
  };
}

test('wordless acknowledgment vs the analyzer verdict', async (t) => {
  await t.test('a REAL, measured hum is acknowledged', () => {
    const ack = resolveWordlessPracticeAcknowledgement(
      humSession(),
      take({ hasMetrics: true, flags: [] }),
    );
    assert.ok(ack, 'a measured hum must be answered');
    assert.equal(ack.takeKind, 'hum_sovt');
    assert.ok(ack.line, 'it carries a spoken line');
  });

  await t.test('a FAINT hum — real voicing, under the evidence bar — is STILL acknowledged', () => {
    // This is the case the earlier decision protects, and the case blanket
    // suppression would have broken. `low_voiced_coverage` means the analyzer
    // heard something and could not score it — NOT that nothing was made.
    const ack = resolveWordlessPracticeAcknowledgement(
      humSession(),
      take({ hasMetrics: false, flags: ['low_voiced_coverage'] }),
    );
    assert.ok(ack, 'a sound too quiet to score must not be met with silence');
    assert.equal(ack.ackBasis, 'drill_kind', 'the learner\'s own drill choice is the warrant');
  });

  await t.test('DIGITAL SILENCE is not acknowledged — the fabrication this ruling removes', () => {
    const ack = resolveWordlessPracticeAcknowledgement(
      humSession(),
      take({ hasMetrics: false, flags: ['no_voiced_frames'], peakLoudnessDb: -100 }),
    );
    assert.equal(ack, null, 'the coach must not claim to have heard what the analyzer proved absent');
  });

  await t.test('a QUIET HUM that trips no_voiced_frames is STILL answered — the shipped regression', () => {
    // THE DEFECT THIS PINS, measured against the real DSP by review:
    //   -37.8 dBFS -> voicedPct 1.0, flags ['quiet_input']
    //   -38.6 dBFS -> voicedPct 0.0, flags ['no_voiced_frames','low_voiced_coverage',
    //                 'low_confidence','low_score_confidence','quiet_input']
    // A 0.8 dB drop on a CLEAN 200 Hz hum, and the flag list becomes BYTE-IDENTICAL
    // to digital silence. `no_voiced_frames` means "no frame cleared the voicing
    // detector" (audio_analysis.py:2173 needs rms >= ~0.012), NOT "no sound".
    // Gating on the flag alone shipped and silenced real quiet hums in the field.
    // Loudness is what separates them: -38.6 here vs -100 for true silence.
    const ack = resolveWordlessPracticeAcknowledgement(
      humSession(),
      take({
        hasMetrics: false,
        flags: ['no_voiced_frames', 'low_voiced_coverage', 'low_confidence', 'low_score_confidence', 'quiet_input'],
        peakLoudnessDb: -38.64,
      }),
    );
    assert.ok(ack, 'a real hum under the voicing bar must NOT be met with silence');
    assert.equal(ack.ackBasis, 'drill_kind');
  });

  await t.test('missing loudness is not proof of silence — an unreported field never suppresses', () => {
    const artifact = { metrics: { advanced: { reliabilityFlags: ['no_voiced_frames'] } } };
    const ack = resolveWordlessPracticeAcknowledgement(humSession(), {
      outcome: 'analyzed',
      hasMetrics: false,
      takeKind: 'hum_sovt',
      takeKindSource: 'drill',
      summary: artifact,
      attemptArtifact: artifact,
    });
    assert.ok(ack, 'absent evidence must not be read as evidence of absence');
  });

  await t.test('an analyzer that never answered still yields the heard-only line', () => {
    // Absence of evidence is not evidence of absence. A timeout says nothing
    // about whether the learner made a sound, so the drill-choice warrant
    // stands exactly as it did before this ruling.
    const ack = resolveWordlessPracticeAcknowledgement(
      humSession(),
      take({ outcome: 'timeout', hasMetrics: false, flags: [] }),
    );
    assert.ok(ack, 'an unavailable analyzer must not silence a genuine attempt');
  });

  await t.test('no take at all still yields the heard-only line', () => {
    const ack = resolveWordlessPracticeAcknowledgement(humSession(), null);
    assert.ok(ack, 'the pre-take-leg behavior is unchanged when nothing was measured');
  });

  await t.test('the flags are read where the ANALYZER puts them, not off the top level', () => {
    // Regression pin for the defect that made the first version of this guard
    // inert: it read `summary.reliabilityFlags`, a path a real take never has.
    // Nested (the real shape) must suppress; flat (the shape I wrongly assumed)
    // must ALSO suppress, because resolveVoiceMeasurementUsability falls back to
    // the object itself. If a future edit reads only one of these, one of these
    // two assertions fails.
    // Loudness is held at the silence floor in BOTH shapes so this case isolates
    // the one thing it exists to test — where the flags are read from — rather
    // than re-testing the loudness gate.
    const silent = { reliabilityFlags: ['no_voiced_frames'], peakLoudnessDb: -100, meanLoudnessDb: -100 };

    const nested = resolveWordlessPracticeAcknowledgement(humSession(), {
      outcome: 'analyzed',
      hasMetrics: false,
      takeKind: 'hum_sovt',
      takeKindSource: 'drill',
      attemptArtifact: { metrics: { advanced: silent } },
    });
    assert.equal(nested, null, 'metrics.advanced.reliabilityFlags — the real DSP shape — must be read');

    const flat = resolveWordlessPracticeAcknowledgement(humSession(), {
      outcome: 'analyzed',
      hasMetrics: false,
      takeKind: 'hum_sovt',
      takeKindSource: 'drill',
      attemptArtifact: silent,
    });
    assert.equal(flat, null, 'the bare-advanced-object fallback must be honoured too');
  });
});
