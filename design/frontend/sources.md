# Deployed frontend source map

| stage | where it landed | why off-shelf |
|---|---|---|
| direction | `design/frontend/direction.md` | Existing portrait instrument direction now permits one static active-state readout without adding controls or chat chrome. |
| structure | `design/frontend/structure.md` | Existing Practice state-replacement viewport remains the owning structure. |
| UX states | `design/ux/states.md` | The one-control lifecycle and four truthful active phases are behavior contracts rather than a new screen. |
| tokens | `design/frontend/tokens.css` and `frontend/voice-tutor-app.html` `:root` | The shelf records the system; the deployed standalone shell owns its live token block. |
| build | `frontend/voice-tutor-app.html` | Template/controller surgery survives the existing Vite production build and is what the Android WebView loads. |
| verification | `design/frontend/verify/` and `studio/code/verify-phone-contrast.mjs` | Deployed physical WebView geometry/state is the release truth. |
