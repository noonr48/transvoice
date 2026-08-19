# TransVoice mobile UI/UX review — independent assessment

- **Reviewer:** Fable (claude-fable-5), acting as independent senior product/interaction/accessibility reviewer
- **Date:** 2026-07-22 · **Brief:** `design/ux/reviews/fable-ui-ux-review-prompt-2026-07-22.md`
- **Method:** read-only. Live Pixel 9 (`46271FDAQ000BC`) observed via `am start` + `screencap` only — **no taps were made on the device** (an active user session was present; interactive journeys are assessed from source, tests, telemetry, and the 2026-07-19/22 verification receipts). Sanctioned probes run: `verify-phone-contrast.mjs` (gate PASS), `verify-phone-telemetry.mjs --read-only` (gate PASS), `/voice/debug/health` (ok), `witness.jsonl` tail.
- **Evidence tags:** `[V]` directly verified (receipt cited) · `[I]` inference from verified evidence · `[Q]` open question. Timezone note: device local time = UTC+9:30 (screencap at 13:27 local ↔ health `newest` 03:57Z), used below to correlate screenshots with witness rows.

---

## 1. Executive verdict

The Coach surface is close to its promise — a calm, single-viewport, one-primary-action practice room with a genuinely honest measurement backbone — but it currently fails its core loop in a common state: when the coach has not authored a practice card, the current line is invisible on the phone, the phrase card claims "Your tutor is preparing a phrase…" indefinitely, and the user can record and be scored against a line they cannot see `[V]`. Second, the coach's own words are hard-clamped to four lines, so it asks questions the user cannot finish reading `[V]`. Third, when a take was rejected for being too quiet, the coach told the user it was "a struggle with the connection" — an honesty failure in the one place this product most needs honesty `[V]`. The no-scroll constraint itself is not the culprit in any of these and should be kept; every fix below fits inside it. Fix the invisible-line defect first; it blocks the practice loop for returning users.

## 2. What already works — protect these

| Keep | Evidence |
| --- | --- |
| **K1 — Single-orb capture lifecycle.** One control renders Ready → Recording → Finishing → Ready in place, with ARIA mirroring each state (`Ready — activate to record`) and a named recovery path when unavailable. | `[V]` live probe `coachOrb.ariaLabel`; `design/frontend/verify/critique.md` 2026-07-22 supplement; `design/ux/states.md` |
| **K2 — Front-door copy and flow.** Affirming, non-assumptive ("no gender rules, just the sound you choose"), preset path as a peer of upload/record ("Start now with a preset — add your voice later"), honest record meter with elapsed time, minimum-duration notice, and Cancel. | `[V]` `frontend/src/voice/standalone-template.ts:72–118` |
| **K3 — No false praise.** A silent/unusable take is measurement-rejected and excluded from achievements rather than praised. | `[V]` `witness.jsonl` 03:21:37Z `measurement_rejected`, `low_voiced_coverage`; `studio/code/phone-runtime-2026-07-22.md` |
| **K4 — Honesty surfaces exist.** "Coach is offline — basic guidance mode" and "Speaking in a stand-in voice — your target voice clip didn't load", both `role=status aria-live=polite`, positioned outside the clamped thread so phone CSS does not hide them. | `[V]` `standalone-template.ts:537–538`; `[I]` visibility-when-fired not physically replayed |
| **K5 — No-scroll integrity.** 411×809 document, zero overflow, no descendant scrollers, verified on the physical device; contrast on probed text 7.22–7.88:1; mode-pill buttons 44 px tall. | `[V]` contrast verifier output; `critique.md` |
| **K6 — Reduced motion honored.** Orb halo and speaking animations disabled under `prefers-reduced-motion`. | `[V]` `voice-tutor-app.html:184` |
| **K7 — Privacy-safe telemetry.** Closed vocabularies, no transcripts/audio/identity; every visible control emits activation/effect rows. | `[V]` `studio/code/instrumentation.md`; witness rows |
| **K8 — Port topology.** Same-origin `:3021` for the phone; `:8002` deliberately retained for desktop power users. Per brief: not a phone defect. | `[V]` `phone-runtime-2026-07-22.md` |

## 3. Journey walkthrough

