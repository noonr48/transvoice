export type VoiceOnlyCoachPreset = {
  id: string;
  name: string;
  referenceClipId?: string | null;
  kind?: string | null;
  archived?: boolean;
};

export type VoiceOnlyCoachSurfaceOptions = {
  doc: Document;
  getPracticeLine: () => string | null;
  getPronunciation: () => string | null;
  getSelectedPreset: () => VoiceOnlyCoachPreset | null;
  getInteractionOwner: () => string | null;
  getInputStatus?: () => string | null;
  getInputError?: () => string | null;
  getTutorAudioPlaying?: () => boolean;
  listPresets: () => Promise<VoiceOnlyCoachPreset[]>;
  selectPreset: (presetId: string) => Promise<void>;
  uploadPreset: (name: string, file: File) => Promise<VoiceOnlyCoachPreset | null>;
  startSession: (signal: AbortSignal) => Promise<boolean>;
  stopSession: () => Promise<void>;
  reportFailure?: (code: string) => void;
  reportEvent?: (code: string) => void;
};

export type VoiceOnlyCoachSurface = {
  sync: () => void;
  setStatus: (message: string, kind?: 'neutral' | 'error') => void;
  /**
   * Stop the lesson as pressing End does, INCLUDING the surface state. Use this
   * rather than calling the transport teardown directly — see the note at the
   * implementation. Resolves only once the stop has landed.
   */
  stopIfActive: () => Promise<void>;
  isActive: () => boolean;
  dispose: () => void;
};

export const VOICE_ONLY_COACH_PRACTICE_LINE_MAX_LENGTH = 120;
export const VOICE_ONLY_COACH_PRONUNCIATION_MAX_LENGTH = 160;
export const VOICE_COACH_PLAYBACK_STATE_EVENT = 'tv-coach-playback-state';
export const VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT = 'tv-coach-selected-voice-failure';
export const VOICE_COACH_SELECTED_VOICE_FAILURE_COPY = 'Selected tutor voice is unavailable.';

/**
 * How many times `stopIfActive` will wait for the session reconcile loop to
 * settle before giving up and letting navigation proceed. The loop re-runs
 * whenever intent and live state disagree; a backend that keeps failing must
 * not be able to hold the learner on a screen they asked to leave.
 */
const MAX_STOP_SETTLES = 4;

export type VoiceOnlyCoachActivity = {
  key: 'stopped' | 'starting' | 'ready' | 'hearing' | 'thinking' | 'speaking' | 'unavailable';
  label:
    | ''
    | 'Getting ready…'
    | 'Ready — speak now'
    | 'Hearing you'
    | 'Thinking…'
    | 'Speaking'
    | 'Microphone unavailable.'
    | 'Voice input interrupted.'
    | 'Voice input unavailable.';
};

export function resolveVoiceOnlyCoachActivity(input: {
  active: boolean;
  desiredActive: boolean;
  sessionTransition: 'idle' | 'starting' | 'stopping';
  interactionOwner?: string | null;
  inputStatus?: string | null;
  inputError?: string | null;
  tutorAudioPlaying?: boolean;
}): VoiceOnlyCoachActivity {
  if (input.sessionTransition === 'starting') return { key: 'starting', label: 'Getting ready…' };
  if (!input.active || !input.desiredActive || input.sessionTransition === 'stopping') {
    return { key: 'stopped', label: '' };
  }
  const owner = normalizeText(input.interactionOwner, 60);
  const inputStatus = normalizeText(input.inputStatus, 40);
  const inputError = normalizeText(input.inputError, 200);
  if (input.tutorAudioPlaying === true) return { key: 'speaking', label: 'Speaking' };
  // Callers predating the audible probe keep their old projection. Production
  // supplies an explicit boolean, where generation without audio is Thinking.
  if (owner === 'coach-speaking' && input.tutorAudioPlaying === undefined) {
    return { key: 'speaking', label: 'Speaking' };
  }
  if (owner === 'coach-speaking') return { key: 'thinking', label: 'Thinking…' };
  if (owner === 'coach-processing' || inputStatus === 'processing') {
    return { key: 'thinking', label: 'Thinking…' };
  }
  if (inputStatus === 'listening') return { key: 'hearing', label: 'Hearing you' };
  if (inputStatus === 'waiting') return { key: 'ready', label: 'Ready — speak now' };
  if (inputStatus === 'unsupported') {
    return { key: 'unavailable', label: 'Voice input unavailable.' };
  }
  if (inputStatus === 'error') {
    const microphoneUnavailable = /\b(?:microphone|mic permission|permission denied|notallowederror|notfounderror|overconstrainederror|getusermedia|audio device|audio did not begin|captured no audio)\b/i.test(inputError);
    return {
      key: 'unavailable',
      label: microphoneUnavailable ? 'Microphone unavailable.' : 'Voice input interrupted.',
    };
  }
  return { key: 'starting', label: 'Getting ready…' };
}

