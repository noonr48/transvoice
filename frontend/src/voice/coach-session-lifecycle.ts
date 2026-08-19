export type VoiceOnlyCoachStartLifecycleOptions = {
  signal: AbortSignal;
  prepareSession: (signal: AbortSignal) => Promise<void>;
  enableContinuousCapture: () => Promise<boolean>;
  startListening: () => Promise<boolean>;
  cancelListening: () => void;
  markSessionActive: (signal: AbortSignal) => Promise<void>;
  rollbackToStopped: () => Promise<void>;
};

export type VoiceOnlyCoachStopLifecycleOptions = {
  stopListening: () => void;
  stopSpeech: () => void;
  disableContinuousCapture: () => Promise<boolean>;
  markSessionStopped: () => Promise<void>;
  reportContinuousDisableFailure?: () => void;
};

/**
 * Opens the real audio transport before enabling automatic turn cycling and
 * before committing durable session state. Starting the transport first is
 * deliberate: enabling continuous mode can itself request a listen cycle, so
 * the reverse order can race a second capture against the first.
 * Every incomplete or cancelled attempt returns to stopped, so learner memory
 * can never claim an active lesson whose microphone failed to open.
 */
export async function startVoiceOnlyCoachLifecycle(
  options: VoiceOnlyCoachStartLifecycleOptions,
): Promise<boolean> {
  let committed = false;
  const cancelListening = () => {
    try {
      options.cancelListening();
    } catch {
      // Abort dispatch must stay non-throwing. The authoritative rollback below
      // still records the stopped checkpoint even if local teardown misbehaves.
    }
  };
  options.signal.addEventListener('abort', cancelListening, { once: true });
  try {
    if (options.signal.aborted) return false;
    // This creates a process-local, revocable live-input lease only. It does
    // not write the durable active/restart checkpoint.
    await options.prepareSession(options.signal);
    if (options.signal.aborted) return false;
    if (!await options.startListening()) return false;
    if (options.signal.aborted) return false;
    if (!await options.enableContinuousCapture()) return false;
    if (options.signal.aborted) return false;
    await options.markSessionActive(options.signal);
    if (options.signal.aborted) return false;
    committed = true;
    return true;
  } catch (error) {
    if (options.signal.aborted) return false;
    throw error;
  } finally {
    options.signal.removeEventListener('abort', cancelListening);
    if (!committed) {
      await options.rollbackToStopped();
    }
  }
}

/**
 * Stops every local audio path and always attempts the durable stopped
 * checkpoint, even when persisting continuous-mode disablement fails. The
 * checkpoint is the authoritative learner-memory lifecycle record; it must
 * never be skipped by an adjacent cockpit-state failure.
 */
export async function stopVoiceOnlyCoachLifecycle(
  options: VoiceOnlyCoachStopLifecycleOptions,
): Promise<void> {
  options.stopListening();
  options.stopSpeech();
  const disableContinuous = (async () => {
    try {
      if (!await options.disableContinuousCapture()) {
        options.reportContinuousDisableFailure?.();
      }
    } catch {
      options.reportContinuousDisableFailure?.();
    }
  })();
  // Launch the authoritative memory checkpoint immediately. It must not wait
  // behind cockpit persistence, which can be slow or unavailable.
  const markStopped = options.markSessionStopped();
  await Promise.all([disableContinuous, markStopped]);
}
