// Lesson surface — replay overlay "listen back together" (Wave B).
//
// Plays a recorded attempt's audio while the compass re-travels the recorded
// timeline (dot + growing trail via the EXISTING pure renderers) and the card
// tokens re-mark in sync (WordTimingSource windows). The coach's referenced
// moment (momentProgress) is flagged on the matching token and pulses the
// compass at that frame. 404 / no kept audio -> visual-only replay.
//
// Triggers (wired by the lesson controller): replayDirective (auto-offer),
// keyboard R, "Listen back" intent. This module exposes open()/close() and
// owns ALL its listeners + the audio element; close() tears everything down.

import { renderVoiceGraphDot, renderVoicePolylinePath, getVoiceMetricsFromFrame } from '../render/graph';
import type { VoiceLiveFrame } from '../state';
import type { VoicePracticeCard } from './card';
import {
  defaultWordTimingSource,
  tokenIndexAtElapsed,
  tokenIndexAtProgress,
  type WordTimingSource,
  type VoiceTokenWindow,
} from './word-timing';
import {
  replayFrameIndex,
  replayFrameIndexAtProgress,
  replayTrailFrames,
} from './replay-frames';

export type ReplayOverlayElements = {
  overlay: HTMLElement | null | undefined; // the dialog/backdrop container (toggled .hidden)
  dot: HTMLElement | null | undefined; // moving dot inside the overlay compass
  trailSvg: SVGSVGElement | null | undefined; // svg wrapper for the trail polyline
  trailPolyline: SVGPolylineElement | null | undefined;
  status: HTMLElement | null | undefined; // text line ("no audio kept…")
  cardStrip: HTMLElement | null | undefined; // overlay copy of the card strip (optional)
  closeButton: HTMLElement | null | undefined;
};

export type ReplayOpenOptions = {
  /** Fixed telemetry control id for a user-triggered open; omitted for automatic/keyboard playback. */
  sourceControl?: string;
  attemptId: string | null; // null/empty -> visual-only
  frames: VoiceLiveFrame[]; // recorded take timeline
  card: VoicePracticeCard | null;
  momentProgress: number | null; // 0..1 coach-referenced moment, or null
  reason: string | null;
  // Build the attempt-audio URL (api.fetchAttemptAudioUrl). Null/absent -> no audio.
  resolveAudioUrl?: (attemptId: string) => string;
  // Re-mark the card tokens during replay: called with the active token index +
  // moment token index each tick (the controller paints the real strip).
  onTokenSync?: (activeTokenIndex: number, momentTokenIndex: number) => void;
  // Visual-only fallback duration (ms) when there is no audio.
  visualOnlyDurationMs?: number;
  timingSource?: WordTimingSource;
  // v1.5 time-lapse mirror: which trail this take paints. 'then' applies the
  // muted past-take trail color; 'now' (default) the standard current color.
  // Toggled as a CSS class on the trail SVG — no new render fork.
  trailVariant?: 'then' | 'now';
  // v1.5 time-lapse mirror: fired when this take finishes playing (audio 'ended'
  // OR the visual-only animation completes). Lets the mirror chain take A -> B
  // sequentially through the SAME controller without forking the playback core.
  // Fires at most once per open().
  onComplete?: () => void;
};

type ReplaySession = {
  audio: HTMLAudioElement | null;
  rafId: number | null;
  visualStartMs: number | null;
  cleanups: Array<() => void>;
};

const DEFAULT_VISUAL_DURATION_MS = 4000;

