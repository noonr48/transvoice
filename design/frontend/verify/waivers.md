# Deployed lint warning waivers

- LINT7: 13 inherited fixed spacing values belong to the compact preset popover and established touch geometry. The single new 8px margin separates the non-interactive ready dot from its label; it is fixed micro-icon geometry, not layout spacing.
- LINT8: the four inherited fixed radii are the established preset/action pill and popover geometry; the refinement introduced no additional radius.
- LINT9: the four inherited fixed type values are small preset/error/action roles. The activity line now has explicit 13px routine and 14px ready/error roles so readiness is legible without competing with the action. Instruction density uses bounded `clamp()` scales, and the live/shelf font family is Manrope.
- LINT18: `voice-tutor-template.html` is an intentionally embedded DOM fragment; the actual `voice-tutor-app.html` document owns `lang` and viewport metadata.
- LINT22: the one bare round glyph is an intentional, static status witness attached to the explicit words `Ready — speak now`. It does not indicate presence/network state, does not animate, and cannot carry meaning without its adjacent text.
