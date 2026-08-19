#!/usr/bin/env python3
"""Privacy-safe JSONL adapter for Pipecat Smart Turn v3.2.

The process accepts PCM16 mono 16 kHz audio on stdin and writes one bounded
prediction per line on stdout. It never logs audio, transcripts, or prompts.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from typing import Any

import numpy as np
import onnxruntime as ort
from transformers import WhisperFeatureExtractor


PROTOCOL_VERSION = 1
SAMPLE_RATE = 16_000
MAX_SAMPLES = SAMPLE_RATE * 8
MAX_PCM_BYTES = MAX_SAMPLES * 2


def build_session(model_path: str) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(
        model_path,
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def decode_pcm16(value: Any) -> np.ndarray:
    if not isinstance(value, str) or not value:
        raise ValueError("pcm16Base64 is required")
    encoded_limit = ((MAX_PCM_BYTES + 2) // 3) * 4 + 4
    if len(value) > encoded_limit:
        raise ValueError("audio exceeds eight seconds")
    raw = base64.b64decode(value, validate=True)
    if not raw or len(raw) > MAX_PCM_BYTES or len(raw) % 2:
        raise ValueError("invalid PCM16 audio")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if samples.size > MAX_SAMPLES:
        samples = samples[-MAX_SAMPLES:]
    if samples.size < MAX_SAMPLES:
        samples = np.pad(samples, (MAX_SAMPLES - samples.size, 0), mode="constant")
    return samples


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    feature_extractor = WhisperFeatureExtractor(chunk_length=8)
    session = build_session(args.model)
    emit({"type": "ready", "protocol": PROTOCOL_VERSION})

    for raw_line in sys.stdin:
        request_id: Any = None
        try:
            payload = json.loads(raw_line)
            request_id = payload.get("id")
            if payload.get("protocol") != PROTOCOL_VERSION or payload.get("type") != "predict":
                raise ValueError("unsupported protocol")
            if payload.get("sampleRate") != SAMPLE_RATE:
                raise ValueError("sample rate must be 16000 Hz")
            audio = decode_pcm16(payload.get("pcm16Base64"))
            inputs = feature_extractor(
                audio,
                sampling_rate=SAMPLE_RATE,
                return_tensors="np",
                padding="max_length",
                max_length=MAX_SAMPLES,
                truncation=True,
                do_normalize=True,
            )
            input_features = np.expand_dims(
                inputs.input_features.squeeze(0).astype(np.float32), axis=0
            )
            probability = float(session.run(None, {"input_features": input_features})[0][0].item())
            emit({
                "type": "prediction",
                "id": request_id,
                "complete": probability >= 0.5,
                "probability": max(0.0, min(1.0, probability)),
            })
        except Exception as error:  # fail closed at the adapter boundary
            emit({
                "type": "error",
                "id": request_id,
                "code": type(error).__name__,
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