**First run (Welcome → target choice → preset → practice).** Source and the 2026-07-19 device receipts show a clean one-choice-per-screen ladder with a single amber primary each step `[V critique.md vision pass]`. The welcome promise "not a scoreboard… No scores" is contradicted later by the orb's "Scoring your take…" (F4). Mic-permission expectation is set only after choosing Record ("Recording reads ~10–20 seconds…"); the OS permission dialog moment itself is not previewed — acceptable, since a denial lands in the `mic-denied` status line `[V template:103]`, `[Q]` exact denial copy not replayed. The front-door buttons were dead on 2026-07-21 (contract drift → 502 → boot-skip) and repaired the same day `[V memory/witness]`; the boot path is now gated and instrumented, but this history argues for keeping the first-run path under the existing kill-test battery (it is: S1/S12).

**Returning user.** This is the weakest journey. Live observed state after resume `[V screencaps 13:27/13:28]`: coach greets by name and references last session ("Last time, pitch center: landed cleanly — let's build on it") — warm, continuity-affirming — but (a) the greeting is truncated mid-question (F2), (b) the phrase card says "Your tutor is preparing a phrase…" and still said so 30+ minutes after the earlier session's screenshot showed the same text (F1), (c) nothing on the surface names the selected target voice (F5), and (d) "pitch center:" leaks a raw metric label with a stray colon into prose (F9). A returning user cannot "begin a useful practice take quickly" because the thing to practise is not shown.

**Coach loop (line → hear → record → score → coaching → listen back).** The orb lifecycle itself is verified and honest `[V critique supplement]`. The loop's entry is broken by F1 when no card exists: "Hear it in your target voice" was live-enabled (so a line exists in state) while the card showed the empty placeholder `[V contrast-verifier keyControls + screencap]` — the user can *hear* a line they cannot *read*, and the earlier screenshot shows RECORDING active above "preparing a phrase…" `[V transvoice-orb-recording.png]`. Scoring waits show "Finishing / Scoring your take…" with no progress or cancel; states.md defines no >10 s recovery `[V states.md]`, `[I]` long-wait risk under degraded services.

**Speaking/interrupt.** "Speaking / Tap to stop" on the orb is a single, learnable interrupt and was verified in the state supplement `[V critique.md]`. Distinguishing *coach speaking* from *app recording* rests on orb label + halo animation — under reduced motion, the halo is static, so the distinction is label-only `[I from :184]` (acceptable; labels differ clearly).

**Coach ↔ Explore.** The pill is fixed, 44 px, `aria-pressed`-managed `[V probe + html:628,970–977]`. Switching to Explore reverts hands-free (`voice-tutor-app.html:983`) `[V]`; whether the prior hands-free state is restored on return is not established `[Q]` — a continuity risk worth one test. What Explore actually renders at 411 px was not tapped; source says portrait collapses the cockpit to one column `[V structure.md + 2026-07-20 kill-test at 1080×1920]`, but a phone-width Explore has no device receipt `[Q]`.

**Recovery.** Infrastructure is excellent (K3/K4/K7; unavailable-orb state with named recovery `[V states.md]`; offline → "basic guidance mode" note). The gap is not detection but *narration*: the one live-observed recovery moment misattributed the cause (F3). Silent-take, offline, TTS-standin, and mic-denied all have witnesses and UI seams `[V]`; slow-scoring and replay-failure have UI text ("no audio kept…" `[V replay.ts:34]`) but no cancel affordance `[I]`.

## 4. Findings ledger

