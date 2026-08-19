"""Regression battery for the 2026-07-26 formant-lite selection repair.

THE DEFECT THIS PINS (proven against the live shipped function before the fix,
lab-031 receipts at
/home/USER

  1. The pole->bandwidth expression was ``-0.5*(sr/(2*pi))*ln|z|``, which is
     EXACTLY ONE QUARTER of the standard identity ``-(sr/pi)*ln|z|``. So the
     ``bandwidth <= 700`` gate really admitted poles up to ~2800 Hz wide, and
     ``<= 900`` admitted ~3600 Hz, while real formants are 50-200 Hz wide. The
     bandwidth gate was the selector's only junk-pole defence and it was inert.
  2. Selection took the FIRST pole in each range (candidates are frequency
     sorted) rather than the most prominent one, so any junk pole sitting below
     the true formant won outright.

  Measured consequence on a synthesized /i/ (true F1 437, F2 2761 Hz) at an
  EASY 150 Hz F0: the shipped function returned F2 = 798 Hz, an error of -71%,
  while the correct 2750 Hz pole sat unselected in its own candidate list.
  Resonance rides F2, so resonance coaching was corrupted at every pitch.

  Before/after F2 on this battery's own signals, at F0 150 / 180 / 220 Hz.
  Every number below is reproducible with this module's own helpers
  (``median_formants`` over ``_steady_windows``):

      /i/   815 /  859 / 1005 Hz  ->  2752 / 2754 / 2755 Hz  (true 2761)
      /u/  1055 /  897 / 1093 Hz  ->  1055 / 1077 / 1093 Hz  (true 1105)
      /ae/ 1734 / 1767 / 1423 Hz  ->  1734 / 1767 / 1754 Hz  (true 1723)
      /a/  1549 / 1585 / 1535 Hz  ->  1549 / 1587 / 1535 Hz  (true 1551)

  i.e. the failure was worst on vowels whose true F2 is high; /a/ never moved
  at all, which is exactly why no existing test caught it.

A SECOND fault, found by review of the first draft of this repair and pinned by
``HighPitchTests``: filling F1 and then F2 greedily, one slot at a time, breaks
at the top of the supported pitch range. F1's band reaches 1200 Hz, which
contains /u/'s genuine F2 (1105 Hz), so once the fundamental crowds out the
true F1 the selector crowns F2 as F1 and shoves F2 onto F3 -- /u/ at F0 400 Hz
read F2 = 2767 Hz against a true 1105. Selecting the (F1, F2) PAIR with the
greatest summed prominence removes that, and an uncapped 1.1 x F0 pole floor
(which reaches a real F1 at F0 397 Hz, inside the supported range) was the
other half of it. Scored on 3 vowels x 7 pitches from 150 to 400 Hz, within
+-12% on BOTH formants: pair selection 17/21, greedy 16/21, pre-repair 8/21 --
and pair selection is worse than the pre-repair code on no case at all.

SIGNALS: source-filter synthesis, so the answer is known by construction. The
approach is copied from the lab's own equipment
(/home/USER with one change: this
tree has no scipy, so ``scipy.signal.lfilter`` is replaced by the explicit
2-pole difference equation it implements. A resonator built with
``r = exp(-pi*BW/sr)`` places poles that ARE the ground truth an LPC
root-solver should recover, which is what makes the bandwidth identity below a
round trip rather than a convention.

Formant reference values are Hillenbrand et al. (1995) adult-female means, the
same set the lab spike used.
"""
from __future__ import annotations

import math
import unittest

import numpy as np

from src.services import audio_analysis as A

FS = A.SAMPLE_RATE
WINDOW = A.LIVE_FRAME_SIZE  # the window size the formant-lite pass solves on
TOLERANCE_PCT = 12.0

