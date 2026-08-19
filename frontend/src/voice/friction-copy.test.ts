// Abandon-trigger build wave (2026-07-19) — copy inventory sweep.
//
// Every NEW user-facing string this wave added is asserted here against the
// owner laws: no gamification vocabulary, no guilt, and TIME-BLIND copy (no
// minute/second/timer words).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { COACH_TURN_LOST_THREAD_LINE } from './api';
import { VOICE_MIC_UNAVAILABLE_LINE, VOICE_PRESET_ESCAPE_LABEL } from './front-door';
import {
  MIC_CHECK_CANCELLED_COPY,
  MIC_CHECK_NOISE_SHIFT_LINE,
  MIC_CHECK_STOP_LABEL,
  MIC_CHECK_VERDICT_COPY,
} from './mic-check';
import {
  VOICE_SESSION_SCOPE_ARIA_LABEL,
  VOICE_SESSION_TIER_LABELS,
} from './session-scope';

// Inline strings that live in standalone-app.ts (degraded boot) — read from
// source, the same pattern standalone-dom.test.ts uses for the shell.
const standaloneAppSource = readFileSync(
  resolve(process.cwd(), 'src/voice/standalone-app.ts'),
  'utf8',
);
const DEGRADED_BOOT_LINE = "Can't reach the practice room — try again in a moment.";

const NEW_COPY_INVENTORY: Record<string, string> = {
  presetEscape: VOICE_PRESET_ESCAPE_LABEL,
  micUnavailable: VOICE_MIC_UNAVAILABLE_LINE,
  degradedBoot: DEGRADED_BOOT_LINE,
  degradedRetry: 'Retry',
  degradedRetrying: 'Trying…',
  lostTurn: COACH_TURN_LOST_THREAD_LINE,
  micCheckNoisy: MIC_CHECK_VERDICT_COPY.noisy,
  micCheckCancelled: MIC_CHECK_CANCELLED_COPY,
  micCheckStop: MIC_CHECK_STOP_LABEL,
  micCheckNoiseShift: MIC_CHECK_NOISE_SHIFT_LINE,
  tierSpeaking: VOICE_SESSION_TIER_LABELS.speaking,
  tierQuiet: VOICE_SESSION_TIER_LABELS.quiet,
  tierListening: VOICE_SESSION_TIER_LABELS.listening,
  tierAria: VOICE_SESSION_SCOPE_ARIA_LABEL,
};

// Gamification / pressure vocabulary the product bans outright.
const BANNED_VOCAB = [
  /\bstreak/i,
  /\bbadge/i,
  /\bpoints?\b/i,
  /\bscore/i,
  /\bxp\b/i,
  /\blevel\s*up/i,
  /\bleaderboard/i,
  /\breward/i,
  /\bcombo\b/i,
];

// Guilt-shaped phrasing: the app never scolds, hurries, or implies debt.
const GUILT_VOCAB = [
  /\byou (should|must|failed|need to)\b/i,
  /\bdon'?t give up\b/i,
  /\bhurry\b/i,
  /\btoo late\b/i,
  /\bmissed\b/i,
  /\bbehind\b/i,
];

// Time-blind law: no clock words in user-facing copy. ("sec" as a bare idiom
// is not matched by /\bseconds?\b/ — that is deliberate, see header.)
const TIME_VOCAB = [
  /\bminutes?\b/i,
  /\bseconds?\b/i,
  /\btimer\b/i,
  /\bcountdown\b/i,
  /\bhours?\b/i,
  /\bdeadline\b/i,
];

describe('abandon-trigger wave copy inventory (owner laws)', () => {
  it.each(Object.entries(NEW_COPY_INVENTORY))('%s: calm, guilt-free, time-blind', (_name, copy) => {
    expect(copy.trim().length).toBeGreaterThan(0);
    for (const pattern of [...BANNED_VOCAB, ...GUILT_VOCAB, ...TIME_VOCAB]) {
      expect(copy).not.toMatch(pattern);
    }
  });

  it('the degraded-boot line and retry labels ship verbatim in standalone-app.ts', () => {
    expect(standaloneAppSource).toContain(DEGRADED_BOOT_LINE);
    expect(standaloneAppSource).toContain("textContent = 'Retry'");
    expect(standaloneAppSource).toContain("textContent = 'Trying…'");
  });

  it('both templates carry the preset peer button; the tertiary-link copy is gone', () => {
    const templateHtml = readFileSync(
      resolve(process.cwd(), 'src/voice/templates/voice-tutor-template.html'),
      'utf8',
    );
    const mirrorSource = readFileSync(
      resolve(process.cwd(), 'src/voice/standalone-template.ts'),
      'utf8',
    );
    for (const source of [templateHtml, mirrorSource]) {
      expect(source).toContain(VOICE_PRESET_ESCAPE_LABEL);
      // Peer weight: the skip control is a real button, not the fallback link.
      expect(source).toContain('id="voice-front-door-skip" class="voice-btn voice-btn-secondary"');
      expect(source).not.toContain('No sample yet? Start with a preset instead');
      // The tier indicator control exists in the rail header of both.
      expect(source).toContain('id="voice-session-scope"');
      // The calm mic-denied line slot exists (populated from the constant).
      expect(source).toContain('id="voice-front-door-mic-denied"');
    }
  });

  it('the lost-turn line stays honest and dignified', () => {
    // "didn't reach me" is only ever shown for pure network loss — the copy
    // must not promise anything about server state it can't know.
    expect(COACH_TURN_LOST_THREAD_LINE).toBe("Say that again? That one didn't reach me.");
  });
});
