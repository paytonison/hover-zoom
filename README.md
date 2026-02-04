# Hover Zoom (Safari Image Popout)

Safari userscript that shows a near-cursor image preview on hover and a full popout
overlay on Alt/Option-click. The preview and popout automatically size themselves
to fit within the current viewport.

## Features
- Hover preview near the cursor (auto-fits the viewport).
- Click to pin/unpin the preview; press `Z` to toggle previews.
- Alt/Option-click to open a movable, resizable popout overlay (auto-fits the viewport).
- Copy/Open/Close controls in the popout titlebar.

## Installation
1. Install a Safari-compatible userscript manager (for example, Userscripts or Tampermonkey).
2. Create a new userscript and paste in `src/image-popout.user.js`.
3. Ensure the script is enabled, then refresh any page.

> Tip: The script currently matches all `http`/`https` pages. If you want narrower
> coverage, edit the `// @match` lines in the userscript header.

## Usage
### Hover preview
- Hover an image (or an element with a background image) to show the preview.
- Click the image (or press `P`) to pin/unpin the preview.
- Press `Z` to toggle the hover preview on/off.
- Press `Esc` to hide the preview (and close any popout).

### Popout overlay
- **Alt/Option-click** an image to open the popout.
- Drag the titlebar to move it.
- Use the bottom-right resize handle to resize it.
- Click outside the popout or press `Esc` to close it.

## Behavior details
- The preview and popout use `object-fit: contain` so the full image remains visible.
- When the window is resized, the popout re-fits to the viewport until you drag or resize it.
- The script attempts to choose the best available image URL from `srcset` and
  common lazy-loading attributes.

## Development
- Source: `src/image-popout.user.js`
- No build/test tooling is configured yet. Test by reloading pages in Safari.

## Privacy & security
- The script runs entirely in the browser and does not send data anywhere.
- Images must be accessible via direct URLs; protected images may fail to load.

## Contributing
- Keep changes focused and avoid new dependencies unless necessary.
- Update this README when behavior or controls change.