| ID | Cat | Sev | Conf | Freq | Evidence | Observed moment → impact → smallest improvement → verification |
| --- | --- | --- | --- | --- | --- | --- |
| **F1** | defect | **P0** | high | every session where the coach hasn't authored a card (incl. observed resume) | `[V]` screencaps 13:27+13:28 & checked-in 12:51 shot all show "preparing a phrase…"; probe shows `voice-hear-line` enabled (line exists); `card-strip.ts:96–101` renders the placeholder whenever no card tokens; `voice-tutor-app.html:332–335` hides `#voice-active-line-text`/meta on phone | The only phone rendering of the current line is the card strip, which fills only when the LLM emits `card_ops`; otherwise the user faces a permanent "preparing…" while Hear-it and Record operate on an invisible line. **Fix (S):** in coach mode, fall back the card strip to the active line text (`card-strip` already accepts `card?.phrase`; feed it the active-line string), or unhide the `h3` when the strip is empty. **Verify:** resume with no card → screenshot shows the line; hear-line-enabled ⇒ line visible invariant added to the phone verifier. |
| **F2** | defect | **P1** | high | any coach reply > 4 lines; observed on both live sessions | `[V]` "…or should we kee…" in 13:27 screencap; `voice-tutor-app.html:409–413` (`-webkit-line-clamp:4`, prior messages `display:none`); no length constraint on coach output found for phone mode (not exhaustively searched — `[I]`) | The coach asks a question the user cannot finish reading; deaf/HoH users and anyone with Speak: Off lose the content entirely (speech mitigates for hearing users only). **Fix (S/M):** give the coach a hard reply-length budget in coach mode (backend prompt/truncation at sentence boundary), plus a fade + "tap to hear again/expand" affordance on clamp. **Verify:** replay a long reply; no mid-word cut; clamp event counted in telemetry. |
| **F3** | defect | **P1** | high (correlation `[V]`, generality `[I]`) | every unusable-take turn | `[V]` witness 03:21:41Z `coach-metric-contract` guarded, failures `measurement_unusable_for_scoring, low_voiced_coverage`; 12:51-local screenshot (= 03:21Z) coach text "That last one was a bit of a struggle with the connection" | The take failed because too little voiced sound was captured; the coach blamed the connection. The user's corrective action (speak up / closer to mic) is hidden, and trust in all future coach statements erodes. **Fix (M):** pass the failure-reason class into the coaching signal and require cause-matched copy + one next action; forbid cause words ("connection") absent a matching failure class. **Verify:** eval fixture per failure class asserting cause-consistent reply. |
| **F4** | defect | P1 | high | every scored take vs. first-run promise | `[V]` welcome copy "No scores, no streaks…" `standalone-template.ts:76`; orb "Finishing / Scoring your take…" `states.md`, critique supplement | The first-screen trust promise is contradicted by the most-watched control. **Fix (S):** reword orb to "Checking your take…" / "Listening closely…". **Verify:** copy grep + screenshot. |
| **F5** | improvement | P2 | high | every session | `[V]` screencaps show no target identity anywhere on Coach; witness carries `target_source: custom-reference`, `target_direction: feminine` | "Hear it in your **target voice**" names a target the surface never identifies; returning users can't confirm what's selected (brief journey 3). **Fix (S):** one muted line naming the target (e.g. "Toward: Aster") near the hear-line control; consider privacy (see Q3). **Verify:** screenshot + returning-user question "which voice am I practising toward?". |
| **F6** | improvement | P2 | med | continuous | `[V]` screencap chips "Hands-Free: On", "Speak: On"; `session-scope.ts:26` cycle chip "Keeping it quiet" | Three label-as-state chips with no switch affordance: does tapping "Speak: On" turn it off? Does "Keeping it quiet" describe me or the app (is my audio muted?)? Cycle-to-change is undiscoverable. **Fix (S):** `role=switch`/`aria-checked` + a subtle pressed/knob treatment; scope chip gets a one-time "tap to change" hint or shows the next tier on press. **Verify:** mis-tap telemetry on the three chips before/after. |
| **F7** | improvement | P2 | high | post-take | `[V]` `standalone-template.ts:571–572`; `controller.ts:652` binds the offer to the same `openReplay`; `replay.ts:9–11` lists "Listen back" intent as another trigger of the same overlay | Two adjacent buttons one word apart ("Listen back" / "Listen back together ●") open the same overlay; the sage fill + unexplained ● competes with the amber primary (direction.md reserves sage for practice focus). **Fix (S):** one control — the "together" offer replaces the plain intent when active; drop the dot or give it a tooltip/ARIA meaning. **Verify:** screenshot; only one replay control visible per state. |
| **F8** | defect | P2 | high | whenever F1 state active | `[V]` `transvoice-orb-recording.png`: RECORDING active above "Your tutor is preparing a phrase…" | Recording proceeds with no visible line — the user performs "nothing" and is then scored (subsumed by F1; listed for the state matrix). **Fix:** F1; optionally gate record with a gentle "want a line first?" only if F1 fallback is impossible. **Verify:** F1's. |
| **F9** | improvement | P3 | high | intermittent | `[V]` screencap "Last time, pitch center: landed cleanly" | Raw metric label + stray colon leaks template internals into coach prose; reads machine-made, dents the "human coach" illusion. **Fix (S):** naturalize metric names in the coaching renderer ("your pitch landed cleanly"). **Verify:** eval fixture asserting no `metric:`-style tokens in replies. |
| **F10** | improvement | P3 | low | rare | `[V]` view-model.ts:1483 "Realtime Coach" vs live "Coach" header in the two screencaps | Header naming varies between states; mild identity wobble. **Fix (S):** one name. **Verify:** grep + screenshots. |
| **F11** | improvement | P2 | med | waits >10 s under degraded services | `[V]` `states.md` defines no cancel/progress for Finishing; `[I]` long-wait plausible when analyzer/LLM degrade | "Scoring your take…" can hold indefinitely with no reassurance or escape, the exact >10 s case the brief's latency lens names. **Fix (M):** after ~8 s, append honest copy ("still working — your take is safe") + a cancel-to-Ready that keeps the take; witness the slow path. **Verify:** kill-test with throttled analyzer. |
| **F12** | experiment | P2 | med | every coach question | `[V]` coach asked "Can you speak freely where you are, or should we kee[p it quiet]?"; scope chip exists as the answer surface | The coach asks questions but the answer channel (just speak; or tap the scope chip) is implicit. **Experiment:** one-time affordance linking coach questions to the chip (pulse the chip when the question maps to a tier intent — wiring exists in `coach-scope-intents`). **Kill-evidence:** users answer fine by voice; pulse adds noise. |
| **F13** | question | P2 | — | all users with large text | `[Q]` Android WebView `textZoom` follows system font scale by default, but the APK project is outside this repo; behavior at 130–200 % scale unverified; clamp (F2) and no-scroll geometry are the risk points | **Needed:** one physical pass at max Android font size; then either honor scale with reflow-safe budgets or pin `textZoom` deliberately (an accessibility decision, not a default). |

