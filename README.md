# hover-zoom

`hover-zoom` is a Safari userscript that shows a near-cursor preview for images
and opens a movable popout window for images or videos with Alt/Option-click.

## Current repo contents

- `src/Image Popout (Safari)-1.5.user.js`: the only source file and the userscript
  you install.
- `README.md`: installation, controls, and development notes.

## What the script does

- Previews large enough images near the cursor while you hover.
- Pins or unpins video previews on click, or any current preview with `P`.
- Toggles hover previews with `Z` and stores that preference in
  `localStorage` under `image_popout_safari_v2`.
- Closes the preview and any open popout with `Esc`.
- Opens a draggable, resizable overlay with Alt/Option-click.
- Supports both image and video popouts.
- Includes `Copy URL`, `Open`, `Download`, and `Close` controls in the popout.
- Lets you press `D` to download the currently open popout media.
- Looks for the best available asset from `srcset`, lazy-load attributes, linked
  originals, CSS background images, and `<video>/<source>` elements.
- Normalizes a few common media URL patterns, including Wikimedia thumbnail URLs
  and original-size `twimg.com` image URLs.

## Installation

1. Install a Safari-compatible userscript manager.
2. Use a manager with `GM_download` and `GM_xmlhttpRequest` support if you want
   the built-in download button to work reliably. `Tampermonkey` is the safest
   fit for the current script.
3. Create a new userscript from `src/Image Popout (Safari)-1.5.user.js`.
4. Enable it and refresh the page you want to test.

The script currently matches all `http` and `https` pages:

```js
// @match        http://*/*
// @match        https://*/*
```

## Controls

| Action | Result |
| --- | --- |
| Hover a supported image target | Show the near-cursor preview |
| Click the hovered video target | Pin or unpin the preview |
| `P` | Pin or unpin the preview |
| `Z` | Turn hover previews on or off |
| `Esc` | Hide the preview and close the popout |
| Alt/Option-click a supported target | Open the popout overlay |
| `D` while the popout is open | Download the current popout media |

## Supported targets

- `<img>` elements, including higher-quality `srcset` variants.
- Linked images when the surrounding `<a>` points at a direct media asset.
- Elements with CSS `background-image`.
- `<video>` elements and linked video files for the popout flow.
- Some Wikimedia media-viewer and thumbnail URLs, which are normalized back to
  direct asset URLs when possible.

## Development and testing

No build, lint, or automated test tooling is configured in this repo.

- Edit `src/Image Popout (Safari)-1.5.user.js`.
- Reload the userscript in Safari.
- Manually verify hover previews, pinning, popout behavior, dragging, resizing,
  copy/open/download actions, and normal page interaction on real sites.

## Security and privacy

- The script runs in-page and does not send browsing data to a server.
- The download flow depends on userscript-manager APIs and direct media access.
- Treat page content as untrusted input when extending the script.
