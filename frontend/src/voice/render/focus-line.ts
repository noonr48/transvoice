import type { VoiceCueSheet } from '../contracts';

/**
 * Approach B — target-pronunciation emphasis woven into the focus line itself.
 * Each word is styled by its cue token's `emphasis` so the sentence IS the delivery
 * map (no separate respelled line):
 *   - keep-bright  -> land it brighter / forward (amber, bold)
 *   - lift-ending  -> pitch lift on the rising end (cyan ↗)
 *   - light-start  -> soft onset (lighter weight)
 *   - steady       -> neutral
 * Falls back to plain text when no cue sheet is loaded. The respellings/emphasis come
 * from the backend pronunciation cascade (backend/voice-cue-sheet.js), so this is a
 * pure presentation layer.
 */
const EMPHASIS_CLASS: Record<string, string> = {
  'keep-bright': 'voice-fl-bright',
  'lift-ending': 'voice-fl-lift',
  'light-start': 'voice-fl-light',
};

export function renderVoiceFocusLine(
  element: HTMLElement | null | undefined,
  lineText: string,
  cueSheet: VoiceCueSheet | null | undefined,
): void {
  if (!element) return;

  const tokens = cueSheet?.tokens;
  if (!tokens || tokens.length === 0) {
    element.textContent = lineText;
    return;
  }

  element.replaceChildren();
  tokens.forEach((token, index) => {
    if (index > 0) {
      element.appendChild(document.createTextNode(' '));
    }
    const className = token.emphasis ? EMPHASIS_CLASS[token.emphasis] : undefined;
    if (className) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = token.text;
      element.appendChild(span);
    } else {
      element.appendChild(document.createTextNode(token.text));
    }
  });
}
