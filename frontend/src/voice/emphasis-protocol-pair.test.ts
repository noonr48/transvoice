// Word-emphasis channel — PROTOCOL PAIR check.
//
// The channel has two halves that must agree on one thing: what "occurrence N
// of the stressed word" means.
//   * frontend  resolveSpokenLineEmphasis (lesson/card.ts) COUNTS it
//   * backend   shapeEmphasisClause (voice-emphasis-shaping.js) RESOLVES it
// If they ever disagree, the tutor stresses the wrong word and nothing in either
// half's own tests would notice — each is internally consistent. So this file
// drives the REAL backend module (not a copy) with the REAL frontend output and
// asserts the comma landed around the word the card actually authored.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  resolveSpokenLineEmphasis,
  normalizeVoicePracticeCard,
  type VoicePracticeCard,
} from './lesson/card';

const require = createRequire(import.meta.url);
const { shapeEmphasisClause } = require('../../../backend/voice-emphasis-shaping.js') as {
  shapeEmphasisClause: (input: {
    text: string;
    emphasisWord: string;
    occurrence?: number | null;
    tokenIndex?: number | null;
  }) => { text: string; matched: boolean; shaped: boolean; occurrenceUsed: number | null };
};

function card(tokens: Array<[string, number]>, phrase: string): VoicePracticeCard {
  return normalizeVoicePracticeCard({
    id: 'pair-card',
    phrase,
    tokens: tokens.map(([text, emphasis]) => ({ text, emphasis })),
  }) as VoicePracticeCard;
}

/** Run the full channel exactly as production does. */
function roundTrip(spoken: string, practiceCard: VoicePracticeCard) {
  const emphasis = resolveSpokenLineEmphasis(spoken, practiceCard);
  if (!emphasis) return { emphasis: null, shaped: spoken };
  const result = shapeEmphasisClause({
    text: spoken,
    emphasisWord: emphasis.word,
    occurrence: emphasis.occurrence,
    tokenIndex: emphasis.tokenIndex,
  });
  return { emphasis, shaped: result.text, occurrenceUsed: result.occurrenceUsed };
}

