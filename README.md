# Hover Zoom Follow

Hover Zoom Follow is a zero‑dependency userscript that recreates the behaviour of extensions like Hover Zoom+. Whenever your pointer glides over a media element, the script resolves the highest‑resolution source it can find, scales it to fit the viewport, and displays it in a floating preview that follows the cursor.

## Features

- Works everywhere: `@match *://*/*` means any site that exposes images, anchors, or role-based images is eligible.
- Intelligent URL extraction: inspects `src`, `srcset`, parent anchors, background images, and common `data-*` attributes (including JSON blobs and delimited lists).
- Polished presentation: draws an overlay with proper padding, drop shadow, rounded corners, and hides itself when the tab blurs, the pointer leaves, or nothing suitable is found.
- Cursor-following preview: positions the preview relative to the pointer while respecting viewport bounds with a configurable margin.
- Sensible performance: ignores true image documents, throttles pointer updates with `requestAnimationFrame`, and bails early when it has already rejected a target.
- Privacy-friendly: no network requests beyond the image you are already hovering, no analytics, and no DOM mutations outside of the single overlay container.

## Installation

1. Install a userscript manager such as Tampermonkey (Chrome, Edge), Violentmonkey (Firefox, Chrome, Edge), or Greasemonkey (Firefox).
2. Create a **new script** and paste in the contents of [`hover-zoom.user.js`](hover-zoom.user.js), or import the file directly if your manager supports file URLs.
3. Save the script. The metadata block already sets `@match *://*/*`, so it is enabled on every site by default.

> Tip: In Tampermonkey/Violentmonkey you can drag the file into the dashboard to create/update the script, which makes keeping it in sync dead simple.

## Usage

- Hover any image, linked thumbnail, or element with a background image. When a larger source exists, an overlay appears near the pointer.
- Move the pointer to reposition the overlay. It automatically flips sides so it never blocks the hovered content.
- Move the pointer away, switch tabs, or hit `Esc` (if your manager maps it to disable scripts on the page) to dismiss the preview.

The script only reacts to mouse/pen pointer events and ignores touch entirely so it stays out of the way on mobile-style interactions.

## How it works

1. The script waits until `document-idle`, then aborts early if the page _is_ an image (so it does not interfere with raw image tabs).
2. It injects a single overlay `<div>` with an `<img>` child and keeps references to the active target/image sizes.
3. Every pointer move finds the closest candidate via `CANDIDATE_SELECTOR`. URLs are derived by:
   - checking a curated list of `data-*` attributes (including parsing JSON/array strings and multi-value `|`/`,` entries),
   - using `srcset` descriptors to prefer the highest resolution,
   - falling back to `currentSrc`, `src`, or a containing anchor with an image extension,
   - checking computed background images on non-`<img>` elements.
4. Once a viable URL is discovered, it preloads the image, measures its natural size, then scales it to 95 % of the viewport while maintaining aspect ratio and a margin of `18px`.
5. Subsequent pointer moves only update the overlay position via `requestAnimationFrame` to minimize layout thrash.

## Tweaking

Because this is plain JavaScript you can adapt it to your needs:

- **Supported attributes**: edit `DATA_ATTRS` if the sites you use rely on custom attribute names for HD URLs.
- **Eligible elements**: extend `CANDIDATE_SELECTOR` to capture bespoke components (e.g., `.lazy-thumb`).
- **Overlay spacing & style**: adjust the `margin` constant or the `overlay.style` block to change padding, colors, or z-index.
- **Pointer behaviour**: switch `POINTER_EVENT` or drop the pointer-type guard to allow touch/pen previews.

After editing, reload the script in your manager and refresh the target page.

## Troubleshooting

- **Nothing happens**: confirm the userscript manager is enabled on the site and that no page-level CSP blocks inline scripts (managers usually report this in the console).
- **Preview stays tiny**: some CDNs gate full-size images behind authenticated URLs. Open the link in a tab to verify the host allows hotlinking.
- **Wrong image chosen**: inspect the element and see which attribute holds the desired URL, then add it to `DATA_ATTRS` or update the selector.
- **Conflicts with other extensions**: because the overlay uses `pointer-events: none`, it rarely blocks clicks. If another tool injects an element with the same ID (`codex-hover-zoom-overlay`), rename `overlay.id`.

## Development

This repository is intentionally lightweight: edit [`hover-zoom.user.js`](hover-zoom.user.js), keep the metadata block intact, and bump the `@version` before distributing. No bundler, build step, or external dependencies are required.

## License

Released under the [MIT License](LICENSE) © Payton Ison.
