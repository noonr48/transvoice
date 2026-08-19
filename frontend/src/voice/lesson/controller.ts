// Lesson surface — orchestrating controller (Wave B).
//
// Ties the lesson zones together and drives them deterministically (NO model
// calls): focus banner, practice card strip + karaoke, voice-compass target
// region, replay overlay, quick intents, keyboard. Self-contained: owns its DOM
// lookups (all optional -> never throws if a template node is absent) and all
// its listeners (dispose() tears everything down). Reads the live VoiceUiState
// for focus/bands/timeline/comparison; fetches the active practice card from the
// dedicated P3 route.
//
// Wiring: standalone-app creates one of these, calls sync() each render,
// applyCoachPayload(payload) when a coach/take payload lands (to capture the
// raw activeCard/replayDirective the shared slice contract drops), and routes
// keydown to handleKeyDown.

import {
  normalizeVoicePracticeCard,
  normalizeVoiceReplayDirective,
  resolveSpokenLineEmphasis,
  voiceCardIdentity,
  voiceCardRevisionIncreased,
  type VoicePracticeCard,
  type VoiceReplayDirective,
} from './card';
import {
  normalizeVoiceGuardianHint,
  normalizeVoicePinSuggestion,
  GUARDIAN_EASE_HINT,
  type VoiceGuardianHint,
  type VoicePinSuggestion,
} from './take-extras';
import { renderVoiceLessonCardStrip, pulseVoiceLessonCard } from './card-strip';
import {
  markCardTokens,
  normalizePhraseForMatch,
  type KaraokeCheckpoint,
  type KaraokeComparison,
  type KaraokeState,
} from './karaoke';
import {
  compassBandsFromProfile,
  compassRegionRect,
  renderVoiceLessonTargetRegion,
} from './compass';
import { resolveFocusBanner, renderVoiceLessonFocusBanner } from './focus-banner';
import { createVoiceLessonReplayController } from './replay';
import { defaultWordTimingSource, tokenIndexAtProgress } from './word-timing';
import type { VoiceSpeechEmphasis } from '../contracts';
import type { VoiceUiState, VoiceLiveFrame, VoicePhraseComparison } from '../state';

type LessonRawCard = unknown;

export type VoiceLessonControllerOptions = {
  doc: Document;
  getUiState: () => VoiceUiState;
  getSessionId: () => string;
  // P3 routes (already on the api object).
  fetchActiveCard: (sessionId: string) => Promise<{ success: boolean; card: LessonRawCard }>;
  advanceCard: (
    sessionId: string,
    options?: { focus?: string; topics?: string[] },
  ) => Promise<{ success: boolean; card: LessonRawCard }>;
  attemptAudioUrl: (attemptId: string) => string;
  // Canned coach questions go through the SAME submit path the chat input uses.
  submitCoachQuestion: (question: string) => void;
  // Take/next actions (implemented by standalone against the bound controls).
  onTakeStartRetry: () => void;
  onNextCard: () => void;
  // Latest coach line text for the focus-banner fallback.
  getLatestCoachText: () => string | null;
  // Authoritative currently rendered practice phrase. This includes lesson
  // board and cue-sheet lines that may not live in activeLine.
  getPracticeLineText?: () => string | null;
  // v1.5 time-lapse mirror: pin a take as this week's marker (POST pin). Wired
  // by standalone against api.pinAttempt; the affordance only shows when the
  // take payload carries pinSuggestion.
  pinAttempt?: (attemptId: string) => Promise<{ success?: boolean }>;
  // v1.5: called after a take payload is applied so the app can refresh the
  // one-real-sentence slot (a take on a real_sentence card may flip it to
  // 'ready' server-side).
  onTakeFinalized?: () => void;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
  // Flow lane — spoken eyes-free surfaces (all optional; absent -> the feature
  // stays silent). Wire from standalone-app mirroring the hear-line wiring:
  // speakLine -> runtime.speakCoachMessage entry, isCoachSpeaking -> the
  // hear-line isSpeaking closure, getInteractionOwner ->
  // getAppRuntime().getVoiceInteractionOwner().
  /**
   * Speak a short line through the coach TTS path (hear-line contract). The
   * optional second argument is the word-emphasis channel: present only when
   * the utterance IS a practice-line demo, so the gateway can shape a clause
   * around the card's stressed word.
   */
  speakLine?: (text: string, emphasis?: VoiceSpeechEmphasis | null) => boolean;
  /** True while coach speech is playing/processing (never overlap it). */
  isCoachSpeaking?: () => boolean;
  /** Live interaction owner ('practice-armed' | 'practice-live' | ...). */
  getInteractionOwner?: () => string;
};

