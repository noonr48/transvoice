import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createVoiceDomBindings } from './dom-bindings';
import {
  buildVoiceTutorStandaloneShell,
  parseVoiceTutorSourceHtml,
} from './standalone-dom';
import {
  getVoiceTutorStandaloneTemplateHtml,
  VOICE_TUTOR_STANDALONE_TEMPLATE_SOURCE,
} from './standalone-template';

function extractVoiceTemplateFromCanonicalSource(): string {
  const sourceDocument = parseVoiceTutorSourceHtml(
    readFileSync(resolve(process.cwd(), 'src/voice/templates/voice-tutor-template.html'), 'utf8'),
  );
  return ['voice-panel', 'voice-lab-panel'].map((id) => {
    const element = sourceDocument.getElementById(id);
    if (!element) {
      throw new Error(`Missing #${id} in src/voice/templates/voice-tutor-template.html`);
    }
    return element.outerHTML;
  }).join('\n');
}

function normalizeTemplateHtml(html: string): string {
  return parseVoiceTutorSourceHtml(`<body>${html}</body>`).body.innerHTML.replace(/\s+/g, ' ').trim();
}

describe('voice standalone DOM shell', () => {
  it('stacks the cockpit for portrait displays independently of pixel width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/voice/voice-tutor-redesign.css'), 'utf8');

    expect(css).toMatch(/@media\s*\(orientation:\s*portrait\),\s*\(max-width:\s*1024px\)/);
    expect(css).toMatch(/\.voice-cockpit-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.voice-tutor-standalone-main\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('uses a direct app entrypoint instead of the full SLOANE bootstrap script', () => {
    const appHtml = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const appSource = readFileSync(resolve(process.cwd(), 'src/voice/standalone-app.ts'), 'utf8');

    expect(appHtml).toContain('/src/voice/standalone-app.ts');
    expect(appHtml).not.toContain('/src/main.ts');
    expect(appSource).not.toContain("fetch('/index.html'");
    expect(appSource).not.toContain('createAppRootRuntimeComposition');
  });

  it('keeps startup passive until the front-door controls are wired', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/voice/standalone-app.ts'), 'utf8');

    expect(appSource).toContain('bootstrapVoiceModeSession(false, true)');
    expect(appSource).not.toContain('bootstrapVoiceModeSession(true)');
    expect(appSource).toContain("markVoiceTutorPhase('health-ready')");
    expect(appSource).toContain("markVoiceTutorPhase('session-ready')");
    expect(appSource).toContain("markVoiceTutorPhase('workflow-ready')");
    expect(appSource).toContain('sessionState.syncFromBackend(true)');
    expect(appSource).not.toContain('voiceApi.startPracticeSession(sessionId');
  });

  it('makes phone Coach a fixed voice-only viewport with two persistent controls', () => {
    const appHtml = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const source = readFileSync(resolve(process.cwd(), 'src/voice/standalone-app.ts'), 'utf8');
    const parsed = parseVoiceTutorSourceHtml(appHtml);
    const surface = parsed.getElementById('tv-coach-surface');

    expect(appHtml).toMatch(/#tv-coach-surface\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
    expect(appHtml).toMatch(/html, body\s*\{[^}]*overflow:\s*hidden;/s);
    expect(surface?.querySelectorAll('[data-coach-persistent-control]')).toHaveLength(2);
    expect(surface?.querySelector('#tv-coach-preset-button')).not.toBeNull();
    expect(surface?.querySelector('#tv-coach-session-toggle')).not.toBeNull();
    expect(surface?.querySelectorAll('#tv-coach-canvas')).toHaveLength(1);
    expect(surface?.querySelector('textarea')).toBeNull();
    expect(surface?.textContent).not.toMatch(/send|message|hear it|listen back|replay|chat|studio/i);
    expect(parsed.getElementById('app')?.getAttribute('aria-hidden')).toBe('true');
    expect(source).not.toContain('setupVoiceHearLine');
    expect(source).not.toContain('setupVoiceWelcomeBack');
    expect(source).not.toContain('onLessonKeyDown');
  });

  it('allows exactly ONE navigation affordance, and never on a lesson control', () => {
    // Product law 2 (docs/VOICE_COACH_MEMORY_CONTRACT.md), amended 2026-07-29 to
    // permit a single NAVIGATION affordance alongside the two LESSON controls.
    // The lesson-control count above was already enforced; the other two halves
    // of the amended law were written down but never checked, so nothing stopped
    // a second navigation button appearing, or a lesson control quietly doubling
    // as navigation — which is precisely the crowding the law exists to prevent.
    const appHtml = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const surface = parseVoiceTutorSourceHtml(appHtml).getElementById('tv-coach-surface');

    expect(surface?.querySelectorAll('[data-coach-navigation]')).toHaveLength(1);
    expect(surface?.querySelector('#tv-coach-nav-toggle')).not.toBeNull();
    expect(
      surface?.querySelectorAll('[data-coach-navigation][data-coach-persistent-control]'),
    ).toHaveLength(0);
  });

  it('THE WIRING: the surface controls are actually connected in the app entry', () => {
    // standalone-app.ts is the entry module — it imports CSS and boots the whole
    // runtime, so no test imports it, and every unit test here passes with the
    // wiring deleted. Reported in review: removing the nav listener, or reverting
    // onLeaveCoach to the raw transport teardown, left all frontend tests green.
    // These are source assertions, which is the weaker kind — they prove the
    // wiring EXISTS, not that it runs. The behaviour of each piece is proven in
    // surface-mode.test.ts / coach-surface.test.ts / practice-surface.test.ts;
    // this closes the gap where the pieces were correct but unattached.
    const appSource = readFileSync(resolve(process.cwd(), 'src/voice/standalone-app.ts'), 'utf8');

    expect(appSource).toContain("document.getElementById('tv-coach-nav-toggle')");
    expect(appSource).toMatch(/surfaceToggle\?\.addEventListener\('click'/);
    expect(appSource).toContain('setupPracticeSurface');

    // Leaving the coach must go through the SURFACE's stop, not the transport
    // helper underneath it — the helper stops the audio but leaves the button
    // reading "End" over a closed microphone.
    expect(appSource).toContain('coachSurface.stopIfActive()');
    // Catches any shape of the reversion, not just the property-shorthand one:
    // `onLeaveCoach: async () => { await stopCoachTransportAndCheckpoint(); }`
    // slipped past the old `onLeaveCoach:\s*stopCoach…` regex.
    const leaveCoachBody = appSource.slice(
      appSource.indexOf('onLeaveCoach: async () => {'),
      appSource.indexOf('onTeardownError:'),
    );
    expect(leaveCoachBody).toContain('coachSurface.stopIfActive()');
    // The idle fallback must be swallowed, not propagated: an idle coach has no
    // open mic, so letting its checkpoint failure cancel the switch is what made
    // the Practice button silently dead.
    expect(leaveCoachBody).toMatch(/try \{\s*await stopCoachTransportAndCheckpoint\(\);\s*\} catch/);
    // And a cancelled switch must say something on screen.
    expect(appSource).toMatch(/onTeardownError:[\s\S]{0,600}coachSurface\?\.setStatus\(/);

    // The practice menu must carry its own lane. Falling back to the session's
    // targetPreset gave a first-ever learner an empty screen, because nothing at
    // boot creates a session and an unknown lane returns an empty menu by design.
    expect(appSource).toContain('/voice/self-practice');
    expect(appSource).toMatch(/targetPreset:\s*ui\.targetPreset/);

    // The stop request must be bounded, or a wedged server hangs every await.
    expect(appSource).toMatch(/AbortSignal\.timeout\(COACH_STOP_TIMEOUT_MS\)/);

    // The graph must be CONNECTED, not merely written.
    //
    // The FIRST version of this test asserted `toContain('createCoachGraph(')`
    // and a source regex for `observeRender(...coachGraph.push(`. Both passed
    // against precisely the failure they claimed to catch — the module was
    // constructed and referenced, and drew absolutely nothing, because the turn
    // was never set and the host was never shown. That is the coincidental-
    // substring trap, written by someone (me) who had spent the day hunting it.
    // Source strings cannot prove behaviour; `coach-graph.behaviour` below does.
    expect(appSource).toContain('createCoachGraph(');
    // It reads the analyser frame off the RUNTIME store; the UI state does not
    // carry it, and reading the wrong one fails silently as "no data".
    expect(appSource).toMatch(/store\.getState\(\)\.voiceLiveFrame/);
    // The turn must actually be ASSIGNED somewhere, not merely declared.
    expect(appSource).toMatch(/graphTurn\s*=\s*'learner'/);
    // Playback completion parks only the tutor dot; the comparison ghost and
    // always-visible shell survive until the learner answers.
    expect(appSource).toContain("coachGraph?.parkTrack('tutor')");
  });

  it('SELF-PRACTICE SURVIVES A DEGRADED BACKEND: wired before the health gate', () => {
    // The degraded-boot path parks in `while (!healthOnline)` until the tutor's
    // model services come back. Self-practice is the mode for exactly when they
    // have NOT: no session, no analyzer, no model — just the gateway's drill
    // list. Wired after that loop, the Practice button silently did nothing,
    // with no error, indefinitely (measured in a real browser: the surface
    // attribute was still unset after 120s with VoiceTrainer and the GGUF model
    // down). Source ORDER is the property, so order is what this asserts.
    const appSource = readFileSync(resolve(process.cwd(), 'src/voice/standalone-app.ts'), 'utf8');

    const wiring = appSource.indexOf('const surfaceController = createVoiceSurfaceController(');
    const practice = appSource.indexOf('practiceSurface = setupPracticeSurface(');
    // Match the STATEMENT, not the phrase: the comment above the wiring quotes
    // this loop verbatim, and a bare indexOf found the quote first and read the
    // order backwards. (It failed loudly, which is the point of writing it.)
    const healthGate = appSource.search(/^\s+while \(!healthOnline\) \{$/m);

    expect(wiring).toBeGreaterThan(-1);
    expect(practice).toBeGreaterThan(-1);
    expect(healthGate).toBeGreaterThan(-1);
    expect(wiring).toBeLessThan(healthGate);
    expect(practice).toBeLessThan(healthGate);

    // Wiring that early runs before the coach mounts, so leaving must tolerate
    // there being no coach surface at all rather than reaching a later `const`.
    expect(appSource).toMatch(/if \(!coachSurface\) return;/);
  });

  it('THE GRAPH IS A MODE, NOT A THIRD ELEMENT', () => {
    // Product law allows exactly two persistent controls and ONE instruction
    // space on the Coach surface. The call-and-response graph is permitted only
    // because it OCCUPIES that single space during a drill and yields it back —
    // it is not an addition. Three things make that true, and all three are
    // asserted here, because "it looked fine when I added it" is how a
    // two-control surface becomes a five-control surface.
    const appHtml = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const parsed = parseVoiceTutorSourceHtml(appHtml);
    const graph = parsed.getElementById('tv-coach-graph');

    expect(graph).not.toBeNull();
    // 1. It lives INSIDE the instruction space, not beside it.
    expect(parsed.getElementById('tv-coach-canvas')?.contains(graph!)).toBe(true);
    // 2. It is the primary canvas from startup, not a hidden secondary mode.
    expect(graph?.hasAttribute('hidden')).toBe(false);
    // 3. It is not a control, and must never be counted as one.
    expect(graph?.hasAttribute('data-coach-persistent-control')).toBe(false);
    expect(graph?.querySelectorAll('[data-coach-persistent-control]')).toHaveLength(0);
    expect(graph?.querySelectorAll('button, input, select, textarea')).toHaveLength(0);

    // The axis words must stay out of the banned register — the owner rejected
    // "brighter" outright ("as if anyone knows wtf that is"). Body-pointable
    // language only.
    const axisText = Array.from(graph?.querySelectorAll('.tv-graph-axis') ?? [])
      .map((node) => node.textContent).join(' ');
    expect(axisText).toMatch(/buzz in your chest/i);
    expect(axisText).toMatch(/buzz in your face/i);
    expect(axisText).not.toMatch(/bright|dark|resonance|forward placement|mask/i);

    // THE FIELD MUST BE SQUARE — correctness, not taste. The band runs corner to
    // corner, so a stretched box makes it something other than 45°, and both
    // "travelling along the band" and "leaving it sideways" get drawn at wrong
    // angles. A learner copying the shape would be copying a distortion. Caught
    // by rendering it: the box measured 319x430 before this was pinned.
    expect(appHtml).toMatch(/#tv-coach-graph\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
    // ...and the flex column must not be allowed to stretch it back.
    expect(appHtml).toMatch(/#tv-coach-graph\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
    // Sized against the CANVAS, not the viewport. A `dvh` cap measured the screen
    // while the canvas is far shorter, so the field overflowed and `overflow:
    // hidden` ate three of the four axis labels on a 360x640 phone.
    expect(appHtml).toMatch(/#tv-coach-graph\s*\{[^}]*100cqh/s);
    expect(appHtml).not.toMatch(/#tv-coach-graph\s*\{[^}]*dvh/s);

    // THE BAND MUST RUN BOTTOM-LEFT TO TOP-RIGHT, joining low-pitch-with-chest-
    // buzz to high-pitch-with-face-buzz. A gradient's stops are PERPENDICULAR to
    // its line, so `to top right` paints the OPPOSITE diagonal — the fault drawn
    // as the guide. Nothing caught that; this does.
    expect(appHtml).toMatch(/\.tv-graph-band\s*\{[^}]*linear-gradient\(\s*to top left/s);
  });

  it('DIST PARITY: the shipped page carries the same surfaces as the source page', () => {
    // This repo has a documented "source-clean but live-clean-unproven" incident:
    // dist/ is a build artifact that nothing asserted on, so a stale bundle could
    // ship while every source test passed. Cheap to check, so check it.
    const distPath = resolve(process.cwd(), '..', 'dist', 'voice-tutor-app.html');
    const distHtml = readFileSync(distPath, 'utf8');
    const dist = parseVoiceTutorSourceHtml(distHtml);
    const distCoach = dist.getElementById('tv-coach-surface');

    expect(distCoach?.querySelectorAll('[data-coach-persistent-control]')).toHaveLength(2);
    expect(distCoach?.querySelectorAll('[data-coach-navigation]')).toHaveLength(1);
    expect(distCoach?.querySelector('#tv-coach-nav-toggle')).not.toBeNull();

    const distPractice = dist.getElementById('tv-practice-surface');
    expect(distPractice).not.toBeNull();
    expect(distPractice?.querySelector('#tv-practice-back')).not.toBeNull();
    expect(distPractice?.querySelector('#tv-practice-list')).not.toBeNull();
  });

  it('THE WAY BACK: the practice surface ships its own exit in the real page', () => {
    // The nav toggle lives INSIDE #tv-coach-surface, which is hidden while
    // practice is showing, and the chosen surface is persisted to localStorage.
    // A practice screen without its own exit is therefore an unrecoverable
    // dead end that survives a reload — it shipped once, and needing devtools to
    // escape is not something this app's learners can do. Asserted against the
    // page itself, because the renderer cannot conjure markup that is not there.
    const appHtml = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const parsed = parseVoiceTutorSourceHtml(appHtml);
    const practice = parsed.getElementById('tv-practice-surface');

    expect(practice).not.toBeNull();
    expect(practice?.querySelector('#tv-practice-back')).not.toBeNull();
    expect(practice?.querySelector('#tv-practice-list')).not.toBeNull();
    expect(practice?.querySelector('#tv-practice-empty')).not.toBeNull();
    // The exit must not live inside the part that the drill list replaces.
    expect(parsed.getElementById('tv-coach-surface')?.querySelector('#tv-practice-back')).toBeNull();
    // Each surface is hidden only while the OTHER one is selected, so there is
    // no body state in which both are hidden at once.
    expect(appHtml).toMatch(/body:not\(\[data-tv-surface="practice"\]\)\s*#tv-practice-surface\s*\{[^}]*display:\s*none/s);
    expect(appHtml).toMatch(/body\[data-tv-surface="practice"\]\s*#tv-coach-surface\s*\{[^}]*display:\s*none/s);
  });

  it('renders the welcome card as the safe pre-wiring front-door default', () => {
    const template = readFileSync(resolve(process.cwd(), 'src/voice/standalone-template.ts'), 'utf8');
    const twin = readFileSync(resolve(process.cwd(), 'src/voice/templates/voice-tutor-template.html'), 'utf8');
    for (const source of [template, twin]) {
      expect(source).toContain('class="voice-front-door-card voice-front-door-welcome" id="voice-front-door-welcome"');
      expect(source).toContain('class="voice-front-door-card hidden" id="voice-front-door-chooser"');
    }
  });

  it('keeps the standalone launcher connection profile controls available', () => {
    const launcherDocument = parseVoiceTutorSourceHtml(readFileSync(resolve(process.cwd(), 'voice-tutor.html'), 'utf8'));

    expect(launcherDocument.getElementById('voice-connection-profile')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-profile-name')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-save-profile')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-delete-profile')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-copy-link')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-use-same-origin')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-session-select')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-session-id')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-load-sessions')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-resume-session')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-new-session')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-export-session')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-delete-session')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-readiness-check')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-install-app')).not.toBeNull();
    expect(launcherDocument.getElementById('voice-pwa-status')).not.toBeNull();
  });

  it('declares an installable Voice Tutor PWA shell without caching backend APIs', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/voice-tutor.webmanifest'), 'utf8'));
    const serviceWorkerSource = readFileSync(resolve(process.cwd(), 'public/voice-tutor-sw.js'), 'utf8');
    const offlineShell = readFileSync(resolve(process.cwd(), 'public/voice-tutor-offline.html'), 'utf8');

    expect(manifest.id).toBe('/voice-tutor.html');
    expect(manifest.start_url).toBe('/voice-tutor.html');
    expect(manifest.display_override).toContain('standalone');
    expect(serviceWorkerSource).toContain('/voice-tutor.html');
    expect(serviceWorkerSource).toContain('/voice-tutor-app.html');
    expect(serviceWorkerSource).toContain('/voice-tutor-offline.html');
    expect(serviceWorkerSource).toContain("url.pathname.startsWith('/voice/')");
    expect(offlineShell).toContain('Voice Tutor is offline');
  });

  it('loads the voice DOM template as a bundled build-time artifact', () => {
    expect(VOICE_TUTOR_STANDALONE_TEMPLATE_SOURCE)
      .toBe('generated:src/voice/templates/voice-tutor-template.html#voice-panel+voice-lab-panel');
    const sourceDocument = parseVoiceTutorSourceHtml(getVoiceTutorStandaloneTemplateHtml());

    expect(sourceDocument.getElementById('voice-panel')).not.toBeNull();
    expect(sourceDocument.getElementById('voice-lab-panel')).not.toBeNull();
  });

  it('keeps the bundled template byte-synced with the canonical Voice Tutor source', () => {
    // The bundled standalone-template.ts mirrors the #voice-panel + #voice-lab-panel
    // markup from voice-tutor-template.html. There is no longer a separate generator
    // script — this content equality is the sync contract (edit both together).
    expect(normalizeTemplateHtml(getVoiceTutorStandaloneTemplateHtml()))
      .toBe(normalizeTemplateHtml(extractVoiceTemplateFromCanonicalSource()));
  });

  // Skipped in the standalone build: index.html is the SLOANE-monolith embedded-host
  // entry and was never carried into this standalone frontend (the entries are
  // voice-tutor.html / voice-tutor-app.html). Re-enable if the embedded host returns.
  it.skip('uses template slots instead of carrying inline Voice Tutor DOM in index.html', () => {
    const indexDocument = parseVoiceTutorSourceHtml(readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'));

    expect(indexDocument.getElementById('voice-panel')).toBeNull();
    expect(indexDocument.getElementById('voice-lab-panel')).toBeNull();
    expect(indexDocument.getElementById('voice-panel-template-slot')).not.toBeNull();
    expect(indexDocument.getElementById('voice-lab-panel-template-slot')).not.toBeNull();
  });

  it('extracts the Voice Tutor DOM without booting the full SLOANE shell', () => {
    const sourceDocument = parseVoiceTutorSourceHtml(getVoiceTutorStandaloneTemplateHtml());
    const shell = buildVoiceTutorStandaloneShell({
      sourceDocument,
      targetDocument: document,
      backendUrl: 'http://127.0.0.1:3021',
    });

    document.body.replaceChildren(shell);

    expect(document.querySelector('.header')).toBeNull();
    expect(document.querySelector('.main-container')).toBeNull();
    expect(document.getElementById('voice-panel')).toHaveClass('voice-tutor-standalone-source-panel');
    expect(document.getElementById('voice-panel')).toHaveClass('hidden');
    expect(document.getElementById('voice-lab-panel')).not.toHaveClass('hidden');
    expect(document.getElementById('session-status-text')?.textContent).toBe('BOOTING');
    expect(document.getElementById('voice-standalone-backend-label')?.textContent)
      .toBe('Backend: http://127.0.0.1:3021');
    expect(document.getElementById('voice-standalone-health-panel')).not.toBeNull();
    expect(document.getElementById('voice-standalone-health-summary')?.textContent)
      .toBe('Checking runtime layers…');
    expect(document.getElementById('voice-standalone-deep-check')?.textContent).toBe('Run Deep Check');
  });

  it('contains every element required by the voice host runtime bindings', () => {
    const sourceDocument = parseVoiceTutorSourceHtml(getVoiceTutorStandaloneTemplateHtml());
    const shell = buildVoiceTutorStandaloneShell({
      sourceDocument,
      targetDocument: document,
    });

    document.body.replaceChildren(shell);

    const bindings = createVoiceDomBindings({ document });
    expect(bindings.root.voiceLabPanel.id).toBe('voice-lab-panel');
    expect(bindings.root.voiceTargetPresetSelect.id).toBe('voice-target-preset');
    expect(bindings.bootstrapRefs.voiceStartSessionBtn.id).toBe('voice-start-session');
    // 2026-07-27 (owner's law): coach mode is SPOKEN — the typed question
    // input and its send button must NOT exist in the template. The bindings
    // stay nullable for legacy embeddings, but the canonical shell ships none.
    expect(bindings.bootstrapRefs.voiceCoachSendBtn).toBeNull();
    expect(bindings.root.voiceCoachQuestionInput).toBeNull();
  });
});