# Hillenbrand adult-female means: F1, F2, F3, F4.
VOWELS = {
    "/a/ hod": [936.0, 1551.0, 2815.0, 3600.0],
    "/i/ heed": [437.0, 2761.0, 3372.0, 4200.0],
    "/u/ whod": [459.0, 1105.0, 2735.0, 3600.0],
    # /ae/ is here to give F1's raised ceiling teeth. Its F1 (1015 Hz, measuring
    # 1022-1088 here) is the only one in this set that lands in the 1000-1200 Hz
    # window the ceiling was widened to admit; without it, reverting the ceiling
    # to its old 1000 Hz leaves the whole battery green.
    "/ae/ had": [1015.0, 1723.0, 2850.0, 3600.0],
}
VOWEL_BANDWIDTHS = [80.0, 100.0, 140.0, 220.0]
PITCHES = (150.0, 180.0, 220.0)
# The top of the app's own declared pitch range. Reported pitch is CLAMPED to
# VOICE_TARGET_PITCH_MAX_HZ = 400, so every speaker at or above 400 Hz lands
# exactly on 400 and these are not exotic edge cases. An earlier draft of this
# repair left the 1.1 x F0 pole floor uncapped and selected formants greedily
# one slot at a time; both faults only appear up here, and the battery was blind
# to them while it stopped at 220 Hz.
HIGH_PITCHES = (380.0, 400.0)


# --------------------------------------------------------------------------
# numpy-only source-filter synthesis (see module docstring for provenance)
# --------------------------------------------------------------------------
def rosenberg_pulse_train(
    f0: float, sample_rate: int, n_samples: int, open_quotient=0.6, speed_quotient=3.0
) -> np.ndarray:
    """Rosenberg glottal FLOW pulse train: known F0, realistic -12 dB/oct source."""
    period = sample_rate / f0
    rising = period * open_quotient * (speed_quotient / (1.0 + speed_quotient))
    falling = period * open_quotient * (1.0 / (1.0 + speed_quotient))
    out = np.zeros(n_samples, dtype=np.float64)
    position = 0.0
    while position < n_samples:
        start = int(round(position))
        for k in range(int(math.ceil(rising + falling))):
            index = start + k
            if index >= n_samples:
                break
            out[index] = (
                0.5 * (1.0 - math.cos(math.pi * k / rising))
                if k < rising
                else math.cos(math.pi * (k - rising) / (2.0 * falling))
            )
        position += period
    return out


def two_pole_resonator(
    x: np.ndarray, freq_hz: float, bandwidth_hz: float, sample_rate: int
) -> np.ndarray:
    """One 2-pole resonator, poles at r*exp(+-j*theta) -- the ground truth.

    Unity DC gain. This is ``scipy.signal.lfilter([g], [1, a1, a2], x)`` written
    out, because this tree ships without scipy.
    """
    r = math.exp(-math.pi * bandwidth_hz / sample_rate)
    theta = 2.0 * math.pi * freq_hz / sample_rate
    a1 = -2.0 * r * math.cos(theta)
    a2 = r * r
    gain = 1.0 + a1 + a2
    y = np.zeros_like(x)
    back1 = back2 = 0.0
    for i in range(x.size):
        current = gain * x[i] - a1 * back1 - a2 * back2
        y[i] = current
        back2, back1 = back1, current
    return y


def synth_vowel(
    f0: float,
    formants: list[float],
    bandwidths: list[float],
    duration: float = 1.0,
    sample_rate: int = FS,
) -> np.ndarray:
    """Sustained vowel: glottal source -> resonator cascade -> lip radiation."""
    n = int(sample_rate * duration)
    y = rosenberg_pulse_train(f0, sample_rate, n)
    for freq_hz, bandwidth_hz in zip(formants, bandwidths, strict=True):
        if freq_hz < sample_rate / 2.0:
            y = two_pole_resonator(y, freq_hz, bandwidth_hz, sample_rate)
    y = np.diff(np.concatenate([[0.0], y]))  # lip radiation, +6 dB/oct
    peak = float(np.max(np.abs(y)))
    return (y / peak * 0.5) if peak > 0.0 else y


def _steady_windows(signal: np.ndarray, hop: int = 512):
    """Sliding analysis windows over the steady part of a sustained vowel."""
    for start in range(WINDOW, signal.size - WINDOW, hop):
        window = signal[start : start + WINDOW].astype(np.float64)
        yield window - float(window.mean())


