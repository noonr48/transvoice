import { describe, expect, it } from 'vitest';
import {
  BEGINNER_CARD_RESULT_STATES,
  normalizeBeginnerSessionCard,
} from './beginner-session-card';

function card(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'transvoice.beginner_session_card.v1',
    focus: { label: 'Comfortable pitch', otherFocusMentioned: [] },
    listen: { hasApprovedDemo: true },
    try: { steps: ['Start with an easy "mm."', 'Glide a small step upward.'] },
    record: { affordance: 'button', label: 'Record' },
    result: { state: 'verified_progress', message: 'That change moved the way you wanted and it stayed easy.' },
    next: { message: 'Try it once without the guide.' },
    feedback: null,
    technicalDetails: null,
    ...overrides,
  };
}

describe('normalizeBeginnerSessionCard', () => {
  it('normalizes a complete verified-progress card', () => {
    const normalized = normalizeBeginnerSessionCard(card());
    expect(normalized).not.toBeNull();
    expect(normalized!.focusLabel).toBe('Comfortable pitch');
    expect(normalized!.listenHasDemo).toBe(true);
    expect(normalized!.trySteps).toHaveLength(2);
    expect(normalized!.showRecord).toBe(true);
    expect(normalized!.recordLabel).toBe('Record');
    expect(normalized!.resultState).toBe('verified_progress');
    expect(normalized!.fadingMode).toBeNull();
    expect(normalized!.isSafetyStop).toBe(false);
  });

  it('carries the fading why-copy when a mode is present', () => {
    const normalized = normalizeBeginnerSessionCard(card({
      feedback: { mode: 'hidden_guide', whyMessage: 'The guide stays off for this one. You know the feeling now — trust it and go.' },
    }));
    expect(normalized!.fadingMode).toBe('hidden_guide');
    expect(normalized!.fadingWhy).toContain('trust it and go');
  });

  it('drops malformed feedback entirely (no invented explanation)', () => {
    for (const feedback of [null, {}, { mode: 'vibes', whyMessage: 'x' }, { mode: 'hidden_guide' }, 'junk']) {
      const normalized = normalizeBeginnerSessionCard(card({ feedback }));
      expect(normalized!.fadingMode).toBeNull();
      expect(normalized!.fadingWhy).toBeNull();
    }
  });

  it('safety stop collapses the card client-side too (defense in depth)', () => {
    // Even a buggy payload that still carries record + steps + focus on a
    // safety_stop card must not model them here.
    const normalized = normalizeBeginnerSessionCard(card({
      result: { state: 'safety_stop', message: 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.' },
      next: { message: 'Rest your voice now. You can come back to practice later.' },
    }));
    expect(normalized!.isSafetyStop).toBe(true);
    expect(normalized!.showRecord).toBe(false);
    expect(normalized!.recordLabel).toBe('');
    expect(normalized!.trySteps).toEqual([]);
    expect(normalized!.focusLabel).toBeNull();
    expect(normalized!.listenHasDemo).toBe(false);
  });

  it('fails closed to null on unknown result states', () => {
    const normalized = normalizeBeginnerSessionCard(card({
      result: { state: 'mystery_state', message: 'x' },
    }));
    expect(normalized).toBeNull();
  });

  it('fails closed to null on schema mismatch / garbage / missing result', () => {
    expect(normalizeBeginnerSessionCard(null)).toBeNull();
    expect(normalizeBeginnerSessionCard('junk')).toBeNull();
    expect(normalizeBeginnerSessionCard({ schema: 'transvoice.other.v1' })).toBeNull();
    // F2a red-pin: a COMPLETE card under a wrong schema still nulls — the
    // schema gate is load-bearing, not shadowed by the missing-field gates.
    expect(normalizeBeginnerSessionCard({ ...card(), schema: 'transvoice.beginner_session_card.v2' })).toBeNull();
    expect(normalizeBeginnerSessionCard(card({ result: null }))).toBeNull();
    expect(normalizeBeginnerSessionCard(card({ next: null }))).toBeNull();
    expect(normalizeBeginnerSessionCard(card({ result: { state: 'verified_progress' } }))).toBeNull(); // no message
  });

  it('caps and trims steps; drops non-string steps', () => {
    const normalized = normalizeBeginnerSessionCard(card({
      try: { steps: ['  ', 42, 'Real step', ...Array.from({ length: 12 }, (_, i) => `step ${i}`)] },
    }));
    expect(normalized!.trySteps[0]).toBe('Real step');
    expect(normalized!.trySteps.length).toBeLessThanOrEqual(8);
  });

  it('knows the full backend result vocabulary (contract sync)', () => {
    // F3 (hardening review): enumerate ALL 13 literals — a backend rename of ANY state (or a
    // 14th addition) must turn this red, not drift silently into fail-closed
    // null-cards nobody notices.
    expect([...BEGINNER_CARD_RESULT_STATES]).toEqual([
      'ready_for_instruction',
      'could_not_measure',
      'no_reliable_change',
      'movement_needs_confirmation',
      'change_was_mixed',
      'change_too_effortful',
      'cue_not_helping_yet',
      'verified_progress',
      'ease_reset',
      'safety_stop',
      'no_actionable_correction',
      'checking_result',
      'next_step_ready',
    ]);
  });

  it('F3 kill: the two R1-005 states normalize (no silent null-card drift)', () => {
    const checking = normalizeBeginnerSessionCard(card({
      result: { state: 'checking_result', message: 'Checking that take against the last one now.' },
    }));
    expect(checking).not.toBeNull();
    expect(checking!.resultState).toBe('checking_result');

    const nextStep = normalizeBeginnerSessionCard(card({
      result: { state: 'next_step_ready', message: 'You have made real progress — the next practice step is ready.' },
    }));
    expect(nextStep).not.toBeNull();
    expect(nextStep!.resultState).toBe('next_step_ready');
  });

  it('F2c/F3: fading fails closed on the inverse shape and the stop collapse', () => {
    // whyMessage WITHOUT mode (inverse): no fading block — never a floating
    // explanation with nothing to explain.
    const inverse = normalizeBeginnerSessionCard(card({
      feedback: { whyMessage: 'The guide stays off for this one.' },
    }));
    expect(inverse!.fadingMode).toBeNull();
    expect(inverse!.fadingWhy).toBeNull();

    // A stop card carries NO fading block either (defense in depth): even a
    // buggy payload with a complete fading block cannot show a why-message
    // next to stop language.
    const stopWithFading = normalizeBeginnerSessionCard(card({
      result: { state: 'safety_stop', message: 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.' },
      next: { message: 'Rest your voice now.' },
      feedback: { mode: 'hidden_guide', whyMessage: 'The guide stays off for this one.' },
    }));
    expect(stopWithFading!.isSafetyStop).toBe(true);
    expect(stopWithFading!.fadingMode).toBeNull();
    expect(stopWithFading!.fadingWhy).toBeNull();
  });

  it('a record-less non-stop payload renders no record affordance', () => {
    const normalized = normalizeBeginnerSessionCard(card({ record: null }));
    expect(normalized!.showRecord).toBe(false);
    expect(normalized!.recordLabel).toBe('');
  });

  it('defaults a missing record label to Record (button semantics survive)', () => {
    const normalized = normalizeBeginnerSessionCard(card({
      record: { affordance: 'button' },
    }));
    expect(normalized!.showRecord).toBe(true);
    expect(normalized!.recordLabel).toBe('Record');
  });
});
