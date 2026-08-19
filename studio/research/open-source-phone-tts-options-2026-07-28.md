# Open-source phone TTS options for TransVoice

**Research date:** 28 July 2026  
**Status:** engineering research only; no public architecture, voice route,
model, preset or implementation is owner-approved  
**Scope:** open-source or downloadable open-weight TTS with a credible Android
or iOS path, especially voice cloning and original synthetic voices  
**Related work:** [public/mobile voice-rights options](./mobile-public-voice-rights-options-2026-07-28.md)
and [designed-synthetic-voice foundry](./designed-synthetic-voice-foundry-2026-07-28.md)

## Decision

The remembered Qwen fact is correct: the official open
**Qwen3-TTS 0.6B Base and 1.7B Base checkpoints support voice cloning**.
The separate 1.7B VoiceDesign checkpoint creates a voice from a written
description. Qwen publishes the code and these weights under Apache-2.0.

Nothing in this report authorizes implementation. The owner may separately
authorize a technical spike; this report does not ratify a public/mobile
product lane. The previously
reviewed public-voice recommendation still awaits `DEC-01`; the current
uploaded-reference product contract remains in force until expressly
superseded. Aster is fully quarantined: perform no new Aster synthesis, demo,
distribution, model work or public use before `AST-01`. Preserve only the
minimal restricted evidence hold approved by the owner/counsel; otherwise
delete it on their documented schedule. Any other uncleared reference also
remains excluded from new use until its applicable gate passes.

Qwen is not yet the best default phone engine:

- Google's merged Android LiteRT sample proves Qwen 0.6B Base synthesis on a
  Pixel 8a, but the checked-in path installs **1,880,805,470 bytes** of model
  files and takes **28.0 seconds to render 4.16 seconds of audio** (RTF 6.7).
  RTF is generation time divided by generated-audio duration; below 1 is
  faster than real time.
- Faster LiteRT artifacts reduce the reported payload to **1,669,759,898
  bytes** and the reported Pixel 8a RTF to 2.06, still slower than real time.
  The merged Kotlin source currently hardcodes the old MTP and codec graphs,
  so the faster result is not a turnkey result from the checked-in app.
- The merged app takes a precomputed 1024-dimensional speaker x-vector.
  Its voice-enrollment script loads the original Qwen model in desktop
  PyTorch. It therefore proves phone synthesis from a prepared voice, not a
  user recording and enrolling a voice entirely on the phone.
- A newer open `qwentts.cpp` port retains Qwen's speaker and codec encoders.
  Its 0.6B Base Q4 talker plus tokenizer total **883,879,808 bytes**, and it
  has a Termux build. It is the most interesting complete Qwen Android
  experiment, but it has no published phone RTF, peak-memory, thermal or
  quality receipt.

The recommended research portfolio is:

1. **Pocket TTS INT8** as the first small audio-only cloning experiment,
   using a documented conversion from the upstream-licensed artifacts unless
   the existing sherpa archive's contradictory non-commercial notice is
   clarified.
2. **`qwentts.cpp` 0.6B Base Q4** as the Qwen fidelity and complete-enrollment
   experiment.
3. **KittenTTS INT8** as the tiny fixed-voice control.
4. **MOSS-TTS-Nano INT8** as the multilingual clone challenger after the
   first three are instrumented.
5. **ZipVoice Distill INT8** as a technical comparator only after its
   published weight licence is clarified in writing.

The engineering recommendation—still awaiting the owner's public-voice
decision—is **server VoxCPM2 plus only presets that separately clear the
applicable rights gates**. The present private/server route is not yet a safe
public gateway, and no researched local clone engine has cleared TransVoice's
phone, quality, identity, rights and reliability gates.

## What “phone-ready” means here

An ONNX, GGUF, Core ML or LiteRT file is not by itself a phone product. This
report uses the following evidence ladder:

| Stage | Evidence |
|---|---|
| 0 — capability | Model card or code exposes TTS/cloning/design. |
| 1 — portable package | A complete converted package exists, including text frontend, speaker/reference encoder and audio decoder where required. |
| 2 — mobile integration | Android/iOS build instructions or an app/sample exercise the complete relevant path. |
| 3 — device receipt | A named phone runs the path end to end, with model version, timing and enough detail to reproduce it. |
| 4 — sustained target proof | Target devices report download/install bytes, cold/warm latency, RTF, peak memory, failures, energy and thermal throttling over repeated use. |
| 5 — TransVoice acceptance | Blind listening, identity, intelligibility, rights and the exact selected-voice/fail-closed contract pass. |