describe('frontend counts the occurrence the backend resolves', () => {
  it('prefix collision: the comma lands on the phrase word, never the prefix', () => {
    const practiceCard = card([['Hold', 0], ['the', 0], ['line', 3]], 'Hold the line');
    const { emphasis, shaped } = roundTrip('New line: Hold the line. Keep it light.', practiceCard);

    expect(emphasis).toEqual({ word: 'line', tokenIndex: 2, occurrence: 1 });
    expect(shaped).toBe('New line: Hold the, line. Keep it light.');
    expect(shaped.startsWith('New,')).toBe(false);
  });

  it('repeated word: the comma lands on the authored copy, not the first', () => {
    const practiceCard = card(
      [['hello', 1], ['small', 1], ['hello', 2], ['big', 1]],
      'hello small hello big',
    );
    const { emphasis, shaped } = roundTrip('New line: hello small hello big.', practiceCard);

    expect(emphasis).toEqual({ word: 'hello', tokenIndex: 2, occurrence: 1 });
    expect(shaped).toBe('New line: hello small, hello, big.');
  });

  it('prefix AND in-phrase repeat compound correctly', () => {
    const practiceCard = card([['line', 0], ['and', 0], ['line', 3]], 'line and line');
    const { emphasis, shaped, occurrenceUsed } = roundTrip('New line: line and line.', practiceCard);

    expect(emphasis?.occurrence).toBe(2);
    expect(occurrenceUsed).toBe(2);
    // occurrences: prefix(0) "line", phrase(1) "line", phrase(2) "line" <- authored
    expect(shaped).toBe('New line: line and, line.');
  });

  it('bare phrase (the hear-line case) resolves to occurrence 0', () => {
    const practiceCard = card([['I', 0], ['mean', 0], ['today', 2]], 'I mean today');
    const { emphasis, shaped } = roundTrip('I mean today', practiceCard);

    expect(emphasis).toEqual({ word: 'today', tokenIndex: 2, occurrence: 0 });
    expect(shaped).toBe('I mean, today');
  });

  it('no authored stress -> nothing is sent and nothing is shaped', () => {
    const practiceCard = card([['I', 0], ['mean', 1], ['today', 1]], 'I mean today');
    const { emphasis, shaped } = roundTrip('New line: I mean today.', practiceCard);

    expect(emphasis).toBeNull();
    expect(shaped).toBe('New line: I mean today.');
  });

  it('the two halves agree on boundaries, casing and punctuation across a sweep', () => {
    const words = ['line', 'today', "don't", 'well-known', 'İstanbul', 'a'];
    const prefixes = ['', 'New line: ', 'Okay. ', 'Try — ', '"'];
    const suffixes = ['', '.', ' Keep it light.', '!', '"'];
    const bodies = [
      ['hold the WORD steady', 2],
      ['WORD', 0],
      ['WORD and WORD again', 2],
      ['say WORD, then WORD', 1],
      ['(WORD holds)', 0],
      ['ahh… WORD ehh', 1],
    ] as Array<[string, number]>;

    let checked = 0;
    for (const word of words) {
      for (const [template, stressedTokenIndex] of bodies) {
        const phrase = template.replace(/WORD/g, word);
        const tokens = phrase
          .split(/\s+/)
          .map((token, index) => [token, index === stressedTokenIndex ? 3 : 0] as [string, number]);
        // Only meaningful when the stressed token really is the word.
        const core = tokens[stressedTokenIndex][0].replace(/[^\p{L}\p{N}'’-]/gu, '');
        if (core.toLowerCase() !== word.toLowerCase()) continue;
        const practiceCard = card(tokens, phrase);

        for (const prefix of prefixes) {
          for (const suffix of suffixes) {
            const spoken = `${prefix}${phrase}${suffix}`;
            const { emphasis, shaped } = roundTrip(spoken, practiceCard);
            checked += 1;

            // HARD CONTRACT: only commas may ever differ.
            expect(shaped.replace(/,/g, '')).toBe(spoken.replace(/,/g, ''));
            expect(shaped.includes(',,')).toBe(false);

            if (!emphasis) continue;
            // The backend must have resolved the SAME occurrence the frontend
            // counted — proven positionally: the comma(s) hug that occurrence.
            const offsets: number[] = [];
            const pattern = new RegExp(
              emphasis.word.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`),
              'gi',
            );
            let match = pattern.exec(spoken);
            while (match !== null) {
              const start = match.index;
              const end = start + match[0].length;
              const before = start > 0 ? spoken[start - 1] : '';
              const after = end < spoken.length ? spoken[end] : '';
              const isWord = (ch: string) => Boolean(ch) && /[\p{L}\p{N}'’-]/u.test(ch);
              if (!isWord(before) && !isWord(after)) {
                offsets.push(start);
                pattern.lastIndex = end;
              } else {
                pattern.lastIndex = start + 1;
              }
              match = pattern.exec(spoken);
            }
            expect(emphasis.occurrence).toBeLessThan(offsets.length);

            if (shaped !== spoken) {
              // Every added comma must sit immediately beside the chosen span.
              const target = offsets[emphasis.occurrence];
              const targetEnd = target + emphasis.word.length;
              const addedAt: number[] = [];
              let s = 0;
              let t = 0;
              while (s < shaped.length && t < spoken.length) {
                if (shaped[s] === spoken[t]) { s += 1; t += 1; continue; }
                expect(shaped[s]).toBe(',');
                addedAt.push(t);
                s += 1;
              }
              while (s < shaped.length) { expect(shaped[s]).toBe(','); addedAt.push(t); s += 1; }
              for (const at of addedAt) {
                const hugsLeft = at <= target && target - at <= 2;
                const hugsRight = at === targetEnd;
                expect(
                  hugsLeft || hugsRight,
                  `comma at ${at} does not hug occurrence ${emphasis.occurrence} `
                  + `[${target},${targetEnd}) of "${emphasis.word}" in "${spoken}" -> "${shaped}"`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});
