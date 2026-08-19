import { Pcm16FrameAssembler, StreamingLinearResampler } from './pcm16-resampler';

type Pcm16FrameProcessorOptions = {
  outputSampleRate: number;
  frameSize: number;
};

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

type AudioWorkletNodeOptions = { processorOptions?: unknown };

class Pcm16FrameProcessor extends AudioWorkletProcessor {
  private readonly resampler: StreamingLinearResampler;
  private readonly framer: Pcm16FrameAssembler;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const processorOptions = (options?.processorOptions ?? {}) as Partial<Pcm16FrameProcessorOptions>;
    const outputSampleRate = typeof processorOptions.outputSampleRate === 'number' ? processorOptions.outputSampleRate : 16000;
    const frameSize = typeof processorOptions.frameSize === 'number' ? processorOptions.frameSize : 1024;
    this.resampler = new StreamingLinearResampler(sampleRate, outputSampleRate);
    this.framer = new Pcm16FrameAssembler(frameSize, (frame) => {
      this.port.postMessage(frame, [frame]);
    });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inputChannel = inputs[0]?.[0];
    const outputChannel = outputs[0]?.[0];

    if (outputChannel) {
      if (inputChannel && inputChannel.length === outputChannel.length) {
        outputChannel.set(inputChannel);
      } else {
        outputChannel.fill(0);
      }
    }

    if (!inputChannel) {
      return true;
    }

    this.resampler.process(inputChannel, (sample) => {
      this.framer.pushSample(sample);
    });

    return true;
  }
}

registerProcessor('sloane-pcm16-frame-processor', Pcm16FrameProcessor);
