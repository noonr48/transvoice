# Voice-only Coach transition edges

| Edge | Trigger | Visible result | Truth gate |
|---|---|---|---|
| Stopped → preparing | Learner presses `Start` with a selected voice preset. | The same control becomes `End`; the readout says `Getting ready…`. | Start has been requested, but capture readiness is not claimed. |
| Preparing → ready | The live input startup resolves after microphone capture starts and the backend socket accepts the session. | The readout becomes `Ready — speak now` with one static green dot. | Only the armed `waiting` input state may render ready. |
| Ready → hearing | Positive speech evidence is received for the current turn. | `Hearing you`. | Input status is `listening`; silence alone cannot trigger it. |
| Hearing → thinking | Endpointing closes the turn and recognition/model work begins. | `Thinking…`. | Input or interaction owner reports processing. |
| Thinking → speaking | Tutor audio actually begins playback. | `Speaking`. | The audible playback witness is true; generation alone is insufficient. |
| Speaking/thinking → ready | Continuous capture re-arms for the next learner turn. | `Ready — speak now`. | The input state has returned to armed `waiting`. |
| Any active → re-arming | The session remains active but the input state is briefly idle/unknown. | `Getting ready…`. | The UI must never infer readiness from activity alone. |
| Any active → unavailable | Input state becomes error or unsupported. | `Microphone unavailable.` as a polite status. | A failed input cannot render ready; recovery replaces it only after a real state change. |
| Any active → stopped | Learner presses `End` and shutdown completes. | Readout hides; the same control becomes `Start`. | Only the learner owns this transition. |