## 5. State-completeness audit

| Surface | Empty | Loading | Error | Partial | Success | Disabled |
| --- | --- | --- | --- | --- | --- | --- |
| Coach orb | ✅ full matrix defined + verified | ✅ | ✅ returns to Ready; cause in runtime notice | ✅ Tap-to-talk / Speaking | ✅ | ✅ named recovery `[V states.md, critique]` |
| Phrase card | ⚠️ **one placeholder doubles as empty, loading, and error** ("preparing…" forever — F1); no failure text | ⚠️ same | ❌ none | ✅ karaoke/emphasis when card present `[V card-strip.ts]` | ✅ | — |
| Coach thread | ⚠️ probe found no `.voice-coach-empty` node (selector missing) `[V verifier]`; greeting fills it in practice | ✅ (speech claim) | ✅ offline note K4 | ⚠️ only last message visible; >4 lines clipped (F2) | ✅ | — |
| Replay overlay | ✅ "no audio kept…" visual-only fallback `[V replay.ts:7,34]` | `[I]` | ✅ 404-safe | ✅ | ✅ | — |
| Front door | ✅ | ✅ | ✅ mic-denied + presets-error, aria-live `[V template:103,113]` | ✅ | ✅ | ✅ record-stop gated on min duration |
| Scope chip | ✅ hidden absent module `[V session-scope.ts]` | — | ✅ failed POST is quiet no-op | — | ✅ | — |

## 6. Control and copy audit (visible phone controls, observed state)

