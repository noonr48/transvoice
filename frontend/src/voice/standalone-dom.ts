export type VoiceTutorStandaloneShellOptions = {
  sourceDocument: Document;
  targetDocument?: Document;
  backendUrl?: string;
};

function getRequiredSourceElement(sourceDocument: Document, id: string): HTMLElement {
  const element = sourceDocument.getElementById(id);
  if (!element) {
    throw new Error(`Voice Tutor source template is missing #${id}`);
  }
  return element as HTMLElement;
}

function clearStandaloneHiddenState(element: HTMLElement): void {
  element.classList.remove('hidden');
  element.removeAttribute('hidden');
  element.setAttribute('aria-hidden', 'false');
}

function createTopBar(documentRef: Document, backendUrl = ''): HTMLElement {
  const topBar = documentRef.createElement('header');
  topBar.className = 'voice-tutor-standalone-topbar';
  topBar.innerHTML = `
    <div>
      <span class="voice-tutor-standalone-kicker">Standalone Voice Tutor</span>
      <strong>Realtime practice cockpit</strong>
    </div>
    <div class="voice-tutor-standalone-status">
      <span class="status-dot online" aria-hidden="true"></span>
      <span id="session-status-text">BOOTING</span>
      <span id="voice-standalone-backend-label"></span>
      <a href="/voice-tutor.html">Connection settings</a>
    </div>
  `;

  const backendLabel = topBar.querySelector<HTMLElement>('#voice-standalone-backend-label');
  if (backendLabel) {
    backendLabel.textContent = backendUrl ? `Backend: ${backendUrl}` : '';
  }

  return topBar;
}

function createLog(documentRef: Document): HTMLElement {
  const log = documentRef.createElement('section');
  log.id = 'voice-standalone-log';
  log.className = 'voice-standalone-log';
  log.setAttribute('aria-live', 'polite');
  return log;
}

function createHealthPanel(documentRef: Document): HTMLElement {
  const panel = documentRef.createElement('section');
  panel.id = 'voice-standalone-health-panel';
  panel.className = 'voice-standalone-health-panel';
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `
    <div class="voice-standalone-health-heading">
      <strong>Runtime diagnostics</strong>
      <span id="voice-standalone-health-summary">Checking runtime layers…</span>
      <button id="voice-standalone-deep-check" class="voice-standalone-health-action" type="button">Run Deep Check</button>
    </div>
    <div id="voice-standalone-health-layers" class="voice-standalone-health-layers"></div>
  `;
  return panel;
}

export function parseVoiceTutorSourceHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function buildVoiceTutorStandaloneShell({
  sourceDocument,
  targetDocument = document,
  backendUrl = '',
}: VoiceTutorStandaloneShellOptions): HTMLElement {
  const sourcePanel = targetDocument.importNode(
    getRequiredSourceElement(sourceDocument, 'voice-panel'),
    true,
  ) as HTMLElement;
  const voiceLabPanel = targetDocument.importNode(
    getRequiredSourceElement(sourceDocument, 'voice-lab-panel'),
    true,
  ) as HTMLElement;

  sourcePanel.classList.add('voice-tutor-standalone-source-panel');
  sourcePanel.classList.add('hidden');
  sourcePanel.setAttribute('aria-hidden', 'true');
  clearStandaloneHiddenState(voiceLabPanel);

  const shell = targetDocument.createElement('main');
  shell.className = 'voice-tutor-standalone-shell';

  const content = targetDocument.createElement('div');
  content.className = 'voice-tutor-standalone-main';
  content.append(sourcePanel, voiceLabPanel);

  shell.append(
    createTopBar(targetDocument, backendUrl),
    createHealthPanel(targetDocument),
    content,
    createLog(targetDocument),
  );

  return shell;
}
