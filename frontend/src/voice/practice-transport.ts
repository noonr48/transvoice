import { hasVoiceBackendPayload, type VoiceBackendPayload, type VoiceLiveFrame, type VoiceUiState } from './state';
import { pushBackendDiagnostic, reportBackendException } from '../runtime-diagnostics';
import { createVoiceAudioContext } from './audio/audio-context';
import { createPcm16Capture, type Pcm16CaptureHandle } from './audio/pcm16-capture';
import { Pcm16RingBuffer } from './audio/pcm16-ring-buffer';

export type VoicePracticeTransportStatus = 'idle' | 'requesting-mic' | 'connecting' | 'streaming' | 'error';

export type VoicePracticeTransportSnapshot = {
  status: VoicePracticeTransportStatus;
  liveFrame: VoiceLiveFrame | null;
  liveTrace: VoiceLiveFrame[];
  sessionArmed: boolean;
  takeActive: boolean;
  takeProcessing: boolean;
};

type VoicePracticeTransportControllerOptions = {
  getState: () => VoicePracticeTransportSnapshot;
  setState: (
    updater: (state: VoicePracticeTransportSnapshot) => VoicePracticeTransportSnapshot,
  ) => void;
  render: () => void;
  getRecoveryContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
    voiceSessionId: string | null;
  };
  disarmPracticeSession: (sessionId: string, reason: string) => Promise<VoiceBackendPayload>;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  /**
   * Fired when the transport layer recognizes that the active take has
   * ended (i.e. VAD finalizes — the user stopped speaking and the
   * capture stops sending audio frames to the trainer). Used by the
   * turn telemetry pipeline to record `speech_end_at`.
   */
  onTakeFinalized?: (info: { reason: string; at: number }) => void;
};

export type VoicePracticeTransportStartOptions = {
  streamUrl: string | null;
  audioPreferWorklet?: boolean;
  selectedInputDeviceId: string | null;
  readInputDevicePreference: () => string | null;
  writeInputDevicePreference: (deviceId: string | null) => void;
  refreshAudioInputDevices: (silent?: boolean) => Promise<unknown>;
  setSelectedInputDeviceId: (deviceId: string | null) => void;
  setAudioInputNotice: (notice: string | null) => void;
  setResolvedInputLabel: (label: string | null) => void;
  setResolvedInputDeviceId: (deviceId: string | null) => void;
};

