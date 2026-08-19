# TransVoice designed-synthetic-voice foundry

**Research date:** 2026-07-28  
**Status:** Recommendation for a bounded spike; not an owner-ratified product
decision, legal clearance, release authorization, or claim that a selected
voice is exclusive.  
**Parent dossier:** [Public/mobile voice-rights options](./mobile-public-voice-rights-options-2026-07-28.md)

## Bottom line

Yes. TransVoice can create a catalogue of fictional synthetic voices without
using a real person's recording. This is the strongest version of the parent
dossier's B-S route.

The launch architecture should separate two jobs:

1. **Authoring:** use a large voice-design model offline to create and audition
   fictional candidates.
2. **Production:** freeze each admitted candidate as an immutable synthetic
   reference or reusable voice prompt, then synthesize every lesson from that
   retained identity.

Do not ask a model to invent the identity again for every sentence. That is
voice generation, not a stable catalogue voice.

The recommended flow is:

`original acoustic brief -> candidates -> quality/resemblance review -> frozen
synthetic master -> reference-conditioned production TTS -> phone audio`

The production engine may technically call the final step “voice cloning.”
The material distinction is that it clones a TransVoice-generated fictional
master, not a human performer or an uploaded third-party recording.

## Terms that must not be collapsed

| Capability | Meaning | Product consequence |
|---|---|---|
| Voice identity design | Creates a new timbre/persona from a description, with no human reference | Appropriate for fictional catalogue authoring |
| Identity persistence | Keeps the same designed speaker across different utterances | Required for a credible preset |
| Style/prosody control | Changes pace, energy, emotion, articulation, pitch or delivery | May vary per lesson while identity stays fixed |
| Preset mixing | Recombines existing trained speakers or embeddings | Not automatically a new or provenance-clean identity |
| Human voice cloning | Conditions on a real person's recording | Retains consent, persona, recording-rights and abuse issues |
| Synthetic-reference cloning | Conditions on a fictional reference generated during authoring | Preferred production mechanism, subject to validation |

## TransVoice is configured with version zero

The current service is configured to generate a no-reference synthetic coach:

- `services/voxcpm-tts/voices/coach_profile.json` declares `mode: "design"`,
  contains a written voice description, and sets
  `reference_audio_path: null`.
- `services/voxcpm-tts/app/model.py::synthesis_text` prepends that description
  to every utterance when no reference exists.
- When `reference_audio_path` is present, `VoxCPMEngine.generate` treats the
  reference as the complete identity and does not mix in the design
  description.

This means the key authoring-to-production code path is present:

1. generate an audition in design mode;
2. save the chosen generated WAV;
3. put that WAV through the existing reference-conditioned path.

No synthesis was run in this research pass, so the path's end-to-end runtime
behavior remains to be proven by the spike below.

The current default does not yet provide a catalogue-grade identity:

- each `coach_v1` sentence asks VoxCPM to design the speaker again;
- upstream VoxCPM warns that Voice Design can vary between runs;
- `VoiceProfile` and the bridge request have no seed field;
- the locally installed `voxcpm` 2.0.3 implementation has no generation seed
  argument, even though the current upstream README shows one;
- the dependency declaration is unpinned (`voxcpm = ["voxcpm"]`).

Even after seed support is available, a seed is reproducibility metadata, not
as strong an identity contract as immutable master audio or a reusable
conditioning object.

## Recommended foundry pipeline

### 1. Write original voice briefs

Use non-person acoustic and performance dimensions:

- adult perceived-age band;
- pitch range;
- resonance or brightness;
- vocal weight;
- breathiness;
- articulation;
- pace;
- prosodic range;
- warmth, confidence and energy;
- accent or dialect only when the model supports it well.

Do not use a real person's name, a celebrity, an actor, a copyrighted
character, a brand voice, or wording such as “X-like.” Do not add a human
reference later without moving the asset into the human-voice rights lane.

### 2. Generate candidates in a pinned authoring environment

For each brief:

- use fixed, original anchor scripts;
- generate several candidates;
- record the model and code version, weight hash, prompt, seed where supported,
  CFG, inference steps and every other generation parameter;
- retain rejected-candidate history so the design process is auditable;
- use a separate authoring environment rather than silently changing the
  production service's unpinned dependency.

### 3. Freeze an immutable identity master

For each selected candidate, retain:

- stable `voice_id` and version;
- canonical master WAV;
- SHA-256 of the master bytes;
- exact transcript;
- authoring prompt and parameters;
- authoring model/code/weight fingerprints;
- runtime model/code/weight fingerprints;
- licence and terms snapshot;
- reviewer record and SIM-01 report;
- neutral name, description and artwork;
- status: `candidate`, `admitted`, `quarantined`, `retired`, or `superseded`.

