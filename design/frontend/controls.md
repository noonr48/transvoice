# Voice-only Coach control wiring

| Control | Visibility | Intent | Handler / backend crossing | Verified by |
|---|---|---|---|---|
| Selected voice preset | persistent, compact top-right | use a named uploaded voice sample as the tutor's exact voice | `openMenu` / `choosePreset` in `coach-surface.ts` → preset list/select endpoints; upload path analyzes, saves, then selects the returned reference preset | surface tests; deployed preset selection; selected-reference TTS fail-closed tests |
| Start / End | persistent, primary, thumb-zone | learner alone starts or ends the continuous spoken lesson | `toggleSession` → reconciled `startSession` / `stopSession`; startup commits only after recorder-open acknowledgement, End cancels unresolved startup immediately, and shutdown stops local audio and writes the resumable checkpoint | surface/lifecycle race tests; recorder-open tests; privacy-safe control effects; deployed phone interaction |
| Saved voice option | transient inside preset popover | select that exact tutor voice | `choosePreset` → `selectPreset` | surface tests + deployed selection |
| Upload new voice sample | transient inside preset popover | name and create a reusable voice preset | upload form → `uploadPreset` → `selectPreset` | surface tests + backend preset contract |

There are exactly two persistent Coach controls. The activity readout is static output, has no handler, and cannot become a third control. The visible button vocabulary is exactly `Start` / `End`; internal telemetry continues to record categorical `listening-started` and `session-stopped` effects without transcript, audio, labels, or learner identity.
