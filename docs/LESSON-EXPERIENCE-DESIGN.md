# TransVoice Lesson Experience — Design (desktop-first)

> **Historical design note.** The canonical 2026-07-25 contract is
> [VOICE_COACH_MEMORY_CONTRACT.md](./VOICE_COACH_MEMORY_CONTRACT.md). Its
> voice-only, two-control, no-scroll Coach laws supersede this document's older
> desktop controls, replay affordances, optional chat, warm-up stages, and
> coach-led session structure.

*2026-06-11. The product spec for the coach-presence lesson layer. Phone comes later;
this irons out the laptop interface.*

> **Values law:** PRACTICE-PHILOSOPHY.md governs. Where this document's earlier
> language reads game-like ("karaoke", green/red marks), the philosophy doc's
> rulings override: word marks are the **teacher's pencil** (ink palette,
> applied after the take, reviewed together), never a game. The v3 dataset
> (V3-DATASET-SPEC.md) teaches the coach this register natively.

## The scene we are building

A person sits down at their laptop to practice a voice that doesn't fully feel like
theirs yet. This is hard, vulnerable work. A good human tutor makes it survivable:
they greet you by name, remember last week, set **one** focus for today, hand you a
phrase to read, *listen*, and react — not with dashboards but with warmth and
specifics ("hear how the end dropped? let's listen back — right there"). The student
never opens a menu. The tutor's attention does the work.

Every design decision below serves that scene. The user's own words, which are the
requirements: *"maximize and engage user interaction, but without their effort"*,
*"our tutor has to be able to show up their main focus"*, *"you have to listen to
your own voice when practicing but that's hard"*, the tutor *"can naturally make
these cards… modify and emphasize them properly"*, and after setting a task can
*"still be present to catch with the user… talk about the current task"*, while
memory recalls *"what worked, what the person did before, who the person is, their
hobbies, the learning stage they are at."*

## Principles

