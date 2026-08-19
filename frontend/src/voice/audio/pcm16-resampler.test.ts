import { floatToPcm16Sample, StreamingLinearResampler } from './pcm16-resampler';

describe('floatToPcm16Sample', () => {
  it('clamps and truncates Float32 audio samples', () => {
    expect(floatToPcm16Sample(0)).toBe(0);
    expect(floatToPcm16Sample(1)).toBe(32767);
    expect(floatToPcm16Sample(-1)).toBe(-32768);
    expect(floatToPcm16Sample(0.5)).toBe(16383);
    expect(floatToPcm16Sample(-0.5)).toBe(-16384);
    expect(floatToPcm16Sample(2)).toBe(32767);
    expect(floatToPcm16Sample(-2)).toBe(-32768);
    expect(floatToPcm16Sample(Number.NaN)).toBe(0);
    expect(floatToPcm16Sample(Number.POSITIVE_INFINITY)).toBe(32767);
    expect(floatToPcm16Sample(Number.NEGATIVE_INFINITY)).toBe(-32768);
  });
});

describe('StreamingLinearResampler', () => {
  it('downsamples 48kHz to 16kHz with stable streaming chunk boundaries', () => {
    const inputSampleRate = 48000;
    const outputSampleRate = 16000;
    const inputLength = 1000;
    const scale = 1 / inputLength;

    const input = new Float32Array(inputLength);
    for (let index = 0; index < inputLength; index += 1) {
      input[index] = index * scale;
    }

    const resampler = new StreamingLinearResampler(inputSampleRate, outputSampleRate);
    const output: number[] = [];

    const chunkSize = 128;
    for (let offset = 0; offset < input.length; offset += chunkSize) {
      resampler.process(input.subarray(offset, Math.min(input.length, offset + chunkSize)), (sample) => {
        output.push(sample);
      });
    }

    const expected: number[] = [];
    for (let index = 0; index + 1 < inputLength; index += 3) {
      expected.push(input[index]);
    }

    expect(output.length).toBe(expected.length);
    for (let index = 0; index < output.length; index += 1) {
      expect(output[index]).toBe(expected[index]);
    }
  });

  it('downsamples 44.1kHz to 16kHz via linear interpolation', () => {
    const inputSampleRate = 44100;
    const outputSampleRate = 16000;
    const inputLength = 1000;
    const scale = 1 / inputLength;

    const input = new Float32Array(inputLength);
    for (let index = 0; index < inputLength; index += 1) {
      input[index] = index * scale;
    }

    const resampler = new StreamingLinearResampler(inputSampleRate, outputSampleRate);
    const output: number[] = [];

    let offset = 0;
    while (offset < input.length) {
      const chunkSize = offset % 2 === 0 ? 127 : 193;
      const chunk = input.subarray(offset, Math.min(input.length, offset + chunkSize));
      resampler.process(chunk, (sample) => {
        output.push(sample);
      });
      offset += chunk.length;
    }

    const expected: number[] = [];
    for (let sampleIndex = 0; ; sampleIndex += 1) {
      const inputPosition = (sampleIndex * inputSampleRate) / outputSampleRate;
      if (inputPosition >= inputLength - 1) {
        break;
      }
      expected.push(inputPosition * scale);
    }

    expect(output.length).toBe(expected.length);
    for (let index = 0; index < output.length; index += 1) {
      expect(output[index]).toBeCloseTo(expected[index], 6);
    }
  });
});
