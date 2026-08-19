# Render critique — deployed voice-only Coach — 2026-07-22

> **Historical receipt.** The measurements below describe the 2026-07-22
> build and must not be used as evidence for the current bundle. In particular,
> the former stacked 120/240 representation and inverse fit scaling were
> replaced on 2026-07-25. The current addendum at the end of this file is the
> authoritative desktop/headless receipt; physical Android acceptance remains
> separate.

Direction: voice lesson reduced to an instrument · Screens: w360, w768,
w1280, w1280-reduced, and max-content-w360-h620.

## Mechanical

- Deployed target: `http://127.0.0.1:3021/app`.
- Current bundle: `voice-runtime-bpU3v_2R.js`.
- Console errors: 0; page errors: 0; failed requests: 0.
- Horizontal overflow: 0 at 360, 768, and 1280 CSS px.
- Focus issues: 0; keyboard traversal exposes the preset and Start control.
- Reduced-motion animations: 0.
- Design lint: 0 error-severity findings; 22 inherited warnings are dispositioned
  in `waivers.md`.

## Vision pass

| artifact | observable result | defects |
|---|---|---:|
| `screenshots/w360.png` | One dominant amber Start target, one current phrase/pronunciation pair, and compact Aster preset. No thread, helper copy, clipping, decorative gradient, or extra control. | 0 |
| `screenshots/w768.png` | Same single hierarchy and fixed action geometry; the wider viewport does not introduce desktop cockpit chrome. | 0 |
| `screenshots/w1280.png` | The intentionally sparse lesson instrument remains centred and coherent; no overflow or competing action appears. | 0 |
| `screenshots/w1280-reduced.png` | Layout is unchanged and no motion remains active. | 0 |
| `screenshots/max-content-w360-h620.png` | Worst-width 120-character line and 240-character pronunciation are both visible above the action at the shortest supported proof viewport. | 0 |

Native GPT-5 vision inspected the current screenshots. An independent design
reviewer then re-read the pixels, CSS, runtime metrics, and product contract and
returned `VERDICT: PASS` with no blockers.

## Geometry receipt

At 360×620, `max-content-w360-h620.json` records:

- document `scrollHeight === clientHeight === 620` and `scrollY === 0`;
- canvas `y=76..366.344`, with `scrollHeight === clientHeight === 290`;
- all 120 + 240 supported characters retained;
- action `y=387.328..439.328`, 320×52;
- action centre `413.328` versus two-thirds target `413.333` (−0.005px);
- visible persistent controls exactly `tv-coach-preset-button` and
  `tv-coach-session-toggle`.

## Rubric score

- Items 1–5 and 9–20: pass.
- Items 6–8: accepted inherited raw spacing/radius/type warnings; no new warning
  was introduced by this refinement. See `waivers.md`.
- Items 21–22: not applicable to this browser surface.
- Raw score: 17/20 applicable checks; gate result: PASS with the three recorded
  inherited-warning waivers.

## Brief fidelity

| source requirement | delivered? | receipt |
|---|---|---|
| `brief.md`: “one comfortable thumb press” | YES | 320×58 normal target; 320×52 at 360×620; centre fixed at `66.667dvh`. |
| Exactly two persistent controls | YES | Runtime/control count is 2: named preset and Start/End. |
| One instructional canvas | YES | `#tv-coach-canvas` alone holds the current line and pronunciation. |
| Exceptional recovery only | YES | Routine status is clipped; invalid instruction uses the same canvas; actionable lifecycle errors appear below the action. |
| Safe-area padding | YES | Top/right/bottom/left use `env(safe-area-inset-*)` floors. |
| Fixed no-scroll viewport | YES | 360×620 and 360/768/1280 runtime reports show document dimensions equal viewport dimensions. |
| Bottom-edge action placement | ABSENT | Action centre is one-third up from the bottom, not attached to the edge. |
| Lifecycle helper captions | ABSENT | Visible action vocabulary is exactly Start/End; routine state stays in the live region. |
| Warm-up/break/coach-stop prompts | ABSENT | Visible surface contains none; stale “Stop while it’s good” template copy was removed. |
| Coach transcript/messages/composer/send | ABSENT | None exists inside `#tv-coach-surface`; the legacy transport host is `aria-hidden`, clipped, non-pointer, and non-tabbable. |
| Hear/listen/replay/provider actions | ABSENT | No such control exists inside the Coach surface. |
| Competing Coach actions | ABSENT | Exactly one persistent primary action is visible. |

## Waivers

- Physical Android/WebView safe-area, large-font, microphone, and Start→End
  replay require an ADB-connected phone. This render gate does not substitute
  browser proof for that release gate.

## Verdict

PASS — observable defects: 0; the two-control, no-scroll, thumb-zone brief is
green in the deployed browser. Physical Android certification remains a
separate runtime residual.

## Capture-readiness refinement — 2026-07-24

The activity readout now distinguishes `Getting ready…` from the positively
armed `Ready — speak now`. Ready appears only for the input runtime's `waiting`
state, after the microphone capture and backend live session have both been
accepted. An active-but-idle transition remains `Getting ready…`; error and
unsupported input render `Microphone unavailable.` rather than a false ready
claim.

Deployed reduced-motion screenshots:

- `screenshots/capture-ready-w360.png` — 360×620;
- `screenshots/capture-ready-w768.png` — 768×1024;
- `screenshots/capture-ready-w1280.png` — 1280×900.

All three renders retain exactly two persistent controls, match document
dimensions to viewport dimensions, and produce zero console or page errors.
The ready state uses a static green dot and 14px semibold label; no animation,
progress decoration, helper paragraph, or extra control was introduced.

The focused Coach lint report has zero error-severity findings. Full frontend
tests pass 687/687 with 2 intentional skips across 95 files, TypeScript passes,
and the production build is served as `voice-runtime-BDDRTL1K.js`. The phone
was not ADB-connected for this refinement, so a physical microphone-cycle
replay remains the only residual.

## Accessibility and disclosure repair — 2026-07-25

The current Coach renders exactly one instruction representation. A supplied
pronunciation spelling replaces the practice phrase visually; otherwise the
phrase is shown. The accepted bounds are 120 characters for a phrase and 160
for pronunciation. No JavaScript writes an inline font scale and no
`ResizeObserver` counter-scales enlarged text.

Current automated receipts:

- `node studio/code/verify-coach-thumb-zone.mjs` passes at 360×620 with
  document and canvas scroll dimensions equal to their client dimensions,
  exactly two visible controls, and the action centre at `413.328` versus the
  `413.333` target.
- `node studio/code/verify-coach-instruction-fit.mjs` passes phrase and
  pronunciation at 320×568 and at synthetic 150% text enlargement on 360×620.
  Measured enlarged font sizes are exactly 1.5 times their base values; there
  is no inverse inline scaling.
- `node studio/code/verify-coach-preset-disclosure.mjs` proves the preset
  disclosure is a truthful non-modal region, moves focus inside after content
  arrives, closes and restores focus on Escape, and keeps the region open with
  focus on Upload after Cancel.
- `frontend/src/voice/coach-surface.test.ts` carries the same one-representation,
  no-inline-scale, focus, Escape, Cancel, and late-response regressions.

This repair supersedes the earlier “focus issues: 0,” stacked-pair, 240
character, and dynamic-fit claims above. It does not certify Android WebView
font scaling or audible behavior without a connected phone.
