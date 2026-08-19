# Smart Turn v3.2 isolated latency spike — 2026-07-22

Scope: disposable `/tmp` Python 3.12 environment; no project dependency or live service changed.

- Source: official `pipecat-ai/smart-turn` repository at local clone commit `4786657e…`.
- Model: Hugging Face `pipecat-ai/smart-turn-v3`, commit `f766f81d3cfdf7737ac64aad813d91bbfd56bf93`.
- CPU ONNX SHA-256: `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`.
- Runtime pins exercised: Python 3.12, `onnxruntime==1.23.2`, `transformers==4.48.2`.
- Model/worker load: approximately 488 ms.
- First inference: approximately 90.5 ms.
- Warm inference: approximately 92.4 ms.

Verdict: warm CPU inference is under the 150 ms architecture budget, so Smart Turn does not need a GPU. The synthetic eSpeak phrase was classified incomplete (probability 0.155); synthetic prosody is not accepted as a model-quality oracle. Representative careful/stuttered human speech remains a phone release gate.