function normalizeText(value: unknown, maxLength?: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return maxLength == null ? normalized : normalized.slice(0, maxLength);
}

function getInstructionDensity(text: string): 'normal' | 'compact' | 'dense' {
  if (text.length > 80) return 'dense';
  if (text.length > 56) return 'compact';
  return 'normal';
}

function isReferencePreset(preset: VoiceOnlyCoachPreset | null | undefined): preset is VoiceOnlyCoachPreset {
  return Boolean(
    preset
    && normalizeText(preset.id, 160)
    && normalizeText(preset.name, 160)
    && normalizeText(preset.referenceClipId, 160)
    && (preset.kind === 'reference' || preset.kind === 'custom-reference' || !preset.kind)
    && preset.archived !== true,
  );
}

function requiredElement<T extends HTMLElement>(doc: Document, id: string): T {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Missing voice-only Coach surface element: #${id}`);
  return element as T;
}

export function setupVoiceOnlyCoachSurface(options: VoiceOnlyCoachSurfaceOptions): VoiceOnlyCoachSurface {
  const { doc } = options;
  const root = requiredElement<HTMLElement>(doc, 'tv-coach-surface');
  const presetButton = requiredElement<HTMLButtonElement>(doc, 'tv-coach-preset-button');
  const presetMenu = requiredElement<HTMLElement>(doc, 'tv-coach-preset-menu');
  const presetList = requiredElement<HTMLElement>(doc, 'tv-coach-preset-list');
  const uploadOpen = requiredElement<HTMLButtonElement>(doc, 'tv-coach-upload-open');
  const uploadForm = requiredElement<HTMLFormElement>(doc, 'tv-coach-upload-form');
  const uploadName = requiredElement<HTMLInputElement>(doc, 'tv-coach-upload-name');
  const uploadFile = requiredElement<HTMLInputElement>(doc, 'tv-coach-upload-file');
  const uploadSave = requiredElement<HTMLButtonElement>(doc, 'tv-coach-upload-save');
  const uploadCancel = requiredElement<HTMLButtonElement>(doc, 'tv-coach-upload-cancel');
  const canvas = requiredElement<HTMLElement>(doc, 'tv-coach-canvas');
  const practiceLine = requiredElement<HTMLElement>(doc, 'tv-coach-practice-line');
  const pronunciation = requiredElement<HTMLElement>(doc, 'tv-coach-pronunciation');
  const status = requiredElement<HTMLElement>(doc, 'tv-coach-status');
  const sessionToggle = requiredElement<HTMLButtonElement>(doc, 'tv-coach-session-toggle');

  let active = false;
  let desiredActive = false;
  let pending = false;
  let disposed = false;
  let sessionTransition: 'idle' | 'starting' | 'stopping' = 'idle';
  let startController: AbortController | null = null;
  let reconcilePromise: Promise<void> | null = null;
  let selectedOverride: VoiceOnlyCoachPreset | null = null;
  let library: VoiceOnlyCoachPreset[] = [];
  let instructionLengthFailureReported = false;
  let stickyError: string | null = null;
  let playbackEventState: boolean | null = null;
  let menuGeneration = 0;
  const removers: Array<() => void> = [];

  function listen(target: EventTarget, event: string, handler: EventListener): void {
    target.addEventListener(event, handler);
    removers.push(() => target.removeEventListener(event, handler));
  }

  function selectedPreset(): VoiceOnlyCoachPreset | null {
    const live = options.getSelectedPreset();
    return isReferencePreset(live) ? live : (isReferencePreset(selectedOverride) ? selectedOverride : null);
  }

  function renderStatus(message: string, kind: 'neutral' | 'error', activity: string): void {
    status.textContent = normalizeText(message, 160);
    status.dataset.kind = kind;
    root.dataset.activity = activity;
    if (kind === 'error') {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    } else {
      status.setAttribute('role', 'presentation');
      status.setAttribute('aria-live', 'off');
    }
  }

  function currentActivity(): VoiceOnlyCoachActivity {
    return resolveVoiceOnlyCoachActivity({
      active,
      desiredActive,
      sessionTransition,
      interactionOwner: options.getInteractionOwner(),
      inputStatus: options.getInputStatus?.(),
      inputError: options.getInputError?.(),
      tutorAudioPlaying: playbackEventState ?? options.getTutorAudioPlaying?.(),
    });
  }

  function renderCurrentActivity(): void {
    if (stickyError) {
      renderStatus(stickyError, 'error', 'error');
      return;
    }
    const activity = currentActivity();
    renderStatus(
      activity.label,
      activity.key === 'unavailable' ? 'error' : 'neutral',
      activity.key,
    );
  }

  function clearStatusError(): void {
    stickyError = null;
  }

  function setStatus(message: string, kind: 'neutral' | 'error' = 'neutral'): void {
    if (kind === 'error') {
      stickyError = normalizeText(message, 160);
      renderStatus(stickyError, 'error', 'error');
      return;
    }
    renderCurrentActivity();
  }

  function reportSemanticEffect(control: string, effect: string, statusValue: 'succeeded' | 'failed' = 'succeeded'): void {
    const view = doc.defaultView;
    if (!view) return;
    view.dispatchEvent(new view.CustomEvent('tv-control-effect', {
      detail: { control, effect, status: statusValue },
    }));
  }

  function sync(): void {
    if (disposed) return;
    const line = normalizeText(options.getPracticeLine());
    const spelling = normalizeText(options.getPronunciation());
    const instructionTooLong = (
      line.length > VOICE_ONLY_COACH_PRACTICE_LINE_MAX_LENGTH
      || spelling.length > VOICE_ONLY_COACH_PRONUNCIATION_MAX_LENGTH
    );
    if (instructionTooLong) {
      root.dataset.instructionState = 'invalid';
      root.dataset.instructionDensity = 'normal';
      root.dataset.instructionRepresentation = 'error';
      practiceLine.dataset.kind = 'error';
      practiceLine.textContent = 'Practice line unavailable.';
      practiceLine.hidden = false;
      pronunciation.textContent = '';
      pronunciation.hidden = true;
      canvas.setAttribute('aria-label', 'Practice line unavailable.');
      if (!instructionLengthFailureReported) {
        instructionLengthFailureReported = true;
        options.reportFailure?.('instruction-length-invalid');
      }
    } else {
      instructionLengthFailureReported = false;
      delete practiceLine.dataset.kind;
      const visibleSpelling = spelling && spelling !== line ? spelling : '';
      // 2026-07-28: the verbatim practice sentence is ALWAYS the primary canvas
      // representation. The old law showed the styled pronunciation spelling
      // INSTEAD whenever one existed — the owner saw "need a LITTLE magic" and
      // could not find the actual sentence anywhere. Pronunciation is now the
      // fallback, shown only when no verbatim line exists yet. The two are
      // still never stacked.
      const representation = line
        ? 'practice'
        : (visibleSpelling ? 'pronunciation' : 'empty');
      const visibleInstruction = line || visibleSpelling;
      const emptyPlaceholder = desiredActive
        ? 'Getting your sentence ready…'
        : 'Press Start to begin.';
      root.dataset.instructionState = visibleInstruction ? 'ready' : 'empty';
      root.dataset.instructionDensity = getInstructionDensity(visibleInstruction || emptyPlaceholder);
      root.dataset.instructionRepresentation = representation;
      practiceLine.textContent = visibleInstruction ? line : emptyPlaceholder;
      practiceLine.hidden = representation === 'pronunciation';
      pronunciation.textContent = visibleSpelling;
      pronunciation.hidden = representation !== 'pronunciation';
      if (line && visibleSpelling) {
        canvas.setAttribute('aria-label', `${line}. Pronunciation: ${visibleSpelling}`);
      } else if (visibleInstruction) {
        canvas.setAttribute('aria-label', visibleInstruction);
      } else {
        canvas.setAttribute('aria-label', emptyPlaceholder);
      }
    }

    // The comparison graph is the one primary canvas in the standalone tutor.
    // Keep the sentence as lesson context and an accessible fallback, but never
    // stack it visibly over the graph.
    const graphVisible = doc.getElementById('tv-coach-graph')?.hidden === false;
    if (graphVisible) {
      practiceLine.hidden = true;
      pronunciation.hidden = true;
      root.dataset.instructionRepresentation = 'graph';
      canvas.setAttribute('aria-label', 'Voice comparison graph.');
    }
    root.dataset.instructionFit = 'native';

    const preset = selectedPreset();
    presetButton.textContent = preset?.name || 'Choose voice';
    presetButton.dataset.selected = String(Boolean(preset));
    const sessionAction = desiredActive ? 'End' : 'Start';
    sessionToggle.textContent = sessionAction;
    sessionToggle.setAttribute('aria-label', sessionAction);
    sessionToggle.setAttribute('aria-pressed', String(desiredActive));
    sessionToggle.disabled = false;
    root.dataset.sessionState = sessionTransition === 'idle'
      ? (active ? 'active' : 'stopped')
      : sessionTransition;

    renderCurrentActivity();
  }

  function setMenuOpen(open: boolean, restoreFocus = true): void {
    menuGeneration += 1;
    presetMenu.hidden = !open;
    presetButton.setAttribute('aria-expanded', String(open));
    if (!open) {
      uploadForm.hidden = true;
      uploadOpen.hidden = false;
      if (restoreFocus) presetButton.focus();
    }
  }

  async function choosePreset(preset: VoiceOnlyCoachPreset): Promise<void> {
    if (pending || !isReferencePreset(preset)) return;
    clearStatusError();
    pending = true;
    presetList.setAttribute('aria-busy', 'true');
    setStatus('Setting tutor voice…');
    sync();
    try {
      await options.selectPreset(preset.id);
      selectedOverride = preset;
      setMenuOpen(false);
      clearStatusError();
      setStatus(`Tutor voice: ${preset.name}`);
      options.reportEvent?.('preset-selected');
      reportSemanticEffect('tv-coach-preset-button', 'preset-selected');
    } catch {
      options.reportFailure?.('preset-select-failed');
      setStatus("Couldn't set that tutor voice.", 'error');
    } finally {
      pending = false;
      presetList.removeAttribute('aria-busy');
      sync();
    }
  }

  function renderPresetList(presets: VoiceOnlyCoachPreset[]): void {
    library = presets.filter(isReferencePreset);
    if (!library.length) {
      const empty = doc.createElement('p');
      empty.className = 'tv-coach-preset-empty';
      empty.textContent = 'No saved voices yet.';
      presetList.replaceChildren(empty);
      return;
    }
    const buttons = library.map((preset) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'tv-coach-preset-option';
      button.dataset.coachPresetId = preset.id;
      button.textContent = preset.name;
      button.setAttribute('aria-pressed', String(selectedPreset()?.id === preset.id));
      listen(button, 'click', (() => { void choosePreset(preset); }) as EventListener);
      return button;
    });
    presetList.replaceChildren(...buttons);
  }

  async function openMenu(): Promise<void> {
    const opening = presetMenu.hidden;
    if (opening) clearStatusError();
    setMenuOpen(opening);
    if (!opening) return;
    const openingGeneration = menuGeneration;
    uploadOpen.focus();
    presetList.setAttribute('aria-busy', 'true');
    try {
      renderPresetList(await options.listPresets());
    } catch {
      options.reportFailure?.('preset-list-failed');
      renderPresetList([]);
      setStatus("Couldn't load saved voices.", 'error');
    } finally {
      presetList.removeAttribute('aria-busy');
    }
    if (
      presetMenu.hidden
      || menuGeneration !== openingGeneration
      || doc.activeElement !== uploadOpen
    ) return;
    const selectedOption = presetList.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    const firstOption = presetList.querySelector<HTMLButtonElement>('button');
    (selectedOption || firstOption || uploadOpen).focus();
  }

  function scheduleSessionReconcile(): void {
    if (reconcilePromise || disposed) return;
    reconcilePromise = (async () => {
      while (!disposed && desiredActive !== active) {
        if (desiredActive) {
          const controller = new AbortController();
          startController = controller;
          sessionTransition = 'starting';
          setStatus('Getting ready…');
          sync();
          let started = false;
          let failed = false;
          try {
            started = await options.startSession(controller.signal);
          } catch {
            // startSession owns rollback. A rejection therefore means either
            // startup or durable stop failed and must never be hidden merely
            // because the original start signal was cancelled.
            failed = true;
          } finally {
            if (startController === controller) startController = null;
          }

          if (started && desiredActive && !controller.signal.aborted) {
            active = true;
            sessionTransition = 'idle';
            clearStatusError();
            setStatus('Ready — speak now');
            options.reportEvent?.('session-started');
            reportSemanticEffect('tv-coach-session-toggle', 'listening-started');
            sync();
            continue;
          }

          active = false;
          sessionTransition = 'idle';
          if (failed) {
            // A rejected start includes rollback/checkpoint failure. Fail closed
            // even if the learner already requested a replacement Start; only a
            // fresh press may retry after this error is visible.
            desiredActive = false;
            options.reportFailure?.('session-start-failed');
            reportSemanticEffect('tv-coach-session-toggle', 'listening-started', 'failed');
            setStatus("Couldn't start listening.", 'error');
            sync();
            continue;
          }
          if (controller.signal.aborted && desiredActive) {
            // The learner pressed Start again while the cancelled attempt was
            // still unwinding. Preserve that newer intent and immediately run
            // a replacement start instead of misclassifying it as a failure.
            setStatus('Getting ready…');
            sync();
            continue;
          }
          if (desiredActive) {
            desiredActive = false;
            options.reportFailure?.('session-start-failed');
            reportSemanticEffect('tv-coach-session-toggle', 'listening-started', 'failed');
            setStatus("Couldn't start listening.", 'error');
          } else {
            options.reportEvent?.('session-stopped');
            reportSemanticEffect('tv-coach-session-toggle', 'session-stopped');
            setStatus('Stopped');
          }
          sync();
          continue;
        }

        sessionTransition = 'stopping';
        setStatus('Stopping…');
        sync();
        try {
          await options.stopSession();
          active = false;
          sessionTransition = 'idle';
          clearStatusError();
          setStatus('Stopped');
          options.reportEvent?.('session-stopped');
          reportSemanticEffect('tv-coach-session-toggle', 'session-stopped');
        } catch {
          desiredActive = true;
          sessionTransition = 'idle';
          options.reportFailure?.('session-stop-failed');
          reportSemanticEffect('tv-coach-session-toggle', 'session-stopped', 'failed');
          setStatus("Couldn't stop cleanly.", 'error');
        }
        sync();
      }
    })().finally(() => {
      reconcilePromise = null;
      if (!disposed && desiredActive !== active) scheduleSessionReconcile();
    });
  }

  async function toggleSession(): Promise<void> {
    clearStatusError();
    if (desiredActive) {
      desiredActive = false;
      startController?.abort();
      setStatus('Stopping…');
      sync();
      scheduleSessionReconcile();
      return;
    }

    if (!selectedPreset()) {
      setStatus('Choose a tutor voice first.', 'error');
      await openMenu();
      return;
    }

    desiredActive = true;
    setStatus('Getting ready…');
    sync();
    scheduleSessionReconcile();
  }

  listen(presetButton, 'click', (() => { void openMenu(); }) as EventListener);
  listen(doc, 'keydown', ((event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== 'Escape' || presetMenu.hidden) return;
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    setMenuOpen(false);
  }) as EventListener);
  listen(sessionToggle, 'click', (() => { void toggleSession(); }) as EventListener);
  listen(doc, VOICE_COACH_PLAYBACK_STATE_EVENT, ((event: Event) => {
    const playing = (event as CustomEvent<{ playing?: unknown }>).detail?.playing === true;
    playbackEventState = playing;
    if (playing && stickyError === VOICE_COACH_SELECTED_VOICE_FAILURE_COPY) {
      clearStatusError();
    }
    sync();
  }) as EventListener);
  listen(doc, VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT, (() => {
    playbackEventState = false;
    setStatus(VOICE_COACH_SELECTED_VOICE_FAILURE_COPY, 'error');
    options.reportFailure?.('selected-tutor-voice-unavailable');
    sync();
  }) as EventListener);
  listen(uploadOpen, 'click', (() => {
    uploadOpen.hidden = true;
    uploadForm.hidden = false;
    uploadName.focus();
  }) as EventListener);
  listen(uploadCancel, 'click', (() => {
    uploadForm.reset();
    uploadForm.hidden = true;
    uploadOpen.hidden = false;
    uploadOpen.focus();
  }) as EventListener);
  listen(uploadForm, 'submit', ((event: Event) => {
    event.preventDefault();
    if (pending) return;
    const name = normalizeText(uploadName.value, 160);
    const file = uploadFile.files?.[0] || null;
    if (!name || !file) {
      setStatus('Name the voice and choose an audio sample.', 'error');
      return;
    }
    clearStatusError();
    pending = true;
    uploadSave.disabled = true;
    setStatus('Preparing tutor voice…');
    sync();
    void options.uploadPreset(name, file)
      .then(async (preset) => {
        if (!isReferencePreset(preset)) throw new Error('No saved reference preset returned.');
        await options.selectPreset(preset.id);
        selectedOverride = preset;
        clearStatusError();
        library = [...library.filter((entry) => entry.id !== preset.id), preset];
        uploadForm.reset();
        setMenuOpen(false);
        setStatus(`Tutor voice: ${preset.name}`);
        options.reportEvent?.('preset-uploaded-and-selected');
        reportSemanticEffect('tv-coach-preset-button', 'preset-selected');
      })
      .catch(() => {
        options.reportFailure?.('preset-upload-failed');
        setStatus("Couldn't prepare that voice sample.", 'error');
      })
      .finally(() => {
        pending = false;
        uploadSave.disabled = false;
        sync();
      });
  }) as EventListener);

  sync();
  root.hidden = false;

  return {
    sync,
    setStatus,
    /**
     * Stop the lesson exactly as pressing End does — including the SURFACE
     * state, not just the transport.
     *
     * Added 2026-07-29 for the navigation affordance. Reaching past this module
     * and calling the transport teardown directly stops the microphone but
     * leaves `desiredActive`/`active` set, so the button still reads "End",
     * `data-session-state` still reads `active`, and the status still says
     * "Ready — speak now" over a closed mic. Measured: a learner returning from
     * the practice surface met a screen claiming the lesson was running, and
     * speaking did nothing until they pressed End then Start.
     *
     * This routes through the same `desiredActive = false` + reconcile path the
     * End button uses, so there is one stop, not two.
     *
     * It RESOLVES when the stop has actually landed. The caller hides this
     * surface the moment it returns, so returning early would hide a screen with
     * a live microphone still behind it — the exact hazard the caller exists to
     * prevent.
     */
    stopIfActive: async (): Promise<void> => {
      if (desiredActive || active) {
        desiredActive = false;
        startController?.abort();
        setStatus('Stopping…');
        sync();
        scheduleSessionReconcile();
      }
      // Drain the reconcile chain rather than awaiting one promise: the loop
      // re-schedules itself whenever intent and live state still disagree.
      // Bounded, because a backend that keeps failing must not hang navigation.
      for (let settle = 0; settle < MAX_STOP_SETTLES && reconcilePromise; settle += 1) {
        await reconcilePromise;
      }

      // A FAILED STOP MUST NOT LOOK LIKE A SUCCESSFUL ONE. When `stopSession`
      // rejects, the reconcile loop deliberately re-arms `desiredActive` so the
      // lesson is still marked live — and then intent and state agree again, the
      // loop exits, and this function would otherwise fulfil. The caller hides
      // this surface on a fulfilled promise, which puts a running lesson and an
      // open microphone behind an invisible screen: exactly the defect the
      // navigation teardown exists to prevent, reached through the failure door.
      // Measured before this throw: stopSession rejected once, isActive() stayed
      // true, the surface flipped to practice, and no teardown error was
      // reported. Throwing is what makes the caller's error path real.
      if (desiredActive || active) {
        throw new Error('Coach session did not stop.');
      }
    },
    isActive: () => active || desiredActive,
    dispose: () => {
      disposed = true;
      desiredActive = false;
      startController?.abort();
      removers.splice(0).forEach((remove) => remove());
    },
  };
}

export const __coachSurfaceTest = {
  isReferencePreset,
  normalizeText,
  resolveVoiceOnlyCoachActivity,
};
