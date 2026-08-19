export type ResampleEmitFn = (sample: number) => void;

export function floatToPcm16Sample(sample: number): number {
  if (Number.isNaN(sample)) {
    return 0;
  }
  const clamped = Math.max(-1, Math.min(1, sample));
  const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  return Math.trunc(scaled);
}

export class Pcm16FrameAssembler {
  private readonly frameSize: number;
  private readonly onFrame: (frame: ArrayBuffer) => void;
  private frame: Int16Array;
  private offset: number;

  constructor(frameSize: number, onFrame: (frame: ArrayBuffer) => void) {
    if (!Number.isFinite(frameSize) || frameSize <= 0) {
      throw new Error(`Invalid PCM16 frame size: ${String(frameSize)}`);
    }
    this.frameSize = Math.trunc(frameSize);
    this.onFrame = onFrame;
    this.frame = new Int16Array(this.frameSize);
    this.offset = 0;
  }

  reset(): void {
    this.frame = new Int16Array(this.frameSize);
    this.offset = 0;
  }

  pushSample(sample: number): void {
    this.frame[this.offset] = floatToPcm16Sample(sample);
    this.offset += 1;
    if (this.offset >= this.frameSize) {
      this.onFrame(this.frame.buffer);
      this.frame = new Int16Array(this.frameSize);
      this.offset = 0;
    }
  }
}

export class StreamingLinearResampler {
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;

  private readonly step: number;
  private readonly denom: number;

  private phase: number;
  private tail: Float32Array;
  private tailLength: number;
  private scratch: Float32Array;

  constructor(inputSampleRate: number, outputSampleRate: number) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error(`Invalid input sample rate: ${String(inputSampleRate)}`);
    }
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) {
      throw new Error(`Invalid output sample rate: ${String(outputSampleRate)}`);
    }
    this.inputSampleRate = Math.trunc(inputSampleRate);
    this.outputSampleRate = Math.trunc(outputSampleRate);
    this.step = this.inputSampleRate;
    this.denom = this.outputSampleRate;
    this.phase = 0;
    this.tail = new Float32Array(0);
    this.tailLength = 0;
    this.scratch = new Float32Array(0);
  }

  reset(): void {
    this.phase = 0;
    this.tailLength = 0;
  }

  process(input: Float32Array, emit: ResampleEmitFn): void {
    if (input.length <= 0) {
      return;
    }

    const totalLength = this.tailLength + input.length;
    if (this.scratch.length < totalLength) {
      this.scratch = new Float32Array(totalLength);
    }

    if (this.tailLength > 0) {
      this.scratch.set(this.tail.subarray(0, this.tailLength), 0);
    }
    this.scratch.set(input, this.tailLength);

    const denom = this.denom;
    const step = this.step;
    let phase = this.phase;

    while (true) {
      const index = Math.floor(phase / denom);
      if (index + 1 >= totalLength) {
        break;
      }
      const remainder = phase - index * denom;
      const frac = remainder / denom;
      const sample0 = this.scratch[index];
      const sample1 = this.scratch[index + 1];
      emit(sample0 + (sample1 - sample0) * frac);
      phase += step;
    }

    let discard = Math.floor(phase / denom);
    if (discard > totalLength - 1) {
      discard = totalLength - 1;
    }
    const newTailLength = totalLength - discard;
    if (newTailLength > this.tail.length) {
      this.tail = new Float32Array(newTailLength);
    }
    if (newTailLength > 0) {
      this.tail.set(this.scratch.subarray(discard, discard + newTailLength), 0);
    }
    this.tailLength = newTailLength;
    phase -= discard * denom;
    this.phase = phase;
  }
}
