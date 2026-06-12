# Codex Prompt: Liquid Glass Hover-Zoom Preview Frame

You are working on my hover-zoom userscript.

## Goal

Update the hover preview/view window styling so its border looks like macOS 27 Golden Gate “Liquid Glass”: clear, glossy, dimensional, and lens-like. It should **not** look like a flat frosted-glass panel.

## Before editing

1. Inspect the userscript and find the code that creates/styles the hover preview container, image/video element, border, shadow, and any injected CSS.
2. Do not rewrite unrelated logic.
3. Preserve existing behavior: hover detection, zoom sizing, positioning, dismissal, keyboard/mouse behavior, and media handling must keep working.

## Design target

The preview window should look like a transparent polished glass object:

- Clear and glossy, not cloudy/frosted.
- Rounded corners with a thick optical-looking rim.
- A bright upper/left edge highlight.
- A subtle darker lower/right edge for depth.
- A faint inner rim/glow.
- A soft outer shadow so the window floats above the page.
- A diagonal or curved glossy sheen across the frame.
- The preview media itself should remain sharp and readable.
- Any blur should be very subtle and used only for the border/shell effect, not to make the whole preview look foggy.

## Visual language

This is not a “blurred pane of glass.” It should feel like a **clear acrylic lens with a polished liquid edge**.

The border should be thick, rounded, and optically dimensional, like the edge of a transparent pill-shaped object. The surface can have a faint tint, but the content behind it should stay mostly visible instead of becoming cloudy. The depth should come from layered highlights: a bright upper-left rim, a softer inner white line, a darker lower edge, and a subtle shadow outside the shape.

It should feel convex, like the border is bending light around the preview window. The glossy part should come from specular streaks and gradients, not heavy blur. Use a soft top sheen, a diagonal light sweep, and a very faint inner glow. The corners should look molded rather than flat.

## Implementation guidance

- Prefer CSS changes and small DOM additions if needed.
- If the preview container already has a wrapper, use pseudo-elements on that wrapper.
- If pseudo-elements are not practical because the style is injected directly, add one lightweight frame/shell element around the preview.
- Do not apply heavy `backdrop-filter: blur(...)` to the entire preview.
- Use layered gradients, inset shadows, border highlights, and pseudo-elements to create the Liquid Glass effect.
- Make the style work in both light and dark page backgrounds.

## Suggested CSS approach

The outer preview container should have:

- `border-radius` around `22px` to `28px`, depending on existing preview size.
- `overflow: hidden` or a clip-path-compatible rounded shape.
- A very subtle transparent background.
- A translucent light border.
- Outer shadow plus inset highlights.

Add a `::before` layer for the glass rim:

- `position: absolute`
- `inset: 0`
- `pointer-events: none`
- same `border-radius`
- multiple `linear-gradient` / `radial-gradient` backgrounds:
  - bright highlight from top-left
  - faint darker edge bottom-right
  - soft transparent center
- use a mask or padding-mask if needed so the effect concentrates near the border instead of covering the media.

Add a `::after` layer for the glossy reflection:

- `position: absolute`
- `inset: 0` or `inset: 1px`
- `pointer-events: none`
- same `border-radius`
- diagonal linear-gradient or radial highlight
- low opacity
- `mix-blend-mode: screen` or normal, whichever is more reliable.

## Possible visual baseline

Use CSS in this spirit, adapting names/selectors to the actual script:

```css
.hz-preview {
  position: fixed;
  isolation: isolate;
  border-radius: 26px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.42);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.34),
    0 2px 8px rgba(0, 0, 0, 0.22),
    inset 0 1px 1px rgba(255, 255, 255, 0.72),
    inset 0 -1px 1px rgba(0, 0, 0, 0.24);
}

.hz-preview::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  z-index: 2;
  background:
    linear-gradient(135deg,
      rgba(255,255,255,0.58) 0%,
      rgba(255,255,255,0.18) 18%,
      rgba(255,255,255,0.04) 42%,
      rgba(0,0,0,0.10) 72%,
      rgba(255,255,255,0.22) 100%),
    radial-gradient(circle at 18% 8%,
      rgba(255,255,255,0.72),
      rgba(255,255,255,0.10) 26%,
      transparent 48%);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.34),
    inset 0 0 18px rgba(255,255,255,0.10),
    inset 0 -10px 22px rgba(0,0,0,0.16);
}

.hz-preview::after {
  content: "";
  position: absolute;
  inset: 1px;
  pointer-events: none;
  border-radius: calc(26px - 1px);
  z-index: 3;
  background:
    linear-gradient(115deg,
      transparent 0%,
      rgba(255,255,255,0.20) 16%,
      rgba(255,255,255,0.06) 32%,
      transparent 48%);
  opacity: 0.75;
}

.hz-preview img,
.hz-preview video {
  position: relative;
  z-index: 1;
  display: block;
  border-radius: inherit;
}
```

That CSS is a starting point, not something to paste blindly. Adapt selectors to the actual userscript. If the script uses inline styles, move the visual styling into one injected CSS block where possible.

## Acceptance criteria

1. The hover preview still appears in the same place and scales the same way.
2. The media remains sharp.
3. The border looks dimensional and glossy, with a clear glass rim.
4. It does not look like a flat translucent gray rectangle.
5. It does not rely on heavy blur.
6. It looks acceptable over both bright and dark webpages.
7. The change is small, localized, and easy to revert.

## After editing

Tell me exactly which selectors/functions were changed.

Explain how the Liquid Glass effect is layered.

Mention whether any behavior changed.

Run any available lint/test/check command, or say if none exists.
