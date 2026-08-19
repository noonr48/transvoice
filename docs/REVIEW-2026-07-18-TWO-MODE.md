# TransVoice — Comprehensive Two-Mode Review

> **Historical review, not current product authority.** The Coach contract was
> clarified after this review. See
> [VOICE_COACH_MEMORY_CONTRACT.md](./VOICE_COACH_MEMORY_CONTRACT.md): Coach is
> spoken-only, has exactly preset + Start/End, uses no forced warm-up or
> coach-owned stopping, and never becomes a messaging interface.

*2026-07-18. Five-agent review (architecture · coach UX · solo UX · metrics/detection · pedagogy) of the working tree at commit a7a8c33 plus uncommitted changes. Read-only: services were offline, so everything here is source-verified with file:line receipts; nothing was run on a live session or a real phone. Reviewed against the owner's two-mode vision and the standing law in PRACTICE-PHILOSOPHY.md.*

---

## TL;DR — the five sentences that matter

1. **Both modes already exist in the code — but the coach redesign HID the solo half instead of toggling it, and it also hid the lesson card the coach writes on.** The single-toggle vision is mostly an *unhiding* job, not a build.
2. **One real bug poisons coaching in both modes:** a mis-ported threshold function makes the app treat healthy, clear voices as strained — new users get "stop" warnings almost immediately, and users with a target profile get no warning band at all. The correct implementation already exists in this repo; it is a one-function fix.
3. **The app quietly lies in small ways** — silent coach-voice swaps, unmarked canned replies when the AI is offline, made-up numbers when nothing was measured, praise with no data behind it. For a product whose written law is "the honest mirror," the trust layer is the first thing to repair.
4. **"Imagine your future voice" is one button away.** The voice engine can already speak any line in the user's target voice; no UI element asks it to.
5. **FTM and neutral users are currently second-class:** the analyzer knows 8 target presets and masculine/androgynous drills exist, but the UI offers only 4 feminine presets and the practice-card engine styles *every* card with feminine sound cues.

---

## 1. The target design (proposed, filling the gaps in the spec)

### Mode names and the toggle

- **Coach mode** — the lesson. Phone-first, voice-first, one button. The student follows, speaks, asks, practices; the coach decides everything else.
- **Explore mode** — the studio. Desktop-first, sit-down, alone. Instruments, comparisons, listening, imagination. No coach presence — but never unguarded (see below).

**The toggle (smallest change, verified feasible):** the coach redesign already wrote one half of it as an unconditional stylesheet (`frontend/voice-tutor-app.html:45-71` hides the entire cockpit with `display:none!important`; its own comment says "controllers keep running, just unseen"). Make that conditional:

1. Move the hide-list under `body.tv-coach-mode` selectors; add the mirror `body.tv-solo-mode` ruleset that hides/condenses the coach rail instead.
2. One pill control ("Coach | Explore") in the existing late-binding script block (voice-tutor-app.html:169-199), toggling the body class.
3. Persist in localStorage + a `?mode=` URL param; **default Coach on narrow screens, Explore on wide** (`matchMedia('(max-width:1024px)')` — the breakpoint already exists in voice-tutor-redesign.css:1656).
4. Make the hands-free auto-click conditional on Coach mode.
5. Zero backend change: the session is auto-created at bootstrap (standalone-app.ts:385) and the target voice (referenceClipId) lives in shared state both modes already read.

**Retire the legacy `/coach` page** (302 → `/app?mode=coach`). It is orphaned — zero inbound links anywhere — and dangerous to keep: it stores its own voice choice in localStorage, diverging from the main app, the coach never speaks first there, and replies self-erase after 8 seconds.

### What lives in which mode (the content split)

One shared signal pipeline, two surfaces — no backend fork needed:

