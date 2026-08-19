import { describe, expect, it } from 'vitest';

import {
  VOICE_STANDALONE_LOADING_MARKER_ID,
  shouldAutoBootstrapVoiceTutorStandalone,
} from './standalone-bootstrap-guard';

function buildDocument(bodyHtml: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html lang="en"><body>${bodyHtml}</body></html>`,
    'text/html',
  );
}

describe('voice tutor standalone auto-bootstrap guard', () => {
  it('does NOT auto-bootstrap on the SLOANE dashboard document', () => {
    // The dashboard ships the classic shell (#terminal-output) and never the standalone splash.
    // Auto-running the bootstrap here would wipe #app and crash the dashboard.
    const dashboard = buildDocument(
      '<div id="app" class="app-shell-classic-chat app-shell-power-workstation">'
        + '<div id="terminal-output"></div>'
        + '<div id="voice-panel-template-slot"></div>'
        + '</div>',
    );
    expect(shouldAutoBootstrapVoiceTutorStandalone(dashboard)).toBe(false);
  });

  it('auto-bootstraps on the standalone voice-tutor-app document', () => {
    const standalone = buildDocument(
      '<div id="app" class="voice-tutor-standalone-app">'
        + `<div id="${VOICE_STANDALONE_LOADING_MARKER_ID}">Starting Voice Tutor…</div>`
        + '</div>',
    );
    expect(shouldAutoBootstrapVoiceTutorStandalone(standalone)).toBe(true);
  });

  it('returns false when no document is available (SSR / worker context)', () => {
    expect(shouldAutoBootstrapVoiceTutorStandalone(undefined)).toBe(false);
  });
});
