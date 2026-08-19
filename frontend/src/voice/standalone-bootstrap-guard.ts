// Decides whether the side-effectful standalone voice-tutor bootstrap should auto-run.
//
// standalone-app.ts is the page entry for voice-tutor-app.html, but Vite code-splits its
// code into the shared `voice-runtime` chunk that the full SLOANE dashboard ALSO imports.
// Its top-level bootstrap calls app.replaceChildren() on #app, so without a guard, merely
// loading the dashboard would wipe the dashboard shell (#terminal-output) and replace it
// with the voice standalone view — the "frontend taken over by the voice tutor" regression.
//
// Gate on #voice-standalone-loading, the splash element that ONLY voice-tutor-app.html
// ships. Mirrors the #voice-launcher-form guard in standalone-launcher.ts.

export const VOICE_STANDALONE_LOADING_MARKER_ID = 'voice-standalone-loading';

export function shouldAutoBootstrapVoiceTutorStandalone(
  documentRef: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): boolean {
  if (!documentRef || typeof documentRef.getElementById !== 'function') {
    return false;
  }
  return Boolean(documentRef.getElementById(VOICE_STANDALONE_LOADING_MARKER_ID));
}
