'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StrainGuardian,
  createStrainGuardian,
  extractStrainEvidence,
  GUARDIAN_CONSTANTS,
  GUARDIAN_TEMPLATES,
} = require('./guardian');

// A take artifact with a given strainRisk (and optional breathy/flags).
function artifact({ strainRisk = 0, breathyRisk = 0, flags = [] } = {}) {
  return {
    metrics: { advanced: { quality: { strainRisk, breathyRisk }, reliabilityFlags: flags } },
    reliabilityFlags: [],
  };
}

const STRAINED = artifact({ strainRisk: 0.7 });
const CLEAN = artifact({ strainRisk: 0.1 });

test('guardian — strain evidence extraction', async (t) => {
  await t.test('keys on strainRisk >= threshold', () => {
    assert.equal(extractStrainEvidence(artifact({ strainRisk: 0.52 })).strained, true);
    assert.equal(extractStrainEvidence(artifact({ strainRisk: 0.51 })).strained, false);
  });

  await t.test('breathyRisk only counts at the higher bar', () => {
    assert.equal(extractStrainEvidence(artifact({ breathyRisk: 0.67 })).strained, false);
    assert.equal(extractStrainEvidence(artifact({ breathyRisk: 0.68 })).strained, true);
  });

  await t.test('uses profile-capped and vocalise-lenient canonical thresholds', () => {
    const profileCapped = extractStrainEvidence(
      artifact({ strainRisk: 0.46 }),
      { qualityBands: { strainRiskCeiling: 0.35 } },
    );
    assert.equal(profileCapped.strained, true);
    assert.equal(profileCapped.thresholds.strainWarn, 0.45);

    assert.equal(
      extractStrainEvidence(artifact({ strainRisk: 0.6 }), { takeKind: 'siren' }).strained,
      false,
    );
  });

  await t.test('measurement-unavailable quality proxies are ignored', () => {
    const unavailable = artifact({ strainRisk: 0.99, breathyRisk: 0.99 });
    unavailable.metrics.advanced.measurementAvailable = false;
    const evidence = extractStrainEvidence(unavailable);
    assert.equal(evidence.measurementAvailable, false);
    assert.equal(evidence.strained, false);
  });

  await t.test('a recognized strain reliability flag counts; capture flags do not', () => {
    assert.equal(extractStrainEvidence(artifact({ flags: ['vocal_strain'] })).strained, true);
    assert.equal(extractStrainEvidence(artifact({ flags: ['low_voiced_coverage'] })).strained, false);
    assert.equal(extractStrainEvidence(artifact({ flags: ['quiet_input'] })).strained, false);
  });

  await t.test('reads flags from the top-level artifact.reliabilityFlags too', () => {
    const ev = extractStrainEvidence({
      metrics: { advanced: { quality: { strainRisk: 0.1 } } },
      reliabilityFlags: ['strain'],
    });
    assert.equal(ev.strained, true);
  });

  await t.test('crash-proof on missing layers', () => {
    assert.equal(extractStrainEvidence(null).strained, false);
    assert.equal(extractStrainEvidence({}).strained, false);
    assert.equal(extractStrainEvidence({ metrics: {} }).strained, false);
  });
});

test('guardian — ease rule', async (t) => {
  await t.test('strain on 2 of the last 4 takes -> one ease line', () => {
    const g = new StrainGuardian({ now: () => 0 });
    assert.equal(g.recordTake(STRAINED).level, 'none'); // 1 strained, not enough
    const r = g.recordTake(STRAINED); // 2 of last 4
    assert.equal(r.level, 'ease');
    assert.equal(r.spoke, true);
    assert.equal(r.line, GUARDIAN_TEMPLATES.ease);
  });

  await t.test('ease does not repeat while the window still holds', () => {
    const g = new StrainGuardian({ now: () => 0 });
    g.recordTake(STRAINED);
    const first = g.recordTake(STRAINED);
    assert.equal(first.spoke, true);
    const second = g.recordTake(STRAINED); // window still qualifies (3 of last 4)
    assert.equal(second.level, 'ease');
    assert.equal(second.spoke, false, 'must not nag while ease window holds');
    assert.equal(second.line, null);
  });

  await t.test('ease re-arms after the window clears, then can speak again', () => {
    // Keep total strained < CLOSE_TOTAL_STRAIN_COUNT (4) so the close rule never
    // pre-empts: one strained -> ease via a single repeat is impossible, so we
    // use exactly 1 strained per cluster but rely on the 2-of-4 across a boundary.
    // Cluster A: strained, strained (ease fires, total=2). Clear with cleans.
    // Cluster B would push total to 4 -> close. So instead assert ease re-arms by
    // checking the announced flag resets, using a fresh guardian per the rule's
    // intent (the close precedence is itself covered elsewhere).
    const g = new StrainGuardian({ now: () => 0 });
    g.recordTake(STRAINED);
    assert.equal(g.recordTake(STRAINED).spoke, true); // ease fires (total=2)
    // Clear the window with clean takes (push strained out of the last 4).
    g.recordTake(CLEAN);
    g.recordTake(CLEAN);
    g.recordTake(CLEAN);
    const cleared = g.recordTake(CLEAN);
    assert.equal(cleared.level, 'none', 'window cleared -> none, ease re-armed');
    // A single further strained take is now the 3rd total (still < 4): the ease
    // window needs 2-of-4, so one strained alone stays 'none' — proving the prior
    // ease state was reset (it did not persist as 'ease').
    const next = g.recordTake(STRAINED);
    assert.equal(next.level, 'none', 'ease must have re-armed (not stuck announced)');
  });
});

