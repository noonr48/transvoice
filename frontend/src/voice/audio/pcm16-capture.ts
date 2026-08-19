import { Pcm16FrameAssembler, StreamingLinearResampler } from './pcm16-resampler';

export type Pcm16CaptureMode = 'worklet' | 'script-processor';

export type Pcm16CaptureOptions = {
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  onFrame: (frame: ArrayBuffer) => void;
  outputSampleRate?: number;
  frameSize?: number;
  preferWorklet?: boolean;
};

export type Pcm16CaptureHandle = {
  readonly captureSampleRate: number;
  readonly outputSampleRate: number;
  readonly frameSize: number;
  readonly mode: Pcm16CaptureMode;
  start: () => Promise<void>;
  stop: () => void;
};

type Pcm16CaptureInternalOptions = {
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  onFrame: (frame: ArrayBuffer) => void;
  outputSampleRate: number;
  frameSize: number;
};

const workletModuleLoads = new WeakMap<AudioContext, Promise<void>>();

function canUseAudioWorklet(audioContext: AudioContext): boolean {
  return Boolean(audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined');
}

async function ensurePcm16WorkletModule(audioContext: AudioContext): Promise<void> {
  const existing = workletModuleLoads.get(audioContext);
  if (existing) {
    await existing;
    return;
  }

  if (!audioContext.audioWorklet) {
    throw new Error('AudioWorklet is not available.');
  }

  const load = audioContext.audioWorklet.addModule(
    new URL('./pcm16-frame-processor.worklet.ts', import.meta.url),
  );
  workletModuleLoads.set(audioContext, load);
  await load;
}

function safeDisconnect(node: AudioNode | null): void {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch {
    // Ignore disconnect failures during teardown.
  }
}

function safeDisconnectNodes(sourceNode: AudioNode, destination: AudioNode): void {
  try {
    sourceNode.disconnect(destination);
  } catch {
    try {
      sourceNode.disconnect();
    } catch {
      // Ignore disconnect failures during teardown.
    }
  }
}

function createScriptProcessorCapture(options: Pcm16CaptureInternalOptions): Pcm16CaptureHandle {
  const { audioContext, sourceNode, onFrame, outputSampleRate, frameSize } = options;

  const processorNode = audioContext.createScriptProcessor(1024, 1, 1);
  const silentGainNode = audioContext.createGain();
  silentGainNode.gain.value = 0;

  const resampler = new StreamingLinearResampler(audioContext.sampleRate, outputSampleRate);
  const framer = new Pcm16FrameAssembler(frameSize, onFrame);

  let started = false;

  return {
    captureSampleRate: audioContext.sampleRate,
    outputSampleRate,
    frameSize,
    mode: 'script-processor',
    async start() {
      if (started) {
        return;
      }
      started = true;
      processorNode.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        resampler.process(input, (sample) => {
          framer.pushSample(sample);
        });
      };
      sourceNode.connect(processorNode);
      processorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      processorNode.onaudioprocess = null;
      safeDisconnectNodes(sourceNode, processorNode);
      safeDisconnect(processorNode);
      safeDisconnect(silentGainNode);
      framer.reset();
      resampler.reset();
    },
  };
}

async function createWorkletCapture(options: Pcm16CaptureInternalOptions): Promise<Pcm16CaptureHandle> {
  const { audioContext, sourceNode, onFrame, outputSampleRate, frameSize } = options;

  await ensurePcm16WorkletModule(audioContext);

  const workletNode = new AudioWorkletNode(audioContext, 'sloane-pcm16-frame-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions: {
      outputSampleRate,
      frameSize,
    },
  });
  const silentGainNode = audioContext.createGain();
  silentGainNode.gain.value = 0;

  let started = false;

  workletNode.port.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      onFrame(event.data);
    }
  };

  return {
    captureSampleRate: audioContext.sampleRate,
    outputSampleRate,
    frameSize,
    mode: 'worklet',
    async start() {
      if (started) {
        return;
      }
      started = true;
      sourceNode.connect(workletNode);
      workletNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      workletNode.port.onmessage = null;
      safeDisconnectNodes(sourceNode, workletNode);
      safeDisconnect(workletNode);
      safeDisconnect(silentGainNode);
    },
  };
}

export async function createPcm16Capture(options: Pcm16CaptureOptions): Promise<Pcm16CaptureHandle> {
  const outputSampleRate = options.outputSampleRate ?? 16000;
  const frameSize = options.frameSize ?? 1024;
  const preferWorklet = options.preferWorklet !== false;

  if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) {
    throw new Error(`Invalid output sample rate: ${String(outputSampleRate)}`);
  }
  if (!Number.isFinite(frameSize) || frameSize <= 0) {
    throw new Error(`Invalid PCM16 frame size: ${String(frameSize)}`);
  }

  if (preferWorklet && canUseAudioWorklet(options.audioContext)) {
    try {
      return await createWorkletCapture({
        audioContext: options.audioContext,
        sourceNode: options.sourceNode,
        onFrame: options.onFrame,
        outputSampleRate,
        frameSize,
      });
    } catch {
      // Fall back to ScriptProcessor when AudioWorklet cannot be initialized.
    }
  }

  return createScriptProcessorCapture({
    audioContext: options.audioContext,
    sourceNode: options.sourceNode,
    onFrame: options.onFrame,
    outputSampleRate,
    frameSize,
  });
}
