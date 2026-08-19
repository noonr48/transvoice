import { describe, expect, it } from 'vitest';
import fixtures from './coach-routing-fixtures.json';
import {
  getVoiceCoachClarificationIntent,
  resolveVoiceCoachHandlingDecision,
  resolveVoiceCoachRoutingDecision,
} from './coach-routing';
import {
  isVoiceCoachCommandShaped,
  normalizeVoiceCoachIntentText,
} from './coach-routing-core';

describe('voice coach routing', () => {
  it('matches the shared clarification-intent corpus', () => {
    for (const fixture of fixtures.clarificationIntents) {
      expect(getVoiceCoachClarificationIntent(fixture.text)).toBe(fixture.intent);
    }
  });

  it('matches the shared routing-decision corpus', () => {
    for (const fixture of fixtures.routingDecisions) {
      expect(resolveVoiceCoachRoutingDecision(fixture.text)).toMatchObject(fixture.decision);
    }
  });

  it('matches the shared handling-decision corpus', () => {
    for (const fixture of fixtures.handlingDecisions) {
      expect(resolveVoiceCoachHandlingDecision(fixture.text, fixture.hasActiveGuideSession)).toMatchObject(fixture.decision);
    }
  });

  // 2026-07-27 field repair: the command-shape gate. Ordinary reflective
  // speech was being consumed as commands ("i'll try to go a bit higher"
  // matched practice-ready and silently armed the mic), which is how the live
  // "tutor never answers" fault happened.
  describe('command-shape gate', () => {
    it('collapses apostrophes so negated commands stay matchable', () => {
      // "don't" used to normalize to "don t", which no \bdon'?t\b pattern can
      // match — and "don't move on" then routed to ADVANCE via move+on.
      expect(normalizeVoiceCoachIntentText("don't move on")).toBe('dont move on');
      expect(normalizeVoiceCoachIntentText("I'm ready")).toBe('im ready');
    });

    it('accepts every configured command phrase as command-shaped', () => {
      for (const fixture of fixtures.clarificationIntents) {
        if (fixture.intent !== null) {
          expect(
            isVoiceCoachCommandShaped(normalizeVoiceCoachIntentText(fixture.text)),
            `expected command-shaped: "${fixture.text}"`,
          ).toBe(true);
        }
      }
    });

    it('rejects utterances that carry non-command content', () => {
      for (const text of [
        'ill try to go a bit higher',
        'i couldnt hit it again',
        'why does it sound so nasal',
        'that felt lighter on the ending',
      ]) {
        expect(isVoiceCoachCommandShaped(text), `expected conversational: "${text}"`).toBe(false);
      }
    });

    it('rejects long utterances even when every word is command vocabulary', () => {
      expect(isVoiceCoachCommandShaped('can we go back over that one more time again please')).toBe(false);
    });

    it('never lets a gated-out utterance defer to the frontend', () => {
      const decision = resolveVoiceCoachRoutingDecision("i'll try to go a bit higher");
      expect(decision.intent).toBeNull();
      expect(decision.shouldDeferToFrontend).toBe(false);
    });
  });
});