const HELP_QUESTION = 'Help me with this — what exactly should I do right now?';
const BREAK_DOWN_QUESTION = 'Break this task down into smaller steps I can do one at a time.';

function getEl(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id);
}

function comparisonToKaraoke(comparison: VoicePhraseComparison | null): KaraokeComparison | null {
  if (!comparison) return null;
  const checkpoints: KaraokeCheckpoint[] = (comparison.checkpoints || []).map((checkpoint) => ({
    pathMatchScore: checkpoint.pathMatchScore,
    laneMatchScore: checkpoint.laneMatchScore,
    startProgress: checkpoint.startProgress,
    endProgress: checkpoint.endProgress,
  }));
  return { phrase: comparison.phrase, checkpoints };
}

export function createVoiceLessonController(options: VoiceLessonControllerOptions) {
  const { doc } = options;

  // --- DOM (all optional; absent nodes simply disable that zone) ---
  const focusBannerEl = getEl(doc, 'voice-lesson-focus-banner');
  const focusTextEl = getEl(doc, 'voice-lesson-focus-text');
  const focusAxisChipEl = getEl(doc, 'voice-lesson-focus-axis');
  const cardStripEl = getEl(doc, 'voice-lesson-card-strip');
  const cardEl = getEl(doc, 'voice-lesson-card');
  const targetRegionEl = getEl(doc, 'voice-lesson-target-region');
  const replayOverlayEl = getEl(doc, 'voice-lesson-replay-overlay');
  const replayDotEl = getEl(doc, 'voice-lesson-replay-dot');
  const replayTrailSvgEl = doc.getElementById('voice-lesson-replay-trail') as unknown as SVGSVGElement | null;
  const replayTrailPolylineEl = doc.getElementById('voice-lesson-replay-trail-line') as unknown as SVGPolylineElement | null;
  const replayStatusEl = getEl(doc, 'voice-lesson-replay-status');
  const replayCloseEl = getEl(doc, 'voice-lesson-replay-close');
  const replayCardStripEl = getEl(doc, 'voice-lesson-replay-card-strip');
  const replayOfferEl = getEl(doc, 'voice-lesson-replay-offer');
  const intentHelpEl = getEl(doc, 'voice-lesson-intent-help');
  const intentBreakEl = getEl(doc, 'voice-lesson-intent-break');
  const intentListenEl = getEl(doc, 'voice-lesson-intent-listen');
  // Surfacing wave: the Review panel's per-take rows carry a quiet Listen button
  // (render-dom paints the markup; rows rebuild every render, so we delegate ONE
  // click listener on the stable list container instead of per-row bindings).
  const reviewListEl = getEl(doc, 'voice-review-list');
  // v1.5 guardian hint (a muted line under the card) + the existing end-session
  // control we apply a calm emphasis to on 'close'.
  const guardianHintEl = getEl(doc, 'voice-lesson-guardian-hint');
  const endSessionEl = getEl(doc, 'voice-end-session');
  // v1.5 pin affordance (an inline offer on the take result area).
  const pinOfferEl = getEl(doc, 'voice-lesson-pin-offer');
  const pinOfferBtnEl = getEl(doc, 'voice-lesson-pin-offer-button') as HTMLButtonElement | null;
  const pinOfferTextEl = getEl(doc, 'voice-lesson-pin-offer-text');

  const replay = createVoiceLessonReplayController({
    overlay: replayOverlayEl,
    dot: replayDotEl,
    trailSvg: replayTrailSvgEl,
    trailPolyline: replayTrailPolylineEl,
    status: replayStatusEl,
    cardStrip: replayCardStripEl,
    closeButton: replayCloseEl,
  });

  // --- State the controller owns ---
  let currentCard: VoicePracticeCard | null = null;
  let karaoke: KaraokeState[] = [];
  let lastReplayDirective: VoiceReplayDirective | null = null;
  let pendingReplayAttemptId: string | null = null;
  let cardFetchInFlight = false;
  let cardEverFetched = false;
  // Take-completion detection: a change in lastCoachGeneratedAt or summary means
  // a new scored take landed -> recompute karaoke + refresh the card.
  let lastSummarySignature = '';
  let lastPaintSignature = '';
  let cancelPulse: (() => void) | null = null;
  // v1.5 take-extras state.
  let guardianHint: VoiceGuardianHint | null = null;
  let pinSuggestion: VoicePinSuggestion | null = null;
  let pinInFlight = false;
  // Flow lane — spoken eyes-free surfaces state. sessionScope.eyesFree rides
  // the session payload (B-SESS contract) through applyCoachPayload; absent ->
  // stays false and every eyes-free utterance is skipped.
  let sessionScopeEyesFree = false;
  let eyesFreePracticePhase: 'idle' | 'recording' = 'idle';
  let lastSpokenFallbackCardIdentity = '';
  const listenerCleanups: Array<() => void> = [];

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function isCoachSpeakingNow(): boolean {
    if (options.isCoachSpeaking) {
      return options.isCoachSpeaking();
    }
    // Fallbacks: the data-speaking attribute the transport bootstrap reflects
    // on the coach thread, then the __tvCoach shell bridge.
    if (getEl(doc, 'voice-coach-thread')?.getAttribute('data-speaking') === 'true') {
      return true;
    }
    const bridge = (globalThis as { __tvCoach?: { isSpeaking?: () => boolean } }).__tvCoach;
    try {
      return Boolean(bridge?.isSpeaking?.());
    } catch {
      return false;
    }
  }

  // At most one utterance per state change; never overlapping coach speech
  // (skip rather than queue — the next state change speaks again).
  function speakEyesFreeLine(text: string, emphasis: VoiceSpeechEmphasis | null = null): void {
    if (!sessionScopeEyesFree || !options.speakLine) return;
    if (isCoachSpeakingNow()) return;
    // Call shape is unchanged for every utterance that carries no emphasis, so
    // the second argument appears only when there is genuinely a word to stress.
    const started = emphasis
      ? options.speakLine(text, emphasis)
      : options.speakLine(text);
    if (started) {
      log('system', `[voice-eyes-free] spoke: ${text}`);
    }
  }

  // 2026-07-28: a newly assigned line is ALWAYS spoken once, eyes-free or not —
  // the utterance IS the target-voice demo (coach TTS is reference-conditioned),
  // and a beginner cannot be expected to find the sentence on their own. The
  // eyes-free gate above stays on the OTHER utterances ('got it', 'recording'),
  // which are auditory stand-ins for surfaces a sighted learner can see.
  function speakLineAnnouncement(text: string, emphasis: VoiceSpeechEmphasis | null = null): void {
    if (!options.speakLine) return;
    if (isCoachSpeakingNow()) return;
    const started = emphasis
      ? options.speakLine(text, emphasis)
      : options.speakLine(text);
    if (started) {
      log('system', `[voice-line-announce] spoke: ${text}`);
    }
  }

  function summarySignature(state: VoiceUiState): string {
    return [
      state.lastCoachGeneratedAt ?? '',
      state.lastSummary?.metrics?.targetHitPct ?? '',
      state.lastSummary?.durationMs ?? '',
      Array.isArray(state.lastTakeTimeline) ? state.lastTakeTimeline.length : 0,
    ].join('|');
  }

  function recomputeKaraoke(state: VoiceUiState): void {
    const comparison = comparisonToKaraoke(state.phraseComparison);
    const phraseMatches = Boolean(
      currentCard?.phrase
      && comparison?.phrase
      && normalizePhraseForMatch(currentCard.phrase) === normalizePhraseForMatch(comparison.phrase),
    );
    karaoke = markCardTokens(currentCard, comparison, { phraseMatches });
  }

  function paintCard(state: VoiceUiState): void {
    const momentTokenIndex = lastReplayDirective?.momentProgress != null && currentCard
      ? tokenIndexAtProgress(
          defaultWordTimingSource.getTokenWindows(currentCard, 1000),
          lastReplayDirective.momentProgress,
        )
      : -1;
    // Dirty-check: render() fires per live audio frame during a take, so skip the
    // DOM rebuild (and the tooltip/selection churn it causes) when nothing the
    // strip + banner depend on has actually changed since the last paint.
    const fallbackFocusText = options.getLatestCoachText();
    const renderedPracticeLine = getEl(doc, 'voice-active-line-text')?.textContent?.trim() || '';
    const fallbackPhrase = options.getPracticeLineText?.()?.trim()
      || state.activeLine?.displayText?.trim()
      || (renderedPracticeLine && renderedPracticeLine !== 'Waiting for your first line...'
        ? renderedPracticeLine
        : null);
    const paintSignature = [
      voiceCardIdentity(currentCard),
      karaoke.join(''),
      momentTokenIndex,
      currentCard?.focus.statement ?? '',
      currentCard?.focus.axis ?? '',
      currentCard?.focus.statement ? '' : (fallbackFocusText ?? ''),
      currentCard?.phrase ? '' : (fallbackPhrase ?? ''),
    ].join('|');
    if (paintSignature === lastPaintSignature) {
      return;
    }
    lastPaintSignature = paintSignature;

    renderVoiceLessonCardStrip({
      element: cardStripEl,
      card: currentCard,
      karaoke,
      momentTokenIndex,
      fallbackPhrase,
    });
    // Focus banner tracks the card focus (fallback: latest coach line).
    renderVoiceLessonFocusBanner(
      { banner: focusBannerEl, text: focusTextEl, axisChip: focusAxisChipEl },
      resolveFocusBanner({ card: currentCard, fallbackFocusText }),
    );
    void state;
  }

  function setCard(nextCard: VoicePracticeCard | null, state: VoiceUiState): void {
    const previous = currentCard;
    const identityChanged = voiceCardIdentity(previous) !== voiceCardIdentity(nextCard);
    if (!identityChanged && nextCard) {
      // Same rendered card; nothing structural changed.
      return;
    }
    const revisionBumped = voiceCardRevisionIncreased(previous, nextCard);
    currentCard = nextCard;
    recomputeKaraoke(state);
    paintCard(state);
    if (revisionBumped && cardEl) {
      cancelPulse?.();
      cancelPulse = pulseVoiceLessonCard(cardEl);
      log('system', 'Coach adjusted the card.');
    }
    // A newly assigned fallback card is ALWAYS spoken out loud once
    // ("New line: <phrase>. <focus>") — it is the line demo, and a beginner
    // must never have to guess the sentence. Tutor-authored cards already
    // arrive with a spoken coach turn, so only source 'fallback' speaks here;
    // once per card identity.
    if (nextCard && nextCard.source === 'fallback') {
      const spokenIdentity = voiceCardIdentity(nextCard);
      if (spokenIdentity !== lastSpokenFallbackCardIdentity) {
        lastSpokenFallbackCardIdentity = spokenIdentity;
        const focusStatement = (nextCard.focus?.statement || '').trim();
        // Word-emphasis channel: this utterance IS the line demo, so the card's
        // stressed word rides along. The spoken text is PREFIXED ("New line: "),
        // so the emphasis must be resolved against that exact string — a card
        // token index counted against the bare phrase would land on a prefix
        // word or on the wrong copy of a repeated word.
        const linePrefix = 'New line: ';
        const spokenLine = focusStatement
          ? `${linePrefix}${nextCard.phrase}. ${focusStatement}`
          : `${linePrefix}${nextCard.phrase}.`;
        // We BUILT this string, so hand over the exact phrase offset instead of
        // making the resolver search for it — a short phrase can also occur
        // inside the prefix ("New line: line.").
        speakLineAnnouncement(
          spokenLine,
          resolveSpokenLineEmphasis(spokenLine, nextCard, { phraseOffset: linePrefix.length }),
        );
      }
    }
  }

  async function fetchAndApplyCard(opts: { allowAdvance: boolean }): Promise<void> {
    if (cardFetchInFlight) return;
    const sessionId = options.getSessionId();
    if (!sessionId) return;
    cardFetchInFlight = true;
    try {
      const response = await options.fetchActiveCard(sessionId);
      cardEverFetched = true;
      let card = normalizeVoicePracticeCard(response?.card);
      // The lesson never stalls: if there is no active card, pull the first
      // deterministic fallback card.
      if (!card && opts.allowAdvance) {
        const advanced = await options.advanceCard(sessionId).catch(() => null);
        card = normalizeVoicePracticeCard(advanced?.card);
      }
      setCard(card, options.getUiState());
    } catch {
      // Card route unavailable -> leave the strip on its placeholder.
    } finally {
      cardFetchInFlight = false;
    }
  }

  function refreshReplayOffer(): void {
    if (!replayOfferEl) return;
    const offer = Boolean(pendingReplayAttemptId);
    replayOfferEl.classList.toggle('hidden', !offer);
    replayOfferEl.setAttribute('aria-hidden', offer ? 'false' : 'true');
  }

  // --- v1.5 guardian hint: a single muted line under the card; on 'close' the
  // existing end-session control also gets a calm emphasis class. The coach has
  // ALREADY said the full template line in-thread (backend) — this is purely the
  // quiet visual cue. No modal, no red, controls never locked.
  function renderGuardianHint(): void {
    if (guardianHintEl) {
      if (guardianHint) {
        guardianHintEl.textContent = GUARDIAN_EASE_HINT;
        guardianHintEl.classList.remove('hidden');
        guardianHintEl.setAttribute('aria-hidden', 'false');
      } else {
        guardianHintEl.textContent = '';
        guardianHintEl.classList.add('hidden');
        guardianHintEl.setAttribute('aria-hidden', 'true');
      }
    }
    // 'close' calmly emphasizes the end-session control (a settled accent, not an
    // alarm). 'ease' and clean takes leave it untouched.
    endSessionEl?.classList.toggle('voice-lesson-end-emphasis', guardianHint?.level === 'close');
  }

  // --- v1.5 pin affordance: when a take carries pinSuggestion, show a small
  // inline offer on the take result area. Ignoring it costs nothing; accepting
  // POSTs the pin and replaces the offer with a quiet confirmation. The offer is
  // cleared on the next take (and the backend enforces once/session).
  function renderPinOffer(): void {
    if (!pinOfferEl) return;
    const offer = Boolean(pinSuggestion) && !pinInFlight;
    pinOfferEl.classList.toggle('hidden', !offer);
    pinOfferEl.setAttribute('aria-hidden', offer ? 'false' : 'true');
    if (offer && pinOfferTextEl) {
      pinOfferTextEl.textContent = 'keep this one as this week’s marker';
    }
    if (pinOfferBtnEl) {
      pinOfferBtnEl.disabled = pinInFlight;
    }
  }

  async function acceptPinSuggestion(): Promise<void> {
    if (!pinSuggestion || pinInFlight || !options.pinAttempt) return;
    const attemptId = pinSuggestion.attemptId;
    pinInFlight = true;
    renderPinOffer();
    try {
      const result = await options.pinAttempt(attemptId);
      if (result?.success === false) {
        log('warning', 'Could not pin that take.');
        pinInFlight = false;
        renderPinOffer();
        return;
      }
      // Quiet confirmation; the affordance is gone (do not repeat).
      pinSuggestion = null;
      pinInFlight = false;
      if (pinOfferEl) {
        pinOfferEl.classList.remove('hidden');
        pinOfferEl.setAttribute('aria-hidden', 'false');
      }
      if (pinOfferTextEl) pinOfferTextEl.textContent = 'Kept — it’s in your arc.';
      if (pinOfferBtnEl) pinOfferBtnEl.classList.add('hidden');
      log('system', 'Take pinned to your arc.');
    } catch (error) {
      pinInFlight = false;
      renderPinOffer();
      log('warning', `Could not pin that take: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function clearPinOfferForNewTake(): void {
    // A fresh take supersedes any prior pin offer/confirmation; reset the UI so
    // a new suggestion (or none) renders cleanly.
    pinSuggestion = null;
    pinInFlight = false;
    if (pinOfferBtnEl) pinOfferBtnEl.classList.remove('hidden');
    renderPinOffer();
  }

  function resolveReplayFrames(state: VoiceUiState, attemptId?: string | null): VoiceLiveFrame[] {
    // Surfacing wave: a Review-row Listen names a specific attempt — when that
    // artifact retained its own timeline, replay THAT take's trail instead of
    // the last take's (the honest pairing of audio and path).
    if (attemptId) {
      const artifact = (state.attemptArtifacts ?? []).find((candidate) => (
        candidate?.clientAttemptId === attemptId || candidate?.attemptId === attemptId
      ));
      if (artifact && Array.isArray(artifact.timeline) && artifact.timeline.length > 0) {
        return artifact.timeline.slice();
      }
    }
    return Array.isArray(state.lastTakeTimeline) ? state.lastTakeTimeline.slice() : [];
  }

  function resolveReplayArtifact(state: VoiceUiState, attemptId?: string | null) {
    if (!attemptId) return state.lastAttemptArtifact ?? null;
    return (state.attemptArtifacts ?? []).find((candidate) => (
      candidate?.clientAttemptId === attemptId
      || candidate?.attemptId === attemptId
      || candidate?.attemptArtifactId === attemptId
    )) || (state.lastAttemptArtifact && (
      state.lastAttemptArtifact.clientAttemptId === attemptId
      || state.lastAttemptArtifact.attemptId === attemptId
      || state.lastAttemptArtifact.attemptArtifactId === attemptId
    ) ? state.lastAttemptArtifact : null);
  }

  function openReplay(directiveAttemptId?: string | null, sourceControl?: string): void {
    const state = options.getUiState();
    const attemptId = directiveAttemptId
      || lastReplayDirective?.attemptId
      || pendingReplayAttemptId
      || state.lastAttemptArtifact?.clientAttemptId
      || null;
    // clientAttemptId correlates UI/timeline events; VoiceTrainer retains WAVs
    // under attemptArtifactId. Resolve the storage identity before building the
    // audio URL while keeping the client identity for directive comparisons.
    const replayArtifact = resolveReplayArtifact(state, attemptId);
    const audioAttemptId = replayArtifact?.attemptArtifactId || attemptId;
    // Surfacing wave: an explicitly requested attempt (a Review-row Listen) that
    // is NOT the directive's take must not inherit the directive's coach moment
    // or reason — those belong to the take the coach referenced.
    const foreignExplicitAttempt = Boolean(
      directiveAttemptId && lastReplayDirective?.attemptId !== directiveAttemptId,
    );
    replay.open({
      sourceControl,
      attemptId: audioAttemptId,
      frames: resolveReplayFrames(state, attemptId),
      card: currentCard,
      momentProgress: foreignExplicitAttempt ? null : lastReplayDirective?.momentProgress ?? null,
      reason: foreignExplicitAttempt ? null : lastReplayDirective?.reason ?? null,
      resolveAudioUrl: (id) => options.attemptAudioUrl(id),
      onTokenSync: (activeTokenIndex, momentTokenIndex) => {
        renderVoiceLessonCardStrip({
          element: cardStripEl,
          card: currentCard,
          karaoke,
          momentTokenIndex,
          activeTokenIndex,
        });
        // The replay cursor paints an activeTokenIndex the dirty-check doesn't
        // track; invalidate it so the next regular sync() repaints the clean
        // (cursor-free) strip once replay ends.
        lastPaintSignature = '';
      },
    });
    // Consuming the offer dismisses the pulse affordance.
    pendingReplayAttemptId = null;
    refreshReplayOffer();
  }

  // --- Public: capture the raw payload's lesson fields (activeCard/replay) ---
  // The shared VoiceBackendPayload slice drops these, so we read them straight
  // off the raw object at the one seam that still has it (standalone wraps the
  // render / payload apply and calls this).
  function applyCoachPayload(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const record = payload as Record<string, unknown>;
    // Flow lane: the session payload may carry sessionScope (B-SESS contract).
    // Capture eyesFree defensively BEFORE the card applies so a card in the
    // same payload already speaks under the fresh scope; absent key -> no
    // change.
    const sessionScope = record.sessionScope;
    if (sessionScope && typeof sessionScope === 'object') {
      const eyesFree = (sessionScope as Record<string, unknown>).eyesFree;
      if (typeof eyesFree === 'boolean') {
        sessionScopeEyesFree = eyesFree;
      }
    }
    const directive = normalizeVoiceReplayDirective(record.replayDirective);
    if (directive) {
      lastReplayDirective = directive;
      pendingReplayAttemptId = directive.attemptId;
      refreshReplayOffer();
    }
    const card = normalizeVoicePracticeCard(record.activeCard);
    if (card) {
      setCard(card, options.getUiState());
    }

    // v1.5 take-extras: the guardian decision + pin suggestion ride the
    // take-finalize payload. A payload that carries these is a finalized take
    // (the guardian/pinSuggestion keys are only present then), so treat their
    // presence as the take-finalized signal for the pin offer + slot refresh.
    const isTakeFinalize = Object.prototype.hasOwnProperty.call(record, 'guardian')
      || Object.prototype.hasOwnProperty.call(record, 'pinSuggestion')
      || Object.prototype.hasOwnProperty.call(record, 'strainWatch');
    if (isTakeFinalize) {
      // Guardian: set/clear the quiet hint (null guardian on a clean take clears).
      guardianHint = normalizeVoiceGuardianHint(record.guardian);
      renderGuardianHint();
      // Pin suggestion: a new take supersedes any prior offer first, then adopt
      // this take's suggestion (if any). The backend offers at most once/session.
      clearPinOfferForNewTake();
      pinSuggestion = normalizeVoicePinSuggestion(record.pinSuggestion);
      renderPinOffer();
      // Let the app refresh the one-real-sentence slot (a real_sentence take may
      // have flipped its status to 'ready' server-side).
      options.onTakeFinalized?.();
      // Flow lane: eyes-free — short spoken confirmation that the take landed.
      speakEyesFreeLine('got it');
    }

    // A payload may also carry a fresh take/comparison; re-run the full sync so
    // karaoke + compass + focus all reflect it (cheap, idempotent).
    sync();
  }

  // --- Public: called each render frame ---
  function sync(): void {
    const state = options.getUiState();

    // Compass target region from the reference-derived bands.
    renderVoiceLessonTargetRegion(
      targetRegionEl,
      compassRegionRect(compassBandsFromProfile(state.targetVoiceProfile)),
    );

    // First entry into the practice stage: pull a card (advance to a fallback if
    // none) so the strip is never empty.
    if (!cardEverFetched && state.voiceSessionId) {
      void fetchAndApplyCard({ allowAdvance: true });
    }

    // A new scored take landed -> recompute karaoke + refresh the card (the tutor
    // may have adjusted it on the coach turn that follows the take).
    const signature = summarySignature(state);
    if (signature !== lastSummarySignature) {
      lastSummarySignature = signature;
      if (currentCard) {
        recomputeKaraoke(state);
      }
      // Offer a replay of the take just completed (if we have any attempt id).
      const attemptId = state.lastAttemptArtifact?.clientAttemptId || null;
      if (attemptId) {
        pendingReplayAttemptId = attemptId;
      }
      refreshReplayOffer();
      if (cardEverFetched) {
        void fetchAndApplyCard({ allowAdvance: false });
      }
    }

    // Flow lane: eyes-free — one short spoken confirmation when the practice
    // mic goes hot (entering practice-armed/practice-live), reset once
    // practice leaves. One utterance per transition, none while coach speaks.
    const interactionOwner = options.getInteractionOwner?.();
    if (interactionOwner) {
      const phase: 'idle' | 'recording' = (
        interactionOwner === 'practice-armed' || interactionOwner === 'practice-live'
      ) ? 'recording' : 'idle';
      if (phase === 'recording' && eyesFreePracticePhase !== 'recording') {
        speakEyesFreeLine('recording');
      }
      eyesFreePracticePhase = phase;
    }

    // Repaint focus + strip (cheap; idempotent).
    paintCard(state);
  }

  // --- Keyboard (desktop-first) ---
  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function isBlockingSurfaceOpen(): boolean {
    // The practice keys must not fire behind a takeover surface: the replay
    // overlay (it owns its own keys/Esc), the front-door / welcome-back cards,
    // or the v1.5 time-lapse mirror panel (also a takeover surface that owns its
    // own Esc/backdrop). All use the `.hidden { display:none }` convention. The
    // one-real-sentence slot is NOT a takeover surface, so it is not listed.
    if (replay.isOpen()) return true;
    for (const id of ['voice-front-door', 'voice-welcome-back', 'voice-lesson-mirror-overlay']) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Never hijack typing into the coach chat / any field.
    if (isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isBlockingSurfaceOpen()) return;

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      options.onTakeStartRetry();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      options.onNextCard();
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      openReplay();
    }
  }

  function bindIntents(): void {
    const bind = (el: HTMLElement | null, handler: () => void): void => {
      if (!el) return;
      el.addEventListener('click', handler);
      listenerCleanups.push(() => el.removeEventListener('click', handler));
    };
    // Help / Break it down go through the existing coach submit path. (These
    // also carry data-voice-coach-question so the bootstrap auto-binding fires;
    // we guard against a double-send by only binding here when that attribute is
    // absent.)
    if (intentHelpEl && !intentHelpEl.dataset.voiceCoachQuestion) {
      bind(intentHelpEl, () => options.submitCoachQuestion(HELP_QUESTION));
    }
    if (intentBreakEl && !intentBreakEl.dataset.voiceCoachQuestion) {
      bind(intentBreakEl, () => options.submitCoachQuestion(BREAK_DOWN_QUESTION));
    }
    bind(intentListenEl, () => openReplay(null, 'voice-lesson-intent-listen'));
    bind(replayOfferEl, () => openReplay(null, 'voice-lesson-replay-offer'));
    // v1.5 pin affordance.
    bind(pinOfferBtnEl, () => { void acceptPinSuggestion(); });

    // Surfacing wave: delegated per-take Listen — thread the row's attemptId
    // straight into the existing replay machinery (openReplay accepts any id).
    if (reviewListEl) {
      const onReviewListClick = (event: Event): void => {
        const target = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('.voice-review-row-listen')
          : null;
        if (!target || target.disabled) return;
        const attemptId = (target.dataset.attemptId || '').trim();
        if (!attemptId) return;
        log('system', '[voice-surface] review row listen');
        openReplay(attemptId, 'voice-review-row-listen');
      };
      reviewListEl.addEventListener('click', onReviewListClick);
      listenerCleanups.push(() => reviewListEl.removeEventListener('click', onReviewListClick));
    }
  }

  function start(): void {
    bindIntents();
    refreshReplayOffer();
    renderGuardianHint();
    renderPinOffer();
  }

  function dispose(): void {
    cancelPulse?.();
    replay.dispose();
    listenerCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    listenerCleanups.length = 0;
  }

  // v1.5: public refresh of the session's active card (used after a real-sentence
  // pick sets a new real_sentence card active server-side). Belt-and-braces — the
  // pick payload may already have flowed through applyCoachPayload.
  function refreshActiveCard(): void {
    void fetchAndApplyCard({ allowAdvance: false });
  }

  return {
    start,
    sync,
    applyCoachPayload,
    handleKeyDown,
    openReplay,
    refreshActiveCard,
    dispose,
  };
}

export type VoiceLessonController = ReturnType<typeof createVoiceLessonController>;
