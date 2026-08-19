// Word-emphasis channel — the frontend half.
//
// Three questions, one per layer:
//   1. card.ts      — which token does the demo lean on?
//   2. hear-line.ts — does that word reach the speak call?
//   3. coach-speech — does it reach the gateway request, and ONLY for line demos?
//
// The gateway half (clause shaping, the witness, cloning left alone) is proved
// in backend/voice-emphasis-gateway.test.js.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCoachSpeechController } from './coach-speech';
import { setupVoiceHearLine } from './hear-line';
import { createDefaultVoiceUiState } from './state';
import { createVoiceLessonController } from './lesson/controller';
import {
  resolveVoiceCardEmphasis,
  resolveSpokenLineEmphasis,
  normalizeVoicePracticeCard,
  type VoicePracticeCard,
} from './lesson/card';

function cardWithEmphasis(
  tokens: Array<{ text: string; emphasis: number }>,
  phrase?: string,
): VoicePracticeCard {
  return normalizeVoicePracticeCard({
    id: 'card-1',
    phrase: phrase ?? tokens.map((token) => token.text).join(' '),
    tokens,
  }) as VoicePracticeCard;
}

describe('emphasis token resolution (card)', () => {
  it('picks the highest emphasis level at or above 2', () => {
    const card = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'can', emphasis: 1 },
      { text: 'do', emphasis: 2 },
      { text: 'that', emphasis: 3 },
      { text: 'today', emphasis: 2 },
    ]);
    expect(resolveVoiceCardEmphasis(card)).toEqual({ word: 'that', tokenIndex: 3, level: 3 });
  });

  it('breaks a tie on the FIRST qualifying token', () => {
    const card = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'really', emphasis: 2 },
      { text: 'mean', emphasis: 1 },
      { text: 'that', emphasis: 2 },
    ]);
    expect(resolveVoiceCardEmphasis(card)).toEqual({ word: 'really', tokenIndex: 1, level: 2 });
  });

  it('ignores levels below 2 — those are ordinary speech, not authored stress', () => {
    const card = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'can', emphasis: 1 },
      { text: 'do', emphasis: 1 },
    ]);
    expect(resolveVoiceCardEmphasis(card)).toBeNull();
  });

  it('is null-safe for an absent or empty card', () => {
    expect(resolveVoiceCardEmphasis(null)).toBeNull();
    expect(resolveVoiceCardEmphasis({ tokens: [] } as unknown as VoicePracticeCard)).toBeNull();
  });

  it('returns the index into card.tokens so a repeated word stays distinguishable', () => {
    const card = cardWithEmphasis([
      { text: 'today', emphasis: 0 },
      { text: 'and', emphasis: 0 },
      { text: 'today', emphasis: 3 },
    ]);
    expect(resolveVoiceCardEmphasis(card)).toEqual({ word: 'today', tokenIndex: 2, level: 3 });
  });
});

