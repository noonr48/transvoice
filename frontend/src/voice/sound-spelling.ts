// Surfacing wave — sound-spelling cue-layer toggle.
//
// A small, calm control in the script pad ("Sound-spelling: on/off") that
// shows/hides the sound-spelling cue-text layer (the respelled cue lines and
// per-word cue text) via ONE container class on #voice-lab-panel; the CSS in
// voice-tutor-redesign.css owns which layers hide. Preference persists in
// localStorage (`tvSoundSpelling`); default ON. Self-contained: owns its DOM
// lookups (absent nodes disable the surface) and its listener (dispose() tears
// down) — the same module pattern the lesson controller uses.

export const VOICE_SOUND_SPELLING_STORAGE_KEY = 'tvSoundSpelling';
export const VOICE_SOUND_SPELLING_OFF_CLASS = 'tv-sound-spelling-off';

type VoiceSoundSpellingStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type VoiceSoundSpellingOptions = {
  doc: Document;
  /** Injectable for tests; defaults to window.localStorage (null-safe). */
  storage?: VoiceSoundSpellingStorage | null;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

function resolveDefaultStorage(): VoiceSoundSpellingStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setupVoiceSoundSpelling(options: VoiceSoundSpellingOptions) {
  const { doc } = options;
  const storage = options.storage !== undefined ? options.storage : resolveDefaultStorage();
  const toggleEl = doc.getElementById('voice-sound-spelling-toggle') as HTMLButtonElement | null;
  const containerEl = doc.getElementById('voice-lab-panel');

  let on = true;
  let onToggleClick: (() => void) | null = null;

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function apply(): void {
    containerEl?.classList.toggle(VOICE_SOUND_SPELLING_OFF_CLASS, !on);
    if (toggleEl) {
      toggleEl.textContent = on ? 'Sound-spelling: on' : 'Sound-spelling: off';
      toggleEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function persist(): void {
    try {
      storage?.setItem(VOICE_SOUND_SPELLING_STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable — the in-session state still applies */
    }
  }

  function start(): void {
    try {
      // Default ON; only an explicit stored 'off' turns the layer off.
      on = storage?.getItem(VOICE_SOUND_SPELLING_STORAGE_KEY) !== 'off';
    } catch {
      on = true;
    }
    apply();
    if (toggleEl && !onToggleClick) {
      onToggleClick = () => {
        on = !on;
        apply();
        persist();
        log('system', `[voice-surface] sound-spelling ${on ? 'on' : 'off'}`);
      };
      toggleEl.addEventListener('click', onToggleClick);
    }
  }

  function dispose(): void {
    if (toggleEl && onToggleClick) {
      toggleEl.removeEventListener('click', onToggleClick);
      onToggleClick = null;
    }
  }

  return {
    start,
    dispose,
    isOn: () => on,
  };
}

export type VoiceSoundSpelling = ReturnType<typeof setupVoiceSoundSpelling>;