Never overwrite a master while keeping the same identity/version. A different
master is a new voice version.

### 4. Use the master only as the production identity

The existing VoxCPM path already builds and caches prompt features from a
reference WAV. Production should:

- resolve a server-owned catalogue ID to its admitted synthetic master;
- reject arbitrary caller-selected filesystem paths;
- condition every utterance on that master or its content-addressed prompt
  cache;
- keep per-utterance style controls narrow enough that the speaker remains
  recognizably the same;
- fail closed when the master, hash, runtime fingerprint or admission status
  does not match.

### 5. Run SIM-01 before admission and after material changes

At minimum:

- synthesize at least 20 held-out lesson lines;
- cover short and long lines, questions, numbers, difficult phonemes,
  emotionally varied directions and TransVoice coaching vocabulary;
- measure ASR intelligibility, clipping, discontinuities and pacing;
- compare master-to-output and output-to-output speaker embeddings;
- calibrate any embedding threshold with lawful positive and negative pairs;
- use a randomized, level-matched blind listening panel;
- review the whole commercial impression: sound, name, avatar, biography,
  prompt, sample text, metadata and marketing.

Speaker embeddings are engineering evidence, not legal clearance. There is no
universal “safe similarity” threshold. The parent dossier's conservative
trigger remains useful: reject or escalate if multiple independent listeners
identify the same real person or persona.

Re-run admission after a change to the master, authoring model, production
model, language, accent, style policy, emotion policy, quantization or
student/distilled model.

## Current model landscape

### Open authoring candidates