describe('occurrence resolution against the SPOKEN string', () => {
  // These are the defects the independent review caught: a card TOKEN index is
  // meaningless against a prefixed utterance, so the demo must translate it into
  // an occurrence ordinal counted on the exact string it is about to send.

  it('REGRESSION: an announcement prefix containing the word shifts the occurrence', () => {
    const card = cardWithEmphasis([
      { text: 'Hold', emphasis: 0 },
      { text: 'the', emphasis: 0 },
      { text: 'line', emphasis: 3 },
    ], 'Hold the line');
    const spoken = 'New line: Hold the line. Keep it light.';

    // "line" occurs twice in the spoken text; the card's is the SECOND.
    expect(resolveSpokenLineEmphasis(spoken, card)).toEqual({
      word: 'line', tokenIndex: 2, occurrence: 1,
    });
  });

  it('REGRESSION: a word the phrase repeats resolves to the authored copy', () => {
    const card = cardWithEmphasis([
      { text: 'hello', emphasis: 1 },
      { text: 'small', emphasis: 1 },
      { text: 'hello', emphasis: 2 },
      { text: 'big', emphasis: 1 },
    ], 'hello small hello big');
    const spoken = 'New line: hello small hello big.';

    expect(resolveSpokenLineEmphasis(spoken, card)).toEqual({
      word: 'hello', tokenIndex: 2, occurrence: 1,
    });
  });

  it('counts prefix occurrences AND in-phrase repeats together', () => {
    const card = cardWithEmphasis([
      { text: 'line', emphasis: 0 },
      { text: 'and', emphasis: 0 },
      { text: 'line', emphasis: 3 },
    ], 'line and line');
    const spoken = 'New line: line and line.';

    // prefix "line"(0) + phrase "line"(1) + phrase "line"(2) -> the card's is #2
    expect(resolveSpokenLineEmphasis(spoken, card)).toEqual({
      word: 'line', tokenIndex: 2, occurrence: 2,
    });
  });

  it('resolves occurrence 0 when the spoken text IS the bare phrase', () => {
    const card = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'mean', emphasis: 0 },
      { text: 'today', emphasis: 2 },
    ], 'I mean today');

    expect(resolveSpokenLineEmphasis('I mean today', card)).toEqual({
      word: 'today', tokenIndex: 2, occurrence: 0,
    });
  });

  it('strips card-token punctuation before matching', () => {
    const card = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'mean', emphasis: 0 },
      { text: 'today.', emphasis: 2 },
    ], 'I mean today.');

    expect(resolveSpokenLineEmphasis('New line: I mean today.', card)).toEqual({
      word: 'today', tokenIndex: 2, occurrence: 0,
    });
  });

  it('returns null rather than guessing when the phrase is not locatable and the word repeats', () => {
    const card = cardWithEmphasis([
      { text: 'say', emphasis: 0 },
      { text: 'now', emphasis: 3 },
    ], 'a phrase that is nowhere in the utterance');

    expect(resolveSpokenLineEmphasis('now and now again', card)).toBeNull();
  });

  it('still resolves when the phrase is not locatable but the word is unambiguous', () => {
    const card = cardWithEmphasis([
      { text: 'say', emphasis: 0 },
      { text: 'now', emphasis: 3 },
    ], 'a phrase that is nowhere in the utterance');

    expect(resolveSpokenLineEmphasis('please say it now', card)).toEqual({
      word: 'now', tokenIndex: 1, occurrence: 0,
    });
  });

  it('returns null when the word is absent from the spoken text entirely', () => {
    const card = cardWithEmphasis([
      { text: 'say', emphasis: 0 },
      { text: 'today', emphasis: 3 },
    ], 'say today');

    expect(resolveSpokenLineEmphasis('nothing relevant here', card)).toBeNull();
  });

  it('REGRESSION: a phrase that also occurs in the prefix is refused, not guessed', () => {
    // Reviewer repro: phrase "line" appears inside "New line: " too. Searching
    // would anchor on the prefix and stress the wrong word.
    const shortCard = cardWithEmphasis([['line', 3]].map(([text, emphasis]) => ({
      text: text as string, emphasis: emphasis as number,
    })), 'line');

    expect(resolveSpokenLineEmphasis('New line: line.', shortCard)).toBeNull();
  });

  it('REGRESSION: an explicit phraseOffset resolves what searching refuses', () => {
    const shortCard = cardWithEmphasis([['line', 3]].map(([text, emphasis]) => ({
      text: text as string, emphasis: emphasis as number,
    })), 'line');

    // The caller BUILT "New line: " + phrase, so it knows the offset exactly.
    expect(resolveSpokenLineEmphasis('New line: line.', shortCard, { phraseOffset: 10 })).toEqual({
      word: 'line', tokenIndex: 0, occurrence: 1,
    });
  });

  it('ignores a phraseOffset that does not actually point at the phrase', () => {
    const practiceCard = cardWithEmphasis([
      { text: 'I', emphasis: 0 },
      { text: 'mean', emphasis: 0 },
      { text: 'today', emphasis: 2 },
    ], 'I mean today');

    // A wrong offset must not be trusted; the unambiguous search still works.
    expect(resolveSpokenLineEmphasis('New line: I mean today.', practiceCard, {
      phraseOffset: 3,
    })).toEqual({ word: 'today', tokenIndex: 2, occurrence: 0 });
  });

  it('REGRESSION: a multi-word card token contributes every copy it holds', () => {
    // Reviewer repro: the LLM card-op `create` path passes token text verbatim,
    // so a token can hold more than one word. Counting whole tokens mis-aimed.
    const practiceCard = cardWithEmphasis([
      { text: 'hello hello', emphasis: 0 },
      { text: 'hello', emphasis: 3 },
      { text: 'big', emphasis: 0 },
    ], 'hello hello hello big');

    expect(resolveSpokenLineEmphasis('New line: hello hello hello big.', practiceCard)).toEqual({
      word: 'hello', tokenIndex: 1, occurrence: 2,
    });
  });

  it('REGRESSION: the word length cap matches the gateway on both sides', () => {
    // A word of exactly the cap still resolves normally.
    const atCap = 'a'.repeat(80);
    const okCard = cardWithEmphasis([
      { text: 'say', emphasis: 0 },
      { text: atCap, emphasis: 3 },
    ], `say ${atCap}`);
    expect(resolveSpokenLineEmphasis(`say ${atCap}`, okCard)).toEqual({
      word: atCap, tokenIndex: 1, occurrence: 0,
    });

    // Past the cap, BOTH halves truncate to the same 80 chars, and the truncated
    // form has no whole-word match — so nothing is sent at all. That is the safe
    // outcome: previously the frontend counted an occurrence for the full word
    // while the gateway looked for the truncated one and silently found nothing.
    const tooLong = 'a'.repeat(120);
    const longCard = cardWithEmphasis([
      { text: 'say', emphasis: 0 },
      { text: tooLong, emphasis: 3 },
    ], `say ${tooLong}`);
    expect(resolveSpokenLineEmphasis(`say ${tooLong}`, longCard)).toBeNull();
  });

  it('is null-safe for an absent card, empty text, or no authored stress', () => {
    expect(resolveSpokenLineEmphasis('New line: hello.', null)).toBeNull();
    expect(resolveSpokenLineEmphasis('', cardWithEmphasis([{ text: 'hi', emphasis: 3 }]))).toBeNull();
    expect(resolveSpokenLineEmphasis('hi there', cardWithEmphasis([
      { text: 'hi', emphasis: 1 },
      { text: 'there', emphasis: 0 },
    ]))).toBeNull();
  });

  it('does not match a substring — word boundaries hold', () => {
    const card = cardWithEmphasis([
      { text: 'day', emphasis: 3 },
      { text: 'off', emphasis: 0 },
    ], 'day off');

    // "day" inside "today" must not count as an occurrence.
    expect(resolveSpokenLineEmphasis('New line: today is a day off.', card)).toEqual({
      word: 'day', tokenIndex: 0, occurrence: 0,
    });
  });
});

