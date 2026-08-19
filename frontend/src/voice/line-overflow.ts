// Declutter (2026-07-19) — quiet line-action overflow disclosure.
//
// The script pad keeps three primary moves (Next Line, Easier, Harder); the
// rest (Guided Coach, Advance Lesson, Regenerate, Pin Line) sit in a folded
// tray behind a "⋯ More" button. This module owns ONLY the disclosure state:
// pure local view concern — no store round-trip, no persistence. Same
// self-contained pattern as sound-spelling.ts: owns its DOM lookups (absent
// nodes disable the surface) and its listener (dispose() tears down).
//
// Accessibility: the toggle carries aria-expanded + aria-controls; the tray is
// plain flow content, so its buttons keep their native focus order.

export type VoiceLineOverflowOptions = {
  doc: Document;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

export function setupVoiceLineOverflow(options: VoiceLineOverflowOptions) {
  const { doc } = options;
  const toggleEl = doc.getElementById('voice-line-more-toggle') as HTMLButtonElement | null;
  const trayEl = doc.getElementById('voice-line-overflow');

  let open = false;
  let onToggleClick: (() => void) | null = null;

  function apply(): void {
    trayEl?.classList.toggle('hidden', !open);
    toggleEl?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function start(): void {
    // Always start folded — the disclosure is a per-visit reveal, not a mode.
    open = false;
    apply();
    if (toggleEl && trayEl && !onToggleClick) {
      onToggleClick = () => {
        open = !open;
        apply();
        options.addLog?.('system', `[voice-surface] line overflow ${open ? 'open' : 'closed'}`);
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
    isOpen: () => open,
  };
}

export type VoiceLineOverflow = ReturnType<typeof setupVoiceLineOverflow>;