export function createVoicePracticeTransportController(options: VoicePracticeTransportControllerOptions) {
  let streamSocket: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let audioCapture: Pcm16CaptureHandle | null = null;
  let transportStopping = false;
  let transportFailureRecovery = false;
  let socketGeneration = 0;
  const audioRingBuffer = new Pcm16RingBuffer({ capacitySamples: 16000 * 30 }); // 30 seconds

  const patchState = (patch: Partial<VoicePracticeTransportSnapshot>) => {
    options.setState((state) => ({ ...state, ...patch }));
  };

  const isCurrentSocket = (socket: WebSocket, generation: number) => (
    streamSocket === socket && socketGeneration === generation
  );

  function notifyTakeFinalized(reason: string): void {
    try {
      options.onTakeFinalized?.({ reason, at: Date.now() });
    } catch (error) {
      // Never let telemetry callbacks take down the transport.
      console.warn('[Sloane] onTakeFinalized handler failed:', error);
    }
  }

  /**
   * Explicitly mark the current take as VAD-finalized. Callers should
   * invoke this when the take ends (e.g. from `endPracticeTake` after the
   * VAD reports silence or the user releases the take). Safe to call when
   * no take is active — it is a no-op in that case.
   */
  function finalizeTake(reason = 'vad_finalize'): boolean {
    if (!streamSocket) return false;
    notifyTakeFinalized(reason);
    return true;
  }

  async function stop(preserveFrame = false): Promise<void> {
    transportStopping = true;
    audioRingBuffer.clear();
    try {
      // If a take is still in flight at teardown, fire the VAD-finalize
      // callback so the telemetry pipeline can stamp speech_end_at before
      // the audio is fully released.
      if (audioCapture && streamSocket) {
        notifyTakeFinalized('transport_stop');
      }
      if (audioCapture) {
        audioCapture.stop();
        audioCapture = null;
      }
      if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (audioContext) {
        await audioContext.close().catch(() => undefined);
        audioContext = null;
      }
      socketGeneration += 1;
      if (streamSocket) {
        const socket = streamSocket;
        streamSocket = null;
        try {
          socket.close();
        } catch {
          // Ignore close failures.
        }
      }
      patchState({
        status: 'idle',
        sessionArmed: false,
        takeActive: false,
        takeProcessing: false,
        ...(preserveFrame ? {} : { liveFrame: null, liveTrace: [] }),
      });
    } finally {
      transportStopping = false;
    }
    options.render();
  }

  async function recoverFailure(
    message: string,
    reason = 'voice transport failure',
  ): Promise<void> {
    if (transportStopping || transportFailureRecovery) {
      return;
    }
    transportFailureRecovery = true;
    try {
      const normalizedMessage = message.trim() || 'Voice stream transport failed.';
      const { currentSessionId, isConnected, voiceSessionId } = options.getRecoveryContext();
      const hadBackendSession = Boolean(currentSessionId && isConnected && voiceSessionId);
      await stop(true);
      if (hadBackendSession && currentSessionId) {
        try {
          const data = await options.disarmPracticeSession(currentSessionId, reason);
          if (hasVoiceBackendPayload(data)) {
            options.applyVoiceBackendPayload(data);
          }
        } catch {
          // Ignore cleanup failures and surface the transport error instead.
        }
      }
      options.updateVoiceUiState((state) => ({
        ...state,
        status: 'error',
        lastError: normalizedMessage,
      }));
      patchState({ status: 'error' });
      options.render();
    } finally {
      transportFailureRecovery = false;
    }
  }

  async function start(startOptions: VoicePracticeTransportStartOptions): Promise<void> {
    if (!startOptions.streamUrl) {
      throw new Error('Voice trainer did not return a stream URL.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not available in this browser context.');
    }

    const currentState = options.getState();
    if (
      currentState.status === 'requesting-mic'
      || currentState.status === 'connecting'
      || currentState.status === 'streaming'
    ) {
      return;
    }

    patchState({ status: 'requesting-mic' });
    options.render();

    try {
      await startOptions.refreshAudioInputDevices(true).catch(() => undefined);
      const requestedDeviceId = startOptions.selectedInputDeviceId || startOptions.readInputDevicePreference() || 'default';
      /**
       * MEASUREMENT-lane capture constraints — keep fully RAW.
       *
       * | Lane          | Acquired in                              | EC  | NS  | AGC |
       * |---------------|------------------------------------------|-----|-----|-----|
       * | measurement   | practice-transport.ts (this acquisition) | off | off | off |
       * | measurement   | front-door.ts (reference recording)      | off | off | off |
       * | conversation  | coach-input.ts (coach listening)         | ON  | ON  | off |
       *
       * This stream feeds pitch/resonance/level analysis of armed takes; any
       * browser DSP (echoCancellation / noiseSuppression / autoGainControl)
       * would corrupt the measurements. Only the coach CONVERSATION lane
       * (coach-input.ts) enables EC+NS — its audio is transcribed, not measured.
       */
      const baseAudioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      const requestStream = (deviceId: string | null): Promise<MediaStream> => navigator.mediaDevices.getUserMedia({
        audio: deviceId && deviceId !== 'default'
          ? {
              ...baseAudioConstraints,
              deviceId: { exact: deviceId },
            }
          : baseAudioConstraints,
      });

      let stream: MediaStream;
      try {
        stream = await requestStream(requestedDeviceId);
        startOptions.setAudioInputNotice(null);
      } catch (streamError) {
        const errorName = (streamError as DOMException)?.name || '';
        if (requestedDeviceId !== 'default' && (errorName === 'NotFoundError' || errorName === 'OverconstrainedError')) {
          startOptions.setSelectedInputDeviceId('default');
          startOptions.writeInputDevicePreference('default');
          startOptions.setAudioInputNotice(
            'The requested input is unavailable right now, so the trainer fell back to the system default input.',
          );
          stream = await requestStream(null);
        } else {
          throw streamError;
        }
      }

      mediaStream = stream;
      // Witness: one line per measurement-lane mic acquisition (echo-safe split).
      console.info('[voice-stream] measurement raw EC:off NS:off AGC:off (practice-transport)');
      const audioTrack = stream.getAudioTracks()[0] || null;
      startOptions.setResolvedInputLabel(audioTrack?.label?.trim() || null);
      startOptions.setResolvedInputDeviceId(
        audioTrack?.getSettings?.().deviceId || requestedDeviceId || startOptions.selectedInputDeviceId,
      );
      await startOptions.refreshAudioInputDevices(true).catch(() => undefined);
      audioContext = createVoiceAudioContext();
      sourceNode = audioContext.createMediaStreamSource(stream);
      const activeAudioContext = audioContext;
      const activeSourceNode = sourceNode;
      if (!activeSourceNode || !activeAudioContext) {
        throw new Error('Failed to initialize the voice audio pipeline.');
      }

      patchState({ status: 'connecting' });
      options.render();

      let activeSocket: WebSocket | null = null;
      let activeGeneration = 0;
      audioCapture = await createPcm16Capture({
        audioContext: activeAudioContext,
        sourceNode: activeSourceNode,
        outputSampleRate: 16000,
        frameSize: 1024,
        preferWorklet: startOptions.audioPreferWorklet !== false,
        onFrame: (frame) => {
          // Accumulate all frames in the ring buffer for coaching requests
          audioRingBuffer.write(frame);
          const socket = activeSocket;
          const generation = activeGeneration;
          if (!socket) return;
          if (!options.getState().takeActive) return;
          if (!isCurrentSocket(socket, generation) || socket.readyState !== WebSocket.OPEN) return;
          try {
            socket.send(frame);
          } catch (sendError) {
            reportBackendException({
              operation: 'Send voice practice audio chunk',
              error: sendError,
              source: startOptions.streamUrl || 'voice-stream',
              method: 'GET',
              kind: 'websocket',
            });
            void recoverFailure(
              (sendError as Error).message || 'Voice stream audio send failed.',
              'voice stream audio send failure',
            );
          }
        },
      });

      const socket = new WebSocket(startOptions.streamUrl);
      socket.binaryType = 'arraybuffer';
      const generation = ++socketGeneration;
      streamSocket = socket;
      activeSocket = socket;
      activeGeneration = generation;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const failBeforeReady = (errorMessage: string) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error(errorMessage));
        };

        socket.addEventListener('open', () => {
          if (!isCurrentSocket(socket, generation)) {
            failBeforeReady('Voice stream was superseded before it became ready.');
            return;
          }
          if (settled) {
            return;
          }
          settled = true;
          patchState({
            status: 'streaming',
            sessionArmed: true,
            takeActive: false,
            takeProcessing: false,
          });
          void audioCapture?.start();
          options.render();
          resolve();
        });

        socket.addEventListener('message', (event) => {
          try {
            const parsed = JSON.parse(String(event.data)) as any;
            if (
              parsed
              && typeof parsed === 'object'
              && typeof parsed.error === 'string'
              && parsed.error.trim()
            ) {
              void recoverFailure(parsed.error.trim(), 'voice stream error frame');
              return;
            }
            const frame = parsed as VoiceLiveFrame;
            if (!options.getState().takeActive) {
              return;
            }
            options.setState((state) => ({
              ...state,
              liveFrame: frame,
              liveTrace: [...state.liveTrace, frame].slice(-240),
            }));
            options.updateVoiceUiState((state) => ({
              ...state,
              status: 'active',
              lastError: null,
            }));
            options.render();
          } catch (error) {
            reportBackendException({
              operation: 'Parse voice practice frame',
              error,
              source: startOptions.streamUrl || 'voice-stream',
              method: 'GET',
              kind: 'websocket',
            });
            console.warn('[Sloane] Failed to parse voice frame:', error);
          }
        });

        socket.addEventListener('error', () => {
          pushBackendDiagnostic({
            kind: 'websocket',
            operation: 'Voice practice stream error',
            message: 'Voice practice stream socket failed.',
            source: startOptions.streamUrl || 'voice-stream',
            method: 'GET',
          });
          if (!isCurrentSocket(socket, generation)) {
            failBeforeReady('Voice stream was superseded before it became ready.');
            return;
          }
          if (!settled) {
            failBeforeReady('Voice stream socket failed.');
            return;
          }
          void recoverFailure('Voice stream socket failed.', 'voice stream socket error');
        });

        socket.addEventListener('close', (event) => {
          if (!transportStopping) {
            pushBackendDiagnostic({
              kind: 'websocket',
              operation: 'Voice practice stream closed',
              message: `Voice stream closed unexpectedly (${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
              source: startOptions.streamUrl || 'voice-stream',
              method: 'GET',
            });
          }
          if (!isCurrentSocket(socket, generation)) {
            failBeforeReady('Voice stream was superseded before it became ready.');
            return;
          }
          streamSocket = null;
          if (transportStopping) {
            return;
          }
          if (!settled) {
            failBeforeReady(`Voice stream socket closed before the practice transport became ready (${event.code}${event.reason ? `: ${event.reason}` : ''}).`);
            return;
          }
          const hint = event.code === 4401
            ? 'VoiceTrainer unauthorized (check VITE_VOICE_TRAINER_TOKEN).'
            : event.code === 4404
              ? 'VoiceTrainer session not found (check VOICE_TRAINER_URL vs VITE_VOICE_TRAINER_URL).'
              : `Voice stream closed unexpectedly (${event.code}${event.reason ? `: ${event.reason}` : ''}).`;
          void recoverFailure(hint, 'voice stream socket closed');
        });
      });
    } catch (error) {
      await stop();
      patchState({ status: 'error' });
      options.updateVoiceUiState((state) => ({
        ...state,
        lastError: (error as Error).message,
      }));
      options.render();
      throw error;
    }
  }

  return {
    stop,
    recoverFailure,
    start,
    finalizeTake,
    getAudioRingBuffer: () => audioRingBuffer,
  };
}