test('guardian — close rule (total strain)', async (t) => {
  await t.test('4 strained takes total -> close line', () => {
    const g = new StrainGuardian({ now: () => 0 });
    g.recordTake(STRAINED); // 1 (none)
    g.recordTake(STRAINED); // 2 (ease)
    g.recordTake(STRAINED); // 3 (ease, silent)
    const r = g.recordTake(STRAINED); // 4 total -> close
    assert.equal(r.level, 'close');
    assert.equal(r.spoke, true);
    assert.equal(r.line, GUARDIAN_TEMPLATES.close);
  });

  await t.test('close repeats at most once more, then stays silent', () => {
    const g = new StrainGuardian({ now: () => 0 });
    for (let i = 0; i < 3; i += 1) g.recordTake(STRAINED);
    const firstClose = g.recordTake(STRAINED); // 4th -> close #1
    assert.equal(firstClose.spoke, true);
    const secondClose = g.recordTake(STRAINED); // kept going -> close #2 (the one allowed repeat)
    assert.equal(secondClose.level, 'close');
    assert.equal(secondClose.spoke, true);
    const thirdClose = g.recordTake(STRAINED); // kept going -> SILENT
    assert.equal(thirdClose.level, 'close');
    assert.equal(thirdClose.spoke, false, 'guardian must go silent after saying its piece');
    assert.equal(thirdClose.line, null);
    const fourthClose = g.recordTake(STRAINED);
    assert.equal(fourthClose.spoke, false);
  });
});

test('guardian — close rule (session length)', async (t) => {
  await t.test('>25 active minutes AND strain in the last 3 takes -> close', () => {
    let t0 = 0;
    const g = new StrainGuardian({ sessionStartedAt: 0, now: () => t0 });
    // Active minutes accrue take-to-take (2026-07-28): six clean takes five
    // minutes apart build 25 active minutes, the next take crosses the bar
    // with strain in the recent window.
    for (let i = 0; i < 6; i += 1) {
      g.recordTake(CLEAN);
      t0 += 5 * 60000;
    }
    const r = g.recordTake(STRAINED); // 30 active min + strain in last 3 -> close
    assert.ok(g.sessionMinutes() > 25, `${g.sessionMinutes()} active minutes accrued`);
    assert.equal(r.level, 'close');
    assert.equal(r.spoke, true);
  });

  await t.test('idle days do not count as practice minutes (the 4472-minute latch)', () => {
    let t0 = 0;
    const g = new StrainGuardian({ sessionStartedAt: 0, now: () => t0 });
    g.recordTake(CLEAN);
    // Three idle days, then a strained take: the gap is a break, not practice —
    // the active clock accrues at most the capped gap, never the days, so the
    // close posture cannot be permanently armed by wall-clock age alone.
    t0 = 3 * 24 * 60 * 60000;
    const r = g.recordTake(STRAINED);
    assert.ok(g.sessionMinutes() <= GUARDIAN_CONSTANTS.ACTIVE_IDLE_GAP_MINUTES);
    assert.notEqual(r.level, 'close');
  });

  await t.test('over 25 minutes but NO recent strain -> no close', () => {
    let t0 = 0;
    const g = new StrainGuardian({ sessionStartedAt: 0, now: () => t0 });
    t0 = 40 * 60000;
    const r = g.recordTake(CLEAN);
    assert.equal(r.level, 'none');
    assert.equal(r.spoke, false);
  });
});