| Coach mode (phone, lesson) | Explore mode (desktop, studio) |
|---|---|
| Practice card strip with per-word emphasis + sound-spelling | Voice compass (pitch × resonance XY map) with trails |
| Coach speaks first; call-and-response takes | Karaoke marks + per-take replay with moment markers |
| One-real-sentence pick + next-day debrief | Time-lapse mirror (then vs now) |
| Guardian ease/close lines | Baseline deltas, stat tiles, hover metrics |
| Breather / gentle / converse actions | Drill-pack browsing, custom target workspace |
| Ask-the-coach (typed or spoken), quick intents | Preset audition + "hear this line in your target voice" |
| No numbers, no charts (coach's notebook only when invoked) | Metric teaching layer (plain-word tooltips, "what am I seeing") |

### Reconciling Explore mode with the philosophy

PRACTICE-PHILOSOPHY.md's first principle is "never alone with the work" — unsupervised drilling is where strain and bad habits entrench. The solo mode does not contradict this if it is built as an **exploration and listening room, not an unsupervised drill hall**:

- The **strain guardian runs in both modes** — it is the system's presence even when the coach's isn't. Alone with the instruments, never alone with the risk.
- Explore mode's center of gravity is *perception*: listening back, comparing takes, auditioning targets, imagining the future voice, understanding the numbers — the philosophy's own "ear before mouth" and "quiet days" modalities live naturally here.
- The coach is one tap away (the toggle), and Explore hands moments to Coach mode ("ask the coach about this take").

### The one-button start (Coach mode)

- **First run (unavoidably ~3 taps, keep it):** mic permission → orientation beat (already built: commit 29cc0ef) → record/upload target voice → report card → **the coach greets first and speaks.** Today the thread says "the teacher will start talking after your first completed take" (template:466) — inverted; the greeting route exists (`/voice/coach/greeting`) and should fire here.
- **Every return:** open → auto-continue (already built: welcome-back auto-click + spoken continuity greeting) → coach speaks. Genuinely zero-button today on the cockpit — this part is done and good.
- **Demote the launcher:** `/` currently serves an engineer's connection-profile form (backend URL, WS URL, session IDs) as the consumer front door. Default to same-origin config and jump straight into the app (the Electron build already proves this works, electron/main.js:203); keep the launcher behind a "connection settings" link.

---

## 2. The surfacing dividend — finished features that are currently invisible

The most unusual property of this codebase: a large fraction of the vision is **built, wired, tested — and hidden**. Before building anything new, unhide these:

| Feature | State | Where it's stuck | Receipt |
|---|---|---|---|
| **Practice card the coach authors** (create/emphasize/swap/simplify, per-word emphasis 0–3, karaoke marks, "coach adjusted" pulse) | Complete end-to-end incl. LLM authoring channel | Renders inside `.voice-cockpit-main`, hidden by the coach overlay | card-ops.js:138-303 → runtime:1643 → card-strip.ts:96-118; hidden at voice-tutor-app.html:46-48 |
| **Sound-spelling per word** (styledCue under each token) | Data produced server-side, renderer exists | Same hidden container; no user-facing toggle | voice-cue-sheet.js:266-273; render/phrase.ts:243-255 |
| **Spaced-repetition due-queue** ("Due now: X") | Computed every session, SM-2 wired to real DSP evaluations | Rendered into a force-hidden sidebar | view-model.ts:2349-2355; spaced-rep.js:44-69; standalone-dom.ts:87-89 |
| **Focus-line emphasis renderer, compass, mirror link, guardian hint, Space/Enter/R keymap** | Built | All in hidden zones of the coach overlay | template:301-448; render/focus-line.ts |
| **Masculine / androgynous / neutral targets + drills** | DSP defines 8 presets with direction-aware bands; masc/andro drill packs exist | Preset selects list only 4 feminine (both selects); card cue layer hard-falls-back to feminine | audio_analysis.py:81-176; voice-drills.js:266-360; template:176-181, 679-684; voice-cue-sheet.js:113-115 |
| **Per-take replay** | Overlay accepts any attemptId + audio URL; attempt audio retained & served | Review rows are inert text; only last-attempt replay is reachable | lesson/replay.ts:250-262; render-dom.ts:25-56 |
| **"Hear it in your target voice"** | VoxCPM accepts arbitrary text ≤700 chars + the stored reference clip; clone gate + streaming TTS live | The only caller of speech is the coach's chat replies — no practice-line button | schemas.py:96-116; coach-transport-bootstrap.ts:72 (sole caller) |
| **Voice choice in-lesson** | Prominent on the orphaned legacy page | Hidden by the overlay in the cockpit | voice-tutor-app.html:62-64 |

---

## 3. Findings by area

### 3.1 Trust & honesty (systemic P0 cluster)

The product's law is the honest mirror. Today the app breaks it in five small, fixable ways:

1. **Fabricated metrics when nothing was measured.** Zero voiced frames → pitch defaults to mid-target-band, resonance to 0.92×target, weight to target+0.08 — an empty take "measures" near-target (audio_analysis.py:2062-2078). The UI dot null-coalesces to 190 Hz / 0.5 / 0.45 and renders mid-graph (graph.ts:45-48). Frame *confidence* is displayed as *target hit %* (graph.ts:39).
2. **Praise without data.** No detected issue + nothing to correct → "That was good — keep that same quality," which also fires when the DSP is down or no take happened (signal-builder.js:1093, 1194-1197). No staleness check anywhere — a minutes-old summary is coached as current.
3. **Silent coach-voice swap.** If reference resolution fails, TTS falls back to the default voice with only a response header (`X-Reference-Resolved: false`, server.js:146-149) — the coach can stop sounding like the user's target mid-session with no notice. For an identity product this is the worst silent failure in the app.
4. **Unmarked canned replies.** When the LLM is offline, deterministic fallback lines render as normal coach bubbles; the backend tags it (`telemetry.setFallback`, runtime:2076) but no frontend module surfaces it, and the overlay hides the health panel.
5. **Client-declared success.** Lesson-point completion is a boolean the client posts, not DSP-verified (runtime:3527-3540).

**Fixes are all small:** confidence-gate the display (grey/blank unmeasured values, never coalesce), require a usable take for `acknowledge_win`, add a `measuredAt` staleness check, a quiet "coach is offline — basics mode" chip, a one-line toast on voice fallback, and score lesson-points from the existing attempt evaluation.

### 3.2 The safety engine (P0, the one real bug)

- `safety-gates.js:23-26` `getThreshold(ceiling, softDefault, hardDefault)` returns `ceiling ?? softDefault`; `hardDefault` is dead code. Verified live in the current working tree.
- **Root cause found — a botched port.** The original, `deeptutor-voice-adapter.js:957-962`, is correct: `min(fallback, ceiling + offset)` → no-profile 0.52 fire / 0.70 stop / 0.68 breathy (exactly the documented contract) and, with a profile, ceiling+0.10 fire / ceiling+0.24 stop — a real warning band. The port misread `offset` as a default and dropped `fallback`. The frontend's copy (view-model.ts) is also correct — so the UI chip says "fine" while the coach is told to stop.
- Consequence: no-profile sessions fire strain at ≥0.10 and hard-stop at ≥0.24 — and the strainRisk formula *adds* 0.40 when HNR > 10 dB (audio_analysis.py:1335-1340), i.e. a clear, healthy voice reads as strained. Profile sessions get fire==stop (no warning band). This directly feeds the over-firing the owner has rejected repeatedly.
- **Five strain thresholds disagree across layers** (safety-gates 0.10, detectIssues 0.10, guardian 0.50, DSP's own triggers 0.52, docs 0.52/0.70). The guardian (guardian.js:47-67) is the only one with proper windowing (2-of-last-4 takes, session-length rule, says its piece once) — and it currently only tints tone lines.

**Fix:** swap in the adapter's semantics (one function), collapse the three implementations into one shared module, make the guardian the single strain authority feeding `safetyState`, and add two-strikes hysteresis so single-frame spikes never fire a breather.

### 3.3 Coach-mode lesson UX

**Strong today:** returning-user start is genuinely zero-button with a spoken continuity greeting; mid-lesson questions are excellent (typed/spoken, deterministic intent routing for repeat/slower/why/easier/harder, cached instant answers); TTS is true streaming PCM with first-audio telemetry; the R12 fix means only sanitized coach text is finalized.

**Gaps, ranked:**
- **P0 — the lesson card is invisible** (§2). The coach authors cards no one sees. Unhide/re-parent into the coach rail.
- **P1 — no wake lock anywhere** (repo-wide grep: zero). A phone lesson dies when the screen sleeps. ~15 lines.
- **P1 — no barge-in.** The frontend contract exists (coach-input.ts:721-723) but no server implements the live-input lane; there's no tap-to-interrupt affordance either, though `stopCoachSpeech`/`toggleCoachListening` are already exposed (coach-transport-bootstrap.ts:89-90). Bind an orb tap first; the live lane is a later project.
- **P1 — echo strategy.** Capture deliberately disables echoCancellation/noiseSuppression/AGC for measurement fidelity (coach-input.ts:137-145) — correct for the DSP, hazardous for a phone-speaker conversation loop. Today only half-duplex sequencing protects it. Split the streams: EC ON for the conversation lane, raw for measurement takes.
- **P2 — first-run coach doesn't speak first** (greeting route exists; call it).
- **P2 — no sound-spelling toggle.** The data (styledCue per token) is always produced server-side; a normal ⇄ sound-spelling flip on the card strip is presentation-only.
- **P2 — phone ergonomics:** overlay pills compute to ~34px (under the 44px touch floor); the overlay layer has no @media rules of its own; Google Fonts load from CDN (dead weight offline; both surfaces).
- **P3 — no reconnect logic** for a dropped network mid-lesson; lost turns aren't retried.

### 3.4 Explore-mode UX

**Strong today:** the front door is exactly right for normal people (plain welcome, mic-record or upload, a numberless 3-check report card with figures in tooltips); "fit, never passing" copy; baseline deltas; the mirror (then-vs-now) is built; progressive disclosure via the advanced drawer.

**Gaps, ranked:**
- **P0 — solo surface unreachable** (§1 toggle) and the due-queue invisible (§2).
- **P1 — no metric teaching layer.** Path Match, Zone Hold, hit/sim, weight, forward tone are bare jargon; no glossary, no "what does this mean," no resonance-vs-pitch teaching anywhere (broad greps empty). The front-door tooltip pattern is the reusable fix; a proper "what am I seeing" popover is the follow-up. The custom target workspace asks for Hz and 0-1 floats with no guidance.
- **P1 — preset parity** (§2, 8 lines) and **P2 — presets are silent**: nothing lets a user *hear* what "bright-playful" or a masculine target sounds like. One canned audition phrase per preset through the existing TTS solves it (needs a stored per-preset prompt clip — small backend addition).
- **P2 — no per-row Listen in Review** (§2).
- **P2 — solo copy is coach-saturated:** "Activate the coach loop…" (template:213), "type to talk to the coach" (317), "your tutor will set today's focus in a moment" (144) all read as broken promises in a coach-less mode; needs solo variants. Rename "Arm Practice" → "Start take."
- **P2 — the June declutter stalled:** self-report still sits pre-take in the script pad; 5 stat tiles visible (target was ~3); 7 line-buttons; 4 provider toggles.
- **The imagine-lab (the owner's wish):**
  - **v1 (one button):** "Hear this line in your target voice" on the active practice line — the highest vision-value-per-line change in the repo (§2).
  - **v2 (small feature):** clone from the user's *own* mic sample or retained attempt WAV with a style prompt ("your voice, moved brighter") — VoxCPM's bridge supports it; attempt audio is already served. Needs a consent-styled frame ("this is an AI sketch of a possible you, not a measurement").
  - No DSP morphing machinery exists anywhere (psola/world/rubberband greps empty) — true resynthesis would be new machinery; don't start there.

### 3.5 Metrics, detection, and normal-people hardware

**Strong today:** all DSP in one Python service; voiced-gated aggregation with per-frame VAD; honest jitter/shimmer (only ≥8 confident voiced frames); literature-grounded pitch bands; robust reference-upload gates (<1.5s reject, voiced <15% reject, clone gate ≥3s ≤5% clipping, 10-20s guidance).

**Gaps, ranked:**
- **P1 — the consumer-hardware management is dead plumbing.** `snrDb`, `captureReliability`, attempt-level `clippingPct` are checked in three places (safety-gates.js:86-101) but **produced nowhere** — the fields don't exist in the attempt contract (contracts.py:126-153) and the frontend never writes them. Python's `quiet_input` flag never reaches the coaching path. So today there is no real noise/SNR/clipping management despite code implying it.
- **P1 — no mic calibration flow exists** (broad greps empty). With AGC deliberately off, quiet laptop mics and hot mics are both unmanaged.
- **P2 — detection thresholds are magic numbers** (weight ±8, resonance ±5, tilt <−12…), the profile source itself admits non-feminine bands are "heuristic mirrors (no real-voice calibration corpus yet)", and the strainRisk composite punishes clear voices (the HNR term).
- **P2 — the `adapt` path is dead in live:** `consecutiveMisses` is never passed to `resolvePolicy` (signal-builder.js:1262-1269) — only lexical struggle or flat-trend can trigger adaptation.
- **P3 — 48k→16k linear resample without an anti-alias filter** (aliasing into HNR/tilt on noisy mics).

**The "way to manage that" plan (connect the plumbing, don't build new DSP):**
1. **First-run mic check (~10s):** 5s silence + 5s phrase → noise-floor dB, speech level, SNR, clipping — all trivially derivable from the existing worklet RMS/clipping frames. This *produces* the dead fields and makes the existing checks real. Persist per deviceId; re-run on device change.
2. **Confidence-gated everything:** unmeasured → grey/blank, never a fabricated number; low scoreConfidence → skip coaching on that axis and say so ("couldn't hear that one clearly").
3. Add clippingPct + snrDb to the attempt contract so the gates see real capture faults.
4. Then (data work): validate strainRisk against labeled strained/healthy consumer-mic recordings; until then ship the documented 0.52/0.70.
5. Later: multi-sample reference profiles (2-3 uploads merged into wider honest bands).

### 3.6 Pedagogy & curriculum

**Strong today:** feedback is genuinely specific (cues cite measured issues with numbers); the 5-action policy (coach/gentle/adapt/breather/converse) has careful precedence with `gentle` for ease-off requests; one-real-sentence-a-day is philosophy-perfect (no negative records, readiness advisory-only); the guardian advises and never locks; memory recall is now wired end-to-end (moments/preferences reach the prompt, hard moments are never recited, injection-neutralized) — the old "capture without recall" hole is closed.

**Gaps, ranked:**
- **P0 — no curriculum arc.** Sessions are issue-reactive; session #1 ≈ session #20 in shape. The philosophy mandates phases (Foundation → Stabilization → Integration → Living); zero code encodes them. The pieces exist: per-concept EWMA mastery + SM-2 are live — a deterministic phase model derived from conceptStats + session history, gating lesson shape and difficulty, is a moderate change, not a rebuild. (Phases are structure, not pressure — no completion theater.)
- **P1 — exercises are 100% "say a phrase."** Missing from the standard trans-voice repertoire: sirens/pitch glides, SOVT/straw/lip-trill as *scoreable* exercises (only a safety-line mention today), sustained vowels, resonance size-play, ear training (perception-before-production), warm-up/cool-down arcs, situation rooms, spontaneity ladder, phone band-pass, quiet-days mode. First step: a `vocalise` drill kind (siren/hum-glide/sustained vowel) scored on the pitch trace alone + a real warmup stage in LessonState. (Whether the DSP can score non-phrase takes is unverified — check services/voice-trainer first.)
- **P1 — FTM/neutral card pedagogy** (§2): the cue-sheet's four profiles are all feminine and the fallback is `cute-feminine`, so masculine/androgynous learners get bright-vowel/light-onset cards that contradict their own drill packs. Data-only fix.
- **P1 — commands without understanding.** The coach says *what* but never *why* (resonance ≠ pitch is taught nowhere; the planner even discards the model's own lessonTitle/sessionFocus, hard-coding 'Voice Practice'). Cheap fix: one plain "because" sentence on focus *change* only + stop discarding the model's titles.
- **P2 — preferences are prompt-only.** "No imagery" / "be brief" could be *code-enforced* (imagery terms → the existing doNotSay sanitizer list; brevity → token cap) instead of hoping the model complies (pref_obey ≈0.68 is a known model ceiling).
- **P3 — no live banned-vocab guard:** the philosophy's banned gamification vocabulary (score, streak, XP, badge…) is enforced in the training dataset gate but not in the live sanitizer — a one-list addition.

---

## 4. Roadmap (dependency-ordered; S/M/L = size)

**Phase 0 — Truth & safety (do first, all small, both modes benefit):**
1. Swap `getThreshold` to the adapter's semantics; dedupe the three implementations to one module (S).
2. Guardian becomes the single strain authority feeding safetyState; two-strikes hysteresis (S/M).
3. Kill fabricated values: confidence-gate DSP outputs + UI dot; no praise without a usable take; staleness check (S).
4. Honesty chips: "coach offline — basics mode" + voice-fallback toast (S).
5. Live banned-vocab list into the sanitizer (S).

**Phase 1 — The toggle + the surfacing dividend (the vision lands here):**
6. Body-class toggle + pill + `?mode=` + narrow-screen default (S/M).
7. Unhide the lesson card into the coach rail; sound-spelling ⇄ normal toggle on the strip (S/M).
8. Coach speaks first on first-run (S). 9. Wake lock (S). 10. Tap-to-interrupt (S).
11. Preset parity: 4 missing presets in both selects + masc/andro/neutral cue-sheet profiles (S, data).
12. "Hear this line in your target voice" button (S). 13. Review per-row Listen (S). 14. Due-now surfaced into the visible Review panel (S).
15. Solo copy variants + "Start take" rename (S). 16. Retire `/coach` via redirect (S).
17. Demote the launcher to settings; straight into the app (M).

**Phase 2 — Normal-people robustness:**
18. First-run mic check producing snrDb/noise-floor/clipping per device (M).
19. Attempt contract gains clippingPct + snrDb; gates read them (M).
20. Touch-target pass ≥44px + coach-overlay @media + self-hosted fonts (S/M).
21. Reconnect/retry for dropped turns; PWA test on a real phone over HTTPS (M).
22. Split conversation stream (EC on) from measurement stream (raw) (M).
23. Finish the June declutter (self-report → Review, ~3 stat tiles, thin the 7 buttons) (M).

**Phase 3 — Deeper practice:**
24. Deterministic phase model (Foundation→Stabilization→Integration→Living) gating lesson shape (M).
25. `vocalise` drill kind + warmup stage (M; verify DSP can score non-phrase takes first).
26. Teach-the-why line on focus change; keep model's lesson titles (S).
27. Preference code-enforcement (doNotSay + brevity cap) (S).
28. Preset audition clips (M). 29. Imagine-lab v2: clone the user's own attempt toward a target style, consent-framed (M).
30. Ear-before-mouth two-take quiz (M). 31. Then the philosophy's v2 modalities: situation rooms, real-moment debriefs, phone band-pass room, quiet days (L).

**Explicitly rejected/deferred:** DSP voice morphing (no machinery exists; VoxCPM cloning covers the need); a second LLM for card authoring (single-tutor-LLM is a standing deployment constraint); any gamification mechanics (banned by law).

---

## 5. Decisions for the owner

1. **Retire `/coach`?** Recommended: redirect to `/app?mode=coach` after the toggle ships. Its one-button start and prominent voice picker are the two things worth porting first.
2. **Imagine-lab v2 framing:** cloning the user's *own* voice toward a target is powerful and sensitive. Proposed frame: "an AI sketch of a possible you — not a promise, not a measurement." Ship v1 (target-voice line playback) without waiting on this.
3. **Curriculum phases:** adopt the deterministic phase model? It adds structure the philosophy demands, but it also gates content — say if you want it advisory-only at first.
4. **Preset audition voice:** each preset needs one stored prompt clip to be audible. Source: synthesize from existing test refs, or record once per preset — your call.

## 6. What this review could NOT certify

- Nothing was run live: services were down and the tree carries another session's uncommitted work. All findings are source-verified; runtime behavior (latency feel, echo in practice, iOS specifics) needs a live pass.
- No real-phone test exists anywhere in the tree; the PWA-on-phone path is plausible but unproven.
- Preset band values (`qualityBands` ceilings per preset) were not enumerated; the fire==stop finding is derived from the code path, not from each preset's data.
- Whether the DSP can score non-phrase takes (for vocalise drills) is unverified.

*Companion detail lives in the five agent reports (architecture, coach UX, solo UX, metrics, pedagogy) committed to project memory 2026-07-18.*

---

## Implementation status — updated 2026-07-19

The roadmap above was EXECUTED on 2026-07-19 (7 builder agents + independent code review + live runtime testing + design review, all repairs applied). Final state:

**Shipped & verified live:** Phase 0 complete (threshold contract 0.52/0.70 via new `coaching/safety-thresholds.js`, guardian two-strike authority, no-praise-without-fresh-data, live banned-vocab sanitizer, fallbackReply honesty flag end-to-end incl. the W4 tee repair); Phase 1 complete (Coach|Explore toggle live + interactively proven, lesson card visible in coach mode, wake lock, tap-to-interrupt via bundle bridge, 8-preset parity across selects/cue-sheet/policy/cockpit-lines, hear-this-line, per-row Listen, due-now surfaced, solo copy, /coach redirect, launcher auto-forward); Phase 2 complete (first-run mic check producing snrDb/noiseFloorDb/clippingPct/captureReliability through the attempt contract into the gates, EC-on conversation lane vs raw measurement lane, network-error-only coach-turn retry (backend lacks turn dedup — 5xx retry would double-apply), visibility health refresh, June declutter finished, direction-aware focus statements, regenerate wired to the line catalog); plus the preset-skip front-door fix and the phone coach-mode chip/banner clearances from the visual pass.

**Evidence:** backend 357/357 · frontend 513/513 (83 files) · tsc clean · build clean · live 8-flow runtime pass incl. degraded-honesty wire proof · code-reviewer PASS after 2 blocker repairs · design-reviewer defects fixed and re-verified live (screenshots + geometry probes in ~/.local/share/sloane/transvoice-run-20260719/).

**Not certified here:** real-phone device test (PWA over HTTPS on actual hardware); Phase 3 items 24-31 (curriculum phase model, vocalise drills, preset audition, imagine-lab v2, situation rooms — next session scope); two pre-existing Python test reds (includesRawAudio; websocket-contract needs fastapi env); no git commits made (shared dirty tree with a dormant concurrent lane — commit awaits tree reconciliation); the first-call lane must re-baseline its preflight hashes.


---

## Zero-friction practice design — decided 2026-07-19 (owner rulings + 4-agent exploration)

**Owner law (binding):** (1) Coach mode never requires a physical prop or setup — voice + phone only, anywhere, anytime. (2) The metric system must handle every adopted practice type; computational cost filters practice types. (3) The coach is TIME-BLIND — no durations, timers, or timed arcs; only last-session-gap continuity. No forced start or end structure: sessions flow; warmup and warm close are conversational offers, never stages. The strain guardian is exempt (safety, not structure).

**Straw verdict (exercise-science leg, confidence high):** straw phonation's benefit is the semi-occluded-tract mechanism — the narrowing, not the object. Prop-free members (lip trill, tongue trill, hums on m/n/ng, small-lipped "oo", softly held v/z/zh) deliver the same reset/ease effect. The only genuine loss (titrated resistance dosing) is clinical-rehab scope, which this product already refers out. Coach-mode curriculum is fully effective with zero props.

**The repertoire (3 loudness tiers, no props):** FULL VOICE (car alone / home): slides-sirens, sustained vowels, size-play (scored as between-take delta), trills, phrases, monologue. QUIET (waiting room / shared walls): soft hums, ng-glides, hum-to-word onsets, melody-hum-a-real-sentence (prosody without words), held "vvv" (near-invisible reset); soft voice never whisper (banned). SILENT (not-out / night / queue): ear-training pairs, target-voice listening, silent mouthing (safe — no fold airflow), breath settling, planning. Tier is context adaptation, not time structure.

**Sessions are flows:** every rep is complete in itself — the coach's per-take reaction both closes the rep and leaves the door open ("that one held — good place to stop, or take another"). Leaving IS the close; a cut-short session gets a kind continuity line next time ("last time ended mid-practice — no matter, it counts"). Internal plumbing may use time (plan-reuse freshness); the coach's language never does.

**Context capture is passive, never a gate:** remembered tier per daypart → mic-check noise floor shades the opening offer → the user's first utterance confirms the tier behaviorally → at most one ignorable coach line ("can you speak freely where you are, or should we keep it quiet?") answerable by voice or not at all; mid-session tier shifts by voice intent; an ambient tier indicator is a control, not a picker. The zero-button return is untouched.

**Car / eyes-free:** all 9 coach intents are already voice-reachable; deltas are spoken fallback-card announcements, spoken arm/finalize confirmations, an echo-first prompt rule (coach says the phrase, learner repeats; nothing new to read mid-exercise), one honest safety line. Voice barge-in over TTS does not exist (tap-interrupt only) — known limit.

**Metrics (cost-filtered; nothing dropped on cost):** new `takeKind` on the signal (phrase | siren | sustained | hum_sovt | resonance_play | trill | spontaneous | ear_training | silent) with a compact per-kind `kindMetrics` block — 3-5 numbers, all from already-computed values plus three ~free proxies (glide smoothness from pitch-slope std; F2 range from the existing per-window list; trill rate via one autocorrelation of the RMS envelope). Correctness gates: SKIP LPC formants on hums/trills (nasal antiformants corrupt them — and it is the heaviest live op, so this also saves CPU); suppress stability/jitter/shimmer/strain on trills (the ~28 Hz flutter false-flags all four); lenient strain band on sustained clean phonation (high HNR reads as "strain" in the current composite); note the 400 Hz pitch ceiling on wide sirens ("hit ceiling", never under-report). Rejected: neural pitch trackers (CREPE ~90× the cost for no benefit here — benchmarked). Optional cheap win if profiling ever demands: FFT autocorrelation (~10× fewer flops, identical output). PROBED LIVE: the real analyzer pitch-tracks synthetic hum (151 Hz vs 150 synthesized) and 28 Hz AM trill (133 vs 130) correctly — vocalise scoring on the pitch trace is confirmed feasible.

**Friction fixes adopted (adversarial leg, receipts in memory):** preset-first first-run (skip becomes a peer button; auto-offered on mic-deny; also on the reject card); voiced failure states (degraded-boot thread line + Retry; "say that again?" on a lost turn; spoken "mm — one sec" latency filler); noise-adaptive turn-taking (wire the measured noise floor into the VAD threshold; degenerate-take counter offers tap-to-talk); defer the mic permission until first user gesture; every drill kind ships a quiet-ok variant + a no-questions "can't do that here" swap; sentence-slot buttons join the 44px rule; mic check becomes cancellable with softer verdict copy; the listening lane (ear-quiz, preset audition) ships before sirens and situation rooms; phase model advisory-only.

**Phase 3 as amended:** 24 curriculum phases (advisory-only, no gates) · 25 vocalise drill kinds ZERO-PROP with takeKind scoring as above · 26 teach-why + DSP-verified lesson points · 27 code-enforced preferences · 28 preset audition (listening lane — early) · 29 imagine-lab v2 (reuses retained attempt audio, headphone-suggested, consent-framed) · 30 ear-quiz (listening lane — early) · 31 situation rooms framed "for when you're alone" + quiet-days first-class. Plus the friction-fix wave above, smallest-first.

**Zero-friction wave EXECUTED — 2026-07-19 (same day):** the design above is built, tested, and live-verified. 5 builders (sessions/signal/DSP/friction/flow) + independent review (2 blockers found: the main coach path was not receiving takeKind/sessionScope — repaired + unit-proven through the exact chain) + live runtime probes (6/7 flows proven with executed pre-change differentials incl. the trill contract on the real streaming attempt path, 27.83Hz on a 28Hz probe; the 7th was an owner-law copy hit — time language in the mic-check line — fixed). Peek-session greeting fix (zero-take cut-shorts no longer greeted as "cut short" and no longer shadow daypart tiers). Final: backend 421/421 · frontend 592/592 · build clean · gateway live. Still open: real-phone device test; Phase-3 items 24/26-31; git commit reconciliation.
