# hover-zoom

`hover-zoom` is a Safari-focused userscript for previewing images and videos
without opening them in a new page. Hover a supported media target to show a
near-cursor preview, or Option-click media to open it in a movable popout with
copy, open, and download controls.

The active userscript is:

```text
hover-zoom-safari-v2.3.2.user.js
```

There is no build step. Install that file directly in a Safari-compatible
userscript manager.

## What It Does

- Shows a large hover preview for supported images and videos.
- Keeps the preview inside the visible browser viewport.
- Lets you pin a preview when you want to inspect it more closely.
- Opens media in a draggable, resizable popout with Option-click.
- Copies or opens the current popout media URL.
- Downloads the current popout media when the userscript manager and site allow
  it.
- Stores only the hover-preview on/off preference in `localStorage`.

The script runs only in the top-level page. It exits inside iframes.

## Install

1. Install a Safari-compatible userscript manager.
2. Create a new userscript from `hover-zoom-safari-v2.3.2.user.js`.
3. Enable the userscript.
4. Refresh any pages that were already open.

For the download button, use a manager that supports these userscript APIs:

```js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
```

The script matches normal web pages:

```js
// @match        http://*/*
// @match        https://*/*
```

## How To Use It

| Action | Result |
| --- | --- |
| Hover a supported image or video | Show a near-cursor preview |
| `P` while a preview is visible | Pin or unpin the preview |
| `Z` | Toggle hover previews on or off |
| `Esc` | Hide the preview and close the popout |
| Option-click supported media | Open media in the popout |
| Drag the popout title bar | Move the popout |
| Drag the bottom-right handle | Resize the popout |
| `Copy URL` | Copy the popout media URL |
| `Open` | Open the popout media URL in a new tab |
| `Download` or `D` | Download the current popout media |
| `Close`, backdrop click, or `Esc` | Close the popout |

The `Z` setting is saved under `image_popout_safari_v2`.

## Supported Media

The script looks at the element under the pointer and nearby elements at the
same screen position. It can preview media from:

- Standard `<img>` elements.
- `srcset` and `picture` sources.
- Common lazy-load attributes such as `data-src`, `data-original`,
  `data-lazy-src`, `data-full`, and `data-thumbnail`.
- Direct image links around an image.
- CSS `background-image` URLs on common containers.
- Inline SVG elements.
- Standard `<video>` elements and nested `<source>` URLs.
- Direct video links.
- Wikimedia thumbnails and media-viewer file links.
- `twimg.com` image URLs, requesting original quality when possible.
- OnlyFans-style media containers when the page exposes usable image or video
  elements.

Direct video URLs can replay inside the hover preview. Blob or
MediaSource-backed videos may be moved into the preview temporarily when a
direct URL is not available. In those cases, popout and download behavior may be
limited by what the page exposes.

## Downloads

Downloads use a two-step fallback:

1. Try `GM_download`.
2. If that fails, try `GM_xmlhttpRequest` and save the response as a blob.

Generated filenames use this shape:

```text
hz_<site-host>_<yyyy-mm-dd>_<hh-mm-ss>.<extension>
```

The extension is inferred from the response content type, URL path, or common
query parameters. If the script cannot infer a better extension, it uses
`.bin`.

Download reliability depends on the userscript manager, the current site, media
headers, CORS behavior, and whether the page exposes a direct media URL.

## Limits

- The script does not bypass paywalls, authentication, or private media access.
- Some sites expose only temporary blob or MediaSource video URLs.
- Some downloads fail when a site blocks direct media requests.
- Pages with custom media players may need direct hover testing.
- The script runs on all `http` and `https` pages, so disable it per site in
  your userscript manager if a page conflicts with it.

## Development

Edit `hover-zoom-safari-v2.3.2.user.js` directly, then reload the userscript in
Safari and refresh the test page.

Useful manual checks:

- Hover previews for images and videos.
- `P`, `Z`, and `Esc` keyboard behavior.
- Option-click popouts.
- Popout drag and resize.
- Copy, open, and download controls.
- Normal page click and scroll behavior.

Quick syntax check:

```sh
node --check 'hover-zoom-safari-v2.3.2.user.js'
```

There is no automated test suite in this repo.

## Privacy

- The script does not send browsing data to a separate service.
- The script does not fetch or execute remote code.
- Media URLs are read from the current page.
- Media URLs may be requested only when loading previews, opening popouts, or
  downloading media.
