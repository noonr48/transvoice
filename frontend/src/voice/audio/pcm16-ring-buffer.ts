/**
 * Pcm16RingBuffer — circular buffer for accumulating PCM16 audio frames.
 *
 * Sits between the PCM16 capture pipeline and the transport layer.
 * Accumulates frames during recording so they can be included in coaching requests.
 *
 * Default capacity: 30 seconds at 16kHz = 480,000 samples = 960,000 bytes.
 * When full, oldest frames are overwritten (circular behavior).
 */

export type Pcm16RingBufferOptions = {
  /** Maximum number of samples to hold. Default: 480000 (30s at 16kHz) */
  capacitySamples?: number;
  /** Sample rate in Hz. Default: 16000 */
  sampleRate?: number;
};

export class Pcm16RingBuffer {
  private readonly buffer: Int16Array;
  private readonly capacity: number;
  private readonly sampleRate: number;
  private writePos: number;
  private filled: boolean;
  private dirty: boolean;
  private cachedWavBase64: string | null;

  constructor(options: Pcm16RingBufferOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.capacity = options.capacitySamples ?? (this.sampleRate * 30); // 30 seconds
    this.buffer = new Int16Array(this.capacity);
    this.writePos = 0;
    this.filled = false;
    this.dirty = false;
    this.cachedWavBase64 = null;
  }

  /**
   * Append a PCM16 frame (ArrayBuffer) to the ring buffer.
   * The frame is copied into the circular buffer.
   */
  write(frame: ArrayBuffer): void {
    if (frame.byteLength < 2 || frame.byteLength % 2 !== 0) return;
    const samples = new Int16Array(frame);
    this.writeSamples(samples);
  }

  /**
   * Append PCM16 samples (Int16Array) to the ring buffer.
   */
  writeSamples(samples: Int16Array): void {
    const len = samples.length;
    if (len <= 0) return;

    this.dirty = true;

    const cap = this.capacity;

    // If frame is larger than buffer, keep only the last `cap` samples
    if (len >= cap) {
      this.buffer.set(samples.subarray(len - cap), 0);
      this.writePos = 0;
      this.filled = true;
      return;
    }

    const pos = this.writePos;

    // If the frame fits entirely after writePos
    if (pos + len <= cap) {
      this.buffer.set(samples, pos);
      this.writePos = pos + len;
    } else {
      // Wrap around: split the write
      const firstChunk = cap - pos;
      this.buffer.set(samples.subarray(0, firstChunk), pos);
      const secondChunk = len - firstChunk;
      if (secondChunk > 0) {
        this.buffer.set(samples.subarray(firstChunk), 0);
        this.writePos = secondChunk;
      } else {
        this.writePos = 0;
      }
      this.filled = true;
    }

    if (this.writePos >= cap) {
      this.writePos = 0;
      this.filled = true;
    }
  }

  /**
   * Get the number of samples currently in the buffer.
   */
  get length(): number {
    return this.filled ? this.capacity : this.writePos;
  }

  /**
   * Get the duration of audio in the buffer (seconds).
   */
  get durationSeconds(): number {
    return this.length / this.sampleRate;
  }

  /**
   * Get all accumulated samples as a new Int16Array (in order, oldest first).
   * Returns a copy — safe to use after further writes.
   */
  toArray(): Int16Array {
    const len = this.length;
    if (len === 0) return new Int16Array(0);

    const result = new Int16Array(len);
    if (this.filled) {
      // Buffer has wrapped: oldest data starts at writePos
      const firstPart = this.capacity - this.writePos;
      result.set(this.buffer.subarray(this.writePos), 0);
      result.set(this.buffer.subarray(0, this.writePos), firstPart);
    } else {
      result.set(this.buffer.subarray(0, this.writePos));
    }
    return result;
  }

  /**
   * Get all accumulated audio as a WAV ArrayBuffer (16-bit mono).
   * Ready to base64-encode and send to the LLM.
   */
  toWav(): ArrayBuffer {
    const samples = this.toArray();
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = this.sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM samples
    const int16View = new Int16Array(buffer, headerSize);
    int16View.set(samples);

    return buffer;
  }

  /**
   * Get all accumulated audio as a base64-encoded WAV string.
   * Caches the result — subsequent calls return the cached value until the buffer is modified.
   */
  toBase64Wav(): string {
    if (!this.dirty && this.cachedWavBase64 !== null) {
      return this.cachedWavBase64;
    }
    const wav = this.toWav();
    this.cachedWavBase64 = arrayBufferToBase64(wav);
    this.dirty = false;
    return this.cachedWavBase64;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.writePos = 0;
    this.filled = false;
    this.dirty = true;
    this.cachedWavBase64 = null;
  }

  /**
   * Reset the buffer (alias for clear).
   */
  reset(): void {
    this.clear();
  }
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
