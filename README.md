# hover-zoom

`hover-zoom` contains a single Safari/Tampermonkey userscript, `Image Popout
(Safari)`, for inspecting media on web pages without leaving the page. It shows
near-cursor previews for supported images and videos, and it can open supported
media in a draggable, resizable in-page popout.

## Repository contents

- `src/Image Popout (Safari)-1.5.2.user.js`: the userscript to install.
- `README.md`: this usage and development guide.

There is no build step, package manifest, lint command, or automated test suite.

## What the userscript does

- Runs on top-level `http` and `https` pages.
- Shows a hover preview for supported images and videos when the target is at
  least 48 by 48 CSS pixels.
- Keeps hover previews inside the viewport and scales them down when needed.
- Lets `Z` turn hover previews on or off, saved per site in `localStorage` under
  `image_popout_safari_v2`.
- Lets `P` pin or unpin the current hover preview.
- Opens a modal popout with Alt/Option-click on supported image or video media.
- Auto-fits the popout to the media, then allows manual dragging and resizing.
- Provides popout controls for `Copy URL`, `Open`, `Download`, and `Close`.
- Lets `D` download the media currently open in the popout.
- Closes the hover preview and popout with `Esc`; clicking the popout backdrop
  also closes the popout.

## Supported media

The script uses generic media discovery plus small site-aware URL handling where
common sites need it. It searches the element under the pointer and nearby
elements at the same screen coordinates for:

- `<img>` elements, preferring the largest `srcset` candidate when one exists.
- `currentSrc`, `src`, and common lazy-load attributes: `data-src`,
  `data-original`, `data-url`, `data-lazy-src`, `data-zoom-src`, `data-hires`,
  `data-full`, and `data-large`.
- Direct image links around an image or under the pointer.
- CSS `background-image` URLs on common container elements.
- `<video>` elements, including `currentSrc`, `src`, and nested `<source>` URLs.
- Direct video links for popouts and hover previews.
- Wikipedia/Wikimedia thumbnails, media-viewer file hashes, and direct upload
  URLs, including thumbnail URLs rewritten back to the original upload path when
  possible.
- Instagram images and videos when the page exposes them as ordinary media
  elements, background images, or direct media links.
- `twimg.com` image URLs, with `name=orig` requested when the URL uses Twitter's
  `format` or `name` query parameters.

For hover video previews, direct video URLs are replayed in the preview. Blob or
MediaSource-backed videos are moved into the preview temporarily when possible,
with poster/frame fallbacks used when direct replay is not available.

## Installation

1. Install a Safari-compatible userscript manager.
2. Prefer a manager with `GM_download` and `GM_xmlhttpRequest` support if you
   want the built-in download control to work reliably.
3. Create a new userscript from
   `src/Image Popout (Safari)-1.5.2.user.js`.
4. Enable it and refresh any pages you want to test.

The userscript metadata currently matches every `http` and `https` page:

```js
// @match        http://*/*
// @match        https://*/*
```

It also declares:

```js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
```

Those grants are used only for the download flow.

## Controls

| Action | Result |
| --- | --- |
| Hover a supported media target | Show a near-cursor preview |
| `P` while a preview is visible | Pin or unpin the current preview |
| `Z` | Toggle hover previews on or off |
| `Esc` | Hide the preview and close the popout |
| Alt/Option-click supported media | Open the media in the popout |
| Drag the popout title bar | Move the popout |
| Drag the bottom-right handle | Resize the popout |
| `Copy URL` | Copy the popout media URL, with a prompt fallback |
| `Open` | Open the popout media URL in a new tab |
| `Download` or `D` | Download the current popout media |
| `Close`, backdrop click, or `Esc` | Close the popout |

## Download behavior

Downloads first try the userscript manager's `GM_download` API. If that is not
available or fails, the script tries `GM_xmlhttpRequest` to fetch the media as a
blob and then saves it through a temporary download link.

Generated filenames use this pattern:

```text
hz_<site-host>_<yyyy-mm-dd>_<hh-mm-ss>.<extension>
```

The extension is inferred from the response `Content-Type`, the URL path, or
common query parameters when possible. Otherwise, `.bin` is used.

## Known limits

- The script exits inside iframes and only runs in the top window.
- Download reliability depends on the userscript manager, direct media access,
  and the site's response headers.
- Some dynamic video players expose only blob or MediaSource URLs. Hover preview
  may still work by temporarily moving the live video element, but popout and
  download need a direct media URL.

## Development and testing

Edit `src/Image Popout (Safari)-1.5.2.user.js` directly, reload the userscript in
Safari, and manually verify behavior on real pages. Useful checks include hover
previews, keyboard pinning, Alt/Option-click popouts, dragging, resizing,
copy/open/download controls, keyboard shortcuts, and normal page click/scroll
behavior.

For a quick syntax check, run:

```sh
node --check 'src/Image Popout (Safari)-1.5.2.user.js'
```

## Security and privacy

- The script does not send browsing data to a separate service.
- It does not fetch or execute remote code.
- It reads media URLs from the current page and may request those URLs only when
  loading previews, opening popouts, or downloading media.
- Treat page content as untrusted input when extending the script.
