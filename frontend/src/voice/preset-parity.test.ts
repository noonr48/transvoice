import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVoiceTutorSourceHtml } from './standalone-dom';
import { getVoiceTutorStandaloneTemplateHtml } from './standalone-template';

// Preset parity: both preset selects must list exactly the DSP's target presets,
// grouped by direction.
//
// The preset ids AND their group labels are READ FROM THE PYTHON SOURCE rather
// than copied here. A hardcoded twin of TARGET_PROFILES is exactly the drift this
// test exists to catch: it would keep passing while the two lists diverged, which
// is how the retired masculine preset survived in the UI after the DSP dropped it.
//
// 2026-07-30: the group labels are now DERIVED too. They used to be the literal
// `['Feminine','Neutral']`, which meant the MTF-only removal had to come back and
// edit this test by hand — the same hand-maintained-twin problem one level up.
// Now removing a whole direction from the DSP simply changes what this expects.
// (The Masculine group went with the FTM direction earlier; Neutral went on
// 2026-07-30, leaving Feminine as the only direction this app coaches.)
function readDspProfiles(): Array<{ id: string; direction: string }> {
  const source = readFileSync(
    resolve(process.cwd(), '../services/voice-trainer/src/services/audio_analysis.py'),
    'utf8',
  );
  const block = source.match(/TARGET_PROFILES:[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error('Could not locate TARGET_PROFILES in audio_analysis.py');
  const entries = Array.from(
    block[1].matchAll(/^\s{4}"([a-z0-9-]+)":\s*VoiceTargetProfile\(([\s\S]*?)^\s{4}\),/gm),
  ).map((match) => ({
    id: match[1],
    // `direction=` is optional in the dataclass; feminine is its default.
    direction: (match[2].match(/direction\s*=\s*"([a-z-]+)"/) || [, 'feminine'])[1] as string,
  }));
  if (entries.length === 0) throw new Error('Parsed TARGET_PROFILES but found no preset ids');
  return entries;
}

/** 'feminine' -> 'Feminine', matching the optgroup labels in the templates. */
function toGroupLabel(direction: string): string {
  return direction.replace(/(^|-)([a-z])/g, (_m, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());
}

describe('voice preset parity', () => {
  const sourceDocument = parseVoiceTutorSourceHtml(getVoiceTutorStandaloneTemplateHtml());
  const dspProfiles = readDspProfiles();
  const dspPresetIds = dspProfiles.map((profile) => profile.id);
  // Group labels in DSP declaration order, deduplicated — the order the templates
  // must list them in.
  const expectedGroupLabels = [...new Set(dspProfiles.map((p) => toGroupLabel(p.direction)))];

  it('the DSP no longer defines any retired masculine preset', () => {
    expect(dspPresetIds.filter((id) => /^(?:masc|ftm)/i.test(id))).toEqual([]);
  });

  it('MTF-ONLY: the DSP offers exactly one goal direction, and it is feminine', () => {
    // The whole app narrowed to male-to-female on 2026-07-30. This is the single
    // assertion that pins that decision at its source, so a neutral or otherwise
    // non-feminine preset reappearing in the DSP fails here first — before the
    // eight hand-copied JS registries have a chance to disagree with each other.
    expect([...new Set(dspProfiles.map((p) => p.direction))]).toEqual(['feminine']);
  });

  for (const selectId of ['voice-target-preset', 'voice-custom-preset-base']) {
    it(`lists exactly the DSP presets in #${selectId}, grouped by direction`, () => {
      const select = sourceDocument.getElementById(selectId) as HTMLSelectElement | null;
      expect(select).not.toBeNull();

      const values = Array.from(select!.querySelectorAll('option')).map((option) => option.value);
      // Set-equal against the live DSP list, so adding a preset on either side fails here.
      expect([...values].sort()).toEqual([...dspPresetIds].sort());

      const groupLabels = Array.from(select!.querySelectorAll('optgroup')).map((group) => group.label);
      expect(groupLabels).toEqual(expectedGroupLabels);

      // No retired target may be selectable anywhere in the UI. Removed 2026-07-30
      // with the neutral presets: an assertion that the Neutral group contained
      // exactly ['androgynous','gender-neutral']. There is no Neutral group now,
      // and the set-equality against the live DSP list above is what proves it —
      // a stray neutral option would break that first.
      expect(values.filter((value) => /^(?:masc|ftm|androgynous|gender-neutral)$/i.test(value))).toEqual([]);

      // Every option sits inside a group whose label matches its DSP direction,
      // so an option cannot be filed under the wrong heading.
      for (const profile of dspProfiles) {
        const option = Array.from(select!.querySelectorAll('option'))
          .find((candidate) => candidate.value === profile.id);
        expect(option, `no <option> for DSP preset ${profile.id}`).toBeTruthy();
        expect((option!.parentElement as HTMLOptGroupElement).label)
          .toBe(toGroupLabel(profile.direction));
      }
    });
  }
});