export function createVoiceLessonReplayController(elements: ReplayOverlayElements) {
  let active: ReplaySession | null = null;

  function paintFrame(
    frames: VoiceLiveFrame[],
    k: number,
  ): void {
    if (k < 0) return;
    const frame = frames[Math.min(k, frames.length - 1)] || null;
    renderVoiceGraphDot({
      element: elements.dot,
      metrics: getVoiceMetricsFromFrame(frame),
      isReference: false,
    });
    renderVoicePolylinePath({
      svgEl: elements.trailSvg,
      polylineEl: elements.trailPolyline,
      timeline: replayTrailFrames(frames, k),
    });
  }

  function pulseCompassMoment(): void {
    if (!elements.dot) return;
    elements.dot.classList.remove('voice-lesson-replay-moment');
    void elements.dot.offsetWidth;
    elements.dot.classList.add('voice-lesson-replay-moment');
  }

  function teardownSession(): void {
    if (!active) return;
    if (active.rafId != null) {
      cancelAnimationFrame(active.rafId);
    }
    if (active.audio) {
      active.audio.pause();
      // Drop the source + force the element to release the network/file handle.
      active.audio.removeAttribute('src');
      try {
        active.audio.load();
      } catch {
        /* element may be detached; ignore */
      }
    }
    active.cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort teardown */
      }
    });
    active = null;
  }

  function setStatus(text: string): void {
    if (elements.status) {
      elements.status.textContent = text;
    }
  }

  function close(): void {
    teardownSession();
    elements.dot?.classList.remove('voice-lesson-replay-moment');
    // Clear any time-lapse trail variant so a subsequent normal replay is clean.
    elements.trailSvg?.classList.remove('voice-lesson-replay-trail-then', 'voice-lesson-replay-trail-now');
    elements.overlay?.classList.add('hidden');
    elements.overlay?.setAttribute('aria-hidden', 'true');
  }

  function open(options: ReplayOpenOptions): void {
    // A fresh open always tears down any prior session first.
    teardownSession();
    if (!elements.overlay) return;

    const frames = Array.isArray(options.frames) ? options.frames : [];
    const timing = options.timingSource ?? defaultWordTimingSource;
    const visualDurationMs = options.visualOnlyDurationMs ?? DEFAULT_VISUAL_DURATION_MS;
    const cleanups: Array<() => void> = [];

    elements.overlay.classList.remove('hidden');
    elements.overlay.setAttribute('aria-hidden', 'false');
    if (options.sourceControl) {
      elements.overlay.ownerDocument.defaultView?.dispatchEvent(new CustomEvent('tv-control-effect', {
        detail: {
          control: options.sourceControl,
          effect: 'replay-opened',
          status: 'succeeded',
        },
      }));
    }

    // v1.5 time-lapse mirror: paint this take's trail in its variant color. The
    // muted "then" trail vs the standard "now" trail (CSS-driven; default 'now').
    if (elements.trailSvg) {
      elements.trailSvg.classList.remove('voice-lesson-replay-trail-then', 'voice-lesson-replay-trail-now');
      if (options.trailVariant === 'then') {
        elements.trailSvg.classList.add('voice-lesson-replay-trail-then');
      } else if (options.trailVariant === 'now') {
        elements.trailSvg.classList.add('voice-lesson-replay-trail-now');
      }
    }

    // onComplete fires at most once when this take finishes (audio 'ended' or the
    // visual animation reaching progress 1). The mirror uses it to chain A -> B.
    let completeFired = false;
    const fireComplete = (): void => {
      if (completeFired) return;
      completeFired = true;
      options.onComplete?.();
    };

    const momentProgress = (typeof options.momentProgress === 'number')
      ? Math.min(Math.max(options.momentProgress, 0), 1)
      : null;

    // Esc + click-outside close.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeydown);
    cleanups.push(() => document.removeEventListener('keydown', onKeydown));

    const onBackdropClick = (event: MouseEvent): void => {
      if (event.target === elements.overlay) {
        close();
      }
    };
    elements.overlay.addEventListener('click', onBackdropClick);
    cleanups.push(() => elements.overlay?.removeEventListener('click', onBackdropClick));

    if (elements.closeButton) {
      const onClose = (): void => close();
      elements.closeButton.addEventListener('click', onClose);
      cleanups.push(() => elements.closeButton?.removeEventListener('click', onClose));
    }

    active = { audio: null, rafId: null, visualStartMs: null, cleanups };

    // Pre-compute token windows lazily once we know the duration.
    let windows: VoiceTokenWindow[] = [];
    const momentTokenIndexFor = (computedWindows: VoiceTokenWindow[]): number => (
      momentProgress != null ? tokenIndexAtProgress(computedWindows, momentProgress) : -1
    );

    const syncTokens = (elapsedMs: number, computedWindows: VoiceTokenWindow[]): void => {
      if (!options.onTokenSync) return;
      const activeIndex = tokenIndexAtElapsed(computedWindows, elapsedMs);
      options.onTokenSync(activeIndex, momentTokenIndexFor(computedWindows));
    };

    let lastMomentPainted = false;
    const maybePulseMoment = (progress: number): void => {
      if (momentProgress == null || lastMomentPainted) return;
      if (progress >= momentProgress) {
        lastMomentPainted = true;
        pulseCompassMoment();
      }
    };

    const startVisualOnly = (note: string): void => {
      setStatus(note);
      windows = timing.getTokenWindows(options.card, visualDurationMs);
      // Initial paint.
      if (frames.length > 0) paintFrame(frames, 0);
      syncTokens(0, windows);
      if (active) active.visualStartMs = performance.now();
      const step = (): void => {
        if (!active || active.visualStartMs == null) return;
        const elapsed = performance.now() - active.visualStartMs;
        const progress = Math.min(elapsed / visualDurationMs, 1);
        const k = replayFrameIndexAtProgress(frames.length, progress);
        paintFrame(frames, k);
        syncTokens(progress * visualDurationMs, windows);
        maybePulseMoment(progress);
        if (progress < 1) {
          active.rafId = requestAnimationFrame(step);
        } else {
          active.rafId = null;
          fireComplete();
        }
      };
      if (active) active.rafId = requestAnimationFrame(step);
    };

    const attemptId = (typeof options.attemptId === 'string' && options.attemptId.trim())
      ? options.attemptId.trim()
      : null;

    if (!attemptId || !options.resolveAudioUrl) {
      startVisualOnly('Visual replay — no audio was kept for this attempt.');
      return;
    }

    // Audio-backed replay. A load/playback error -> graceful visual-only.
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = options.resolveAudioUrl(attemptId);
    if (active) active.audio = audio;
    setStatus(options.reason ? `Listening back together — ${options.reason}` : 'Listening back together…');

    const onTimeUpdate = (): void => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const k = replayFrameIndex(frames.length, audio.currentTime, duration);
      paintFrame(frames, k);
      const elapsedMs = audio.currentTime * 1000;
      windows = windows.length ? windows : timing.getTokenWindows(options.card, (duration || visualDurationMs / 1000) * 1000);
      syncTokens(elapsedMs, windows);
      if (duration > 0) maybePulseMoment(audio.currentTime / duration);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    cleanups.push(() => audio.removeEventListener('timeupdate', onTimeUpdate));

    const onLoadedMetadata = (): void => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : visualDurationMs / 1000;
      windows = timing.getTokenWindows(options.card, duration * 1000);
      paintFrame(frames, 0);
      syncTokens(0, windows);
    };
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    cleanups.push(() => audio.removeEventListener('loadedmetadata', onLoadedMetadata));

    const onEnded = (): void => {
      // The mirror suppresses the single-take hint (it drives its own A->B copy).
      if (!options.onComplete) {
        setStatus('That was the take. Press Listen back to hear it again.');
      }
      fireComplete();
    };
    audio.addEventListener('ended', onEnded);
    cleanups.push(() => audio.removeEventListener('ended', onEnded));

    const onError = (): void => {
      // 404 / no retained audio (older attempts) -> visual-only fallback.
      audio.pause();
      audio.removeAttribute('src');
      if (active) active.audio = null;
      startVisualOnly('No audio kept for this attempt — replaying the path only.');
    };
    audio.addEventListener('error', onError);
    cleanups.push(() => audio.removeEventListener('error', onError));

    void audio.play().catch(() => {
      // Autoplay blocked or other playback failure -> still animate visually.
      startVisualOnly('Tap play was blocked — replaying the path only.');
    });
  }

  function isOpen(): boolean {
    return Boolean(elements.overlay && !elements.overlay.classList.contains('hidden'));
  }

  // Full teardown for controller disposal.
  function dispose(): void {
    close();
  }

  return { open, close, isOpen, dispose };
}

export type VoiceLessonReplayController = ReturnType<typeof createVoiceLessonReplayController>;
