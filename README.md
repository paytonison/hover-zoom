# hover-zoom

`hover-zoom` contains a single Safari/Tampermonkey userscript,
`hover-zoom-safari`, for inspecting media on web pages without leaving the page.
It shows near-cursor previews for supported images and videos, and it can open
supported media in a draggable, resizable in-page popout.

[Install Hover Zoom](https://raw.githubusercontent.com/paytonison/hover-zoom/main/hover-zoom.user.js)

[Support Hover Zoom on Ko-fi](https://ko-fi.com/paytonison)

## Repository contents

- [`hover-zoom.user.js`](hover-zoom.user.js): the userscript to install.
- [`README.md`](README.md): this usage and development guide.
- [`LICENSE`](LICENSE): the BSD 3-Clause license.
- [`.github/workflows/validate.yml`](.github/workflows/validate.yml): the
  automatic syntax and regression checks.
- [`tests/`](tests): zero-dependency regression tests for full-image selection.

There is no build step, package manifest, dependency installation, or lint
command.

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

- `<img>` elements, preferring explicit full-image attributes (`data-zoom-src`,
  `data-full-src`, `data-full`, `data-hires`, `data-large`, and `data-original`)
  over thumbnail display sources, then the largest applicable `srcset` candidate.
- The browser-selected `<picture>` source, or the image's own `srcset` when
  the browser uses its fallback image.
- `currentSrc`, `src`, and common lazy-load attributes: `data-src`, `data-url`,
  and `data-lazy-src`.
- Direct image links around an image or under the pointer.
- CSS `background-image` URLs on common container elements.
- `<video>` elements, including `currentSrc`, `src`, and nested `<source>` URLs.
- Direct video links for popouts and hover previews.
- Wikipedia/Wikimedia thumbnails, media-viewer file hashes, and direct upload
  URLs, including thumbnail URLs rewritten back to the original upload path when
  possible.
- Instagram images and videos when the page exposes them as ordinary media
  elements, background images, or direct media links.
- OnlyFans images, videos, and background images nested inside post media
  containers.
- `twimg.com` image URLs, with `name=orig` requested when the URL uses Twitter's
  `format` or `name` query parameters.

For hover video previews, the browser's active media source is preserved. Direct
video URLs are replayed in the preview. Blob or MediaSource-backed videos are
moved into the preview temporarily when possible. Poster/frame fallbacks are
used if replay fails, and cached frames are refreshed when the video source
changes. Moving the pointer over an unpinned preview target also checks for a
source change when the page reuses the same video element.

Video popouts prefer a compatible direct source, using explicit resolution
metadata when available. When only a blob or MediaSource URL is exposed, the
popout uses a poster or captured still if available, then attempts the original
URL as a last fallback.

## Installation

1. Install a Safari-compatible userscript manager.
2. Prefer a manager with `GM_download` and `GM_xmlhttpRequest` support if you
   want the built-in download control to work reliably.
3. Install [`hover-zoom.user.js`](https://raw.githubusercontent.com/paytonison/hover-zoom/main/hover-zoom.user.js),
   or create a new userscript and paste in that file's contents.
4. Enable the userscript and refresh any pages you want to use it on.

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

| Action                            | Result                                            |
| --------------------------------- | ------------------------------------------------- |
| Hover a supported media target    | Show a near-cursor preview                        |
| `P` while a preview is visible    | Pin or unpin the current preview                  |
| `Z`                               | Toggle hover previews on or off                   |
| `Esc`                             | Hide the preview and close the popout             |
| Alt/Option-click supported media  | Open the media in the popout                      |
| Drag the popout title bar         | Move the popout                                   |
| Drag the bottom-right handle      | Resize the popout                                 |
| `Copy URL`                        | Copy the popout media URL, with a prompt fallback |
| `Open`                            | Open the popout media URL in a new tab            |
| `Download` or `D`                 | Download the current popout media                 |
| `Close`, backdrop click, or `Esc` | Close the popout                                  |

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
  may still work by temporarily moving the live video element. Popouts may show
  a static fallback; downloading the underlying video needs a direct media URL.

## Development and testing

Edit `hover-zoom.user.js` directly, reload the userscript in Safari, and manually
verify behavior on real pages. Useful checks include hover previews, keyboard
pinning, Alt/Option-click popouts, dragging, resizing, copy/open/download
controls, keyboard shortcuts, and normal page click/scroll behavior.

For the same checks used in CI, run:

```sh
node --check hover-zoom.user.js
set -- tests/*.test.js
test -f "$1"
node --test tests/*.test.js
```

The syntax and regression checks run automatically for pushes to `main` and
`beta`, and for pull requests.

The tests exercise the actual userscript functions with simulated page elements.
They cover full-image attributes, responsive image and picture source selection,
direct image links, and ordinary image and lazy-load fallbacks.

Real Safari/Tampermonkey checks remain necessary for playback, live-video
restoration, dynamic site behavior, and actual saved downloads.

## Security and privacy

- The script does not send browsing data to a separate service.
- It does not fetch or execute remote code.
- It reads media URLs from the current page and may request those URLs only when
  loading previews, opening popouts, or downloading media.
- Treat page content as untrusted input when extending the script.

## License

`hover-zoom` is available under the [BSD 3-Clause License](LICENSE).

## Development Philosophy

I made this userscript because the Safari userscripts I found were slow, bloated, or overloaded with unnecessary features. The core problem was simple: display a full-resolution image or video preview from a thumbnail without requiring the user to click through and load the media directly.

This userscript is built specifically for Safari. It uses the browser’s native behavior to improve responsiveness while keeping the feature set focused and lightweight. It works with images and videos on most sites that expose media assets in the page, including sites that wrap media in containers, such as Wikipedia and Instagram. Because it is Safari-native, I also added a little Liquid Glass flair.

The development process was agent-assisted, but not passive. I collaborated with ChatGPT to reason through the design, especially because web development and media-serving edge cases are not my usual domain. We worked through the initial concept, refined the feature behavior, assembled implementation prompts, and then used Codex to generate and modify the code.

As with any software project, issues appeared during testing. I would have Codex write or update the code, test the script directly in Safari, evaluate whether the behavior was actually useful, and identify bugs or edge cases. Then I would report the problem back in concrete terms and direct the next fix. Through that loop, bugs were squashed, edge cases were handled, and the userscript became progressively more robust.

When I wanted a new feature, the process repeated: discuss the idea with ChatGPT, understand the relevant web-development or media-handling mechanics, turn that into a precise prompt, give it to Codex, test the result, and iterate.

This is the development pattern I think agentic programming is moving toward. Right now, coding agents are often treated as “insert words, get program,” which is dismissed as “vibe coding”: the developer accepts whatever the agent produces and keeps moving until something breaks. My process is different.

I use ChatGPT and Codex as collaborators in the development loop: discussing features, formulating implementation plans, directing changes, testing software live, identifying failures, and iterating when bugs or useful surprises emerge. The agent is not just autocomplete, and the human is not just a prompt dispenser. The result is a workflow where the human provides architecture, judgment, testing, taste, and direction, while the agent accelerates implementation.

I believe this kind of collaboration will become a major part of software development as agents become more deeply integrated into programming workflows. The relevant skill will not only be raw coding ability, but also the ability to use agents effectively: specifying intent, supervising implementation, testing behavior, recognizing edge cases, and turning a rough generated artifact into working software.
