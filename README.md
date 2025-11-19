# Image Hover Zoom Combined (Safari Edition)

Image Hover Zoom Combined is a zero‑dependency userscript for Safari that recreates the behaviour of extensions like Hover Zoom+. Whenever your pointer glides over a media element, the script resolves the highest‑resolution source it can find, scales it to fit the viewport, and displays it in a floating preview that follows the cursor.

## Features

- **Works everywhere**: `@match *://*/*` means any site that exposes images, anchors, or role-based images is eligible.
- **Intelligent URL extraction**: inspects `src`, `srcset`, parent anchors, `<picture>` elements, background images, and common `data-*` attributes (including JSON blobs and delimited lists).
- **Smart URL upgrading**: automatically transforms thumbnail URLs to full-size versions by recognizing common patterns (`_thumb` → `_large`, `_small` → `_large`, `/thumb/` → `/large/`, plus platform-specific patterns for Flickr, Google Photos, and width/height-based paths).
- **Minimum zoom threshold**: only shows the preview if the full-size image is at least 20% larger than the displayed version, avoiding unnecessary previews for images already at full resolution.
- **Size filtering**: ignores tiny elements (smaller than 40×40px) to avoid showing previews for icons and buttons.
- **Polished presentation**: draws an overlay with proper padding, drop shadow, rounded corners, and hides itself when the tab blurs, the pointer leaves, or nothing suitable is found.
- **Cursor-following preview**: positions the preview relative to the pointer while respecting viewport bounds with a configurable 18px margin.
- **Sensible performance**: skips bare image documents, throttles pointer updates with `requestAnimationFrame`, prefers inline background styles before calling `getComputedStyle`, caches resolved URLs, and applies a short-lived rejection cache (automatically cleared when images reload) to avoid redundant work.
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

1. The script runs at `document-end` and immediately aborts if the document itself is an image so it stays out of raw image tabs.
2. It injects a single overlay `<div>` with an `<img>` child and tracks the active target, pointer position, and pending loader.
3. Whenever you hover an `<img>` that clears the size threshold, it resolves the largest URL by:
   - checking a curated list of `data-*` attributes (including parsing JSON/array strings and multi-value `|`/`,` entries),
   - looking at parent anchors that already point to an image,
   - walking up through `<picture>`/`<source srcset>` entries and the element's own `srcset` descriptors,
   - falling back to `currentSrc`/`src`, or background images (only running `getComputedStyle` when the inline style mentions `background`),
   - checking `data-background-image` values when present.
4. Once a viable URL is found, it runs through `upgradeUrl` to swap thumbnail segments (Imgur, Flickr, Twitter/X, Google Photos, and generic width/height patterns) for their full-resolution counterparts.
5. The image is preloaded and its natural size is measured. If either dimension is not at least 20% larger than what’s on screen, the preview is skipped and the element is temporarily rejected.
6. If the image passes all checks, it’s scaled to fit up to 90% of the viewport while maintaining aspect ratio and respecting the 18px margin.
7. Pointer movements are throttled with `requestAnimationFrame`, resolved URLs are cached, and negative results are cached for ~1.5 s (flushed whenever the image fires `load`) to prevent unnecessary recomputation.

## Tweaking

Because this is plain JavaScript you can adapt it to your needs:

- **Supported attributes**: edit `DATA_ATTRS` if the sites you use rely on custom attribute names for HD URLs.
- **Eligible elements**: extend the `mouseover` handler (or add your own listener) if you need custom components to call `extractImageUrl`.
- **URL upgrade patterns**: add custom patterns to `upgradeUrl` if you want to transform site-specific thumbnail URLs to full-size versions.
- **Minimum zoom threshold**: adjust `MIN_ZOOM_GAIN` (default 1.2) to control how much larger an image must be to trigger the preview.
- **Size filtering**: change `MIN_SIZE` (default 40) to adjust the minimum element size that triggers previews.
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