Only stages 4 and 5 justify calling a model release-ready for TransVoice.
No candidate in this report has reached them.

“Open” is also split into independent questions:

- Is the runtime code redistributable?
- Are the model weights redistributable for a commercial app?
- Is the conversion or quantization redistributable?
- Are the tokenizer, phonemizer and audio codec covered?
- Are the reference recording, speaker identity and derived voice state
  authorized?

An open runtime does not license the weights or a person's voice.

## Normalized clone-capable comparison

Package figures below are complete model payloads where a reproducible
package could be enumerated. Decimal MB/GB are used. Runtime libraries, the
TransVoice app, caches and generated audio are additional.

| Candidate | Clone input and reach | Complete payload | Payload basis | Best current phone evidence | Licence/provenance | Research ruling |
|---|---|---:|---|---|---|---|
| **Pocket TTS INT8 + sherpa** | Reference audio only; no transcript. Upstream now supports EN/FR/DE/PT/IT/ES, while the inspected sherpa export is English-first. | **203.2 MB installed**, 98.3 MB compressed | Unpacked/archived sherpa package, including sample WAVs; runtime library and app excluded. | sherpa has Kotlin and Swift APIs and a complete encoder/synthesizer. Community phone synthesis exists, but no authoritative arbitrary-enrollment phone benchmark was found. | Upstream code MIT and weights CC-BY-4.0 plus gated prohibited-use terms. The selected sherpa archive's embedded README also says “for non-commercial,” conflicting with its embedded licence/upstream metadata. | **First small research spike; commercial hold.** Reproduce and document a conversion from upstream-licensed artifacts or obtain written archive clarification before distribution. |
| **ZipVoice Distill INT8 + sherpa** | Reference audio plus an exact transcript; EN/ZH. | **205.2 MB installed** including Vocos; about 163.3 MB downloaded | Unpacked/archived acoustic package plus separate vocoder; runtime library and app excluded. | Open sherpa issue reports full offline cloning on Pixel 10 Pro CPU at roughly RTF 1.0. It is a developer report, not a merged app or sustained benchmark. | Repository code Apache-2.0. The HF weight card declares no weight licence and says the released Distill model was trained from Emilia. | **Technically strong, commercial hold.** Exact transcript also adds ASR/enrollment complexity. |
| **MOSS-TTS-Nano official ONNX** | Reference audio; upstream says 20 languages. | **763.2 MB** for full TTS plus codec encode/decode | Directly loadable official ONNX graphs/external data; runtime library and app excluded. | Official Android ONNX smoke app runs two pre-tokenized texts with built-in prompt audio codes. It does not expose microphone enrollment or a named-device benchmark. | Apache-2.0. | **Multilingual research candidate, not compact yet.** |
| **MOSS community INT8 ONNX** | Same architecture; the conversion documents EN/ZH/JA testing. | **288.8 MB** with full official codec | Directly loadable community INT8 TTS files plus official codec; runtime library and app excluded. | Community Snapdragon 8 Gen 3 claims RTF 0.36 and 123 ms warm first audio, but no independent reproduction was found. Microphone cloning is not wired by default. | Conversion labels Apache-2.0 inherited from upstream; verify every converted artifact before redistribution. | **Spike after Pocket/Qwen.** Reproduce size, memory and quality before relying on the claims. |
| **Qwen3-TTS 0.6B Base, LiteRT** | Phone receives a pre-enrolled x-vector; 10 languages. Higher-quality ICL reference codes are not in the merged app. | **1.881 GB** checked-in path; **1.670 GB** faster artifact set | Two selected LiteRT graph-file sets; runtime library, app and off-phone enrollment model excluded. | Official Pixel 8a app: RTF 6.7. Artifact author reports RTF 2.06 with faster graphs. User enrollment remains off-phone. | Qwen and converted weights Apache-2.0. | **Useful official control, not a conversational release path.** |
| **Qwen3-TTS 0.6B Base, `qwentts.cpp` Q4** | WAV to x-vector or ICL codes and synthesis; 10 languages; streaming API. | **883.9 MB** Q4 pair; 1.284 GB Q8 pair | Paired talker/tokenizer GGUF weights; runtime binary and app excluded. | C++/GGML runtime, public C ABI and Termux build. No named-phone end-to-end benchmark. | Runtime MIT; upstream/converted weights Apache-2.0. | **Best complete Qwen Android feasibility spike.** Prove the phone path before JNI/app work. |
| **NeuTTS Nano Q4** | 3–15 second reference; separate EN/FR/DE/ES models. | About **507 MB** for a pre-encoded voice; roughly **1.23 GB+** when a full codec encoder is included for private on-phone enrollment | Required model files for the named mode; runtime and frontend excluded. | Galaxy A25 result is language-model tokens only and explicitly excludes the required codec. | NeuTTS Open License allows free commercial use only below its US$5M revenue threshold. | **Defer.** Size, incomplete end-to-end proof and licence are inferior to Pocket/MOSS/Qwen. |
| **OpenVoice V2 + base TTS** | Tone-colour conversion after another TTS generates speech. | Roughly **339 MB** for converter plus an English Melo base before runtime/frontend | Required model files for one English two-stage path; runtime/frontend excluded. | A custom Adreno port measured only the converter on a 2020 Razr at RTF 2.01. Total latency also includes base TTS. | MIT project; each base model and voice asset remains separate. | **Offline voice-preparation experiment, not first interactive engine.** |
| **VoxCPM2** | Voice design, controllable clone and high-fidelity continuation; 30 languages. | **4.961 GB** official BF16 snapshot; current NCNN conversion is about 5.188 GB | Whole official HF snapshot, or named conversion file set; runtime and app excluded. | No representative phone receipt. Official performance is an RTX 4090 result with about 8 GB VRAM. | Apache-2.0. | **Keep on the private server baseline.** It remains the quality/voice-design control, not a phone candidate or public approval. |

