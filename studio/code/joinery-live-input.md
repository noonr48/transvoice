# Joinery — TransVoice live spoken input

> **Historical live-input assembly receipt.** Its 120/240 stacked-content
> geometry reference is superseded by the current one-representation 120/160
> contract in `docs/VOICE_COACH_MEMORY_CONTRACT.md`; the transport and
> turn-detection seam evidence remains historical evidence for its dated build.

Mates: phone PCM client × standalone gateway @ `/voice/input/live`; gateway live turn × existing ASR/session owner @ internal Buffer handoff; runtime activity × Coach surface @ one status line · Mode: FORGE · Medium: tech

Reroute check passed: architecture has already selected the parts; instrumentation separately owns long-term death detection; final certification remains with deep-review. This sheet proves the three assembly crossings only.

## §1 Seam contracts

| seam | A-GIVES | B-NEEDS | connector | SHAPE | TIMING | LIFECYCLE/owner | on-failure |
|---|---|---|---|---|---|---|---|
| J1 phone→gateway | existing `coach-input.ts` sends one JSON open frame then 16 kHz mono PCM16 binary frames | authenticated active session plus ordered bounded PCM frames | WebSocket upgrade `/voice/input/live` | open v1 JSON; then even-length little-endian PCM16 frames | audio streams during speech; endpoint decision after candidate silence | browser owns capture/cancel; `voice-input-live.js` owns connection/turn after receipt | deny before upgrade; bounded error/close; recorded fallback remains |
| J2 gateway→ASR/session | one bounded mono WAV `Buffer`, capture timestamps, segment cancellation guard | current `submitVoiceInputTurn` needs audio plus session and owns one ASR/commit | internal-only `{audioBuffer, signal, shouldCommit}` options | Node Buffer with `audio/wav`; existing response payload unchanged | exactly once after endpoint acceptance; late work must fail before mutation | live service owns ephemeral audio; runtime remains sole session mutation owner | provider/abort/stale error emits no transcript or session mutation |
| J3 runtime→Coach status | current interaction owner plus normalized input `waiting/listening/processing/error/unsupported` based on real capture events | one current user-meaningful label, no history/control | `setupVoiceOnlyCoachSurface` read-only activity inputs | enum → `Getting ready…/Ready — speak now/Hearing you/Thinking…/Speaking/Microphone unavailable.` | same render, no artificial phase delay | runtime owns facts; surface owns derived label | only `waiting` → Ready; unknown active state → Getting ready; error/unsupported → unavailable |

Diff verdicts: J1 ADAPTER:`voice-input-live.js` (server side is currently absent); J2 ADAPTER:internal Buffer options + PCM16→WAV owner; J3 ADAPTER:pure activity derivation. The client frame format, runtime response payload, session owner, and status DOM node otherwise match.

INTEROP: Smart Turn v3.2 CPU ONNX at commit `f766f81d…` | adapter pins/bump is project-owned | checksum/import/worker protocol health is the drift signal.

## §2 Belonging

Law of the place: live spoken lesson, never messaging; exactly preset + Start/End controls; one fixed no-scroll instructional surface; selected preset is tutor voice.

| part | partner HERE? | obeys local law | REMOVE-IT |
|---|---|---|---|
| live WebSocket server adapter | existing phone PCM client | native: activates an already-authored capability seam | weaker: current client must fall back to slow whole-blob upload |
| optional semantic detector | candidate-silence endpoint state | native behind a removable adapter; adds no surface | weaker for deliberate/stuttered pauses; conservative fallback remains valid |
| internal Buffer handoff | existing ASR/session owner | native: keeps one mutation owner and removes phone base64 | weaker: recreates the measured blob/base64 critical path |
| four-state readout | existing status element/runtime states | native instrument reading, non-interactive | weaker: user cannot tell whether speech was heard or work is progressing |

## §3 Crossings

| seam | token driven | predicted observable at B | observed | verdict |
|---|---|---|---|---|
| J1 | authenticated open + voiced PCM + silence | server emits one `session-started`, one `speech-start`, then one `processing` for one segment | real HTTP-upgrade integration test passes; deployed fixture emits the exact envelope sequence; Pixel opens one live socket and closes it on End; earlier physical PCM witness measured 110 ms open→first frame | [V] joined |
| J2 | accepted segment WAV into internal handoff | ASR receives `audio/wav`; successful-turn count increments once; same segment emits one final transcript; abort increments zero | current-bundle production crossing: one Buffer handoff, 149 ms open→ASR, 326 ms provider ASR, 475 ms open→final; cancellation/stale-owner kill tests pass | [V] joined |
| J3 | unarmed → waiting → positive speech → processing → actual tutor audio | one fixed line reads Getting ready… → Ready — speak now → Hearing you → Thinking… → Speaking, with no third control or scroll | resolver/surface tests prove the complete state order, fail closed on idle/error, and require a first-audio witness before Speaking; deployed 360×620, 768×1024, and 1280×900 probes show exactly two controls and no scroll; physical replay remains | [V] joined with phone residual |

HANDSHAKES:

- J1: PCM frames → endpoint envelopes / `session-started` + `processing` acknowledgement / bounded `error` then close.
- J2: WAV Buffer → existing session payload + final transcript / abort or provider error returns no mutation.
- J3: runtime snapshot → visual label / DOM render on sync / persistent actionable error replaces routine label.

## §4 Commons at this moment

| bank | budget | part draws (measured) | Σ fits? |
|---|---|---|---|
| endpoint latency after final voiced frame | exact 1800 ms protected candidate + semantic inference <150 ms + scheduling margin; target processing <=2.1 s | isolated Smart Turn warm ~92 ms; faster-than-real-time current-bundle fixture entered ASR in 149 ms after sufficient silence frames were injected (server/model seam only) | yes, with real-time formula explicit |
| ephemeral audio memory | <=4 MiB PCM per connection plus <=256 KiB detector tail | max-buffer, detector-tail, cancellation, and cleanup tests pass; no disk audio witness exists | yes |
| Coach viewport | document scroll height equals viewport at 360x620 and 411x809 | both deployed probes equal their viewport; 360×620 also contains maximum 120/240-character supported content | yes |
| persistent controls | exactly 2 | Pixel and headless DOM each report only preset + Start/End; activity has no handler | yes |

Collision rule: `voice-input-live.js` alone writes endpoint/finalized state; standalone runtime alone writes session state; Coach surface alone writes status DOM. Any second writer is a blocking fault.

## §5 Exit

Tidy done: the gateway is the only live endpoint owner, the existing input-turn runtime remains the only ASR/session commit owner, stale semantic/ASR work cannot mutate, and the Coach surface derives one transient activity line without adding a control or transcript.

JOIN LEDGER:

| seam | status |
|---|---|
| J1 phone→gateway | [V] joined — integration + deployed fixture + physical Pixel socket/PCM receipts |
| J2 gateway→ASR/session | [V] joined — Buffer/ASR production timing + stale/cancel kill tests |
| J3 runtime→Coach status | [V] joined — physical lifecycle + deployed geometry + state derivation tests |

Escalations taken: the initial 900 ms semantic-candidate policy was rejected after a real human mid-thought prefix produced a false `complete`; the deployed policy is now 1800 ms candidate / 4500 ms conservative fallback.
Re-join debts: build→restart→production verifier→phone verifier must rerun after any transport, threshold, status, or Coach layout edit. Representative physical-phone careful/stuttered speech remains a quality corpus residual, not an unproven wiring seam.
Handoffs: J1/J2 seam timings and failure classes → `studio/code/instrumentation.md`; this ledger → final deep-review wiring gate.
