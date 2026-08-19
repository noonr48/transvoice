export type LearnerMemoryPreference = {
  id?: string | null;
  text?: string | null;
};

export type LearnerMemoryMoment = {
  id?: string | null;
  kind?: string | null;
  text?: string | null;
};

export type LearnerMemorySnapshot = {
  success?: boolean;
  studentId?: string | null;
  learnerContext?: {
    profile?: {
      displayName?: string | null;
      pronouns?: string | null;
      direction?: string | null;
      goal?: string | null;
    } | null;
    targetBinding?: {
      presetId?: string | null;
      presetName?: string | null;
      referenceClipId?: string | null;
      targetKey?: string | null;
    } | null;
    coachPreferences?: LearnerMemoryPreference[] | null;
    moments?: LearnerMemoryMoment[] | null;
    storageHealth?: {
      status?: string | null;
      writeBlocked?: boolean | null;
    } | null;
  } | null;
  deletionReceipt?: Record<string, unknown> | null;
  resetReceipt?: Record<string, unknown> | null;
  error?: unknown;
};

type MemoryProfileUpdate = {
  displayName?: string | null;
  pronouns?: string | null;
  direction?: string | null;
  goal?: string | null;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function requireStudentId(value: unknown): string {
  const studentId = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  if (!studentId) throw new Error('Learner ID is required.');
  return studentId;
}

async function parseMemoryResponse(response: Response): Promise<LearnerMemorySnapshot> {
  const payload = await response.json().catch(() => null) as LearnerMemorySnapshot | null;
  if (!response.ok || payload?.success === false) {
    const detail = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Memory request failed: HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload || {};
}

export async function getLearnerMemory(
  backendUrl: string,
  studentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LearnerMemorySnapshot> {
  const params = new URLSearchParams({ studentId: requireStudentId(studentId) });
  const response = await fetchImpl(
    `${trimTrailingSlash(backendUrl)}/voice/learner-context/profile?${params.toString()}`,
    { cache: 'no-store' },
  );
  return parseMemoryResponse(response);
}

export async function updateLearnerMemoryProfile(
  backendUrl: string,
  studentId: string,
  update: MemoryProfileUpdate,
  fetchImpl: typeof fetch = fetch,
): Promise<LearnerMemorySnapshot> {
  const response = await fetchImpl(
    `${trimTrailingSlash(backendUrl)}/voice/learner-context/profile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: requireStudentId(studentId), ...update }),
    },
  );
  return parseMemoryResponse(response);
}

export async function forgetLearnerMemory(
  backendUrl: string,
  studentId: string,
  operation: {
    operation?: 'reset-personalization' | 'delete-all';
    momentId?: string | null;
    removePreference?: string | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<LearnerMemorySnapshot> {
  const response = await fetchImpl(
    `${trimTrailingSlash(backendUrl)}/voice/learner-context/forget`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: requireStudentId(studentId), ...operation }),
    },
  );
  return parseMemoryResponse(response);
}

function textInput(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function selectInput(id: string): HTMLSelectElement | null {
  return document.getElementById(id) as HTMLSelectElement | null;
}

function setMemoryStatus(message: string, warning = false): void {
  const status = document.getElementById('voice-memory-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('warning', warning);
}

function appendMemoryItem(
  list: HTMLElement,
  label: string,
  removeLabel: string,
  onRemove: () => void,
): void {
  const row = document.createElement('div');
  row.className = 'memory-item';
  const text = document.createElement('span');
  text.textContent = label;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary memory-remove';
  button.textContent = 'Remove';
  button.setAttribute('aria-label', removeLabel);
  button.addEventListener('click', onRemove);
  row.append(text, button);
  list.append(row);
}

export function renderLearnerMemory(
  snapshot: LearnerMemorySnapshot,
  onRemove: (operation: { momentId?: string; removePreference?: string }) => void,
): void {
  const memory = snapshot.learnerContext || {};
  const profile = memory.profile || {};
  const fields: Array<[string, string | null | undefined]> = [
    ['voice-memory-name', profile.displayName],
    ['voice-memory-pronouns', profile.pronouns],
    ['voice-memory-goal', profile.goal],
  ];
  for (const [id, value] of fields) {
    const input = textInput(id);
    if (input) input.value = value || '';
  }
  const direction = selectInput('voice-memory-direction');
  if (direction) direction.value = profile.direction || 'unspecified';

  const binding = memory.targetBinding;
  const target = document.getElementById('voice-memory-target');
  if (target) {
    target.textContent = binding?.presetName || binding?.presetId
      ? `Selected tutor voice: ${binding.presetName || binding.presetId}`
      : 'No uploaded tutor voice is bound yet.';
  }
  const health = document.getElementById('voice-memory-health');
  if (health) {
    health.textContent = memory.storageHealth?.writeBlocked
      ? 'Memory storage needs recovery before it can save.'
      : `Memory storage: ${memory.storageHealth?.status || 'available'}.`;
    health.classList.toggle('warning', memory.storageHealth?.writeBlocked === true);
  }

  const list = document.getElementById('voice-memory-items');
  if (!list) return;
  list.replaceChildren();
  const preferences = Array.isArray(memory.coachPreferences) ? memory.coachPreferences : [];
  const moments = Array.isArray(memory.moments) ? memory.moments : [];
  for (const preference of preferences) {
    const id = String(preference.id || '').trim();
    if (!id) continue;
    appendMemoryItem(
      list,
      `Coaching preference: ${preference.text || id}`,
      `Remove coaching preference ${preference.text || id}`,
      () => onRemove({ removePreference: id }),
    );
  }
  for (const moment of moments) {
    const id = String(moment.id || '').trim();
    if (!id) continue;
    appendMemoryItem(
      list,
      `${moment.kind || 'Remembered moment'}: ${moment.text || ''}`,
      `Remove remembered moment ${moment.text || id}`,
      () => onRemove({ momentId: id }),
    );
  }
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'fine-print';
    empty.textContent = 'No removable coaching preferences or moments are stored.';
    list.append(empty);
  }
}

export function bindLearnerMemorySettings(options: {
  getBackendUrl: () => string;
  fetchImpl?: typeof fetch;
  confirmImpl?: (message: string) => boolean;
}): void {
  const fetchImpl = options.fetchImpl || fetch;
  const confirmImpl = options.confirmImpl || ((message: string) => window.confirm(message));
  const getStudentId = () => requireStudentId(textInput('voice-memory-student-id')?.value);

  const reportError = (error: unknown): void => {
    setMemoryStatus(error instanceof Error ? error.message : String(error), true);
  };

  const renderSnapshot = (snapshot: LearnerMemorySnapshot): void => {
    renderLearnerMemory(snapshot, (operation) => {
      void removeMemoryItem(operation);
    });
  };

  const removeMemoryItem = async (
    operation: { momentId?: string; removePreference?: string },
  ): Promise<void> => {
    try {
      setMemoryStatus('Removing learner memory…');
      const snapshot = await forgetLearnerMemory(
        options.getBackendUrl(),
        getStudentId(),
        operation,
        fetchImpl,
      );
      renderSnapshot(snapshot);
      setMemoryStatus('Removed.');
    } catch (error) {
      reportError(error);
    }
  };

  const load = async (): Promise<LearnerMemorySnapshot> => {
    setMemoryStatus('Loading learner memory…');
    const snapshot = await getLearnerMemory(options.getBackendUrl(), getStudentId(), fetchImpl);
    renderSnapshot(snapshot);
    setMemoryStatus('Memory loaded.');
    return snapshot;
  };

  document.getElementById('voice-memory-load')?.addEventListener('click', () => {
    void load().catch(reportError);
  });

  document.getElementById('voice-memory-save')?.addEventListener('click', () => {
    void (async () => {
      try {
        const snapshot = await updateLearnerMemoryProfile(options.getBackendUrl(), getStudentId(), {
          displayName: textInput('voice-memory-name')?.value || '',
          pronouns: textInput('voice-memory-pronouns')?.value || '',
          direction: selectInput('voice-memory-direction')?.value || 'unspecified',
          goal: textInput('voice-memory-goal')?.value || '',
        }, fetchImpl);
        renderSnapshot(snapshot);
        setMemoryStatus('Memory details saved.');
      } catch (error) {
        reportError(error);
      }
    })();
  });

  document.getElementById('voice-memory-reset')?.addEventListener('click', () => {
    if (!confirmImpl('Reset learned coaching history and preferences? Your identity and selected tutor voice will stay.')) return;
    void (async () => {
      try {
        const snapshot = await forgetLearnerMemory(
          options.getBackendUrl(),
          getStudentId(),
          { operation: 'reset-personalization' },
          fetchImpl,
        );
        renderSnapshot(snapshot);
        setMemoryStatus('Coaching personalization reset.');
      } catch (error) {
        reportError(error);
      }
    })();
  });

  document.getElementById('voice-memory-delete-all')?.addEventListener('click', () => {
    if (!confirmImpl('Permanently delete this learner’s profile, event history, and runtime sessions?')) return;
    void (async () => {
      try {
        await forgetLearnerMemory(
          options.getBackendUrl(),
          getStudentId(),
          { operation: 'delete-all' },
          fetchImpl,
        );
        renderSnapshot({ learnerContext: null });
        setMemoryStatus('All learner data deleted. The operation is safe to repeat.');
      } catch (error) {
        reportError(error);
      }
    })();
  });
}