describe('hear-line demo threads the emphasis word', () => {
  function mountButton() {
    document.body.innerHTML = '<button type="button" id="voice-hear-line" disabled>Hear it</button>';
    return document.getElementById('voice-hear-line') as HTMLButtonElement;
  }

  it('passes the resolved emphasis alongside the line text', () => {
    const button = mountButton();
    const speakLine = vi.fn(() => true);
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => 'I can do that today.',
      getLineEmphasis: () => ({ word: 'today', tokenIndex: 4, occurrence: 0 }),
      speakLine,
    });
    hearLine.start();
    button.click();

    expect(speakLine).toHaveBeenCalledWith(
      'I can do that today.',
      { word: 'today', tokenIndex: 4, occurrence: 0 },
    );
    hearLine.dispose();
  });

  it('leaves the call shape untouched when the card authors no stress', () => {
    const button = mountButton();
    const speakLine = vi.fn(() => true);
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => 'I can do that today.',
      getLineEmphasis: () => null,
      speakLine,
    });
    hearLine.start();
    button.click();

    expect(speakLine).toHaveBeenCalledWith('I can do that today.');
    hearLine.dispose();
  });
});

describe('the live eyes-free path carries the card emphasis to speakLine', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createController(speakLine: ReturnType<typeof vi.fn>) {
    const uiState = createDefaultVoiceUiState();
    return createVoiceLessonController({
      doc: document,
      getUiState: () => uiState,
      getSessionId: () => 'session-1',
      fetchActiveCard: vi.fn(async () => ({ success: true, card: null })),
      advanceCard: vi.fn(async () => ({ success: true, card: null })),
      attemptAudioUrl: (attemptId: string) => `http://kernel.test/attempts/${attemptId}/audio`,
      submitCoachQuestion: vi.fn(),
      onTakeStartRetry: vi.fn(),
      onNextCard: vi.fn(),
      getLatestCoachText: () => null,
      addLog: vi.fn(),
      speakLine,
      isCoachSpeaking: () => false,
      getInteractionOwner: () => 'idle',
    });
  }

  function fallbackCard(tokens: Array<{ text: string; emphasis: number }>) {
    return {
      sessionScope: { eyesFree: true },
      activeCard: {
        id: 'card-emphasis-1',
        phrase: 'hello there today',
        source: 'fallback',
        focus: { axis: 'pitch', statement: 'Keep it light.' },
        tokens,
      },
    };
  }

  it('passes the stressed word when the card authors one', () => {
    const speakLine = vi.fn(() => true);
    createController(speakLine).applyCoachPayload(fallbackCard([
      { text: 'hello', emphasis: 0 },
      { text: 'there', emphasis: 1 },
      { text: 'today', emphasis: 3 },
    ]));

    expect(speakLine).toHaveBeenCalledWith(
      'New line: hello there today. Keep it light.',
      { word: 'today', tokenIndex: 2, occurrence: 0 },
    );
  });

  it('keeps the original one-argument call when the card authors no stress', () => {
    const speakLine = vi.fn(() => true);
    createController(speakLine).applyCoachPayload(fallbackCard([
      { text: 'hello', emphasis: 0 },
      { text: 'there', emphasis: 1 },
      { text: 'today', emphasis: 1 },
    ]));

    expect(speakLine).toHaveBeenCalledWith('New line: hello there today. Keep it light.');
  });
});

