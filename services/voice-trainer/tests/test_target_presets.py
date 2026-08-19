"""Regression tests for handmade-target defaults and strict exact bands."""
from __future__ import annotations

import re
import unittest

from src.services.audio_analysis import TARGET_PROFILES, get_target_profile
from src.services.target_preset_library import (
    _build_handmade_target_voice_profile,
)


# 2026-07-30 MTF-ONLY. Every census below iterates the LIVE preset ids out of
# `TARGET_PROFILES` — the single source of truth for the offered set — instead of
# restating five names here. A preset added or retired there is enrolled or
# dropped automatically, so this file cannot silently desync from the analyzer
# the way the hardcoded "androgynous"/"gender-neutral" call sites did.
LIVE_PRESETS = tuple(sorted(TARGET_PROFILES))

# ...but a DERIVED census is only as good as its non-emptiness: if the source of
# truth were ever emptied or the import renamed, every `for preset in
# LIVE_PRESETS` loop below would pass by iterating nothing, which is worse than
# the hardcoded list it replaces. Fail loudly instead.
assert len(LIVE_PRESETS) >= 5, (
    f'expected the live preset set to be non-trivial, got {LIVE_PRESETS!r}'
)


class HandmadeTargetDefaultsTests(unittest.TestCase):
    def test_default_bands_stay_on_the_feminine_side_of_every_base_threshold(self):
        # F3: min_resonance_mean is a FLOOR for feminine and max_weight_mean is a
        # CEILING, NOT band centres, so a handmade target must not tolerate
        # resonance below the floor or weight above the ceiling.
        #
        # WIDENED 2026-07-30 from `test_feminine_resonance_floor_not_below_base
        # _threshold`, which checked resonance on `everyday-feminine` alone. Now a
        # census over every live preset, plus the weight twin nothing asserted.
        # This is the assertion that DISCRIMINATES one-sided from band-centred
        # defaults: re-introduce the retired +-0.06 centring and the floor drops
        # under the threshold / the ceiling rises above it and this goes red.
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                base = get_target_profile(preset)
                prof = _build_handmade_target_voice_profile(
                    preset_id='p', name='n', base_preset=preset, payload={}, notes=[]
                )
                self.assertGreaterEqual(prof.resonanceFloor, base.min_resonance_mean)
                self.assertLessEqual(prof.weightCeiling, base.max_weight_mean)
                self.assertLess(prof.resonanceFloor, prof.resonanceCeiling)
                self.assertLess(prof.weightFloor, prof.weightCeiling)

    # DELETED 2026-07-30 — `test_neutral_handmade_band_is_centered`.
    #
    # It proved that a handmade target inherits its BASE preset's
    # coordinate-side semantics, which for a `direction == "neutral"` base
    # (androgynous / gender-neutral) meant a resonance/weight band CENTRED on
    # the threshold (+-0.06) rather than the feminine one-sided floor/ceiling.
    # It had already been re-pointed once, on 2026-07-26, from the masculine
    # lane onto the neutral one.
    #
    # The neutral lane was removed on 2026-07-30 with the MTF-only narrowing, so
    # there is no second coordinate-side left to inherit and the branch it
    # exercised is gone from `_build_handmade_target_voice_profile`.
    #
    # NOT re-pointed to a feminine base, deliberately: its assertions only
    # demanded a band CONTAINING the base threshold, and the one-sided feminine
    # default satisfies that too (floor == threshold, ceiling == threshold+0.12),
    # so a feminine copy COULD NOT FAIL. The property worth keeping is the
    # opposite one — that the band is one-sided, not centred — and that is now
    # asserted over every live preset by
    # `test_default_bands_stay_on_the_feminine_side_of_every_base_threshold`
    # above, which a re-introduced centring would break.

    def test_missing_handmade_values_still_use_directional_defaults(self):
        # WIDENED 2026-07-30: was a single call on the retired "gender-neutral"
        # base. The property is not lane-specific — an empty payload must still
        # yield three ordered bands on ANY base preset — so it is now a census.
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                profile = _build_handmade_target_voice_profile(
                    preset_id='missing',
                    name='Missing fields',
                    base_preset=preset,
                    payload={},
                    notes=[],
                )

                self.assertLess(profile.pitchFloorHz, profile.pitchCeilingHz)
                self.assertLess(profile.resonanceFloor, profile.resonanceCeiling)
                self.assertLess(profile.weightFloor, profile.weightCeiling)

    def test_blank_style_fallback_never_overrides_exact_custom_bands(self):
        # A whitespace-only stylePrompt must fall back to the exact-bands text and
        # must not prescribe a REGISTER, which would contradict the saved bands.
        #
        # WIDENED 2026-07-30: was a single call on the retired "gender-neutral"
        # base. The fallback interpolates the base preset id, and every live
        # preset id now contains a banned word itself ("cute-feminine" ->
        # "feminin", "bright-playful" -> "bright"). The interpolated LABEL is not
        # a smuggled register cue, so it is excised before the scan and the ban
        # then applies to the prose the fallback actually authors — measured
        # 2026-07-30: the ban still matches all 5 ids un-excised and none of them
        # excised, so this narrows the scan without disarming it. Change the
        # fallback to "keep it small and sweet" and this still goes red.
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                profile = _build_handmade_target_voice_profile(
                    preset_id='grounded',
                    name='Grounded target',
                    base_preset=preset,
                    payload={'stylePrompt': '   '},
                    notes=[],
                )

                self.assertIn(
                    'exact saved pitch, resonance, and weight bands', profile.stylePrompt
                )
                self.assertIn('comfortable and unforced', profile.stylePrompt)
                label = preset.replace('-', ' ')
                self.assertIn(label, profile.stylePrompt.lower())
                authored_prose = profile.stylePrompt.lower().replace(label, '')
                self.assertNotRegex(
                    authored_prose, r'small|sweet|feminin|bright|light'
                )

    def test_explicit_custom_style_remains_the_authority(self):
        # WIDENED 2026-07-30: was a single call on the retired "gender-neutral"
        # base. An authored prompt wins verbatim whatever the base preset is, so
        # the base is exactly what should be swept rather than pinned.
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                profile = _build_handmade_target_voice_profile(
                    preset_id='authored',
                    name='Authored target',
                    base_preset=preset,
                    payload={'stylePrompt': 'My exact roomy target cue.'},
                    notes=[],
                )

                self.assertEqual(profile.stylePrompt, 'My exact roomy target cue.')
                # The fallback text must not leak in alongside the authored one.
                self.assertNotIn('exact saved pitch', profile.stylePrompt)

    def test_retired_base_presets_are_rejected_like_any_unknown_id(self):
        # ADDED 2026-07-30. The rejection contract, at the handmade-target seam:
        # a retired preset used as a BASE must fail exactly like a preset that
        # never existed, never resolve to a surviving feminine target. Both
        # retirements are swept together so the next one inherits the guard.
        retired_and_unknown = (
            'androgynous',        # retired 2026-07-30 (MTF-only)
            'gender-neutral',     # retired 2026-07-30 (MTF-only)
            'masculine',          # retired 2026-07-26
            'masc-deep',
            'masc-natural',
            'masc-warm',
            'masc-bright',
            'not-a-preset',       # never existed — the reference behaviour
        )
        for preset in retired_and_unknown:
            with self.subTest(base_preset=preset):
                self.assertNotIn(preset, TARGET_PROFILES)
                with self.assertRaises(ValueError) as caught:
                    _build_handmade_target_voice_profile(
                        preset_id='retired',
                        name='Retired base',
                        base_preset=preset,
                        payload={},
                        notes=[],
                    )
                # The message must name the id and offer the live set, so the
                # HTTP 400 the routers raise from this is actionable.
                self.assertRegex(str(caught.exception), re.escape(preset))
                for live in LIVE_PRESETS:
                    self.assertIn(live, str(caught.exception))


if __name__ == '__main__':
    unittest.main()
