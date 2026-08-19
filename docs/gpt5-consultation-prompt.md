# TransVoice — AI Voice Coaching Application: Architecture, State, and Design Questions

## What This Application Is

TransVoice is a standalone AI-powered voice coaching application focused on transfeminine voice training. It provides real-time conversational pronunciation/accent coaching through a browser-based interface. The user speaks into their microphone, receives live acoustic analysis, and gets natural-language coaching feedback in real time.

The core use case: a user practices speaking in their target voice (e.g., bright, forward, light Australian feminine), the system analyzes their pitch, resonance, voice weight, and phrase contour in real time, and an AI coach gives them one practical cue at a time — conversational, warm, actionable.

## Current Architecture

### Components (all running locally)

1. **VoiceTrainer** (Python FastAPI, port 8002)
   - Handles audio capture, acoustic analysis, and voice metrics
   - Provides: pitch tracking, resonance analysis, voice weight estimation, phrase comparison via DTW, target voice profiles, reference clip management
   - Exposes REST API + WebSocket streaming for real-time audio frames
   - Returns rich metrics per take: mean pitch, pitch range, resonance %, weight %, target hit %, similarity %, formant analysis, voiced coverage, pitch trajectory, advanced band analysis

2. **GGUF Voice Tutor Model** (llama.cpp, port 8019)
   - Fine-tuned Gemma 4 model: `voice-tutor-gemma4-r128-clean-s070-iq4nl-attnq8-last10-gguf`
   - IQ4_NL quantized, attention Q8, last 10 layers
   - 120K context window, served via OpenAI-compatible `/v1/chat/completions` endpoint
   - Used for two purposes:
     a. **Realtime coaching** (per voice turn): short conversational replies, 180 tokens max, temperature 0.35
     b. **Lesson planning** (once per session): produces 3-5 structured knowledge points, 400 tokens max, temperature 0.5

3. **Standalone Gateway** (Node.js Express, port 3021)
   - Unified API gateway serving both backend routes and static frontend
   - Session persistence (JSON file-backed, survives restarts)
   - Learner context service (per-student profiles, concept mastery, attempt history, review queues, notepad handoffs, dataset export with consent/redaction)
   - VoiceTrainer WebSocket proxy
   - Coach thread management (last 6 messages)
   - SSE streaming endpoint for real-time coaching responses

4. **Frontend** (Vite-built static SPA, PWA-installable)
   - Launcher page with connection profiles, session management, health checks
   - Direct app entrypoint that bootstraps the voice runtime without the full SLOANE shell
   - Browser speech recognition for ASR
   - Real-time voice analysis visualization
   - Service worker for offline shell caching

### Model Performance Benchmarks (measured locally)

| Scenario | Total Time | Tokens/sec | Time to First Token |
|---|---|---|---|
| Streaming TTFT (raw model) | — | — | 41ms |
| Streaming TTFT (SSE endpoint) | 624ms | 213 chars/s | 349ms |
| Rich context coach turn (667 tokens in) | 365ms | 93 tok/s | — |
| Minimal context coach turn (305 tokens in) | 904ms | 33 tok/s | — |
| Lesson planning (one-time, 322 tokens out) | 3.6s | 89 tok/s | — |

Key finding: rich context injection does NOT slow down inference. The model handles 667-token prompts as fast or faster than 305-token prompts.

## What Is Deterministic vs What Uses the LLM

### Entirely Deterministic (no LLM involved):

- **Practice sentences**: Hardcoded drill packs (4 presets × 4 drills = 16 total sentences)
- **Pronunciation spelling**: A curated dictionary (`CUE_OVERRIDES`, ~40 words) mapping words to phonetic cue spellings (e.g., "again" → "uh-GEHN", "like" → "laik"), plus regex fallback transforms for unknown words
- **Per-word cue annotations**: 12+ heuristic functions generating mouth shape, jaw action, lip action, tongue position, airflow cue, placement feel, expression cue, avoid cue, and teaching notes — all from vowel/consonant regex patterns
- **Cue sheet assembly**: Full per-word token pipeline producing a "styled cue line" with anchor words uppercased and rising endings marked with ~
- **Drill recommendation**: Tag-based scoring matching drills against the student's recent struggles
- **Practice line ranking**: Deterministic scoring by tag match, difficulty preference, and source priority
- **Voice analysis threshold logic**: 135 lines of threshold-based mimic directive computation (load/ready/mimic/repeat/hold workflow)
- **Safety gates**: Deterministic inspection of analyzer metrics (strain, breathiness risk) and self-reported fatigue/strain scoring
- **Reply sanitization**: Pitch-stable filtering (strips pitch mentions when scenario says pitch is acceptable), practice-mode sentence filtering (removes coaching terms from conversation mode)
- **Student model / concept mastery**: JSON-backed tracking of per-concept correct/total, review queue with urgency scores, mastery level inference
- **Phrase comparison**: DTW-based comparison of student attempt vs. reference forecast, producing path match %, lane match %, contour match %, tunnel hold %, target-zone score %