| Control | Intent | Predicted from label | Actual | Confirmation | Ambiguity |
| --- | --- | --- | --- | --- | --- |
| Coach / Explore pill | switch mode | mode switch | ✅ `__tvMode.set`, persists on tap | active fill + `aria-pressed` `[V]` | none; Explore-at-411px unseen `[Q]` |
| Hear it in your target voice | play line in target voice | ✅ | ✅ TTS path, disabled w/o line `[V hear-line.ts:44]` | speech + `speech-started` row | **which** target (F5); enabled while line invisible (F1) |
| Phrase card | show the line | — (display) | only card_ops content (F1) | — | "preparing…" implies imminence it can't promise |
| Orb + caption | record / interrupt | ✅ | ✅ verified lifecycle | in-place label change | caption is 18 px text; tap target is the orb — fine `[V probe]` |
| Keeping it quiet | ? | reads as status | cycles 3 tiers, POSTs scope `[V session-scope.ts]` | label changes | F6 — affordance + subject ("me or the app?") |
| Hands-Free: On / Speak: On | toggle live input / coach speech | toggle, direction unclear | ✅ toggles `[V controls.md]` | label flips | F6 |
| Listen back | replay take | ✅ | opens replay overlay | overlay + `replay-opened` | F7 duplicate |
| Listen back together ● | ? | unclear ("together"? dot?) | same overlay, guided re-travel | overlay | F7 |

Hidden-by-design in coach mode (correct): Start take / Hold to Practice / Talk Once (superseded by orb), keymap hints, text input `[V verifier keyControls + html:414–421]`.

## 7. Accessibility and inclusive-trust audit

- **Contrast:** probed nodes 7.22–7.88:1, ≥AA `[V verifier]`; muted placeholder/card-empty ink not probed `[Q — add to verifier]`.
- **Touch targets:** pill 44 px, mic-check 300×46, cards ≥44 px `[V]`; scope/toggle chips look ≥44 px `[I from screencap proportions]` — add to verifier.
- **Semantics:** orb ARIA states verified; replay overlay `role=dialog aria-modal`; status lines `aria-live=polite`; card strip `aria-live=polite` `[V templates]`. Karaoke tokens carry per-word `aria-label` — chatty under a screen reader `[I]`, worth one TalkBack pass `[Q]`.
- **Screen reader / deaf-HoH asymmetry:** truncated coach text (F2) makes visual reading lossy while speech is complete — inverted for deaf/HoH users when text is the primary channel. F2 is an accessibility defect, not only cosmetic.
- **Text scaling:** unverified (F13) — the single biggest a11y unknown.
- **Reduced motion:** honored (K6); state distinction then rests on labels, which differ — acceptable.
- **Inclusive trust:** language is genuinely affirming and non-assumptive (K2); no gendered "correct voice" framing anywhere reviewed `[V]`; measurement honesty is structurally enforced (K3). The two violations are F3 (misattributed cause) and F4 (scores contradiction). "Robin" personalization and continuity references are warm without being saccharine `[V screencaps]`.
- **Privacy in public:** dark surface, no explicit trans-identifying copy on the Coach screen `[V screencaps]`; F5's target line should avoid direction words ("feminine") in favor of the user's own preset name.

## 8. Simplification pass

- **Merge** the two replay buttons (F7) — one fewer decision post-take.
- **Merge** the three status chips' visual language into one switch idiom (F6) — no new controls, one convention.
- **Remove** the stray template artifacts from coach prose (F9).
- **Defer** nothing else: the surface is already admirably sparse. The complexity problems here are *invisibility* (F1) and *unexplained states*, not clutter. Do **not** add: progress bars, streak/score widgets, more pills, or an expanded thread view by default.

## 9. Idea portfolio

