# Hover Zoom Follow (Safari Edition)

Hover Zoom Follow is a zero‑dependency userscript for Safari that recreates the behaviour of extensions like Hover Zoom+. Whenever your pointer glides over a media element, the script resolves the highest‑resolution source it can find, scales it to fit the viewport, and displays it in a floating preview that follows the cursor.

## Features

- **Works everywhere**: `@match *://*/*` means any site that exposes images, anchors, or role-based images is eligible.
- **Intelligent URL extraction**: inspects `src`, `srcset`, parent anchors, `<picture>` elements, background images, and common `data-*` attributes (including JSON blobs and delimited lists).
- **Smart URL upgrading**: automatically transforms thumbnail URLs to full-size versions by recognizing common patterns (`_thumb` → `_large`, `_small` → `_large`, `/thumb/` → `/large/`, plus platform-specific patterns for Flickr, Google Photos, and width/height-based paths).
- **Minimum zoom threshold**: only shows the preview if the full-size image is at least 20% larger than the displayed version, avoiding unnecessary previews for images already at full resolution.
- **Size filtering**: ignores tiny elements (smaller than 32×32px) to avoid showing previews for icons and buttons.
- **Polished presentation**: draws an overlay with proper padding, drop shadow, rounded corners, and hides itself when the tab blurs, the pointer leaves, or nothing suitable is found.
- **Cursor-following preview**: positions the preview relative to the pointer while respecting viewport bounds with a configurable 18px margin.
- **Sensible performance**: ignores bare image documents, throttles pointer updates with `requestAnimationFrame`, caches rejected targets, and avoids expensive `getComputedStyle` calls unless necessary.
- **Privacy-friendly**: no network requests beyond the image you are already hovering, no analytics, and no DOM mutations outside of the single overlay container.

## Installation

1. Install a userscript manager for Safari such as **Userscripts** (available on the Mac App Store) or **Stay** for Safari.
2. Create a **new script** and paste in the contents of [`Image-Hover-Zoom-Combined.user.js`](Image-Hover-Zoom-Combined.user.js), or import the file directly if your manager supports file URLs.
3. Save the script. The metadata block already sets `@match *://*/*`, so it is enabled on every site by default.

> Note: This userscript is specifically designed and tested for Safari on macOS. It may not work correctly in other browsers.

## Usage

- Hover any image, linked thumbnail, or element with a background image. When a larger source exists (at least 20% bigger than the displayed size), an overlay appears near the pointer.
- Move the pointer to reposition the overlay. It automatically flips sides so it never blocks the hovered content.
- Move the pointer away, switch tabs, or blur the window to dismiss the preview.

The script only reacts to mouse/pen pointer events and ignores touch entirely so it stays out of the way on mobile-style interactions.

## How it works

1. The script waits until `document-idle`, then aborts early if the page _is_ an image (so it does not interfere with raw image tabs).
2. It injects a single overlay `<div>` with an `<img>` child and keeps references to the active target/image sizes.
3. Every pointer move finds the closest candidate via `CANDIDATE_SELECTOR` (ignoring elements smaller than 32×32px). URLs are derived by:
   - checking a curated list of 18 `data-*` attributes (including parsing JSON/array strings and multi-value `|`/`,` entries),
   - for `<img>` elements inside `<a>` tags, checking if the parent link points to a full-resolution image,
   - for `<img>` elements inside `<picture>` elements, checking all `<source>` elements for the highest-resolution `srcset`,
   - using `srcset` descriptors to prefer the highest resolution (prioritizing width descriptors over density descriptors),
   - falling back to `currentSrc`, `src`, or a containing anchor with an image extension,
   - checking computed background images on non-`<img>` elements (only if the inline `style` attribute contains "background" to avoid expensive `getComputedStyle` calls).
4. Once a viable URL is found, it's upgraded using pattern matching (e.g., `_thumb` → `_large`, `/thumbnails/` → `/images/`, plus platform-specific patterns for Flickr `_t`/`_m` → `_o`, Google Photos `=s\d+-c` → `=s0`, and width/height-based paths).
5. The image is preloaded and its natural size is measured. If the natural size is not at least 20% larger than the displayed size in either dimension, the preview is skipped.
6. If the image passes all checks, it's scaled to fit 95% of the viewport while maintaining aspect ratio and respecting an 18px margin.
7. Subsequent pointer moves only update the overlay position via `requestAnimationFrame` to minimize layout thrash. Previously rejected targets are cached to avoid redundant processing.

## Tweaking

Because this is plain JavaScript you can adapt it to your needs:

- **Supported attributes**: edit `DATA_ATTRS` if the sites you use rely on custom attribute names for HD URLs.
- **Eligible elements**: extend `CANDIDATE_SELECTOR` to capture bespoke components (e.g., `.lazy-thumb`).
- **URL upgrade patterns**: add custom patterns to `tryUpgradeUrl` if you want to transform site-specific thumbnail URLs to full-size versions.
- **Minimum zoom threshold**: adjust `MIN_ZOOM_GAIN` (default 1.2) to control how much larger an image must be to trigger the preview.
- **Size filtering**: change `MIN_SIZE` (default 32) to adjust the minimum element size that triggers previews.
- **Overlay spacing & style**: adjust the `margin` constant (default 18) or the `overlay.style` block to change padding, colors, or z-index.
- **Pointer behaviour**: switch `POINTER_EVENT` or drop the pointer-type guard to allow touch/pen previews.

After editing, reload the script in your manager and refresh the target page.

## Troubleshooting

- **Nothing happens**: confirm the userscript manager is enabled on the site and that no page-level CSP blocks inline scripts (managers usually report this in the console).
- **Preview stays tiny**: some CDNs gate full-size images behind authenticated URLs. Open the link in a tab to verify the host allows hotlinking.
- **Wrong image chosen**: inspect the element and see which attribute holds the desired URL, then add it to `DATA_ATTRS` or update the selector.
- **Conflicts with other extensions**: because the overlay uses `pointer-events: none`, it rarely blocks clicks. If another tool injects an element with the same ID (`codex-hover-zoom-overlay`), rename `overlay.id`.

## Development

This repository is intentionally lightweight: edit [`Image-Hover-Zoom-Combined.user.js`](Image-Hover-Zoom-Combined.user.js), keep the metadata block intact, and bump the `@version` before distributing. No bundler, build step, or external dependencies are required.

## License

Released under the [MIT License](LICENSE) © Payton Ison.