describe('speech request carries the emphasis word for line demos only', () => {
  function createController(fetchImpl: typeof fetch) {
    return createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl,
      createAudio: () => ({
        preload: '', src: '', onended: null, onerror: null,
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      } as any as HTMLAudioElement),
    });
  }

  async function captureSpeechBody(message: Record<string, unknown>) {
    let sentBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      // Fail the response deliberately: the request body is the whole subject
      // here, and an error path keeps playback machinery out of the test.
      return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    createController(fetchImpl).speak(message as any, { provider: 'voxcpm' });
    await Promise.resolve();
    await Promise.resolve();
    return sentBody;
  }

  const emphasis = { word: 'today', tokenIndex: 4, occurrence: 0 };

  it('sends emphasisWord + emphasisTokenIndex for a hear-line demo', async () => {
    const body = await captureSpeechBody({
      id: 'demo-1', role: 'coach', channel: 'coach', kind: 'hear-line',
      content: 'I can do that today.', createdAt: 1, emphasis,
    });
    expect(body?.emphasisWord).toBe('today');
    expect(body?.emphasisOccurrence).toBe(0);
    // A CARD token index must never ride under the gateway's `emphasisTokenIndex`
    // name — that field is a whitespace-token ordinal of the sent text.
    expect(body?.emphasisCardTokenIndex).toBe(4);
    expect(body).not.toHaveProperty('emphasisTokenIndex');
    expect(body?.targetText).toBe('I can do that today.');
  });

  it('sends it for an eyes-free spoken card line too', async () => {
    const body = await captureSpeechBody({
      id: 'demo-2', role: 'coach', channel: 'coach', kind: 'eyes-free',
      content: 'New line: I can do that today.', createdAt: 1, emphasis,
    });
    expect(body?.emphasisWord).toBe('today');
  });

  it('NEVER sends it for a coach free-speech reply, even if one is attached', async () => {
    const body = await captureSpeechBody({
      id: 'reply-1', role: 'coach', channel: 'runtime', kind: 'runtime-answer',
      content: 'Try the ending lighter today.', createdAt: 1, emphasis,
    });
    expect(body).not.toHaveProperty('emphasisWord');
    expect(body).not.toHaveProperty('emphasisTokenIndex');
  });

  it('NEVER sends it for a scope-ack chirp', async () => {
    const body = await captureSpeechBody({
      id: 'ack-1', role: 'coach', channel: 'coach', kind: 'scope-ack',
      content: 'got it', createdAt: 1, emphasis,
    });
    expect(body).not.toHaveProperty('emphasisWord');
  });

  it('omits the field entirely when a line demo carries no emphasis', async () => {
    const body = await captureSpeechBody({
      id: 'demo-3', role: 'coach', channel: 'coach', kind: 'hear-line',
      content: 'I can do that today.', createdAt: 1, emphasis: null,
    });
    expect(body).not.toHaveProperty('emphasisWord');
    expect(body?.targetText).toBe('I can do that today.');
  });

  it('drops a malformed emphasis rather than sending junk to the gateway', async () => {
    const blank = await captureSpeechBody({
      id: 'demo-4', role: 'coach', channel: 'coach', kind: 'hear-line',
      content: 'I can do that today.', createdAt: 1,
      emphasis: { word: '   ', tokenIndex: 4, occurrence: 0 },
    });
    expect(blank).not.toHaveProperty('emphasisWord');

    // No occurrence -> the gateway would have to guess WHICH copy of the word to
    // stress, so the whole emphasis is dropped rather than sent half-specified.
    const noOccurrence = await captureSpeechBody({
      id: 'demo-5', role: 'coach', channel: 'coach', kind: 'hear-line',
      content: 'I can do that today.', createdAt: 1,
      emphasis: { word: 'today', tokenIndex: 4 } as never,
    });
    expect(noOccurrence).not.toHaveProperty('emphasisWord');

    const badIndex = await captureSpeechBody({
      id: 'demo-6', role: 'coach', channel: 'coach', kind: 'hear-line',
      content: 'I can do that today.', createdAt: 1,
      emphasis: { word: 'today', tokenIndex: -3, occurrence: 0 },
    });
    expect(badIndex?.emphasisWord).toBe('today');
    expect(badIndex?.emphasisOccurrence).toBe(0);
    expect(badIndex).not.toHaveProperty('emphasisCardTokenIndex');
  });
});