| System | Relevant capability | Persistence | Commercial posture | Phone evidence | TransVoice posture |
|---|---|---|---|---|---|
| [VoxCPM2](https://github.com/OpenBMB/VoxCPM) | Free-form no-reference Voice Design; 2B; 30 languages | No first-class saved designed-voice object; retain a generated WAV and use reference conditioning | Code/weights Apache-2.0; corpus provenance and persona/output warranties remain separate | Upstream-documented third-party GGUF/C++ edge path, but about 1.6 GB Q8 BaseLM plus 1.7 GB acoustic file; published edge result is M4 Pro, not a representative phone | Fastest spike because it is already integrated |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | Free-form VoiceDesign; 10 languages | Officially documents VoiceDesign -> synthetic reference -> `create_voice_clone_prompt` -> repeated Base synthesis | Apache-2.0 checkpoints; corpus described in aggregate, not a jurisdiction-wide clearance warranty | No official representative iPhone/Android benchmark | Best open comparison and strongest documented identity-freeze workflow |
| [MOSS-VoiceGenerator](https://github.com/OpenMOSS/MOSS-TTS) | Rich text-described fictional voice generation | Designed as an upstream voice-generation layer; persistence requires downstream handling | Apache-2.0, but its paper describes cinematic training material, creating a provenance diligence issue | No representative phone proof | Research comparator only until provenance is cleared |

Qwen checkpoint footprints reinforce the authoring/production split:

- the 1.7B VoiceDesign repository is about 4.52 GB;
- the 0.6B Base repository is about 2.52 GB;
- neither has official representative-phone proof.

VoxCPM2 warns that designed voices may vary and suggests multiple generations.
That makes it useful as a candidate generator, not a reason to redesign the
catalogue identity on each lesson.

### Managed authoring candidates

| System | Advantage | Constraint |
|---|---|---|
| [ElevenLabs Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design/) | Generates candidates from a description and saves the selected result as a reusable voice ID | Proprietary cloud; current terms/use policy apply; the current prohibited-use policy bars using service output as input or datasets for training/fine-tuning AI, so it is not a future student-model corpus without separate written permission |
| [Hume Voice Design](https://dev.hume.ai/docs/voice/voice-design) | Saves a designed result as a private reusable voice | Proprietary cloud, vendor terms and narrower design/language constraints |

Managed services are valid product prototypes if their terms fit the exact
deployment. They are weaker strategic foundries when TransVoice wants to
export the identity, change vendors, or train a self-hosted mobile model.

### Exclusions under current public terms

- [Spark-TTS](https://huggingface.co/SparkAudio/Spark-TTS-0.5B) can create
  structured virtual speakers, but the current official pretrained weights
  are CC BY-NC-SA 4.0. They are not a public-commercial launch dependency
  without separate permission.
- OmniVoice's current official pretrained weights are noncommercial.
- Parler-TTS offers strong descriptive style control, but stable identity is
  tied to named training speakers rather than a robust new-identity foundry.

### Smaller production/mobile candidates

These are runtime candidates, not proven foundries:

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) is a 100M,
  CPU-oriented, streaming, reference-conditioned model. It can export a
  reusable voice state from a WAV. Its published speed is on an M4 MacBook,
  not a representative phone.
- [sherpa-onnx PocketTTS](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
  provides an INT8 offline path and Java, Kotlin and Swift examples.
- [KittenTTS](https://github.com/KittenML/KittenTTS) has 15M–80M ONNX models
  and 25–80 MB footprints, but its current public models contain eight preset
  voices and its mobile SDK is still a roadmap item.
- [sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/index.html) supports TTS
  deployment on Android and iOS for supported models.

The first offline experiment should feed the same admitted synthetic master
to Pocket TTS/sherpa-onnx and compare identity and intelligibility with
VoxCPM. It should not assume cross-model identity survives.

A later fixed-speaker VITS/ONNX student may be smaller still, but creating a
synthetic corpus, training it, clearing the generator's output terms and
preventing synthetic-to-synthetic quality loss is a separate ML programme.
VoxCPM LoRA may stabilize a speaker while keeping the large 2B runtime, so it
does not by itself solve handset size.

## Mobile architecture decision

A mobile app and an on-device model are different decisions.

TransVoice's present Android app is a WebView shell whose comments and URL
show that the backend runs remotely. The lowest-risk launch lane is therefore:

`phone client -> authenticated approved lesson turn -> server TTS with frozen
synthetic master -> streamed audio`

This removes the rich voice-design model from the handset and lets the team
ship a mobile client before offline synthesis is solved.

An offline/on-device lane should remain a separate experiment until a
representative low/mid/high Android and iPhone matrix proves:

- model/package size;
- cold start and time to first audio;
- sustained real-time factor;
- peak memory;
- thermal and battery behavior;
- long-session stability;
- identity and intelligibility after quantization.

VoxCPM's current GGUF path is edge-capable, but roughly 3.3 GB of weights and
an M4 Pro benchmark do not establish phone viability.

## Rights and operations delta

### Materially reduced at the preset-supply layer

A genuinely no-target, no-human-reference catalogue normally removes:

- copyright and source-site terms for a third-party reference recording;
- performer consent, compensation, reuse, withdrawal and posthumous-authority
  questions;
- actor-specific reference assets in the phone package;
- collection of a preset subject's recording or voiceprint;
- the claim that TransVoice intentionally cloned or hired a specific person.

### Not removed

Do not call the result “copyright-free,” “cleared,” “unique,” or “owned” as an
abstract timbre. Remaining issues include:

- accidental resemblance to an identifiable person or commercial voice;
- false affiliation, endorsement, passing-off or consumer-deception claims;
- the model licence versus the separate provenance of its training corpus;
- output and vendor terms;
- uncertain copyright protection for wholly AI-generated output;
- trademark/name clearance and the total commercial presentation;
- synthetic-audio and AI-interaction disclosure;
- app-store policies;
- complaint, quarantine, takedown and retirement handling;
- privacy duties for users' own microphone recordings, transcripts and
  accounts;
- biometric/privacy implications if a real-person embedding blocklist is used
  for screening.

Apache-2.0 permits use of the licensed model work subject to its terms. It is
not a warranty that every training recording, person, generated output or
release country has been cleared.

The [U.S. Copyright Office's 2025 output report](https://www.copyright.gov/newsnet/2025/1060.html)
says copyright may protect human-authored expression, creative selection or
arrangement, and human modifications within an AI-assisted work. It does not
protect machine-determined elements merely because a person supplied prompts.
Protect TransVoice's human-authored lesson text, software, curated
compilation, provenance records, names and branding without assuming an
exclusive property right in the timbre.

The [EU AI Act, Article 50](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en)
applies from 2 August 2026 and creates transparency duties relevant to direct
AI interaction and synthetic audio. Depending on TransVoice's role, the
release design may also need machine-readable marking and detectability of
synthetic outputs—not just a user-facing disclosure. Exact provider/deployer
duties need release-specific review.

Keep:

- a no-target design record;
- a public AI-generated-voice disclosure;
- neutral marketing;
- an accessible complaint path;
- a per-voice quarantine/kill switch;
- prompt handling of credible notices;
- fresh legal/terms/store review for each launch jurisdiction and material
  model/vendor update.

This is product/legal research, not legal advice.

## Required product/code changes before a catalogue

The current reference path is useful but should not be exposed unchanged:

1. Add an explicit `synthetic-catalog` source. The trainer currently
   normalizes presets only to `reference` or `handmade`; server-authored
   synthetic voices should not masquerade as user uploads.
2. Add immutable master hash, authoring/runtime model fingerprints,
   provenance and SIM admission status to the preset.
3. Include the master hash and runtime-model version in the voice target
   identity. `backend/voice-target-identity.js` currently hashes the profile
   ID/reference clip ID, acoustic bands and analysis version, but not the
   master bytes or TTS-model fingerprint.
4. Add catalogue selection to the gateway contract. The compatibility
   `/generate` route currently resolves only the default profile, although it
   can accept a reference path.
5. Resolve catalogue IDs server-side. Do not permit the client to choose an
   arbitrary reference path.
6. Preserve the existing content-addressed reference cache and fail-closed
   evidence checks.
7. For a public release, internalize or disable arbitrary upload,
   reference-save, handmade-save, preset-test and free-text synthesis routes
   unless a separately approved policy covers them.
8. Bind production synthesis to approved server-side lesson turns rather than
   arbitrary caller text.
9. Review the reference cache limit of four before offering a 3–6 voice
   catalogue; current synthesis concurrency defaults to one.

These are implementation requirements, not changes made by this research
pass.

## Cheapest falsifying spike

Do not build catalogue UI first.

1. Create six original briefs.
2. In an isolated pinned VoxCPM authoring environment, generate three
   candidates per brief against two neutral scripts (36 clips).
3. Blind-shortlist one or two candidates and freeze each master WAV and hash.
4. Use the current reference-conditioned TransVoice server to synthesize the
   predeclared 20-line SIM-01 suite.
5. In parallel, feed the same master to Pocket TTS/sherpa-onnx INT8 on desktop
   CPU and generate the same suite.
6. Run ASR, clipping/pacing checks, calibrated speaker-embedding comparisons
   and blind identity/resemblance listening.
7. Measure real phone-to-server time to first audio and end-to-end latency.

Predeclare rejection conditions:

- frozen-reference synthesis still does not hold one recognizable identity;
- multiple independent listeners identify the same real person/persona;
- intelligibility or coaching comfort falls below the current coach baseline;
- catalogue voices are not perceptually separable;
- intended commercial or downstream use conflicts with licence/terms;
- server/mobile UX misses its target;
- a smaller runtime materially loses identity or intelligibility.

Interpretation:

- direct design fails, frozen reference passes: keep Voice Design as
  authoring-only;
- VoxCPM passes, Pocket TTS fails: server-first survives; offline remains
  unresolved;
- both pass: begin a representative-phone Pocket/sherpa benchmark;
- frozen reference fails: reject the mechanism/model before building product
  surface around it.

No audio was generated or auditioned in this research pass. Perceptual quality,
catalogue separation and representative-phone performance remain unverified.

## Decision posture

- **High confidence:** no-reference fictional voice design is technically
  available and the corresponding design/reference code paths are configured
  in TransVoice; end-to-end runtime behavior remains untested in this pass.
- **High confidence:** design-once/freeze is a stronger identity mechanism
  than prompt-only redesign on each utterance.
- **Medium confidence:** it materially reduces public-release rights and
  operations risk, but does not eliminate model, resemblance, disclosure or
  ownership questions.
- **Low confidence:** any current rich voice-design model is ready for
  representative-phone on-device deployment.

**Recommendation:** approve only the bounded foundry spike. Do not yet approve
a public catalogue, a model commitment, a claim of exclusive ownership, or an
offline-mobile architecture.

## Primary sources

- [VoxCPM2 official repository and risks/limitations](https://github.com/OpenBMB/VoxCPM)
- [VoxCPM2 technical report](https://arxiv.org/abs/2606.06928)
- [VoxCPM2 official model card](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM2 GGUF file sizes](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF)
- [Qwen3-TTS official repository, including Voice Design then Clone](https://github.com/QwenLM/Qwen3-TTS)
- [Qwen3-TTS technical report](https://arxiv.org/abs/2601.15621)
- [Qwen VoiceDesign checkpoint](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)
- [Qwen 0.6B Base checkpoint](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)
- [ElevenLabs Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design/)
- [ElevenLabs terms](https://elevenlabs.io/terms-of-use/)
- [ElevenLabs prohibited-use policy](https://elevenlabs.io/use-policy)
- [Spark-TTS official model card and noncommercial licence update](https://huggingface.co/SparkAudio/Spark-TTS-0.5B)
- [Pocket TTS official repository](https://github.com/kyutai-labs/pocket-tts)
- [PocketTTS in sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
- [sherpa-onnx Android TTS build documentation](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html)
- [KittenTTS official repository](https://github.com/KittenML/KittenTTS)
- [U.S. Copyright Office AI initiative](https://www.copyright.gov/ai/)
- [U.S. Copyright Office digital-replica report](https://copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-1-Digital-Replicas-Report.pdf)
- [EU AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play AI-generated-content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en)

## Re-check triggers

Re-run this research before public release and whenever:

- a model, checkpoint, runtime or vendor changes;
- a licence, vendor policy or app-store rule changes;
- a release country is added;
- a catalogue voice, name, artwork or marketing presentation changes;
- on-device/offline synthesis becomes a product requirement;
- a credible resemblance or rights complaint arrives;
- synthetic output is proposed as training data for another model.