1. **One focus on stage.** The tutor sets a single named focus ("Today: keep the
   brightness through sentence ENDS"). It is always visible; everything else recedes.
2. **The card is the lesson.** A paper-strip phrase card whose *typography* carries
   the focus. When the focus changes, the same words re-emphasize. When the tutor
   adapts, the card visibly changes.
3. **Feedback lands on the card.** Karaoke marks happen on the words themselves.
   Charts are the *coach's notebook* — summoned when the coach wants to show you
   something, not ambient dashboards.
4. **Replay is a coach move, not a feature.** "Let's listen to that one together" —
   the replay overlay opens, your recorded attempt plays, the dot re-travels the
   compass, the moment the coach cares about is marked. Listening to yourself alone
   is hard; listening *with someone pointing at the exact moment* is how humans
   get through it.
5. **Interaction without effort.** The user's inputs are: their voice, three keys,
   and an optional chat line. Everything else — cards, focus changes, replays,
   emphasis escalation, difficulty — is tutor-initiated.
6. **Memory makes it personal.** Greeting + continuity from the learner memo; phrase
   content drawn from the learner's topics/hobbies; cue style informed by what
   worked before; stage-appropriate difficulty.
7. **Desktop-first.** `Space` = try again · `Enter` = next · `R` = listen back ·
   typing = talk to the coach. Mouse optional.

## The lesson screen (one screen, four zones)

```
┌────────────────────────────────────────────────────────────────┐
│ FOCUS BANNER   "Today: brightness through sentence ENDS"   ●StageN│
├───────────────────────────────┬────────────────────────────────┤
│                               │                                │
│   PRACTICE CARD (paper strip) │   VOICE COMPASS (XY map,       │
│   large type, word emphasis,  │   pitch × resonance, live dot, │
│   karaoke marks               │   soft target region, trail)   │
│                               │                                │
├───────────────────────────────┴────────────────────────────────┤
│ COACH DOCK  [bubble: cue/say, spoken in target voice]           │
│             [chat input] [Help] [Break it down] [Listen back]   │
└────────────────────────────────────────────────────────────────┘
REPLAY OVERLAY (coach-invoked or R): attempt audio plays; compass
animates the recorded trail with a moving dot; card re-marks in sync;
"the moment" the coach referenced is flagged on both.
```

### Practice card ("strips of words on paper")
- Token-rendered (the cue-sheet already tokenizes phrases with per-word emphasis +
  progress windows — reuse it).
- **Emphasis levels 0–3** per token, mapped to the *current focus axis*: size +
  weight + a focus-colored underline. Changing focus re-renders the same phrase
  with different emphasis — the "strip changes as the lesson focus changes."
- **Karaoke states** per token: `pending` (hollow), `hit` (fills green), `missed`
  (soft red, never harsh). v1 marks per-word *voice quality* against the per-token
  checkpoint scores (progress-window mapping — no ASR needed). Phoneme-exact timing
  is phase 2 (SenseVoice ASR exists in config, disabled).
- **Tutor escalation:** when a word is repeatedly missed, the tutor *modifies the
  card* — bumps that word's emphasis, or swaps the phrase to isolate it. The card
  shows a quiet "coach adjusted this card" pulse so the change feels attended, not
  glitchy.

### Voice compass (the quadrant with the dot)
- The existing XY trainer map (pitch vertical × resonance horizontal) restyled as a
  calm "compass": live dot, short trail, **soft target region derived from the
  reference clip**, four quiet quadrant hints. Small by default; expands during
  replay. No numbers unless hovered.

### Coach dock (presence)
- The coach's line renders as a speech bubble and is **spoken in the learner's
  target voice** (cloned TTS — already wired).
- Chat input (exists) + quick intents: **Help · Break it down · Listen back**.
  These are canned messages into the same coach channel.
- The coach can: set/announce focus, hand out a card, react to an attempt (one
  cue), trigger a replay with a marked moment, modify the card, or just talk about
  the task.

### Replay ("listen together")
- Coach-invoked (or `R` / "Listen back"): plays the **recorded attempt audio**
  while the compass animates the recorded timeline (dot + growing trail) and the
  card re-marks token states in sync (progress→frame mapping).
- A **moment marker**: the coach's trigger can carry `momentProgress` (0–1); the
  overlay flags it on the card token and pulses the compass at that frame.
- Requires the attempt-audio retention change (below). Replay without audio
  (visual-only) is the graceful fallback for older attempts.

## Session arc (the feeling of a lesson)

1. **Arrive** → warm greeting with continuity, two lines max ("Welcome back, ⟨name⟩.
   Last time the resonance work clicked near the end — let's build on it.").
2. **Focus** → the tutor names today's focus; banner sets.
3. **Warm-up card** → easy phrase, no marking pressure.
4. **Practice loop** → card → speak (Space to retry) → karaoke marks land → coach
   reacts with exactly ONE of: short cue · replay-together · card modification ·
   encouragement. → Again / Next.
5. **Close** → "what stuck" summary (2 lines), written to memory (`whatWorked`),
   next-time pointer. The lesson ends *named*, like a real session.

## Contracts (what the agents build)

### PracticeCard
```jsonc
{
  "id": "card_...", "phrase": "string",
  "focus": { "axis": "pitch|resonance|weight|prosody", "direction": "...",
             "statement": "Today: ..." },
  "tokens": [ { "text": "word", "emphasis": 0-3, "focusHint": "optional cue" } ],
  "difficulty": "easy|medium|hard",
  "source": "tutor|fallback", "revision": 1, "parentCardId": null
}
```
Server-side: tutor (or fallback) provides `phrase` + emphasis intents; tokens are
built by the existing cue-sheet tokenizer. Cards attach to the lesson-planner.

### Tutor authoring channel (`card_ops`)
The coach reply contract gains an optional structured block (validated like the
existing signal-schema gates; malformed ops are dropped, never crash):
```jsonc
{ "say": "coach line", "focus_update": {...}?, "replay": {"attemptId": "...",
  "momentProgress": 0.62, "reason": "..."}?,
  "card_ops": [ {"op": "create", "card": {...}} | {"op": "emphasize",
  "token": "word", "level": 3} | {"op": "swap_phrase", "phrase": "..."} |
  {"op": "simplify"} ] }
```
**Deterministic fallback:** when the LLM is down or emits nothing usable, cards
come from the drill packs + learner topics; the lesson never stalls.

### Attempt retention (replay enabler)
- DSP: stop discarding take audio — copy the session PCM slice per finalized take
  to `attempts/raw/{attemptId}.wav`, set `includesRawAudio=true`, keep last N=20
  per session (ring cleanup).
- Route: `GET /voice/attempt/{attemptId}/audio` (mirror of reference-audio).
- Frontend already keeps the metric timeline per take (`lastTakeTimeline`).

### Learner memo (memory → personalization)
Extend learner-context profile (additive, normalized):
```jsonc
{ "profile": { "displayName": "", "topics": [], "hobbies": [] },
  "voice": { "whatWorked": [], "lastReference": {"clipId","name","summary"} } }
```
- `referenceClipId` persisted on every attempt record (the one-liner).
- A compact **learner memo block** (name, stage, topics, whatWorked top-3, focus
  history) is injected into the coach prompt by the signal-builder.
- Greeting: on session start the coach channel produces the two-line continuity
  greeting from the memo.

## Single-TUTOR-LLM operation (hard deployment constraint)

The app runs on **exactly one tutor LLM** — never a second full LLM (no separate
card-author model, no judge model, no teacher pool at serving time). Small
specialist models that are already part of the home stack (ASR, embeddings, TTS)
are allowed and encouraged where they directly serve the lesson:

- **Exactly one tutor-LLM call per coach turn.** The cue, `card_ops`, `replay`
  directive, and `focus_update` all ride the SAME reply (the fenced tail block) —
  never a second authoring/eval call. Verified: every `chat/completions` call site
  in the backend targets the one `voiceTutorGgufBaseUrl` endpoint.
- **Zero LLM calls outside coach turns.** Take-finalize, karaoke marking, card
  fallbacks, and the greeting are deterministic (DSP math + templates).
- **Allowed aux models (small, local, optional — app degrades without each):**
  VoxCPM TTS (:8020, spoken demos in the cloned target voice); SenseVoice-class
  ASR (the scaffolded `VOICE_ASR_URL`, for real word-timing karaoke + transcripts);
  the stack's embedding server (e.g. topic-matching phrases to learner interests).
- **Footprint:** tutor LLM (quantized GGUF, ~5–8 GB, llama-server :8019) + the aux
  models above. One consumer GPU runs it; every aux is feature-flagged and the
  lesson works with all of them off.
- The 10-GPU server is the **training rig only**; it is never part of deployment.

## Honest v1 boundaries
- Karaoke marks **voice quality per word**, not phoneme pronunciation accuracy
  (that's phase 2: enable SenseVoice ASR + word timestamps; the UI contract
  already supports it — only the mark source changes).
- Desktop only. No auth/multi-user. Replay audio only for attempts made after the
  retention change.

## Build map (file zones, to avoid collisions)
- **P1 (clip trust):** front-door.ts, workflow-controller.ts (analyzeReference
  area), template front-door section, runtime `ensureReferenceAudio` gate +
  quality passthrough. + mic-record reference.
- **P2 (memory/continuity):** learner-context-service.js + route-handlers,
  signal-builder memo block, session-reentry/front-door welcome-back, template
  welcome-back section.
- **P3 (lesson backend):** card store + authoring route + card_ops validation in
  coaching contract + fallback generator; DSP attempt-audio retention + GET route;
  runtime proxy.
- **Wave B (lesson surface):** template lesson zones, render/phrase + render/graph
  extensions (karaoke states, emphasis levels, compass restyle, replay overlay
  controller), coach dock polish, keyboard bindings.