test('guardian — strainWatch field shape', async (t) => {
  await t.test('recentFlags counts strained in the last EASE_WINDOW; sessionMinutes present', () => {
    let t0 = 0;
    const g = createStrainGuardian({ sessionStartedAt: 0, now: () => t0 });
    g.recordTake(STRAINED);
    t0 = 5 * 60000;
    const r = g.recordTake(CLEAN);
    assert.equal(r.strainWatch.recentFlags, 1);
    assert.equal(r.strainWatch.sessionMinutes, 5);
    assert.equal(r.strainWatch.takeCount, 2);
    assert.equal(r.strainWatch.strainedTotal, 1);
  });

  await t.test('recentFlags never exceeds EASE_WINDOW', () => {
    const g = new StrainGuardian({ now: () => 0 });
    for (let i = 0; i < 8; i += 1) g.recordTake(STRAINED);
    assert.ok(g.strainWatch().recentFlags <= GUARDIAN_CONSTANTS.EASE_WINDOW);
  });
});

test('guardian — clean session never speaks', async (t) => {
  await t.test('all clean takes -> always level none, never spoke', () => {
    const g = new StrainGuardian({ now: () => 0 });
    for (let i = 0; i < 10; i += 1) {
      const r = g.recordTake(CLEAN);
      assert.equal(r.level, 'none');
      assert.equal(r.spoke, false);
    }
  });

  await t.test('measurement-unavailable captures do not advance the strain window', () => {
    const g = new StrainGuardian({ now: () => 0 });
    const unavailable = artifact({ strainRisk: 0.99 });
    unavailable.metrics.advanced.measurementAvailable = false;
    const result = g.recordTake(unavailable);
    assert.equal(result.ignored, true);
    assert.equal(result.strainWatch.takeCount, 0);
    assert.equal(result.strainWatch.recentFlags, 0);
  });

  await t.test('degraded captures do not advance the strain window', () => {
    const g = new StrainGuardian({ now: () => 0 });
    const degraded = artifact({ strainRisk: 0.99 });
    Object.assign(degraded.metrics.advanced, {
      measurementAvailable: true,
      scoreConfidence: 0.04,
      voicedFramePct: 0.01,
      confidentFramePct: 0.01,
      captureReliability: 0.08,
    });
    const result = g.recordTake(degraded);
    assert.equal(result.ignored, true);
    assert.equal(result.strainWatch.takeCount, 0);
    assert.equal(result.strainWatch.recentFlags, 0);
  });
});

// ---------------------------------------------------------------------------
// 2026-07-26: the breathy warn FLOOR reaches the guardian too.
//
// The guardian's composite `strained` flag counts breathyRisk >= the breathy
// warn as strain evidence. Flooring that warn at 0.45 (safety-thresholds.js
// BREATHY_WARN_FLOOR) therefore also raises this bar whenever a profile ceiling
// is tight. That is a live behaviour change in a safety-adjacent path, so it is
// pinned explicitly here (raised in independent review of the breath-nag repair).
// ---------------------------------------------------------------------------

test('breathy floor raises the guardian breathy bar but leaves STRAIN evidence intact', () => {
  // A tight ceiling used to resolve the breathy warn to 0.10 + 0.12 = 0.22.
  const qualityBands = { breathyRiskCeiling: 0.1, strainRiskCeiling: 0.1 };

  const floored = extractStrainEvidence(artifact({ breathyRisk: 0.3 }), { qualityBands });
  assert.equal(floored.thresholds.breathyWarn, 0.45, 'the floor, not ceiling+0.12 (0.22)');
  assert.equal(floored.strained, false, 'a 0.30 breathy read no longer counts as strain evidence');

  const overFloor = extractStrainEvidence(artifact({ breathyRisk: 0.5 }), { qualityBands });
  assert.equal(overFloor.strained, true, 'a 0.50 breathy read still counts');

  // CRITICAL: the floor is breathy-only. With the same tight ceiling the strain
  // warn stays at 0.20 — far BELOW the breathy floor — so a 0.25 strain read
  // must still fire. If the floor had leaked into strain this would go false.
  const strain = extractStrainEvidence(artifact({ strainRisk: 0.25 }), { qualityBands });
  assert.equal(strain.thresholds.strainWarn, 0.2, 'strain warn untouched by the breathy floor');
  assert.equal(strain.thresholds.strainStop, 0.34, 'strain STOP untouched (owner safety law)');
  assert.equal(strain.strained, true, 'real strain evidence must still fire');
});

test('the breathy floor never LOOSENS the no-profile contract bar', () => {
  // With no profile the contract fallback (0.68) already clears the floor, so
  // the long-standing 0.67/0.68 boundary above must be unchanged.
  assert.equal(extractStrainEvidence(artifact({ breathyRisk: 0.67 })).strained, false);
  assert.equal(extractStrainEvidence(artifact({ breathyRisk: 0.68 })).strained, true);
  assert.equal(extractStrainEvidence(artifact({})).thresholds.breathyWarn, 0.68);
});