### Uses the LLM:

- **Realtime coaching responses**: The model receives a system prompt (voice coaching policy + style target + practice mode rules), recent conversation history (last 6 messages), the current practice line, and latest metrics summary. It produces a short conversational coaching reply (max 180 words). This is the ONLY runtime LLM use.
- **Lesson planning** (when DeepTutor is active): One LLM call at session start to produce 3-5 structured knowledge points from voice analysis records. Currently runs through a separate Python DeepTutor server.

### Prompt Structure for Realtime Coaching

The current standalone prompt:
```
System: You are the standalone realtime Voice Tutor layer.
Coach transfeminine voice practice for normal conversation. Keep replies short enough to speak aloud.
Use one practical cue at a time. Prefer bright/forward/smaller vowels, light voice weight, easy onset, and natural intonation.
Do not over-correct when the user is simply holding a normal conversation for practice.
Never encourage pain, throat squeezing, forcing larynx height, chronic whispering, or pushing through fatigue.

Style target: australian-bright-feminine — bright, forward, light, natural Australian conversation.
Practice mode: conversation_practice — sustain conversation first, voice coaching secondary.
[... additional policy lines ...]

Current practice line: "I went to the shops yesterday and grabbed some groceries for dinner"
Latest metrics: {"meanPitchHz":215,"resonancePct":68,"weightPct":42,...}

[Last 6 conversation messages]

User: <spoken question>
```

The DeepTutor-enhanced prompt adds:
- Current lesson board (title, prompt, performance text, focus, instruction, progress)
- Coach brief (display text, cue text, correction focus, listen-for, next step, immediate action)
- Full analyzer context (not just summary — includes pitch trajectory, resonance lane, weight lane, formant analysis, advanced bands)
- Student progression (mastery level, review queue, struggles)
- Runtime directives (mimic/hold/repeat actions)
- Capture reliability assessment

## Current State of Extraction

TransVoice was originally embedded in a larger monolith (SLOANE OS). We've been extracting it as a standalone application:

- **Phase 1 (Freeze Contracts)**: ✅ Complete — API boundary frozen, route contract tests passing
- **Phase 2 (Learner Context)**: ✅ Complete — standalone learner-context service with persistent profiles, attempt history, concept mastery, dataset export
- **Phase 3 (Route Voice State)**: ✅ Complete — voice state routed through learner context
- **Phase 4 (Standalone UI)**: ✅ Complete — launcher, direct app, PWA, deploy bundle, all tests passing
- **Phase 5 (DeepTutor Split)**: ⏳ Not started — DeepTutor is currently a separate Python server that's optional in standalone mode

