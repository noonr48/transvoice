# Voice-only Coach structure

## Coach lesson — one fixed phone viewport

Focal element: the single `Start` / `End` session control.

1. **Preset corner:** one compact top-right control names the selected tutor voice. Its popover owns selecting an existing named voice sample or uploading and naming a new sample.
2. **Instruction canvas:** one centred region shows exactly one current representation: the verbatim practice sentence (up to 120 normalized characters) — always, when one exists — or, only when no verbatim line exists yet, its pronunciation spelling (up to 160). Pronunciation never replaces the sentence; the two never stack. An empty canvas shows a neutral placeholder (`Press Start to begin.` when idle, `Getting your sentence ready…` while starting). It changes density without counter-scaling browser/Android text enlargement, ends above the thumb-zone action, and never becomes a transcript or message history. Invalid oversized content is replaced atomically by one short in-canvas recovery instead of clipping.
3. **Session action:** one wide touch target is centred horizontally and at `66.667dvh` vertically—one-third of the viewport up from the bottom. It remains pressable through startup and shutdown, and its only visible labels are `Start` and `End`.
4. **Activity readout:** one reserved, static text line below the action shows the current spoken-loop phase only while starting/running. The armed state says `Ready — speak now` with a static green dot; unarmed active transitions say `Getting ready…`. It is not interactive, does not retain history, and is not a live region.
5. **Recovery:** a concise actionable error replaces the activity readout and is announced politely. It persists until a real recovery transition; healthy routine updates cannot overwrite it.

## Removal contract

Keep: exactly two persistent controls (preset and session), one instructional canvas, one non-control activity readout, exceptional recovery, safe-area padding, and the fixed no-scroll viewport.

Remove: bottom-edge session placement; stopped/helper/pipeline-detail captions; start/stop instructions; warm-up and break prompts; coach-directed stopping; coach transcript, message history, composer, send, hear/listen/replay controls, and all competing Coach actions.