def median_formants(
    signal: np.ndarray, f0_hz: float
) -> tuple[float | None, float | None]:
    """Median F1/F2 across the vowel, mirroring what the offline pass does."""
    f1_values: list[float] = []
    f2_values: list[float] = []
    for window in _steady_windows(signal):
        f1_hz, f2_hz = A._estimate_lpc_formants(window, FS, f0_hz=f0_hz)
        if f1_hz is not None:
            f1_values.append(f1_hz)
        if f2_hz is not None:
            f2_values.append(f2_hz)
    return (
        float(np.median(f1_values)) if f1_values else None,
        float(np.median(f2_values)) if f2_values else None,
    )


def error_pct(measured: float, truth: float) -> float:
    return 100.0 * (measured - truth) / truth


def mid_window(signal: np.ndarray) -> np.ndarray:
    window = signal[signal.size // 2 : signal.size // 2 + WINDOW].astype(np.float64)
    return window - float(window.mean())


# --------------------------------------------------------------------------
# (a) the exact shipped failure
# --------------------------------------------------------------------------
class PinnedShippedFailureTests(unittest.TestCase):
    """The precise case the shipped code got wrong, held down forever."""

    def setUp(self):
        self.truth = VOWELS["/i/ heed"]
        self.signal = synth_vowel(150.0, self.truth, VOWEL_BANDWIDTHS)

    def test_i_at_150hz_recovers_the_true_f2(self):
        _f1, f2_hz = median_formants(self.signal, 150.0)
        self.assertIsNotNone(f2_hz, "/i/ at 150 Hz: no F2 recovered at all")
        # The shipped code returned 798 Hz here (-71%). Anything in that region
        # means the junk-pole path is back.
        self.assertGreater(
            f2_hz,
            2000.0,
            f"F2 {f2_hz:.0f} Hz is in the junk-pole region; the shipped defect "
            f"returned 798 Hz for this exact signal",
        )
        self.assertLessEqual(
            abs(error_pct(f2_hz, self.truth[1])),
            TOLERANCE_PCT,
            f"F2 {f2_hz:.0f} Hz vs true {self.truth[1]} Hz",
        )

    def test_the_true_f2_pole_was_never_the_missing_piece(self):
        """It was a SELECTION failure, not an estimation failure.

        The correct pole is in the candidate list either way; the old rule just
        did not pick it. If this ever fails, the problem has moved upstream into
        the LPC solve and the rest of this battery is diagnosing the wrong seam.
        """
        candidates = A._formant_candidates(mid_window(self.signal), FS, f0_hz=150.0)
        self.assertTrue(candidates, "no LPC candidates at all")
        nearest = min(candidates, key=lambda c: abs(c[0] - self.truth[1]))
        self.assertLessEqual(
            abs(error_pct(nearest[0], self.truth[1])),
            2.0,
            f"true F2 pole absent from the candidate list; nearest was {nearest[0]:.0f} Hz",
        )


# --------------------------------------------------------------------------
# (b) accuracy across vowels and pitches
# --------------------------------------------------------------------------
class VowelBatteryTests(unittest.TestCase):
    def test_f1_and_f2_within_tolerance(self):
        for name, truth in VOWELS.items():
            signal_cache = {
                f0: synth_vowel(f0, truth, VOWEL_BANDWIDTHS) for f0 in PITCHES
            }
            for f0 in PITCHES:
                with self.subTest(vowel=name, f0=f0):
                    f1_hz, f2_hz = median_formants(signal_cache[f0], f0)
                    self.assertIsNotNone(f1_hz, f"{name} @{f0:.0f} Hz: no F1")
                    self.assertIsNotNone(f2_hz, f"{name} @{f0:.0f} Hz: no F2")
                    self.assertLessEqual(
                        abs(error_pct(f1_hz, truth[0])),
                        TOLERANCE_PCT,
                        f"{name} @{f0:.0f} Hz: F1 {f1_hz:.0f} vs true {truth[0]}",
                    )
                    self.assertLessEqual(
                        abs(error_pct(f2_hz, truth[1])),
                        TOLERANCE_PCT,
                        f"{name} @{f0:.0f} Hz: F2 {f2_hz:.0f} vs true {truth[1]}",
                    )


class F1CeilingTests(unittest.TestCase):
    def test_an_f1_above_the_old_ceiling_is_still_found(self):
        """F1's ceiling was raised 1000 -> 1200 Hz. Prove that matters.

        Hillenbrand's adult-female /ae/ has F1 = 1015 Hz, and high-F0 harmonic
        bias pushes the estimate higher still, so the old 1000 Hz ceiling
        rejected genuine open vowels outright.
        """
        truth = VOWELS["/ae/ had"]
        self.assertGreater(A.FORMANT_F1_RANGE_HZ[1], 1000.0)
        signal = synth_vowel(220.0, truth, VOWEL_BANDWIDTHS)
        f1_hz, _f2 = median_formants(signal, 220.0)
        self.assertIsNotNone(f1_hz)
        self.assertGreater(
            f1_hz, 1000.0, "this case no longer exercises the raised ceiling"
        )
        self.assertLessEqual(abs(error_pct(f1_hz, truth[0])), TOLERANCE_PCT)


class HighPitchTests(unittest.TestCase):
    """The top of the supported pitch range, where F0 crowds F1.

    Absolute F1 is known to degrade above ~260 Hz (harmonic locking: LPC has
    nothing to fit BETWEEN harmonics, so a pole is pulled onto the nearest
    strong one). These tests therefore do not demand an accurate F1 up here.
    What they DO demand is that F2 never gets shunted onto F3 -- because
    resonance rides F2, and a back vowel reported with a front vowel's F2 is
    worse than no reading at all.
    """

    def test_f2_is_never_shunted_onto_f3(self):
        """F2 must stay nearer its own formant than the next one up.

        Deliberately NOT a +-12% check. Above ~260 Hz absolute accuracy decays
        for everyone -- the pre-repair code is wrong here by the same margin, so
        a tolerance assertion would test the pitch limit rather than this
        repair. The failure this pins is categorical and specific: F2 landing on
        F3. Greedy per-slot selection produced exactly that on /u/ at 380-400 Hz
        (F2 read 2653-2767 Hz against a true 1105, with F3 at 2735).
        """
        for name, truth in VOWELS.items():
            for f0 in HIGH_PITCHES:
                with self.subTest(vowel=name, f0=f0):
                    signal = synth_vowel(f0, truth, VOWEL_BANDWIDTHS)
                    _f1, f2_hz = median_formants(signal, f0)
                    if f2_hz is None:
                        continue  # honest absence is always acceptable
                    self.assertLess(
                        abs(f2_hz - truth[1]),
                        abs(f2_hz - truth[2]),
                        f"{name} @{f0:.0f} Hz: F2 read {f2_hz:.0f} Hz, closer to "
                        f"F3 ({truth[2]}) than to its own formant ({truth[1]}) "
                        f"-- F2 was shunted up onto the next formant",
                    )

    def test_f1_is_not_crowned_with_f2(self):
        """The specific failure: F1's band tops out at 1200 Hz, which contains
        /u/'s genuine F2 (1105 Hz). If the true F1 is lost, nothing may promote
        F2 into the F1 slot."""
        truth = VOWELS["/u/ whod"]
        for f0 in HIGH_PITCHES:
            with self.subTest(f0=f0):
                signal = synth_vowel(f0, truth, VOWEL_BANDWIDTHS)
                f1_hz, _f2 = median_formants(signal, f0)
                if f1_hz is None:
                    continue
                self.assertLess(
                    f1_hz,
                    truth[1] - 100.0,
                    f"F1 read {f1_hz:.0f} Hz at F0 {f0:.0f}, which is /u/'s F2 "
                    f"({truth[1]} Hz) promoted into the F1 slot",
                )

    def test_the_f0_floor_never_reaches_a_real_f1(self):
        """The floor exists to reject harmonic locks, not real formants.

        Uncapped, 1.1 x F0 crosses Hillenbrand's female /i/ F1 (437 Hz) at
        F0 = 397 Hz -- inside the supported range.
        """
        self.assertLess(
            A.FORMANT_F0_FLOOR_MAX_HZ,
            340.0,
            "the cap must sit below the lowest adult F1 (~340 Hz, male /i/)",
        )
        signal = synth_vowel(400.0, VOWELS["/u/ whod"], VOWEL_BANDWIDTHS)
        candidates = A._formant_candidates(mid_window(signal), FS, f0_hz=400.0)
        self.assertTrue(
            any(c[0] < 500.0 for c in candidates),
            "the F1 region was emptied by the F0 floor at the pitch ceiling",
        )


# --------------------------------------------------------------------------
# (c) the bandwidth constant
# --------------------------------------------------------------------------
class BandwidthIdentityTests(unittest.TestCase):
    """The constant is load-bearing: it decides which poles the gates admit."""

    def test_bandwidth_round_trips_the_resonator_that_made_the_pole(self):
        """A pole placed with bandwidth B must read back as bandwidth B.

        This is a true round trip, not a convention check: the synthesizer
        places poles at r = exp(-pi*B/sr) and the analyzer inverts it. Under the
        old quarter-scale expression every value here came back 4x too small.
        """
        for truth_bandwidth in (50.0, 100.0, 220.0, 700.0, 2200.0):
            with self.subTest(bandwidth=truth_bandwidth):
                r = math.exp(-math.pi * truth_bandwidth / FS)
                theta = 2.0 * math.pi * 1500.0 / FS
                root = np.array([r * complex(math.cos(theta), math.sin(theta))])
                measured = float(A._pole_bandwidths_hz(root, FS)[0])
                self.assertAlmostEqual(measured, truth_bandwidth, places=6)

    def test_the_old_quarter_scale_expression_would_admit_junk(self):
        """Show the failure mode arithmetically, so a revert is unmistakable."""
        truth_bandwidth = 2200.0  # far wider than any real formant
        r = math.exp(-math.pi * truth_bandwidth / FS)
        theta = 2.0 * math.pi * 1500.0 / FS
        root = np.array([r * complex(math.cos(theta), math.sin(theta))])

        standard = float(A._pole_bandwidths_hz(root, FS)[0])
        quarter_scale = -0.5 * (FS / (2.0 * math.pi)) * math.log(abs(root[0]))

        self.assertAlmostEqual(standard / quarter_scale, 4.0, places=9)
        # Correct math rejects it; the old math called a 2200 Hz-wide pole
        # "550 Hz wide" and waved it through the <= 900 gate.
        self.assertGreater(standard, A.FORMANT_F2_MAX_BANDWIDTH_HZ)
        self.assertLess(quarter_scale, 900.0)

    def test_a_wide_junk_pole_is_rejected_end_to_end(self):
        """On the real pinned signal, the over-wide poles must not be chosen."""
        signal = synth_vowel(150.0, VOWELS["/i/ heed"], VOWEL_BANDWIDTHS)
        window = mid_window(signal)
        candidates = A._formant_candidates(window, FS, f0_hz=150.0)
        _f1, f2_hz = A._select_formants_by_prominence(candidates)

        too_wide = [
            c
            for c in candidates
            if A.FORMANT_F2_RANGE_HZ[0] <= c[0] <= A.FORMANT_F2_RANGE_HZ[1]
            and c[1] > A.FORMANT_F2_MAX_BANDWIDTH_HZ
        ]
        self.assertTrue(
            too_wide,
            "this signal is supposed to contain over-wide junk poles in the F2 "
            "band; if it no longer does, this test has stopped testing anything",
        )
        self.assertIsNotNone(f2_hz)
        for candidate in too_wide:
            self.assertNotAlmostEqual(
                f2_hz,
                candidate[0],
                places=3,
                msg=f"selected a {candidate[1]:.0f} Hz-wide pole as F2",
            )


# --------------------------------------------------------------------------
# (d) prominence beats first-in-range
# --------------------------------------------------------------------------
class ProminenceRankingTests(unittest.TestCase):
    def test_tallest_pole_wins_not_the_lowest(self):
        """Deterministic mechanism proof, no DSP involved.

        The decoy is deliberately made gate-legal: its bandwidth is inside the
        F2 cap, so the bandwidth gate ADMITS it and only prominence ranking can
        reject it. The old rule returned the first in-range candidate, which is
        the decoy.
        """
        decoy = (1000.0, 900.0, 12.0)
        true_f2 = (2300.0, 110.0, 26.0)
        candidates = [(450.0, 60.0, 30.0), decoy, true_f2]

        self.assertLess(decoy[1], A.FORMANT_F2_MAX_BANDWIDTH_HZ)
        self.assertLess(decoy[0], true_f2[0])
        self.assertLess(decoy[2], true_f2[2])

        f1_hz, f2_hz = A._select_formants_by_prominence(candidates)
        self.assertEqual(f1_hz, 450.0)
        self.assertEqual(f2_hz, true_f2[0], "first-in-range would have returned 1000 Hz")

    def test_prominence_wins_on_synthesized_audio(self):
        """The same mechanism, reached through the real LPC path.

        A broad (gate-legal) low resonance is placed below a sharp true F2. Note
        this construction is adversarial, not a real vowel: at F0 >= 220 Hz the
        broad low pole does win, which is the known high-F0 harmonic-locking
        limit rather than the selection defect this battery covers.
        """
        formants = [420.0, 900.0, 1800.0, 3200.0]
        bandwidths = [70.0, 900.0, 60.0, 200.0]
        for f0 in (150.0, 180.0):
            with self.subTest(f0=f0):
                signal = synth_vowel(f0, formants, bandwidths)
                window = mid_window(signal)
                candidates = A._formant_candidates(window, FS, f0_hz=f0)
                _f1, f2_hz = A._select_formants_by_prominence(candidates)

                in_band = [
                    c
                    for c in candidates
                    if A.FORMANT_F2_RANGE_HZ[0] <= c[0] <= A.FORMANT_F2_RANGE_HZ[1]
                    and c[1] <= A.FORMANT_F2_MAX_BANDWIDTH_HZ
                ]
                self.assertGreaterEqual(
                    len(in_band), 2, "expected a decoy and a true F2 in band"
                )
                first_in_range = min(in_band, key=lambda c: c[0])
                chosen = max(in_band, key=lambda c: c[2])
                # The decoy is gate-legal and comes first: only ranking saves us.
                self.assertLess(first_in_range[0], 1500.0)
                self.assertIsNot(first_in_range, chosen)

                self.assertIsNotNone(f2_hz)
                self.assertLessEqual(
                    abs(error_pct(f2_hz, 1800.0)),
                    TOLERANCE_PCT,
                    f"F2 {f2_hz:.0f} Hz vs true 1800 Hz "
                    f"(first-in-range would give {first_in_range[0]:.0f} Hz)",
                )


# --------------------------------------------------------------------------
# supporting behaviour: the F0 floor and null-when-absent
# --------------------------------------------------------------------------
class F0FloorTests(unittest.TestCase):
    """A pole at or below the fundamental is a harmonic lock, not a formant."""

    def setUp(self):
        self.signal = synth_vowel(150.0, VOWELS["/i/ heed"], VOWEL_BANDWIDTHS)
        self.window = mid_window(self.signal)

    # A resonance at 250 Hz voiced at F0 = 240 Hz sits at 1.04x the fundamental,
    # i.e. it IS the fundamental. That is precisely what the floor exists to
    # reject, and it is the only way to exercise the floor with this equipment:
    # on an ordinary clean vowel LPC places no pole below F1 at all, so the
    # floor has nothing to remove and any test built on one passes vacuously.
    LOCKED_F0 = 240.0
    LOCKED_VOWEL = [250.0, 1800.0, 2800.0, 3600.0]
    LOCKED_BANDWIDTHS = [70.0, 100.0, 140.0, 220.0]

    def setUp(self):
        self.signal = synth_vowel(150.0, VOWELS["/i/ heed"], VOWEL_BANDWIDTHS)
        self.window = mid_window(self.signal)
        self.locked_window = mid_window(
            synth_vowel(self.LOCKED_F0, self.LOCKED_VOWEL, self.LOCKED_BANDWIDTHS)
        )

    def test_a_pole_locked_to_the_fundamental_is_dropped(self):
        unfloored = A._formant_candidates(self.locked_window, FS, f0_hz=None)
        floored = A._formant_candidates(
            self.locked_window, FS, f0_hz=self.LOCKED_F0
        )
        expected_floor = min(
            self.LOCKED_F0 * A.FORMANT_F0_FLOOR_MULT, A.FORMANT_F0_FLOOR_MAX_HZ
        )
        self.assertTrue(
            any(c[0] < expected_floor for c in unfloored),
            "fixture no longer contains a fundamental-locked pole",
        )
        self.assertGreater(len(unfloored), len(floored))
        self.assertTrue(
            all(c[0] > expected_floor for c in floored),
            f"a candidate survived below the {expected_floor:.0f} Hz floor",
        )

    def test_a_dropped_f1_reads_as_absent_not_as_the_fundamental(self):
        """Absence beats a confident wrong answer: reporting the fundamental as
        F1 would feed the weight estimator a value that is not a formant."""
        floored = A._formant_candidates(
            self.locked_window, FS, f0_hz=self.LOCKED_F0
        )
        self.assertEqual(A._select_formants_by_prominence(floored), (None, None))

    def test_without_f0_the_floor_is_inert(self):
        """Callers that cannot supply F0 keep the previous 180 Hz behaviour."""
        unfloored = A._formant_candidates(self.locked_window, FS, f0_hz=None)
        f1_hz, _f2 = A._select_formants_by_prominence(unfloored)
        self.assertIsNotNone(f1_hz)
        self.assertLess(f1_hz, 300.0, "the sub-300 Hz pole should survive")

    def test_a_nonsense_f0_does_not_crash_the_solve(self):
        for f0 in (0.0, -12.0, float("nan"), float("inf")):
            with self.subTest(f0=f0):
                candidates = A._formant_candidates(self.window, FS, f0_hz=f0)
                self.assertTrue(candidates)


class NullWhenAbsentTests(unittest.TestCase):
    """Absence must read as absence, never as a fabricated worst case."""

    def test_silence_yields_no_formants(self):
        silence = np.zeros(WINDOW, dtype=np.float64)
        self.assertEqual(A._estimate_lpc_formants(silence, FS), (None, None))

    def test_too_short_a_window_yields_no_formants(self):
        stub = np.ones(64, dtype=np.float64)
        self.assertEqual(A._formant_candidates(stub, FS), [])
        self.assertEqual(A._estimate_lpc_formants(stub, FS), (None, None))

    def test_missing_f2_returns_none_rather_than_a_substitute(self):
        f1_hz, f2_hz = A._select_formants_by_prominence([(450.0, 60.0, 30.0)])
        self.assertEqual(f1_hz, 450.0)
        self.assertIsNone(f2_hz)

    def test_missing_f1_suppresses_both(self):
        # F1 is the anchor; without it there is nothing to measure F2 against.
        self.assertEqual(
            A._select_formants_by_prominence([(2300.0, 110.0, 26.0)]), (None, None)
        )


class PublicContractTests(unittest.TestCase):
    """The signature callers rely on must not drift."""

    def test_returns_a_two_tuple_and_f0_stays_optional(self):
        signal = synth_vowel(180.0, VOWELS["/a/ hod"], VOWEL_BANDWIDTHS)
        window = mid_window(signal)
        without_f0 = A._estimate_lpc_formants(window, FS)
        with_f0 = A._estimate_lpc_formants(window, FS, f0_hz=180.0)
        for result in (without_f0, with_f0):
            self.assertIsInstance(result, tuple)
            self.assertEqual(len(result), 2)
            self.assertTrue(all(v is None or isinstance(v, float) for v in result))

    def test_explicit_order_is_still_honoured(self):
        signal = synth_vowel(180.0, VOWELS["/a/ hod"], VOWEL_BANDWIDTHS)
        window = mid_window(signal)
        self.assertNotEqual(
            A._formant_candidates(window, FS, order=8),
            A._formant_candidates(window, FS, order=18),
        )


if __name__ == "__main__":
    unittest.main()