**Quick wins (low risk):** ① F1 card-strip line fallback — belongs because it repairs the core loop with existing renderer capacity; killed if resumed sessions always author cards within 2 s (they demonstrably don't). ② F4 orb copy rename — belongs for promise-coherence; killed if user testing shows "scoring" reads as neutral. ③ F7 replay merge — killed if telemetry shows the two buttons serve distinct learned uses. ④ F5 target name line — killed if users in public find any target naming exposing (Q3). ⑤ F9 metric-name naturalizer — killed only if replies never carry raw labels (they do).

**Bounded experiments:** ① Coach reply budget vs tap-to-expand (F2): measure re-read/abandon after truncated questions; kill if budgeted replies rate as curt/less caring. ② Switch-affordance chips (F6): measure mis-taps and time-to-first-toggle; kill if unchanged. ③ Question→chip pulse (F12): kill if voice answering already succeeds ≥90 %.

**Longer-horizon:** ① Resume ribbon — one fading line on return ("Last time: pitch center held · Toward Aster") replacing the greeting's job if TTS is off; evidence to kill: returning users reach first take fast without it once F1 lands. ② Eyes-free/pocket practice (seed exists: `lesson/eyes-free.test.ts`) — full loop by audio + haptics for walking practice; kill if session telemetry shows near-zero locked-screen attempts. ③ Phone-reachable "hear yourself over time" side-by-side (the welcome promises it; Coach never delivers it) — kill if Explore usage on phone proves users happily switch modes for it.

## 10. Prioritized recommendation slate

1. **F1 — make the current line always visible on Coach** (S). Benefit: unblocks the core loop for returning users; risk: none identified — renderer fallback exists. Dependency: none.
2. **F3 — cause-honest take-failure coaching** (M). Benefit: restores trust exactly where measurement honesty already invests; risk: needs eval fixtures per failure class. Dependency: failure reasons already in the signal `[V witness]`.
3. **F2 — coach reply length budget + clamp affordance** (S/M). Benefit: coach questions become answerable; a11y parity. Risk: over-tight budget could flatten warmth — pair with eval.
4. **F4 — "Scoring" copy rename** (S). Benefit: first-run promise holds. Risk: none.
5. **F7 + F6 — replay merge and switch-affordance chips** (S). Benefit: fewer decisions, clearer toggles. Risk: minimal; keep the ambient-scope owner ruling intact (chip stays passive).

## 11. Product-owner questions

- **Q1 (F13):** What is the text-scaling policy for the WebView (honor Android font scale with reflow, or pin)? This decides real a11y posture and needs one physical pass.
- **Q2 (journey 6):** Is phone-width Explore intended to be the full cockpit, or should the pill on phones lead to a curated subset? No device receipt exists for Explore at 411 px.
- **Q3 (F5):** May the Coach surface name the selected target (preset name only), or is public-glance privacy the stronger value? User research call, not evidence-resolvable.
- **Q4 (F12):** Should coach questions remain voice-answerable only, with no visual answer affordance, as a deliberate "conversation not UI" stance?

## 12. Final rubric (1–5)

| Dimension | Score | Anchor |
| --- | --- | --- |
| Intuitive next action | 4 | One amber action per screen and a verified one-tap orb — held back only where the *object* of the action is missing (F1). |
| State clarity | 2 | The app knows listening/speaking/scoring, but the phrase card collapses empty/loading/error into one untrue sentence (F1/F8). |
| Error recovery | 3 | Detection and honest infrastructure are excellent (K3/K4); the narrated cause was wrong the one time it was observed live (F3). |
| First-run learning | 4 | Affirming one-choice ladder with honest recording guidance (K2); scores promise contradiction (F4) is the blemish. |
| Returning-user speed | 2 | Warm resume greeting, but no visible line, no visible target, truncated question — first useful take is blocked (F1/F2/F5). |
| One-handed use | 4 | Orb and primary actions sit mid/low; pill top-right is a stretch but occasional `[V screencap geometry]`. |
| Accessibility | 3 | Verified contrast/targets/ARIA/reduced-motion are strong; text-scaling unknown (F13) and clamp asymmetry (F2) cap it. |
| Inclusive trust | 3 | Best-in-class non-assumptive language and no-false-praise design, undermined by misattributed failure cause (F3) and the scores contradiction (F4). |
| No-scroll Coach integrity | 5 | Exactly 411×809, no overflow, no descendant scrollers, physically verified twice (K5). |
| Overall coherence | 3 | The calm graphite/amber system holds; sage misuse (F7), header wobble (F10), and template leaks (F9) fray the edges. |

*(P0 F1 and P1s F2–F4 are reflected in their dimensions, not averaged away.)*

## If we change only one thing

Make the current practice line always visible on the Coach screen (F1). Everything this product promises — a coach, a line, your voice moving toward a target — collapses when the one thing to practise is invisible while the app still records and scores. It is a small, renderer-local change (`card-strip` already accepts a phrase fallback), it removes the app's only standing lie ("Your tutor is preparing a phrase…"), and every other finding becomes easier to see clearly once the loop's anchor object is on screen.