### Size comparison in plain language

Using installed or directly loadable payloads:

```text
Kitten fixed voice       ~0.028 GB
Pocket clone             ~0.203 GB
ZipVoice clone           ~0.205 GB
MOSS clone, INT8         ~0.289 GB  (community conversion)
Qwen clone, GGML Q4      ~0.884 GB
Qwen clone, LiteRT fast  ~1.670 GB
Qwen 0.6B official BF16  ~2.516 GB
VoxCPM2 official BF16    ~4.961 GB
```

On these explicitly labelled byte bases, Pocket and ZipVoice are
approximately one twenty-fourth of the current VoxCPM2 snapshot. Qwen GGML
Q4 is approximately one sixth of VoxCPM2, but still over four times Pocket's
unpacked package payload.

Disk size is not RAM. Some runtimes memory-map weights; others allocate
dequantized buffers or duplicate graph state. Every number still needs a
peak-PSS/physical-footprint measurement on the target phone.

## Qwen: exact answer and mobile boundary

### Official open checkpoints

The [official Qwen repository](https://github.com/QwenLM/Qwen3-TTS) publishes
the following complete checkpoint family. Every TTS checkpoint supports the
same ten listed languages; the tokenizer is a shared speech representation,
not a standalone TTS voice:

| Official checkpoint | Function | Exact HF snapshot |
|---|---|---:|
| `Qwen3-TTS-12Hz-0.6B-Base` | Voice cloning and fine-tuning | **2,516,106,051 bytes** |
| `Qwen3-TTS-12Hz-1.7B-Base` | Larger voice-cloning model | **4,544,229,700 bytes** |
| `Qwen3-TTS-12Hz-0.6B-CustomVoice` | Nine Qwen preset speakers | **2,498,388,392 bytes** |
| `Qwen3-TTS-12Hz-1.7B-CustomVoice` | Nine Qwen preset speakers with instruction/style control | **4,520,218,951 bytes** |
| `Qwen3-TTS-12Hz-1.7B-VoiceDesign` | Voice from a natural-language description | **4,520,163,832 bytes** |
| `Qwen3-TTS-Tokenizer-12Hz` | Shared 24 kHz speech encode/decode tokenizer | **682,300,739 bytes** |

The Base API takes reference audio plus its transcript. Qwen also exposes
`x_vector_only_mode=True`, which removes the transcript requirement but
officially trades away cloning quality. A clone prompt can be precomputed
and reused.

Qwen documents a **Voice Design then Clone** technical recipe:

1. Generate a reference clip with the 1.7B VoiceDesign checkpoint.
2. Turn that clip and transcript into a reusable Base-model clone prompt.
3. Generate later lines conditioned on that prompt.

The recipe proves that the APIs connect; it does not prove that listeners
perceive a stable identity even across VoiceDesign → Base prompt → later
utterances. Substitution into 0.6B Base, Pocket/MOSS conditioning,
distillation and fixed-model training each create another unverified identity
transfer. No output may be called the same frozen voice until the
pre-registered `SIM-01` stability and speaker-similarity gate passes.

The commonly repeated Qwen “97 ms” latency is not a phone result. The
official phone evidence is the Google sample below.

### Android

The [merged Google AI Edge sample](https://github.com/google-ai-edge/litert-samples/tree/main/compiled_model_api/text_to_speech_lm)
is meaningful evidence:

- Kotlin/CPU app;
- Pixel 8a device result;
- full text → talker → multi-token predictor → codec decode path;
- Apache-2.0 code and converted weights;
- 4.16 seconds of audio in 28.0 seconds, RTF 6.7.

It is not full user cloning. The app loads a `demo_speaker.npy` x-vector.
The supplied enrollment script loads the full Qwen checkpoint in PyTorch on
a separate machine to turn a WAV into that vector.

The converted repository contains faster folded-INT8 MTP and split-codec
graphs and reports RTF 2.06 on the Pixel 8a. Inspection on 28 July found:

- the install script downloads the 1.881 GB reference set;
- `Qwen3TtsEngine.kt` loads `mtp_fp32.tflite` and
  `codec_decoder_fp32.tflite`;
- the faster graphs are therefore available artifacts, not the current
  checked-in app's default executable path.

An [open Google PR #241](https://github.com/google-ai-edge/litert-samples/pull/241)
is CI-green and approved but unmerged. It reports 99.6 ms per 80 ms frame
for the Pixel 8a CPU talker-step graph and measures the codec separately.
That is promising engineering evidence, not a complete release APK or
full-pipeline RTF/RAM receipt.

[`qwentts.cpp`](https://github.com/ServeurpersoCom/qwentts.cpp) is the more
complete cloning experiment. Its paired GGUFs retain the speaker encoder,
codec encoder and decoder; it can precompute compact `.spk` and `.rvq`
references or accept the WAV directly. A public C ABI makes a future JNI
bridge plausible. The repository changes quickly and currently lacks the
phone measurements that would justify app integration. Before a spike, pin
the exact runtime commit and public GGUF revision/file hashes: the README's
public model repository and the current `models.sh` repository/filenames do
not presently align, so the helper script is not a reproducible dependency.

### iPhone

The open iOS picture is weaker:

- [Argmax TTSKit](https://github.com/argmaxinc/argmax-oss-swift) provides a
  polished Core ML iOS 18 path at about a 1 GB download for Qwen 0.6B, but
  it currently exposes Qwen's nine CustomVoice presets, not voice cloning.
- [AtomGradient's Swift/MLX port](https://github.com/AtomGradient/swift-qwen3-tts)
  declares iOS 18 support and a 1.7B Base cloning API. Its 808 MB
  edge-optimized artifact is CustomVoice with the speech encoder removed,
  so that smaller artifact cannot clone. No representative iPhone clone
  benchmark was found.
- Other Swift/MLX ports claim 0.6B Base cloning, but current open fixes
  describe broken speaker extraction or lost identity on main branches.
- A closed App Store application demonstrates feasibility on recent iPhones,
  but closed code, anecdotal failures and no public measurement table cannot
  qualify an open TransVoice path.

Pocket/ZipVoice through sherpa's Swift/iOS runtime is consequently a cleaner
open iOS experiment than Qwen today, subject to the same full-device proof.

## Smaller candidates in detail

### Pocket TTS

[Pocket TTS](https://github.com/kyutai-labs/pocket-tts) is a 100M-parameter
CPU/streaming model. A plain WAV is enough; it does not need the matching
transcript. Upstream can export a reusable voice state so reference
processing is paid once.

The [sherpa package](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
is a complete INT8 ONNX path:

- `lm_main.int8.onnx`;
- `lm_flow.int8.onnx`;
- reference encoder;
- decoder;
- text conditioner and vocabulary.

The release archive is 98,336,520 bytes compressed and 203,216,103 bytes
unpacked, including sample WAVs. sherpa exposes C/C++, Java/Kotlin and Swift
APIs and supports Android arm64 and iOS arm64.

The missing proof is important: official Pocket speed numbers are from a
MacBook Air M4, and sherpa's documentation does not publish a complete
record-WAV → encode → repeated synthesis benchmark on named Android and
iPhone devices. Community apps prove that synthesis is possible, not that
TransVoice-grade arbitrary enrollment is fast and stable.

Pocket's upstream code is MIT; the official weights are CC-BY-4.0 and
access-gated with conditions prohibiting cloning without explicit lawful
consent, deception and privacy-invasive use. The inspected sherpa archive
creates a separate unresolved problem: its embedded README says “for
non-commercial,” while its embedded licence and upstream metadata say
CC-BY-4.0. Treat that binary package as a commercial hold. A research spike
must either reproduce and document the conversion from duly obtained
upstream artifacts or obtain written clarification; distribution also needs
an attribution and prohibited-use compliance record.

### ZipVoice

[ZipVoice](https://github.com/k2-fsa/ZipVoice) is a 123M flow-matching
zero-shot model. sherpa's Distill INT8 path is bilingual English/Chinese and
requires:

- reference WAV;
- the exact spoken transcript;
- encoder and decoder;
- `vocos_24khz.onnx`;
- phonemizer/lexicon data.

The acoustic package expands to 150,992,715 bytes; the vocoder adds
54,157,409 bytes. A developer's
[open sherpa issue](https://github.com/k2-fsa/sherpa-onnx/issues/3439)
reports full offline cloning on a Pixel 10 Pro at about RTF 1.0. The issue
also says reference encoding is a noticeable part of that time.

The ZipVoice issue is a more specific publisher report than Pocket's
published phone enrollment evidence; neither result was independently
reproduced. The commercial evidence is weaker. The GitHub code is
Apache-2.0, while the HF weight card has no licence field and says the
released Distill checkpoint is initialized from an Emilia-trained model.
The same maintainers changed another Emilia-trained model to CC-BY-NC after
a licence challenge. This does not by itself decide ZipVoice's legal
status; it is enough to block a commercial dependency until the publisher
clarifies the weights in writing.

### MOSS-TTS-Nano

[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano) combines a
roughly 100M TTS model with a roughly 20M audio tokenizer and advertises 20
languages, CPU streaming and voice cloning. Code and official weights are
Apache-2.0.

Its complete official ONNX assets are larger than the parameter label
suggests:

- TTS graphs/data: 672,627,229 bytes;
- codec encoder/decoder: 90,578,835 bytes;
- total: 763,206,064 bytes.

The official Android example is a valuable build smoke test, but it:

- uses two pre-tokenized texts;
- selects pre-encoded built-in prompt audio codes;
- loads only codec decoding for the demonstrated path;
- has no microphone enrollment UI;
- names no device and publishes no RTF, peak-memory or thermal result.

A community INT8 conversion reduces a complete clone-capable file set to
about 288.8 MB and reports strong Snapdragon 8 Gen 3 performance. Those
figures are a hypothesis to reproduce, not a basis for a product promise.
An unresolved upstream issue reports about 6 GB RAM for the official ONNX
app versus 600 MB for PyTorch on the reporter's machine; it is a warning to
measure, not a general memory fact.

## Fixed and original-synthetic voice lane

If the owner later approves a small catalogue rather than arbitrary cloning,
the phone problem becomes much easier.

| Candidate | Measured model payload | Voice mechanism | Mobile position | Ruling |
|---|---:|---|---|---|
| **KittenTTS Nano v0.8 INT8** | **27.7 MB** official HF snapshot | Eight fixed English voices; speed control; no cloning | ONNX CPU. sherpa also ships Android-compatible packages; vendor's own mobile SDK is still roadmap. | **Tiny fixed-voice control.** Developer preview and English-only. |
| **Kokoro 82M INT8** | about **157.9 MB** installed English sherpa pack or **215.3 MB** multilingual pack | 54 released voice packs; no zero-shot cloning | Mature sherpa Android/iOS path | **Best broad fixed preset comparator.** Apache weights, but maintain a voice-asset provenance record. |
| **Piper/VITS through sherpa** | commonly tens of MB per trained voice | Fixed single/multi-speaker models; train a voice TransVoice owns | Mature embedded/Android paths | **Strong long-term commissioned/synthetic voice format.** Engine and every voice model need separate licence review. |
| **Supertonic 3 INT8** | **145.3 MB** installed sherpa pack | Fixed styles, 31 languages and expression tags; no open cloning pipeline | Official iOS examples and multiple native runtimes | **Frozen benchmark only.** The official 23 July 2026 notice says the repo will be archived and Voice Builder closes 31 August 2026. Weights use OpenRAIL-M. |

The practical “make our own voices” research hypothesis is:

1. Author an original seed voice off-device with VoxCPM2 Voice Design,
   Qwen 1.7B VoiceDesign, or a commissioned speaker with an appropriate
   synthetic-voice release.
2. Freeze the seed, prompt, model/version, hash, date and rights record.
3. Test two deployment branches:
   - condition Pocket/Qwen/MOSS on the seed or a derived voice state; and
   - create a rights-cleared corpus in that identity, then train or distil a
     compact fixed model.
4. Treat every transfer—design → seed, seed → clone state, cross-model
   conditioning, corpus generation and fixed-model training—as an unverified
   identity boundary.
5. Compare the phone output blindly against the frozen seed for stability,
   speaker similarity, intelligibility, coaching suitability and unwanted
   resemblance under `SIM-01`.
6. If the owner later approves a public lane, admit only the smallest
   representation that passes every identity and rights gate, with a
   per-voice kill switch.

The fact that the seed is machine-generated does not automatically clear
copyright, model terms, training-data provenance, personality resemblance
or the right to redistribute a derived embedding/model. Those fields stay
in the voice ledger.

## Recommended TransVoice architecture — pending owner decision

### Current private baseline and public boundary

The normal phone-to-DEVBOX VoxCPM2 path is the current **private research
baseline** and keeps the large model off the phone. Its selected-reference
path fails closed, but the inspected gateway also retains caller-text,
upload/preset-creation and legacy default-voice routes. It is therefore not a
safe public baseline.

No public-lane implementation starts until the owner records `DEC-01`.
Before any pilot, `TXT-01` and `MIG-01` must remove or internal-deny every
legacy upload/free-text route, accept only a bound one-use server-issued
utterance and exact authorized target, reject stale clients, and prove zero
default substitution. Until that decision, the existing uploaded-reference
contract is not silently changed, and the complete Aster prohibition and
evidence-hold/deletion rule above remain in force.

If the owner approves public presets, the proposed server lane would:

- use only commissioned or deliberately designed fictional voices that pass
  their separate human/synthetic rights gates;
- retain a source, seed/master, model, licence, provenance, approval,
  resemblance and withdrawal package for every preset;
- carry one end-to-end target fingerprint across selected preset, frozen
  master, engine, model/quantization, conditioning state, issued request,
  cache, response and playback;
- abort in-flight synthesis and queued audio when selection, voice
  activation or pack state changes; and
- fail closed if the exact target cannot synthesize. Cross-engine/provider
  fallback is forbidden unless that path independently passed `SIM-01` as
  the same frozen identity; a system/default voice is never substituted.

### Isolated on-device research path

The owner may separately authorize an Android-first native measurement
harness that is isolated from the production UI:

| Track | Purpose |
|---|---|
| Pocket INT8 | Small audio-only clone baseline, using a documented upstream conversion or after sherpa archive clarification |
| `qwentts.cpp` Q4 in Termux, then C ABI | Complete Qwen enrollment/fidelity experiment |
| Kitten INT8 | Fixed-voice size, latency and thermal control |
| MOSS INT8 | Multilingual challenger after the harness is trustworthy |
| ZipVoice INT8 | Technical comparison only after weight-licence clearance |

Do not begin with five bespoke app integrations. First produce a common
command contract and measurement output. Promote only survivors into a
Kotlin/JNI integration experiment. After Android survivors are known, run the
same contract through sherpa's Swift/iOS path and any then-correct,
clone-capable Qwen iOS port on the recent and minimum-supported iPhones.
Only an owner-approved future architecture may connect a native provider to
the WebView, and it must retain the exact target fingerprint and failure law
above.

An optional experimental model-pack manager should provide:

- resumable download and free-space check;
- signed manifest, pinned source revision and per-file SHA-256;
- separate compressed, installed and peak-memory figures;
- atomic activation/rollback that invalidates stale requests and audio;
- licence and attribution with each pack;
- explicit “not installed/loading/ready/failed” states;
- verified deletion of the model and every derived voice state; and
- no arbitrary user-supplied ONNX/GGUF import.

### Personal-cloning boundary

The reviewed public-voice recommendation defers personal cloning and keeps
Route C conditioning server-side. A local-custody experiment is a separate
hypothesis requiring a new owner, counsel and security ruling; it may use only
synthetic test assets or directly participating team subjects under the
research protocol.

A future product proposal must be limited to a live, directly participating
adult enrolling their own voice, followed only later by a separately invited
adult subject. It must prohibit uploader-supplied third-party clips, URLs,
scraped/public media, public figures, minors and “I have authority” checkbox
substitution. Before use it requires:

- a direct subject release that expressly covers generated novel speech,
  processor/model scope, territory, term, withdrawal and installed assets;
- risk-based same-speaker/liveness verification and abuse controls;
- revocation before deletion, followed by tested deletion across raw audio,
  derived embedding/state/model, cache, processor and backup layers;
- mandatory app-private encryption and backup exclusion; no client export of
  masters, embeddings, conditioning assets or weights;
- a separate opt-in before any reference is used for training; and
- reporting, quarantine and an operational kill path.

Keeping enrollment on device may reduce network transmission exposure only
if packet capture, telemetry, backup, crash, extraction and deletion tests
prove it. It does not remove consent, impersonation, device-compromise,
app-store or installed-asset obligations.

### TTS-specific rights gates inherited from the public-voice review

This is a TTS-specific excerpt, not the complete public-release register.
Phone performance is never enough for release:

| Gate | Required disposition before the named transition |
|---|---|
| `DEC-01` | Owner expressly approves, rejects or amends the public architecture and voice routes before any public-lane work. |
| `AST-01` | Now, before any existing-reference use: complete and clear its provenance/rights ledger or retain quarantine and the approved minimal evidence-hold/deletion schedule. |
| `MODEL-01` | Before Stage 1 or any inference for a non-team user: separately clear runtime code, original weights, conversion/quantization, tokenizer/phonemizer/codec, training corpus, generated seed/output, reference/persona, derived embedding/model, and on-device distribution, extraction, update, expiry and wind-down rights. |
| `HVOICE-01A/B` | Clear a commissioned human voice before recording and again before release. |
| `SVOICE-01` + `SIM-01` | Prove designed-voice provenance, frozen identity, stability and no unresolved intended-human resemblance. |
| `TXT-01` + `MIG-01` | Establish the server-issued-text/exact-target public boundary and remove every legacy upload/free-text/default-fallback path. |
| `DATA-01` | Before Stage 1: pass the privacy assessment, processor map and deletion/breach tests across raw, derived, cache, processor and backup layers. |
| `CLONE-01` | Before Stage 3: pass direct-subject, verification, revocation, deletion, processor, jurisdiction and abuse tests before any personal-cloning beta. |
| `DEVICE-01` | Before any Stage 4 model: pass the pre-registered device matrix below; this cannot waive any earlier gate. |

The controlling register also retains `AGE-GEO-01`, `STORE-01`, `OPS-01`,
`PILOT-01` and conditional `CHILD-01`; this report does not replace or waive
them.

## Research promotion and stop gate

The current Pixel 9 is the first integration device, not the entire support
matrix. Test at least:

- the current Pixel 9;
- one 6–8 GB mid-range Android;
- one lower supported Android tier;
- a recent standard iPhone and an older minimum-supported iPhone.

For each exact model hash, quantization and runtime/backend, record:

1. Download bytes, installed bytes and free-space requirement.
2. Cold model load, warm load and first playable PCM.
3. RTF and p50/p95 latency for short coaching turns, paragraphs and long
   text.
4. Peak RSS/PSS/native heap and mapped-model memory.
5. Reference WAV processing time and the size/load time of the cached voice
   state.
6. Text frontend, speaker/codec encoder, acoustic generation, audio decoder
   and playback timings separately.
7. Twenty minutes of repeated turns: thermal state, RTF drift, energy and
   time to throttle.
8. Background/foreground, screen lock, low-memory and interrupted-download
   behavior.
9. Network-disabled operation, deletion, uninstall and backup behavior.
10. Intelligibility/WER, blind naturalness and speaker-identity comparison
    against official BF16 and current server VoxCPM2.
11. Clean, noisy and mismatched-language references at 3, 5, 10 and 20
    seconds.
12. Exact selected-voice failure tests: missing pack, corrupt pack, revoked
    voice, encoder failure and out-of-memory must be visible and must never
    produce another voice. Also test A → B selection during generation and
    playback, late/stale responses, pack rollback and attempted
    local → server/system/provider fallback; stale work and queued PCM must be
    aborted.

Before a candidate-specific POC benchmark starts, the owner must ratify or
replace these **provisional research cut lines**. They decide only whether a
branch merits native-integration work; they are not launch budgets or public
approval.

| Promotion measure | Provisional research cut line |
|---|---|
| Installed payload | Compact lane ≤350 MB; Qwen fidelity lane ≤1.0 GB. The larger official LiteRT set remains a measurement control only. |
| Warm first playable PCM | p95 ≤3.0 seconds on every supported test tier. |
| Sustained generation | p95 RTF <1.0 after 20 minutes of repeated turns, with no worsening trend that crosses 1.0. |
| Reliability | ≥99 successful exact-target completions in a 100-turn corpus and zero wrong/default voices. |
| Memory safety | Peak process PSS ≤50% of physical RAM, with zero low-memory kills, OOMs, reboots or unrecovered loads. |
| Identity/quality | Pre-registered `SIM-01`, intelligibility and coaching-prosody thresholds pass against the frozen seed and server control. |

Any of these is an immediate branch stop regardless of speed:

- unresolved or contradictory redistribution terms for any required code,
  weight, conversion, tokenizer, codec or voice asset;
- an intended local-clone track cannot complete reference recording →
  enrollment → repeated synthesis on the phone;
- a wrong voice, default/system voice, cross-engine substitution or stale
  target reaches playback;
- corrupt or unsigned files activate, or a run causes OOM, process kill,
  kernel panic/reboot or unrecoverable thermal throttling;
- raw or derived voice material cannot be revoked and deleted across every
  declared storage/backup layer; or
- the pinned source revision, manifest and file hashes cannot reproduce the
  measured package.

Always retain the raw measurements when a provisional cut line changes.

## Watchlist and explicit deferrals

- **Chatterbox Nano:** its 110M label does not describe the complete
  distributable pipeline; required official files are roughly 1.94 GB and
  no trustworthy Nano phone proof was found.
- **F5-TTS:** roughly 1.35 GB checkpoint, CC-BY-NC pretrained weights and no
  representative phone path.
- **CosyVoice/OmniVoice:** multi-GB complete stacks or noncommercial weights;
  no stronger phone evidence than the selected portfolio.
- **NeuTTS Nano:** codec-inclusive private enrollment is much larger than
  its headline backbone and its phone benchmark excludes the codec.
- **OpenVoice V2:** viable as a two-stage voice converter, but total latency
  is base TTS plus conversion.
- **Aria:** attractive announced 112M/MIT/ONNX/iOS design, but still
  “Coming Soon” with no released complete weights/runtime on the research
  date.
- **Supertonic Voice Builder:** hosted custom-voice creation is closing and
  is not an open on-device cloning pipeline.
- **Qwen/Vox GGUF or NCNN files alone:** container/conversion existence is
  not phone proof. `qwentts.cpp` is included only because it supplies the
  complete Qwen pipeline and a build path.

## Primary evidence

Core sources used for this decision:

- [Qwen3-TTS official repository](https://github.com/QwenLM/Qwen3-TTS)
- [Qwen 0.6B Base model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)
- [Google Qwen3-TTS LiteRT sample](https://github.com/google-ai-edge/litert-samples/tree/main/compiled_model_api/text_to_speech_lm)
- [Qwen LiteRT artifact repository](https://huggingface.co/litert-community/Qwen3-TTS-12Hz-0.6B-Base)
- [Google LiteRT Qwen Tensor API PR #241](https://github.com/google-ai-edge/litert-samples/pull/241)
- [`qwentts.cpp`](https://github.com/ServeurpersoCom/qwentts.cpp)
- [Pocket TTS official repository](https://github.com/kyutai-labs/pocket-tts)
- [Pocket TTS official weights/terms](https://huggingface.co/kyutai/pocket-tts)
- [sherpa Pocket documentation](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
- [ZipVoice official repository](https://github.com/k2-fsa/ZipVoice)
- [ZipVoice model card/provenance](https://huggingface.co/k2-fsa/ZipVoice)
- [sherpa ZipVoice documentation](https://k2-fsa.github.io/sherpa/onnx/tts/zipvoice.html)
- [ZipVoice Android device report](https://github.com/k2-fsa/sherpa-onnx/issues/3439)
- [MOSS-TTS-Nano official repository](https://github.com/OpenMOSS/MOSS-TTS-Nano)
- [MOSS Android ONNX example](https://github.com/OpenMOSS/MOSS-TTS-Nano/tree/main/examples/android_onnx_runtime)
- [VoxCPM2 model card](https://huggingface.co/openbmb/VoxCPM2)
- [sherpa-onnx runtime/platform support](https://github.com/k2-fsa/sherpa-onnx)
- [KittenTTS official repository](https://github.com/KittenML/KittenTTS)
- [Kokoro 82M model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [Supertonic official repository and closure notice](https://github.com/supertone-inc/supertonic)

Artifact byte totals were calculated from Hugging Face blob manifests and
GitHub release metadata on 28 July 2026. Compressed sherpa archives were
stream-listed and their member sizes summed; no disk-size estimate was
substituted for an enumerated payload when a complete package was available.
