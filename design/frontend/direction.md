# Direction lock — voice lesson, reduced to an instrument

One fixed portrait viewport, one quiet graphite ground, one warm amber action, and one instructional canvas. The screen behaves like a vocal-practice instrument: the learner hears the coach, sees only the current phrase or pronunciation spelling, and starts or ends the spoken lesson from the same large control.

Amber means the available primary action and focus. The selected target voice is the small top-right preset control. The session control is the sole focal element: horizontally centred with its centre at `66.667dvh`, approximately one-third of the phone height above the bottom edge. Its visible vocabulary is exactly `Start` and `End`.

One quiet activity micro-label may appear below the session control while the lesson is running: `Getting ready…`, `Ready — speak now`, `Hearing you`, `Thinking…`, or `Speaking`. `Ready — speak now` appears only after capture is genuinely armed and receives one static green status dot; it is a glanceable instrument reading, never a transcript, helper caption, progress bar, animation, or third control. Recognition and coach-generation waits collapse into `Thinking…`; the UI does not narrate internal pipeline anatomy. Routine activity is visual only so it cannot queue screen-reader speech over the audible tutor. A concise polite recovery message replaces it only when action is required. The single text canvas shows the current phrase or its pronunciation spelling, never both as a stacked pair.

Keep: graphite/amber TransVoice palette, Manrope, large touch geometry, preset popover, and no-scroll state replacement.

Forbidden: chat or message history, composer/send affordances, playback buttons, a separate record button, routine Start/End helper instructions, visible `Stopped`, a false ready state before microphone/socket acceptance, recognition-vs-model plumbing labels such as `Transcribing`/`Understanding`, animated dots/pulses, bottom-edge action placement, gradients added for decoration, or any third persistent control.