The standalone application lives at `/home/USER with:
- `server.js` — unified entry point (API + static frontend)
- `backend/` — 23 runtime JS files
- `dist/` — built frontend
- `scripts/` — deploy checker, sync tool, doctor
- `deployment/` — systemd, caddy, nginx configs

## The Core Design Question

Currently the system uses TWO LLM paths:
1. The GGUF model for realtime coaching (fast, local, good)
2. DeepTutor (a separate Python FastAPI server) for lesson planning and structured progression

We want to consolidate to ONE LLM (the existing GGUF model) and ONE server. DeepTutor's value is NOT its LLM — it's the deterministic lesson management code (mimic directives, safety gates, coach briefs, lesson board construction, student model). The LLM part is just one call to produce knowledge points.

The proposed architecture:
- **Deterministic code** handles ALL analysis: metric thresholds, issue detection, safety gates, coaching strategy selection, lesson progression, drill recommendation
- **The LLM** receives a distilled coaching signal (not raw metrics) and conversation history, and phrases the coaching naturally
- **One call at session start** for lesson planning (same GGUF model, different prompt)
- **One call per voice turn** for coaching response (streaming SSE)

## Specific Questions We'd Like Your Input On

### 1. Drill Pack Expansion
Currently 16 hardcoded practice sentences across 4 presets. Options:
- **Curated expansion**: Manually add more drills, more words to CUE_OVERRIDES. Reliable but doesn't scale.
- **LLM-assisted generation**: Use the model to generate practice sentences offline, validate them, cache them. The model generates content once, the deterministic system serves it forever.
- **Hybrid**: Curated core + LLM-generated per-student personalized drills based on their struggle patterns.

What's the best approach? How would you structure LLM-generated drill validation?

### 2. Pronunciation Cue System
Currently ~40 hand-curated word-to-phonetic mappings + simple regex fallbacks. The regex fallbacks are weak (just a few vowel substitutions). Options:
- Expand CUE_OVERRIDES to hundreds of words
- Use a proper phonetic dictionary (CMU Pronouncing Dict, etc.)
- Use the LLM to generate pronunciation cues on-the-fly (but this adds latency per word)
- Use a lightweight phonetic model (g2p)

What's the right balance of quality vs. simplicity?

### 3. Coaching Signal Distillation
The proposed "distill then speak" architecture — the deterministic code computes the coaching signal, the model just phrases it. The current DeepTutor prompt sends ~667 tokens of raw context. The distilled version would send ~100-200 tokens of structured coaching signal.

What should the distilled coaching signal format look like? How do we ensure the model has enough context to sound natural and personalized without dumping raw metrics?

### 4. Lesson Progression Without DeepTutor
DeepTutor's LocateAgent produces knowledge points by analyzing voice records with an LLM. To replace this:
- Call the GGUF model once at session start with the same 11 structured voice records
- Parse the JSON knowledge points from the response
- Store them in the session and progress through them deterministically

Is this reliable enough? How do we handle malformed JSON responses? Should we use structured output / function calling?

### 5. Single-Server Consolidation
Moving from two servers (Node gateway + Python DeepTutor) to one (Node only). The DeepTutor Python code that needs to be ported:
- GuideManager (session state machine: create/start/chat/next)
- LocateAgent (knowledge point extraction from records)
- ChatAgent (knowledge-point-scoped Q&A)

What's the minimum viable extraction? Can we skip porting DeepTutor entirely and just build a lightweight lesson planner in JS?

### 6. Streaming Architecture
We've added SSE streaming for coaching responses (349ms to first chunk). Should we also:
- Stream the lesson planning response (so the user sees knowledge points appearing one by one)?
- Use WebSocket instead of SSE for bidirectional communication?
- Stream directly from the model to TTS (text-to-speech) for spoken coaching?

### 7. Voice Quality and Naturalness
The goal is that coaching feels like talking to a knowledgeable friend, not reading a technical manual. The current model is fine-tuned for this. How do we:
- Ensure the distilled coaching signal doesn't make responses feel robotic?
- Maintain personality and warmth across different coaching scenarios?
- Handle edge cases (noisy audio, unclear transcripts, safety situations)?

### 8. What Would You Prioritize?
Given the current state (working standalone app, fast model, streaming support, deterministic analysis pipeline), what would you focus on next to make this a genuinely useful voice coaching product?

## Technical Details for Reference

### Model Parameters (current)
- Endpoint: llama.cpp OpenAI-compatible at 127.0.0.1:8019/v1
- Model: voice-tutor-gemma4-r128-clean-s070-iq4nl-attnq8-last10-gguf
- Context: 120K tokens
- Coaching: temperature 0.35, max_tokens 180, stream true
- Lesson planning: temperature 0.5, max_tokens 400, stream false
- No stop sequences specified

### Runtime Policies
- 4 style targets: cute-feminine, everyday-feminine, bright-playful, australian-bright-feminine
- 5 practice modes: active_drill, conversation_practice, safety_reset, reflection, lesson_plan
- Safety rules: never encourage pain/squeezing/forcing/whispering/strain
- Pitch-stable dark/large rule: do not mention pitch; use resonance + lighter voice weight
- Conversation practice: default to zero correction unless requested
- Reply sanitization: automatic filtering of inappropriate coaching based on mode and scenario

### Frontend Stack
- Vite + TypeScript, vanilla (no React for voice components)
- PWA with service worker
- Browser SpeechRecognition API for ASR
- Multi-page build: index.html (full SLOANE), voice-tutor.html (launcher), voice-tutor-app.html (direct app)
- Connection profiles in browser localStorage
- Session recovery across page reloads

### Deployment
- Local: node server.js on port 3021
- LAN/remote: HTTPS reverse proxy (Caddy or Nginx examples provided)
- PWA installable on desktop and mobile
- Tauri desktop wrapper planned (Phase 2 of packaging roadmap)
- Capacitor Android planned (Phase 3)
