// ==UserScript==
// @name         Image Popout (Safari)
// @namespace    https://github.com/paytonison/hover-zoom
// @version      2.2.2
// @description  Hover images or videos, including nested site media, for a near-cursor preview. P pins, Z toggles, Esc hides, and Alt/Option-click opens a movable overlay.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(() => {
  "use strict";

  if (window.top !== window.self) return;

  const IDS = {
    style: "hz-style",
    overlay: "hz-overlay",
    backdrop: "hz-backdrop",
    window: "hz-window",
    titlebar: "hz-titlebar",
    title: "hz-title",
    popoutImg: "hz-popout-img",
    popoutVideo: "hz-popout-video",
    popoutToast: "hz-popout-toast",
    resize: "hz-resize",
    hoverWrap: "hz-hover-wrap",
    hoverImg: "hz-hover-img",
    hoverVideo: "hz-hover-video",
    hoverLiveHost: "hz-hover-live-host",
    hoverBadge: "hz-hover-badge",
    hoverToast: "hz-hover-toast",
  };

  const STORAGE_KEY = "image_popout_safari_v2";
  const DEBUG_STORAGE_KEY = "image_popout_safari_debug";
  const CONTEXT_MENU_SUPPRESSION_MS = 2000;
  const BACKGROUND_IMAGE_SELECTOR =
    "div, span, a, button, figure, section, article, li";
  const ONLYFANS_HOST_PATTERN = /(^|\.)onlyfans\.com$/i;
  const ONLYFANS_MEDIA_CONTAINER_SELECTOR = [
    "article",
    "figure",
    "picture",
    "a[href*='/posts/']",
    "a[href*='/photos/']",
    "a[href*='/videos/']",
    "[data-testid*='media']",
    "[class*='b-post__media']",
    "[class*='post_media']",
    "[class*='media-item']",
    "[class*='media-container']",
    "[class*='mediaContainer']",
  ].join(", ");
  const NESTED_IMAGE_CONTAINER_SELECTOR = [
    "a",
    "figure",
    "picture",
    "span",
    ".mw-mmv-image-wrapper",
    ".mw-mmv-image-inner-wrapper",
    ".mw-mmv-image",
  ].join(", ");
  const LAZY_IMAGE_ATTRS = [
    "data-src",
    "data-original",
    "data-url",
    "data-lazy-src",
    "data-zoom-src",
    "data-hires",
    "data-full",
    "data-large",
    "data-full-src",
    "data-preview",
    "data-thumb",
    "data-thumbnail",
    "data-poster",
  ];
  const LAZY_IMAGE_SRCSET_ATTRS = [
    "data-srcset",
    "data-lazy-srcset",
    "data-original-srcset",
  ];
  const SVG_NS = "http://www.w3.org/2000/svg";

  const CONFIG = {
    minTargetPixels: 48,
    viewportPadding: 12,
    popout: {
      titlebarHeight: 44,
      minWidth: 260,
      minHeight: 200,
      maxViewportFraction: 0.82,
    },
    hover: {
      offset: 16,
      maxViewportFraction: 1,
      viewportPadding: 8,
      borderRadius: 14,
      padding: 5,
      borderWidth: 1.5,
      fallbackWidth: 800,
      fallbackHeight: 600,
    },
  };

  const EXT_BY_CONTENT_TYPE = {
    "application/vnd.apple.mpegurl": "m3u8",
    "application/x-mpegurl": "m3u8",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/ogg": "ogv",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };

  const KNOWN_EXTENSIONS = new Set([
    "avif",
    "gif",
    "jpeg",
    "jpg",
    "m3u8",
    "m4v",
    "mov",
    "mp4",
    "ogv",
    "png",
    "svg",
    "webm",
    "webp",
  ]);
  const VIDEO_PREVIEW_CACHE = new WeakMap();

  const state = {
    hover: {
      enabled: loadPrefs().enabled,
      pinned: false,
      target: null,
      url: "",
      previewMode: "image",
      interactive: false,
      mouseX: 0,
      mouseY: 0,
      naturalW: 0,
      naturalH: 0,
      wrapW: 320,
      wrapH: 240,
      loadToken: 0,
      positionRaf: 0,
      lastEventTarget: null,
      fallbackUrl: "",
      temporaryUrl: "",
      videoCurrentTime: 0,
      videoShouldPlay: false,
      live: null,
      toastTimer: 0,
      targetRect: null,
    },
    popout: {
      open: false,
      url: "",
      mediaType: "image",
      autoFit: true,
      loadToken: 0,
      drag: null,
      resize: null,
      pointerListenersActive: false,
      toastTimer: 0,
      temporaryUrl: "",
      fallbackW: 0,
      fallbackH: 0,
    },
    input: {
      suppressClick: false,
      suppressClickUntil: 0,
    },
    viewport: {
      changeRaf: 0,
    },
    ui: {
      overlay: null,
      popoutWindow: null,
      popoutTitle: null,
      popoutImg: null,
      popoutVideo: null,
      popoutToast: null,
      hoverWrap: null,
      hoverImg: null,
      hoverVideo: null,
      hoverLiveHost: null,
      hoverBadge: null,
      hoverToast: null,
      ready: false,
    },
  };

  init();

  function init() {
    bindEvents();
  }

  function ensureUi() {
    if (state.ui.ready) return;
    injectStyles();
    buildUi();
    state.ui.ready = true;
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { enabled: true };
      const parsed = JSON.parse(raw);
      return { enabled: parsed.enabled !== false };
    } catch {
      return { enabled: true };
    }
  }

  function debugLog(label, value = null) {
    if (!isDebugEnabled()) return;

    try {
      console.debug("[Image Popout]", label, value);
    } catch {}
  }

  function isDebugEnabled() {
    try {
      return localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function describeCandidate(candidate) {
    if (!candidate) return null;

    return {
      previewMode: candidate.previewMode || candidate.type || "image",
      url: candidate.url || "",
      fallbackUrl: candidate.fallbackUrl || "",
      element: describeElement(candidate.element),
      hoverTarget: describeElement(candidate.hoverTarget),
    };
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return "";

    const id = element.id ? `#${element.id}` : "";
    const className = String(element.className || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((name) => `.${name}`)
      .join("");

    return `${element.localName}${id}${className}`;
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ enabled: state.hover.enabled }),
      );
    } catch {}
  }

  function injectStyles() {
    if (document.getElementById(IDS.style)) return;

    const style = document.createElement("style");
    style.id = IDS.style;
    style.textContent = `
      :root {
        --hz-text: rgba(24, 24, 28, 0.92);
        --hz-text-muted: rgba(24, 24, 28, 0.68);
        --hz-surface: rgba(255, 255, 255, 0.72);
        --hz-surface-strong: rgba(255, 255, 255, 0.84);
        --hz-surface-soft: rgba(255, 255, 255, 0.56);
        --hz-border: rgba(255, 255, 255, 0.72);
        --hz-border-soft: rgba(0, 0, 0, 0.08);
        --hz-shadow:
          0 20px 50px rgba(15, 15, 18, 0.18),
          0 4px 14px rgba(15, 15, 18, 0.1);
        --hz-backdrop: rgba(10, 10, 14, 0.26);
        --hz-image-bg: rgba(0, 0, 0, 0.08);
        --hz-accent: rgba(0, 122, 255, 0.88);
        --hz-danger: rgba(255, 59, 48, 0.18);
        --hz-danger-border: rgba(255, 59, 48, 0.3);
        --hz-glass-radius: 18px;
        --hz-glass-inner-radius: 13px;
        --hz-glass-blur: 18px;
        --hz-glass-saturation: 165%;
        --hz-glass-brightness: 1.06;
        --hz-glass-border-width: 1.5px;
        --hz-glass-bg:
          radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.72), transparent 34%),
          linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.58),
            rgba(246, 248, 252, 0.34) 42%,
            rgba(232, 238, 248, 0.42)
          );
        --hz-glass-bg-solid: rgba(248, 250, 255, 0.92);
        --hz-glass-body-bg: rgba(0, 0, 0, 0.12);
        --hz-glass-border: rgba(255, 255, 255, 0.46);
        --hz-glass-divider: rgba(18, 22, 30, 0.1);
        --hz-glass-highlight: rgba(255, 255, 255, 0.48);
        --hz-glass-rim: rgba(255, 255, 255, 0.32);
        --hz-glass-edge: rgba(16, 20, 28, 0.1);
        --hz-glass-shadow:
          0 0 0 0.5px var(--hz-glass-edge),
          0 24px 70px rgba(8, 12, 20, 0.22),
          0 8px 24px rgba(8, 12, 20, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.58);
        --hz-titlebar-glass-bg:
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.72),
            rgba(255, 255, 255, 0.42)
          );
        --hz-control-bg: rgba(255, 255, 255, 0.48);
        --hz-control-bg-hover: rgba(255, 255, 255, 0.68);
        --hz-control-bg-active: rgba(255, 255, 255, 0.36);
        --hz-control-border: rgba(255, 255, 255, 0.62);
        --hz-control-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.46),
          0 1px 2px rgba(12, 16, 24, 0.12);
        --hz-toast-glass-bg: rgba(255, 255, 255, 0.78);
        --hz-resize-mark: rgba(255, 255, 255, 0.78);
        --hz-title-text-shadow: 0 1px 0 rgba(255, 255, 255, 0.2);
        --hz-hover-glass-radius: ${CONFIG.hover.borderRadius}px;
        --hz-hover-glass-media-radius: ${CONFIG.hover.borderRadius - 6}px;
        --hz-hover-glass-border-width: ${CONFIG.hover.borderWidth}px;
        --hoverZoomBorderOpacity: 0.2;
        --hoverZoomBorderBlur: 10px;
        --hz-hover-glass-blur: 12px;
        --hz-hover-glass-saturation: 150%;
        --hz-hover-glass-bg: rgba(246, 248, 252, 0.42);
        --hz-hover-glass-border: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-edge-contrast: rgba(16, 20, 28, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-top-sheen: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-side-sheen: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-bottom-tint: rgba(12, 16, 24, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-inner-rim: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
        --hz-hover-glass-content-rim: rgba(18, 22, 30, 0.12);
        --hz-hover-glass-shadow:
          0 0 var(--hoverZoomBorderBlur) var(--hz-hover-glass-edge-contrast),
          0 10px var(--hoverZoomBorderBlur) rgba(12, 16, 24, var(--hoverZoomBorderOpacity)),
          0 2px var(--hoverZoomBorderBlur) rgba(12, 16, 24, var(--hoverZoomBorderOpacity));
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --hz-text: rgba(245, 245, 247, 0.94);
          --hz-text-muted: rgba(245, 245, 247, 0.7);
          --hz-surface: rgba(28, 28, 34, 0.74);
          --hz-surface-strong: rgba(36, 36, 42, 0.84);
          --hz-surface-soft: rgba(24, 24, 30, 0.58);
          --hz-border: rgba(255, 255, 255, 0.2);
          --hz-border-soft: rgba(255, 255, 255, 0.08);
          --hz-shadow:
            0 24px 60px rgba(0, 0, 0, 0.44),
            0 4px 14px rgba(0, 0, 0, 0.28);
          --hz-backdrop: rgba(5, 5, 8, 0.42);
          --hz-image-bg: rgba(0, 0, 0, 0.34);
          --hz-accent: rgba(10, 132, 255, 0.9);
          --hz-danger: rgba(255, 69, 58, 0.22);
          --hz-danger-border: rgba(255, 69, 58, 0.34);
          --hz-glass-brightness: 0.94;
          --hz-glass-bg:
            radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.18), transparent 36%),
            linear-gradient(
              145deg,
              rgba(44, 46, 56, 0.58),
              rgba(24, 26, 34, 0.46) 44%,
              rgba(10, 12, 18, 0.52)
            );
          --hz-glass-bg-solid: rgba(24, 26, 32, 0.94);
          --hz-glass-body-bg: rgba(0, 0, 0, 0.42);
          --hz-glass-border: rgba(255, 255, 255, 0.18);
          --hz-glass-divider: rgba(255, 255, 255, 0.09);
          --hz-glass-highlight: rgba(255, 255, 255, 0.16);
          --hz-glass-rim: rgba(255, 255, 255, 0.1);
          --hz-glass-edge: rgba(255, 255, 255, 0.08);
          --hz-glass-shadow:
            0 0 0 0.5px var(--hz-glass-edge),
            0 30px 78px rgba(0, 0, 0, 0.56),
            0 8px 26px rgba(0, 0, 0, 0.34),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
          --hz-titlebar-glass-bg:
            linear-gradient(
              180deg,
              rgba(52, 54, 64, 0.68),
              rgba(22, 24, 30, 0.5)
            );
          --hz-control-bg: rgba(255, 255, 255, 0.1);
          --hz-control-bg-hover: rgba(255, 255, 255, 0.17);
          --hz-control-bg-active: rgba(255, 255, 255, 0.08);
          --hz-control-border: rgba(255, 255, 255, 0.18);
          --hz-control-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.14),
            0 1px 2px rgba(0, 0, 0, 0.28);
          --hz-toast-glass-bg: rgba(30, 32, 38, 0.82);
          --hz-resize-mark: rgba(255, 255, 255, 0.46);
          --hz-title-text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
          --hz-hover-glass-bg: rgba(28, 30, 36, 0.42);
          --hz-hover-glass-border: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-edge-contrast: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-top-sheen: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-side-sheen: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-bottom-tint: rgba(0, 0, 0, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-inner-rim: rgba(255, 255, 255, var(--hoverZoomBorderOpacity));
          --hz-hover-glass-content-rim: rgba(255, 255, 255, 0.1);
          --hz-hover-glass-shadow:
            0 0 var(--hoverZoomBorderBlur) var(--hz-hover-glass-edge-contrast),
            0 12px var(--hoverZoomBorderBlur) rgba(0, 0, 0, var(--hoverZoomBorderOpacity)),
            0 2px var(--hoverZoomBorderBlur) rgba(0, 0, 0, var(--hoverZoomBorderOpacity));
        }
      }

      #${IDS.overlay} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        color: var(--hz-text);
        color-scheme: light dark;
      }

      #${IDS.overlay}.is-open {
        display: block;
      }

      #${IDS.backdrop} {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.1), transparent 36%),
          var(--hz-backdrop);
        backdrop-filter: blur(14px) saturate(140%);
        -webkit-backdrop-filter: blur(14px) saturate(140%);
      }

      /* Liquid Glass popout surface */
      #${IDS.window} {
        position: absolute;
        overflow: hidden;
        isolation: isolate;
        border-radius: var(--hz-glass-radius);
        border: var(--hz-glass-border-width) solid var(--hz-glass-border);
        background: var(--hz-glass-bg);
        background-clip: padding-box;
        box-shadow: var(--hz-glass-shadow);
        backdrop-filter:
          blur(var(--hz-glass-blur))
          saturate(var(--hz-glass-saturation))
          brightness(var(--hz-glass-brightness));
        -webkit-backdrop-filter:
          blur(var(--hz-glass-blur))
          saturate(var(--hz-glass-saturation))
          brightness(var(--hz-glass-brightness));
      }

      #${IDS.window}::before,
      #${IDS.window}::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
      }

      #${IDS.window}::before {
        z-index: 4;
        box-shadow:
          inset 0 1px 0 var(--hz-glass-highlight),
          inset 1px 0 0 rgba(255, 255, 255, 0.14),
          inset -1px 0 0 rgba(255, 255, 255, 0.08),
          inset 0 -1px 0 rgba(0, 0, 0, 0.08);
      }

      #${IDS.window}::after {
        z-index: 1;
        background:
          linear-gradient(115deg, var(--hz-glass-highlight), transparent 28%),
          radial-gradient(circle at 78% 4%, var(--hz-glass-rim), transparent 22%);
        opacity: 0.62;
      }

      #${IDS.titlebar} {
        position: relative;
        z-index: 3;
        height: ${CONFIG.popout.titlebarHeight}px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        border-bottom: 1px solid var(--hz-glass-divider);
        background: var(--hz-titlebar-glass-bg);
        box-shadow:
          inset 0 1px 0 var(--hz-glass-highlight),
          inset 0 -1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px) saturate(150%);
        -webkit-backdrop-filter: blur(10px) saturate(150%);
        cursor: move;
        user-select: none;
      }

      #${IDS.title} {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-shadow: var(--hz-title-text-shadow);
      }

      .hz-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        border: 1px solid var(--hz-control-border);
        background: var(--hz-control-bg);
        color: var(--hz-text);
        border-radius: 999px;
        padding: 6px 10px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: var(--hz-control-shadow);
        backdrop-filter: blur(10px) saturate(150%);
        -webkit-backdrop-filter: blur(10px) saturate(150%);
        cursor: pointer;
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          box-shadow 120ms ease,
          transform 120ms ease;
      }

      .hz-btn:hover {
        background: var(--hz-control-bg-hover);
        border-color: var(--hz-glass-border);
      }

      .hz-btn:active {
        background: var(--hz-control-bg-active);
        transform: translateY(1px);
      }

      .hz-btn:focus-visible {
        outline: 2px solid var(--hz-accent);
        outline-offset: 1px;
      }

      #hz-close-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 999px;
        font-weight: 700;
      }

      #hz-close-btn:hover {
        background: var(--hz-danger);
        border-color: var(--hz-danger-border);
      }

      #hz-body {
        position: relative;
        z-index: 2;
        width: 100%;
        height: calc(100% - ${CONFIG.popout.titlebarHeight}px);
        overflow: hidden;
        border-radius: 0 0 var(--hz-glass-inner-radius) var(--hz-glass-inner-radius);
        background: var(--hz-glass-body-bg);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      #${IDS.popoutImg},
      #${IDS.popoutVideo} {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: inherit;
        background: var(--hz-glass-body-bg);
      }

      #${IDS.popoutImg} {
        display: block;
      }

      #${IDS.popoutVideo} {
        display: none;
      }

      #${IDS.resize} {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
        opacity: 0.7;
        z-index: 5;
        background:
          linear-gradient(135deg, transparent 50%, var(--hz-resize-mark) 50%),
          linear-gradient(135deg, transparent 68%, var(--hz-resize-mark) 68%),
          linear-gradient(135deg, transparent 84%, var(--hz-resize-mark) 84%);
      }

      #${IDS.popoutToast},
      #${IDS.hoverToast} {
        position: fixed;
        z-index: 2147483647;
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid var(--hz-glass-border);
        background: var(--hz-toast-glass-bg);
        color: var(--hz-text);
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: var(--hz-glass-shadow);
        backdrop-filter: blur(12px) saturate(150%);
        -webkit-backdrop-filter: blur(12px) saturate(150%);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 120ms ease, transform 120ms ease;
        pointer-events: none;
      }

      #${IDS.popoutToast}.is-visible,
      #${IDS.hoverToast}.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      #${IDS.popoutToast} {
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%) translateY(6px);
      }

      #${IDS.popoutToast}.is-visible {
        transform: translateX(-50%) translateY(0);
      }

      #${IDS.hoverWrap} {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483646;
        display: none;
        pointer-events: none;
        padding: ${CONFIG.hover.padding}px;
        overflow: hidden;
        isolation: isolate;
        border-radius: var(--hz-hover-glass-radius);
        border: var(--hz-hover-glass-border-width) solid var(--hz-hover-glass-border);
        background:
          linear-gradient(
            180deg,
            var(--hz-hover-glass-top-sheen),
            transparent 34%,
            var(--hz-hover-glass-bottom-tint)
          ),
          var(--hz-hover-glass-bg);
        background-clip: padding-box;
        box-shadow: var(--hz-hover-glass-shadow);
        backdrop-filter:
          blur(var(--hz-hover-glass-blur))
          saturate(var(--hz-hover-glass-saturation));
        -webkit-backdrop-filter:
          blur(var(--hz-hover-glass-blur))
          saturate(var(--hz-hover-glass-saturation));
        transform: translate3d(-9999px, -9999px, 0);
        will-change: transform;
      }

      #${IDS.hoverWrap}::before,
      #${IDS.hoverWrap}::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
      }

      #${IDS.hoverWrap}::before {
        z-index: 2;
        box-shadow:
          inset 0 1px 0 var(--hz-hover-glass-top-sheen),
          inset 1px 0 0 var(--hz-hover-glass-side-sheen),
          inset -1px 0 0 var(--hz-hover-glass-side-sheen),
          inset 0 -1px 0 var(--hz-hover-glass-bottom-tint);
      }

      #${IDS.hoverWrap}::after {
        inset: 1px;
        z-index: 2;
        border-radius: calc(var(--hz-hover-glass-radius) - 1px);
        box-shadow: inset 0 0 0 1px var(--hz-hover-glass-inner-rim);
      }

      #${IDS.hoverWrap}.is-interactive {
        pointer-events: auto;
      }

      #${IDS.hoverImg},
      #${IDS.hoverVideo},
      #${IDS.hoverLiveHost} {
        display: block;
        max-width: none;
        max-height: none;
        position: relative;
        z-index: 1;
        border-radius: var(--hz-hover-glass-media-radius);
        background: var(--hz-image-bg);
        box-shadow: inset 0 0 0 1px var(--hz-hover-glass-content-rim);
      }

      #${IDS.hoverVideo},
      #${IDS.hoverLiveHost} {
        display: none;
      }

      #${IDS.hoverVideo} {
        object-fit: contain;
      }

      #${IDS.hoverImg} {
        object-fit: contain;
      }

      #${IDS.hoverLiveHost} {
        overflow: hidden;
      }

      #${IDS.hoverBadge} {
        position: absolute;
        top: 10px;
        right: 10px;
        display: none;
        padding: 4px 7px;
        border-radius: 999px;
        border: 1px solid var(--hz-border);
        background: var(--hz-surface-strong);
        color: var(--hz-text);
        font: 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.06em;
        z-index: 3;
      }

      #${IDS.hoverToast} {
        left: 14px;
        bottom: 14px;
      }

      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        #${IDS.backdrop},
        #${IDS.window},
        #${IDS.titlebar},
        .hz-btn,
        #${IDS.popoutToast},
        #${IDS.hoverToast},
        #${IDS.hoverWrap} {
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

        #${IDS.backdrop} {
          background: var(--hz-backdrop);
        }

        #${IDS.window} {
          background: var(--hz-glass-bg-solid);
        }
      }

      @media (prefers-reduced-transparency: reduce) {
        :root {
          --hz-backdrop: rgba(248, 250, 255, 0.82);
          --hz-glass-blur: 0px;
          --hz-glass-bg: var(--hz-glass-bg-solid);
          --hz-glass-body-bg: rgba(0, 0, 0, 0.08);
          --hz-hover-glass-blur: 0px;
          --hz-hover-glass-bg: rgba(248, 250, 255, 0.94);
          --hz-toast-glass-bg: var(--hz-glass-bg-solid);
        }

        #${IDS.backdrop},
        #${IDS.window},
        #${IDS.titlebar},
        .hz-btn,
        #${IDS.popoutToast},
        #${IDS.hoverToast},
        #${IDS.hoverWrap} {
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

        #${IDS.window}::after {
          opacity: 0.18;
        }
      }

      @media (prefers-color-scheme: dark) and (prefers-reduced-transparency: reduce) {
        :root {
          --hz-backdrop: rgba(5, 5, 8, 0.72);
          --hz-glass-body-bg: rgba(0, 0, 0, 0.48);
          --hz-hover-glass-bg: rgba(26, 28, 34, 0.94);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .hz-btn,
        #${IDS.popoutToast},
        #${IDS.hoverToast} {
          transition: none;
        }

        .hz-btn:active {
          transform: none;
        }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function buildUi() {
    const mount = document.body || document.documentElement;

    const overlay = document.createElement("div");
    overlay.id = IDS.overlay;

    const backdrop = document.createElement("div");
    backdrop.id = IDS.backdrop;

    const popoutWindow = document.createElement("div");
    popoutWindow.id = IDS.window;
    popoutWindow.setAttribute("role", "dialog");
    popoutWindow.setAttribute("aria-modal", "true");
    popoutWindow.setAttribute("aria-label", "Image popout");

    const titlebar = document.createElement("div");
    titlebar.id = IDS.titlebar;

    const title = document.createElement("div");
    title.id = IDS.title;
    title.textContent = "Image Popout";

    const copyBtn = buildButton("Copy URL", "copy");
    const openBtn = buildButton("Open", "open");
    const downloadBtn = buildButton("Download", "download");
    const closeBtn = buildButton("×", "close");
    closeBtn.id = "hz-close-btn";
    closeBtn.setAttribute("aria-label", "Close");

    const body = document.createElement("div");
    body.id = "hz-body";

    const popoutImg = document.createElement("img");
    popoutImg.id = IDS.popoutImg;
    popoutImg.alt = "";
    popoutImg.decoding = "async";

    const popoutVideo = document.createElement("video");
    popoutVideo.id = IDS.popoutVideo;
    popoutVideo.controls = true;
    popoutVideo.playsInline = true;
    popoutVideo.preload = "metadata";

    const resize = document.createElement("div");
    resize.id = IDS.resize;
    resize.setAttribute("role", "presentation");

    const popoutToast = document.createElement("div");
    popoutToast.id = IDS.popoutToast;

    titlebar.append(title, copyBtn, openBtn, downloadBtn, closeBtn);
    body.append(popoutImg, popoutVideo);
    popoutWindow.append(titlebar, body, resize);
    overlay.append(backdrop, popoutWindow, popoutToast);

    const hoverWrap = document.createElement("div");
    hoverWrap.id = IDS.hoverWrap;

    const hoverImg = document.createElement("img");
    hoverImg.id = IDS.hoverImg;
    hoverImg.alt = "";
    hoverImg.decoding = "async";
    hoverImg.loading = "eager";

    const hoverVideo = document.createElement("video");
    hoverVideo.id = IDS.hoverVideo;
    hoverVideo.controls = true;
    hoverVideo.defaultMuted = true;
    hoverVideo.muted = true;
    hoverVideo.playsInline = true;
    hoverVideo.preload = "metadata";

    const hoverLiveHost = document.createElement("div");
    hoverLiveHost.id = IDS.hoverLiveHost;

    const hoverBadge = document.createElement("div");
    hoverBadge.id = IDS.hoverBadge;
    hoverBadge.textContent = "PINNED";

    const hoverToast = document.createElement("div");
    hoverToast.id = IDS.hoverToast;

    hoverWrap.append(hoverImg, hoverVideo, hoverLiveHost, hoverBadge);
    mount.append(overlay, hoverWrap, hoverToast);

    state.ui.overlay = overlay;
    state.ui.popoutWindow = popoutWindow;
    state.ui.popoutTitle = title;
    state.ui.popoutImg = popoutImg;
    state.ui.popoutVideo = popoutVideo;
    state.ui.popoutToast = popoutToast;
    state.ui.hoverWrap = hoverWrap;
    state.ui.hoverImg = hoverImg;
    state.ui.hoverVideo = hoverVideo;
    state.ui.hoverLiveHost = hoverLiveHost;
    state.ui.hoverBadge = hoverBadge;
    state.ui.hoverToast = hoverToast;

    overlay.addEventListener("click", onOverlayClick);
    titlebar.addEventListener("pointerdown", startPopoutDrag, {
      passive: false,
    });
    resize.addEventListener("pointerdown", startPopoutResize, {
      passive: false,
    });
  }

  function buildButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hz-btn";
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function bindEvents() {
    document.addEventListener("mousemove", onDocumentMouseMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("mousedown", onDocumentMouseDown, true);
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("contextmenu", onDocumentContextMenu, true);
    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("resize", scheduleViewportChange, { passive: true });
    window.addEventListener("scroll", scheduleViewportChange, {
      capture: true,
      passive: true,
    });
    window.addEventListener("hashchange", onWindowHashChange, true);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("mouseleave", onDocumentMouseLeave, true);
  }

  function onOverlayClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.id === IDS.backdrop) {
      closePopout();
      return;
    }

    const action = target.closest("[data-action]")?.getAttribute("data-action");
    switch (action) {
      case "close":
        closePopout();
        break;
      case "open":
        openPopoutUrlInNewTab();
        break;
      case "copy":
        void copyPopoutUrl();
        break;
      case "download":
        void downloadCurrentMedia();
        break;
      default:
        break;
    }
  }

  function onDocumentClick(event) {
    if (!(event instanceof MouseEvent)) return;

    if (shouldSuppressDocumentClick()) return;
    if (isInsideUserscriptUi(event.target)) return;
    if (!isPlainPrimaryClick(event)) return;

    if (event.altKey) {
      handleAltClick(event);
      return;
    }

    // Plain clicks should pass through to the page. Pinning is keyboard-only.
  }

  function onDocumentMouseDown(event) {
    if (!(event instanceof MouseEvent)) return;

    if (!isPlainPrimaryClick(event)) {
      state.input.suppressClick = true;
      return;
    }

    if (state.input.suppressClickUntil > Date.now()) {
      state.input.suppressClick = true;
      return;
    }

    state.input.suppressClick = false;
  }

  function onDocumentContextMenu(event) {
    if (!(event instanceof MouseEvent)) return;

    // Safari can emit a delayed left-click after the context menu interaction.
    state.input.suppressClick = true;
    state.input.suppressClickUntil = Date.now() + CONTEXT_MENU_SUPPRESSION_MS;
  }

  function shouldSuppressDocumentClick() {
    const suppressClick = (
      state.input.suppressClick ||
      state.input.suppressClickUntil > Date.now()
    );

    state.input.suppressClick = false;
    state.input.suppressClickUntil = 0;
    return suppressClick;
  }

  function isPlainPrimaryClick(event) {
    return event.button === 0 && !event.ctrlKey && !event.metaKey;
  }

  function onDocumentMouseMove(event) {
    state.hover.mouseX = event.clientX;
    state.hover.mouseY = event.clientY;

    if (!state.hover.enabled || state.popout.open || state.hover.pinned) return;

    if (event.target !== state.hover.lastEventTarget) {
      state.hover.lastEventTarget = event.target;
      if (
        activateHoverCandidateAtPoint(
          event.target,
          event.clientX,
          event.clientY,
          event,
        )
      ) {
        return;
      }

      if (
        state.hover.target &&
        !pointWithinHoverTarget(event.clientX, event.clientY)
      ) {
        hideHover();
        return;
      }
    }

    if (!state.hover.target) return;

    if (
      !pointWithinHoverTarget(event.clientX, event.clientY)
    ) {
      if (
        !activateHoverCandidateAtPoint(
          event.target,
          event.clientX,
          event.clientY,
          event,
        )
      ) {
        hideHover();
      }
      return;
    }

    updateHoverPosition(event.clientX, event.clientY);
  }

  function activateHoverCandidateAtPoint(start, clientX, clientY, event = null) {
    const lookup = createMediaLookup(start, clientX, clientY, event);
    const candidate = findHoverCandidate(lookup);
    if (
      !candidate ||
      (!candidate.allowSmallTarget && !isTargetLargeEnough(candidate.element, lookup))
    ) {
      revokeTemporaryUrl(candidate?.temporaryUrl || "");
      return false;
    }

    debugLog("hover candidate", describeCandidate(candidate));
    activateHover(candidate, clientX, clientY, lookup);
    return true;
  }

  function onWindowKeyDown(event) {
    if (!(event instanceof KeyboardEvent)) return;

    if (event.key === "Escape") {
      closePopout();
      state.hover.pinned = false;
      hideHover();
      return;
    }

    const tag = event.target?.tagName || "";
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      event.target?.isContentEditable
    ) {
      return;
    }

    if (
      state.popout.open &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === "d" || event.key === "D")
    ) {
      event.preventDefault();
      if (!event.repeat) void downloadCurrentMedia();
      return;
    }

    if (event.key === "z" || event.key === "Z") {
      state.hover.enabled = !state.hover.enabled;
      state.hover.pinned = false;
      savePrefs();
      if (!state.hover.enabled) hideHover();
      showHoverToast(
        state.hover.enabled ? "Media preview: ON" : "Media preview: OFF",
      );
      return;
    }

    if (event.key === "p" || event.key === "P") {
      if (!state.hover.target) return;
      toggleHoverPinned();
    }
  }

  function onWindowPointerMove(event) {
    if (!(event instanceof PointerEvent)) return;

    if (state.popout.drag && event.pointerId === state.popout.drag.pointerId) {
      event.preventDefault();
      const nextLeft = state.popout.drag.startLeft + (
        event.clientX - state.popout.drag.startX
      );
      const nextTop = state.popout.drag.startTop + (
        event.clientY - state.popout.drag.startY
      );
      const position = clampPopoutPosition(
        nextLeft,
        nextTop,
        state.popout.drag.startWidth,
        state.popout.drag.startHeight,
      );
      setPopoutRect(position.left, position.top);
      return;
    }

    if (
      state.popout.resize &&
      event.pointerId === state.popout.resize.pointerId
    ) {
      event.preventDefault();
      const { width: vw, height: vh } = getViewport();
      const padding = CONFIG.viewportPadding;
      const maxWidth = Math.max(
        CONFIG.popout.minWidth,
        vw - state.popout.resize.startLeft - padding,
      );
      const maxHeight = Math.max(
        CONFIG.popout.minHeight,
        vh - state.popout.resize.startTop - padding,
      );

      const nextWidth = clamp(
        state.popout.resize.startWidth + (
          event.clientX - state.popout.resize.startX
        ),
        CONFIG.popout.minWidth,
        maxWidth,
      );
      const nextHeight = clamp(
        state.popout.resize.startHeight + (
          event.clientY - state.popout.resize.startY
        ),
        CONFIG.popout.minHeight,
        maxHeight,
      );

      setPopoutRect(
        state.popout.resize.startLeft,
        state.popout.resize.startTop,
        nextWidth,
        nextHeight,
      );
    }
  }

  function onWindowPointerUp(event) {
    if (!(event instanceof PointerEvent)) return;

    if (state.popout.drag && event.pointerId === state.popout.drag.pointerId) {
      releasePointerCapture(state.popout.drag.handle, event.pointerId);
      state.popout.drag = null;
      document.documentElement.style.userSelect = "";
    }

    if (
      state.popout.resize &&
      event.pointerId === state.popout.resize.pointerId
    ) {
      releasePointerCapture(state.popout.resize.handle, event.pointerId);
      state.popout.resize = null;
      document.documentElement.style.userSelect = "";
    }

    if (!state.popout.drag && !state.popout.resize) {
      removeActivePointerListeners();
    }
  }

  function onViewportChange() {
    if (state.popout.open) {
      if (state.popout.autoFit) fitPopoutToMedia();
      clampPopoutToViewport();
    }

    if (!isHoverVisible()) return;

    applyHoverSize();
    if (state.hover.pinned) return;

    state.hover.targetRect = getElementRectSnapshot(state.hover.target);
    if (
      state.hover.target &&
      pointWithinHoverTarget(state.hover.mouseX, state.hover.mouseY)
    ) {
      updateHoverPosition(state.hover.mouseX, state.hover.mouseY);
    } else {
      hideHover();
    }
  }

  function onWindowHashChange() {
    state.hover.lastEventTarget = null;
    if (!state.hover.pinned) hideHover();
  }

  function onWindowBlur() {
    stopPopoutPointerInteraction();
    if (!state.hover.pinned) hideHover();
  }

  function onDocumentMouseLeave() {
    if (!state.hover.pinned) hideHover();
  }

  function scheduleViewportChange() {
    state.hover.targetRect = null;
    if (state.viewport.changeRaf) return;

    state.viewport.changeRaf = window.requestAnimationFrame(() => {
      state.viewport.changeRaf = 0;
      onViewportChange();
    });
  }

  function handleAltClick(event) {
    if (event.defaultPrevented) return;

    const candidate = findPopoutCandidate(
      event.target,
      event.clientX,
      event.clientY,
      event,
    );
    if (!candidate) return;

    event.preventDefault();
    event.stopPropagation();

    debugLog("popout candidate", describeCandidate(candidate));
    state.hover.pinned = false;
    hideHover();
    openPopout(candidate);
  }

  function toggleHoverPinned() {
    state.hover.pinned = !state.hover.pinned;
    state.ui.hoverBadge.style.display = state.hover.pinned ? "block" : "none";
    updateHoverInteractivity();

    if (
      !state.hover.pinned &&
      state.hover.target &&
      !pointWithinHoverTarget(state.hover.mouseX, state.hover.mouseY)
    ) {
      hideHover();
    }

    showHoverToast(state.hover.pinned ? "Pinned preview" : "Unpinned");
  }

  function activateHover(candidate, mouseX, mouseY, lookup = null) {
    ensureUi();

    const previewMode = candidate.previewMode || "image";
    const candidateUrl = candidate.url || "";
    const fallbackUrl = candidate.fallbackUrl || "";
    const temporaryUrl = candidate.temporaryUrl || "";
    const sameMedia = isSameHoverMedia(
      previewMode,
      candidateUrl,
      fallbackUrl,
      candidate.liveElement,
    );

    state.hover.url = candidateUrl;
    state.hover.previewMode = previewMode;
    state.hover.fallbackUrl = fallbackUrl;
    replaceHoverTemporaryUrl(temporaryUrl);
    state.hover.videoCurrentTime = clamp(
      Number(candidate.currentTime) || 0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    state.hover.videoShouldPlay = candidate.shouldPlay === true;
    state.hover.mouseX = mouseX;
    state.hover.mouseY = mouseY;

    state.ui.hoverBadge.style.display = state.hover.pinned ? "block" : "none";
    state.ui.hoverWrap.style.display = "block";
    updateHoverInteractivity();

    if (previewMode === "live") {
      setHoverTarget(attachHoverLiveElement(candidate));
    } else if (previewMode === "video") {
      setHoverTarget(candidate.hoverTarget || candidate.element, lookup);
      if (
        sameMedia &&
        state.ui.hoverVideo.src === candidateUrl &&
        state.hover.naturalW &&
        state.hover.naturalH
      ) {
        showHoverPreviewMode("video");
        applyHoverSize();
      } else {
        setHoverVideoCandidate(candidate);
      }
    } else {
      setHoverTarget(candidate.hoverTarget || candidate.element, lookup);
      if (
        !sameMedia ||
        state.ui.hoverImg.src !== candidateUrl ||
        !state.hover.naturalW ||
        !state.hover.naturalH
      ) {
        setHoverImageUrl(candidateUrl, candidate);
      } else {
        showHoverPreviewMode("image");
        clearHoverVideo();
        teardownHoverLiveElement();
        applyHoverSize();
      }
    }

    updateHoverPosition(mouseX, mouseY);
  }

  function isSameHoverMedia(previewMode, url, fallbackUrl, liveElement) {
    if (!isHoverVisible()) return false;
    if (state.hover.previewMode !== previewMode) return false;
    if (state.hover.url !== url) return false;
    if (state.hover.fallbackUrl !== fallbackUrl) return false;

    if (previewMode === "live") {
      return state.hover.live?.element === liveElement;
    }

    return true;
  }

  function hideHover() {
    cancelHoverPositionFrame();
    if (state.ui.ready) {
      teardownHoverLiveElement();
      clearHoverVideo();
      showHoverPreviewMode("image");
    }

    resetHoverCandidateState();

    if (!state.ui.ready) {
      return;
    }

    state.ui.hoverBadge.style.display = "none";
    state.ui.hoverWrap.style.display = "none";
    state.ui.hoverWrap.style.transform = "translate3d(-9999px, -9999px, 0)";
    updateHoverInteractivity();
  }

  function resetHoverCandidateState() {
    state.hover.target = null;
    state.hover.targetRect = null;
    state.hover.url = "";
    state.hover.previewMode = "image";
    state.hover.fallbackUrl = "";
    replaceHoverTemporaryUrl("");
    state.hover.videoCurrentTime = 0;
    state.hover.videoShouldPlay = false;
    state.hover.naturalW = 0;
    state.hover.naturalH = 0;
    state.hover.lastEventTarget = null;
  }

  function replaceHoverTemporaryUrl(url) {
    if (state.hover.temporaryUrl && state.hover.temporaryUrl !== url) {
      revokeTemporaryUrl(state.hover.temporaryUrl);
    }

    state.hover.temporaryUrl = url || "";
  }

  function replacePopoutTemporaryUrl(url) {
    if (state.popout.temporaryUrl && state.popout.temporaryUrl !== url) {
      revokeTemporaryUrl(state.popout.temporaryUrl);
    }

    state.popout.temporaryUrl = url || "";
  }

  function revokeTemporaryUrl(url) {
    if (!url || !url.startsWith("blob:")) return;

    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  function isHoverVisible() {
    return state.ui.ready && state.ui.hoverWrap.style.display === "block";
  }

  function setHoverImageUrl(url, candidate = null) {
    const token = ++state.hover.loadToken;
    const img = state.ui.hoverImg;
    const fallbackSize = getCandidateFallbackSize(candidate);

    showHoverPreviewMode("image");
    clearHoverVideo();
    teardownHoverLiveElement();
    state.hover.naturalW = 0;
    state.hover.naturalH = 0;
    applyHoverSize();

    img.onload = () => {
      if (token !== state.hover.loadToken) return;
      const size = getLoadedImageSize(img, fallbackSize);
      state.hover.naturalW = size.width;
      state.hover.naturalH = size.height;
      applyHoverSize();
      if (isHoverVisible()) {
        updateHoverPosition(state.hover.mouseX, state.hover.mouseY);
      }
    };

    img.onerror = () => {
      if (token !== state.hover.loadToken) return;
      hideHover();
    };

    if (img.src === url && img.complete && img.naturalWidth) {
      const size = getLoadedImageSize(img, fallbackSize);
      state.hover.naturalW = size.width;
      state.hover.naturalH = size.height;
      applyHoverSize();
      updateHoverPosition(state.hover.mouseX, state.hover.mouseY);
      return;
    }

    img.removeAttribute("src");
    img.src = url;
  }

  function setHoverVideoCandidate(candidate) {
    const token = ++state.hover.loadToken;
    const video = state.ui.hoverVideo;

    showHoverPreviewMode("video");
    teardownHoverLiveElement();
    clearHoverVideo();
    state.hover.naturalW = 0;
    state.hover.naturalH = 0;
    applyHoverSize();

    video.onloadedmetadata = () => {
      if (token !== state.hover.loadToken) return;

      state.hover.naturalW = video.videoWidth || CONFIG.hover.fallbackWidth;
      state.hover.naturalH = video.videoHeight || CONFIG.hover.fallbackHeight;
      applyHoverSize();

      if (Number.isFinite(state.hover.videoCurrentTime)) {
        try {
          video.currentTime = Math.min(
            state.hover.videoCurrentTime,
            Number.isFinite(video.duration)
              ? Math.max(0, video.duration - 0.05)
              : state.hover.videoCurrentTime,
          );
        } catch {}
      }

      if (state.hover.videoShouldPlay) {
        video.play().catch(() => {});
      }

      if (isHoverVisible()) {
        updateHoverPosition(state.hover.mouseX, state.hover.mouseY);
      }
    };

    video.onerror = () => {
      if (token !== state.hover.loadToken) return;
      if (candidate.fallbackUrl) {
        setHoverImageUrl(candidate.fallbackUrl);
      } else {
        hideHover();
      }
    };

    video.src = candidate.url;
    video.load();
  }

  function clearHoverVideo() {
    const video = state.ui.hoverVideo;
    if (!video) return;

    video.onloadedmetadata = null;
    video.onerror = null;
    clearVideoSource(video);
  }

  function attachHoverLiveElement(candidate) {
    const liveElement = candidate.liveElement;
    if (!(liveElement instanceof HTMLElement)) {
      if (candidate.fallbackUrl) {
        setHoverImageUrl(candidate.fallbackUrl);
      } else {
        hideHover();
      }
      return candidate.hoverTarget || candidate.element;
    }

    showHoverPreviewMode("live");
    clearHoverVideo();

    if (state.hover.live?.element !== liveElement) {
      teardownHoverLiveElement();

      const rect = liveElement.getBoundingClientRect();
      const placeholder = document.createElement("div");
      placeholder.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      placeholder.style.height = `${Math.max(1, Math.round(rect.height))}px`;
      placeholder.style.pointerEvents = "none";

      const originalParent = liveElement.parentNode;
      const originalNextSibling = liveElement.nextSibling;
      const originalStyle = liveElement.getAttribute("style");
      const originalControls = (
        liveElement instanceof HTMLVideoElement ? liveElement.controls : null
      );
      const hadControlsAttribute = liveElement.hasAttribute("controls");

      if (!(originalParent instanceof Node)) {
        if (candidate.fallbackUrl) {
          setHoverImageUrl(candidate.fallbackUrl);
        } else {
          hideHover();
        }
        return candidate.hoverTarget || candidate.element;
      }

      originalParent.insertBefore(placeholder, liveElement);
      state.ui.hoverLiveHost.appendChild(liveElement);

      if (liveElement instanceof HTMLVideoElement) {
        liveElement.controls = true;
      }

      liveElement.style.display = "block";
      liveElement.style.width = "100%";
      liveElement.style.height = "100%";
      liveElement.style.maxWidth = "none";
      liveElement.style.maxHeight = "none";
      liveElement.style.objectFit = "contain";
      liveElement.style.position = "static";
      liveElement.style.inset = "auto";
      liveElement.style.transform = "none";

      state.hover.live = {
        element: liveElement,
        placeholder,
        originalParent,
        originalNextSibling,
        originalStyle,
        originalControls,
        hadControlsAttribute,
      };

      if (liveElement instanceof HTMLVideoElement) {
        state.hover.naturalW = (
          liveElement.videoWidth ||
          rect.width ||
          CONFIG.hover.fallbackWidth
        );
        state.hover.naturalH = (
          liveElement.videoHeight ||
          rect.height ||
          CONFIG.hover.fallbackHeight
        );
      } else {
        state.hover.naturalW = rect.width || CONFIG.hover.fallbackWidth;
        state.hover.naturalH = rect.height || CONFIG.hover.fallbackHeight;
      }
    }

    applyHoverSize();
    return state.hover.live?.placeholder || candidate.hoverTarget || candidate.element;
  }

  function teardownHoverLiveElement() {
    const live = state.hover.live;
    if (!live) return;

    const {
      element,
      placeholder,
      originalParent,
      originalNextSibling,
      originalStyle,
      originalControls,
      hadControlsAttribute,
    } = live;

    if (placeholder?.parentNode) {
      placeholder.parentNode.insertBefore(element, placeholder);
      placeholder.remove();
    } else if (originalParent?.isConnected) {
      originalParent.insertBefore(element, originalNextSibling || null);
    }

    if (typeof originalStyle === "string" && originalStyle) {
      element.setAttribute("style", originalStyle);
    } else {
      element.removeAttribute("style");
    }

    if (element instanceof HTMLVideoElement) {
      if (typeof originalControls === "boolean") {
        element.controls = originalControls;
      }

      if (hadControlsAttribute) {
        element.setAttribute("controls", "");
      } else {
        element.removeAttribute("controls");
      }
    }

    state.ui.hoverLiveHost.textContent = "";
    state.hover.live = null;
  }

  function showHoverPreviewMode(mode) {
    state.ui.hoverImg.style.display = mode === "image" ? "block" : "none";
    state.ui.hoverVideo.style.display = mode === "video" ? "block" : "none";
    state.ui.hoverLiveHost.style.display = mode === "live" ? "block" : "none";
  }

  function updateHoverInteractivity() {
    state.hover.interactive = (
      state.hover.pinned &&
      state.hover.previewMode !== "image"
    );
    state.ui.hoverWrap.classList.toggle(
      "is-interactive",
      state.hover.interactive,
    );
  }

  function applyHoverSize() {
    const naturalW = state.hover.naturalW || CONFIG.hover.fallbackWidth;
    const naturalH = state.hover.naturalH || CONFIG.hover.fallbackHeight;
    const size = computeHoverSize(naturalW, naturalH);

    state.ui.hoverImg.style.width = `${size.width}px`;
    state.ui.hoverImg.style.height = `${size.height}px`;
    state.ui.hoverVideo.style.width = `${size.width}px`;
    state.ui.hoverVideo.style.height = `${size.height}px`;
    state.ui.hoverLiveHost.style.width = `${size.width}px`;
    state.ui.hoverLiveHost.style.height = `${size.height}px`;

    const chrome = (CONFIG.hover.padding * 2) + (CONFIG.hover.borderWidth * 2);
    state.hover.wrapW = size.width + chrome;
    state.hover.wrapH = size.height + chrome;
  }

  function computeHoverSize(naturalW, naturalH) {
    const { width: vw, height: vh } = getViewport();
    const maxWrapW = Math.min(
      vw * CONFIG.hover.maxViewportFraction,
      vw - (CONFIG.hover.viewportPadding * 2),
    );
    const maxWrapH = Math.min(
      vh * CONFIG.hover.maxViewportFraction,
      vh - (CONFIG.hover.viewportPadding * 2),
    );
    const chrome = (CONFIG.hover.padding * 2) + (CONFIG.hover.borderWidth * 2);
    const maxImgW = Math.max(40, Math.floor(maxWrapW - chrome));
    const maxImgH = Math.max(40, Math.floor(maxWrapH - chrome));

    const safeW = Math.max(1, naturalW);
    const safeH = Math.max(1, naturalH);
    const scale = Math.min(maxImgW / safeW, maxImgH / safeH, 1);

    return {
      width: Math.max(40, Math.floor(safeW * scale)),
      height: Math.max(40, Math.floor(safeH * scale)),
    };
  }

  function updateHoverPosition(mouseX, mouseY) {
    state.hover.mouseX = mouseX;
    state.hover.mouseY = mouseY;
    if (!isHoverVisible()) return;
    if (state.hover.positionRaf) return;

    state.hover.positionRaf = window.requestAnimationFrame(() => {
      state.hover.positionRaf = 0;
      if (!isHoverVisible()) return;
      positionHoverNow(state.hover.mouseX, state.hover.mouseY);
    });
  }

  function cancelHoverPositionFrame() {
    if (!state.hover.positionRaf) return;
    window.cancelAnimationFrame(state.hover.positionRaf);
    state.hover.positionRaf = 0;
  }

  function positionHoverNow(mouseX, mouseY) {
    const { width: vw, height: vh } = getViewport();
    const pad = CONFIG.hover.viewportPadding;
    const offset = CONFIG.hover.offset;
    const width = state.hover.wrapW;
    const height = state.hover.wrapH;

    let left = mouseX + offset;
    let top = mouseY + offset;

    if (left + width + pad > vw) left = mouseX - offset - width;
    if (top + height + pad > vh) top = mouseY - offset - height;

    left = clamp(left, pad, Math.max(pad, vw - width - pad));
    top = clamp(top, pad, Math.max(pad, vh - height - pad));

    state.ui.hoverWrap.style.transform = (
      `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    );
  }

  function openPopout(media) {
    const {
      mediaUrl,
      mediaType,
      fallbackW,
      fallbackH,
      temporaryUrl,
    } = getPopoutMediaDescriptor(media);

    if (!mediaUrl) return;
    ensureUi();

    state.popout.open = true;
    state.popout.url = mediaUrl;
    state.popout.mediaType = mediaType;
    state.popout.autoFit = true;
    state.popout.fallbackW = fallbackW;
    state.popout.fallbackH = fallbackH;
    replacePopoutTemporaryUrl(temporaryUrl);
    state.ui.popoutTitle.textContent = mediaUrl;
    state.ui.overlay.classList.add("is-open");
    state.ui.popoutToast.classList.remove("is-visible");

    const initialRect = getInitialPopoutRect();
    setPopoutRect(
      initialRect.left,
      initialRect.top,
      initialRect.width,
      initialRect.height,
    );

    const token = ++state.popout.loadToken;
    clearPopoutLoadHandlers();

    if (mediaType === "video") {
      loadPopoutVideo(mediaUrl, token);
      return;
    }

    loadPopoutImage(mediaUrl, token);
  }

  function getPopoutMediaDescriptor(media) {
    const mediaUrl =
      typeof media === "string"
        ? media
        : typeof media?.url === "string"
          ? media.url
          : "";
    const mediaType =
      typeof media === "object" && media?.type === "video" ? "video" : "image";
    const fallbackW = typeof media?.fallbackW === "number" ? media.fallbackW : 0;
    const fallbackH = typeof media?.fallbackH === "number" ? media.fallbackH : 0;
    const temporaryUrl =
      typeof media?.temporaryUrl === "string" ? media.temporaryUrl : "";

    return { mediaUrl, mediaType, fallbackW, fallbackH, temporaryUrl };
  }

  function clearPopoutLoadHandlers() {
    const img = state.ui.popoutImg;
    const video = state.ui.popoutVideo;

    img.onload = null;
    img.onerror = null;
    video.onloadedmetadata = null;
    video.onerror = null;
  }

  function loadPopoutVideo(mediaUrl, token) {
    const img = state.ui.popoutImg;
    const video = state.ui.popoutVideo;

    img.style.display = "none";
    img.removeAttribute("src");

    video.style.display = "block";
    clearVideoSource(video);
    video.src = mediaUrl;

    video.onloadedmetadata = () => {
      if (token !== state.popout.loadToken) return;
      if (state.popout.autoFit) fitPopoutToMedia();
    };

    video.onerror = () => {
      if (token !== state.popout.loadToken) return;
      showPopoutToast("Failed to load video");
    };

    video.load();
  }

  function loadPopoutImage(mediaUrl, token) {
    const img = state.ui.popoutImg;
    const video = state.ui.popoutVideo;

    video.style.display = "none";
    clearVideoSource(video);
    img.style.display = "block";

    img.onload = () => {
      if (token !== state.popout.loadToken) return;
      if (state.popout.autoFit) fitPopoutToMedia();
    };

    img.onerror = () => {
      if (token !== state.popout.loadToken) return;
      showPopoutToast("Failed to load image");
    };

    if (img.src === mediaUrl && img.complete && img.naturalWidth) {
      fitPopoutToMedia();
      return;
    }

    img.removeAttribute("src");
    img.src = mediaUrl;
  }

  function clearVideoSource(video) {
    if (!(video instanceof HTMLVideoElement)) return;

    const hadSource = Boolean(video.getAttribute("src") || video.currentSrc);
    video.pause();
    if (!hadSource) return;

    video.removeAttribute("src");
    video.load();
  }

  function closePopout() {
    if (!state.popout.open) return;
    state.popout.open = false;
    stopPopoutPointerInteraction();
    state.ui.popoutVideo.pause();
    state.ui.overlay.classList.remove("is-open");
    state.ui.popoutToast.classList.remove("is-visible");
    document.documentElement.style.userSelect = "";
    replacePopoutTemporaryUrl("");
    state.popout.fallbackW = 0;
    state.popout.fallbackH = 0;
  }

  function openPopoutUrlInNewTab() {
    if (!state.popout.url) return;
    window.open(state.popout.url, "_blank", "noopener,noreferrer");
  }

  async function copyPopoutUrl() {
    if (!state.popout.url) return;

    try {
      await navigator.clipboard.writeText(state.popout.url);
      showPopoutToast("Copied URL");
    } catch {
      window.prompt("Copy image URL:", state.popout.url);
    }
  }

  async function downloadCurrentMedia() {
    const url = getCurrentPopoutMediaUrl();
    if (!url) return;

    const fallbackName = buildDownloadFilename(url, "");
    try {
      await runGMDownload(url, fallbackName);
      showPopoutToast("Download started");
      return;
    } catch {}

    try {
      const { blob, contentType } = await fetchBlobViaGM(url);
      const filename = buildDownloadFilename(url, contentType);
      downloadBlobToDisk(blob, filename);
      showPopoutToast("Downloaded");
    } catch (error) {
      console.error("[Image Popout] Download failed:", error);
      showPopoutToast("Download failed");
    }
  }

  function getCurrentPopoutMediaUrl() {
    if (!state.popout.open || !state.popout.url) return "";
    if (state.popout.mediaType === "video") {
      return pickBestVideoUrl(state.ui.popoutVideo) || resolveUrl(state.popout.url);
    }
    return resolveUrl(state.popout.url);
  }

  function inferExtensionFromContentType(contentType) {
    if (!contentType) return "";
    const normalized = String(contentType).toLowerCase().split(";")[0].trim();
    return EXT_BY_CONTENT_TYPE[normalized] || "";
  }

  function inferExtensionFromUrl(url) {
    if (!url) return "";

    try {
      const parsed = new URL(url, window.location.href);
      const pathExtMatch = parsed.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
      if (pathExtMatch) {
        const ext = pathExtMatch[1];
        if (KNOWN_EXTENSIONS.has(ext)) return ext === "jpg" ? "jpeg" : ext;
      }

      for (const key of ["ext", "extension", "format", "mime", "name"]) {
        const value = parsed.searchParams.get(key);
        if (!value) continue;
        const normalized = value
          .toLowerCase()
          .replace(/^image\//, "")
          .replace(/^video\//, "");
        if (KNOWN_EXTENSIONS.has(normalized)) {
          return normalized === "jpg" ? "jpeg" : normalized;
        }
      }
    } catch {}

    return "";
  }

  function parseContentTypeFromHeaders(headers) {
    if (!headers) return "";
    const match = String(headers).match(/^\s*content-type\s*:\s*([^\r\n]+)/im);
    return match ? match[1].trim() : "";
  }

  function buildDownloadBaseName() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const host = (window.location.hostname || "site").replace(
      /[^a-z0-9.-]+/gi,
      "_",
    );
    return `hz_${host}_${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
  }

  function buildDownloadFilename(url, contentType) {
    const ext =
      inferExtensionFromContentType(contentType) ||
      inferExtensionFromUrl(url) ||
      "bin";
    return `${buildDownloadBaseName()}.${ext}`;
  }

  function runGMDownload(url, name) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== "function") {
        reject(new Error("GM_download unavailable"));
        return;
      }

      try {
        GM_download({
          url,
          name,
          saveAs: false,
          onload: () => resolve(),
          onerror: (error) => reject(error || new Error("GM_download failed")),
          ontimeout: () => reject(new Error("GM_download timeout")),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function fetchBlobViaGM(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }

      try {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType: "blob",
          anonymous: false,
          onload: (response) => {
            const status = Number(response?.status) || 0;
            if (status && (status < 200 || status >= 400)) {
              reject(new Error(`Request failed with status ${status}`));
              return;
            }

            const contentType = parseContentTypeFromHeaders(
              response?.responseHeaders || "",
            );
            let blob = response?.response;
            if (!(blob instanceof Blob) && blob != null) {
              blob = new Blob([blob], {
                type: contentType || "application/octet-stream",
              });
            }

            if (!(blob instanceof Blob)) {
              reject(new Error("No blob response"));
              return;
            }

            resolve({ blob, contentType: contentType || blob.type || "" });
          },
          onerror: (error) =>
            reject(error || new Error("GM_xmlhttpRequest failed")),
          ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout")),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function downloadBlobToDisk(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    (document.body || document.documentElement).appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      link.remove();
    }, 1000);
  }

  function showHoverToast(message) {
    ensureUi();
    showToast(
      state.ui.hoverToast,
      "hover",
      message,
      900,
    );
  }

  function showPopoutToast(message) {
    ensureUi();
    showToast(
      state.ui.popoutToast,
      "popout",
      message,
      1200,
    );
  }

  function showToast(element, type, message, duration) {
    if (!element) return;

    const owner = type === "hover" ? state.hover : state.popout;

    element.textContent = message;
    element.classList.add("is-visible");
    window.clearTimeout(owner.toastTimer);
    owner.toastTimer = window.setTimeout(() => {
      element.classList.remove("is-visible");
    }, duration);
  }

  function startPopoutDrag(event) {
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0) return;
    if (!state.popout.open) return;

    const target = event.target;
    if (target instanceof Element && target.closest(".hz-btn")) return;

    const rect = getPopoutRect();
    if (!rect) return;

    event.preventDefault();
    state.popout.autoFit = false;
    document.documentElement.style.userSelect = "none";

    state.popout.drag = {
      handle: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height,
    };

    addActivePointerListeners();
    capturePointer(event.currentTarget, event.pointerId);
  }

  function startPopoutResize(event) {
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0) return;
    if (!state.popout.open) return;

    const rect = getPopoutRect();
    if (!rect) return;

    event.preventDefault();
    state.popout.autoFit = false;
    document.documentElement.style.userSelect = "none";

    state.popout.resize = {
      handle: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startLeft: rect.left,
      startTop: rect.top,
    };

    addActivePointerListeners();
    capturePointer(event.currentTarget, event.pointerId);
  }

  function addActivePointerListeners() {
    if (state.popout.pointerListenersActive) return;

    state.popout.pointerListenersActive = true;
    window.addEventListener("pointermove", onWindowPointerMove, true);
    window.addEventListener("pointerup", onWindowPointerUp, true);
  }

  function removeActivePointerListeners() {
    if (!state.popout.pointerListenersActive) return;

    state.popout.pointerListenersActive = false;
    window.removeEventListener("pointermove", onWindowPointerMove, true);
    window.removeEventListener("pointerup", onWindowPointerUp, true);
  }

  function stopPopoutPointerInteraction() {
    if (state.popout.drag) {
      releasePointerCapture(
        state.popout.drag.handle,
        state.popout.drag.pointerId,
      );
      state.popout.drag = null;
    }

    if (state.popout.resize) {
      releasePointerCapture(
        state.popout.resize.handle,
        state.popout.resize.pointerId,
      );
      state.popout.resize = null;
    }

    document.documentElement.style.userSelect = "";
    removeActivePointerListeners();
  }

  function capturePointer(handle, pointerId) {
    if (!(handle instanceof Element)) return;
    try {
      handle.setPointerCapture(pointerId);
    } catch {}
  }

  function releasePointerCapture(handle, pointerId) {
    if (!(handle instanceof Element)) return;
    try {
      handle.releasePointerCapture(pointerId);
    } catch {}
  }

  function fitPopoutToMedia() {
    const isVideo = state.popout.mediaType === "video";
    const media = isVideo ? state.ui.popoutVideo : state.ui.popoutImg;
    if (!media) return;

    const { width: vw, height: vh } = getViewport();
    const pad = CONFIG.viewportPadding;
    const maxWidth = Math.max(
      CONFIG.popout.minWidth,
      Math.floor(vw * CONFIG.popout.maxViewportFraction),
    );
    const maxHeight = Math.max(
      CONFIG.popout.minHeight,
      Math.floor(vh * CONFIG.popout.maxViewportFraction),
    );
    const maxBodyHeight = Math.max(
      80,
      maxHeight - CONFIG.popout.titlebarHeight,
    );

    const naturalW = Math.max(
      1,
      isVideo
        ? media.videoWidth || maxWidth
        : media.naturalWidth || state.popout.fallbackW || maxWidth,
    );
    const naturalH = Math.max(
      1,
      isVideo
        ? media.videoHeight || maxBodyHeight
        : media.naturalHeight || state.popout.fallbackH || maxBodyHeight,
    );
    const scale = Math.min(maxWidth / naturalW, maxBodyHeight / naturalH, 1);

    const width = clamp(
      Math.floor(naturalW * scale),
      CONFIG.popout.minWidth,
      vw - (pad * 2),
    );
    const bodyHeight = clamp(
      Math.floor(naturalH * scale),
      80,
      vh - (pad * 2) - CONFIG.popout.titlebarHeight,
    );
    const height = clamp(
      bodyHeight + CONFIG.popout.titlebarHeight,
      CONFIG.popout.minHeight,
      vh - (pad * 2),
    );

    const left = Math.round((vw - width) / 2);
    const top = Math.round((vh - height) / 2);
    setPopoutRect(left, top, width, height);
    clampPopoutToViewport();
  }

  function getInitialPopoutRect() {
    const { width: vw, height: vh } = getViewport();
    const pad = CONFIG.viewportPadding;
    const width = clamp(
      Math.floor(vw * 0.68),
      CONFIG.popout.minWidth,
      vw - (pad * 2),
    );
    const height = clamp(
      Math.floor(vh * 0.68),
      CONFIG.popout.minHeight,
      vh - (pad * 2),
    );

    return {
      left: Math.round((vw - width) / 2),
      top: Math.round((vh - height) / 2),
      width,
      height,
    };
  }

  function getPopoutRect() {
    const popoutWindow = state.ui.popoutWindow;
    if (!popoutWindow) return null;
    return popoutWindow.getBoundingClientRect();
  }

  function setPopoutRect(left, top, width, height) {
    const popoutWindow = state.ui.popoutWindow;
    if (!popoutWindow) return;

    if (typeof left === "number") popoutWindow.style.left = `${Math.round(left)}px`;
    if (typeof top === "number") popoutWindow.style.top = `${Math.round(top)}px`;
    if (typeof width === "number") popoutWindow.style.width = `${Math.round(width)}px`;
    if (typeof height === "number") popoutWindow.style.height = `${Math.round(height)}px`;
  }

  function clampPopoutToViewport() {
    const rect = getPopoutRect();
    if (!rect) return;

    const { width: vw, height: vh } = getViewport();
    const padding = CONFIG.viewportPadding;
    const width = clamp(rect.width, 1, vw - (padding * 2));
    const height = clamp(rect.height, 1, vh - (padding * 2));
    const position = clampPopoutPosition(rect.left, rect.top, width, height);

    setPopoutRect(position.left, position.top, width, height);
  }

  function clampPopoutPosition(left, top, width, height) {
    const { width: vw, height: vh } = getViewport();
    const padding = CONFIG.viewportPadding;
    const clampedWidth = clamp(width, 1, vw - (padding * 2));
    const clampedHeight = clamp(height, 1, vh - (padding * 2));

    return {
      left: clamp(
        left,
        padding,
        Math.max(padding, vw - clampedWidth - padding),
      ),
      top: clamp(
        top,
        padding,
        Math.max(padding, vh - clampedHeight - padding),
      ),
    };
  }

  function findImageCandidate(lookup) {
    const { path } = lookup;

    for (const element of path) {
      if (element instanceof HTMLImageElement) {
        const candidate = buildImageCandidate(element);
        if (candidate) return candidate;
      }

      const inlineSvgCandidate = buildInlineSvgCandidate(element, lookup);
      if (inlineSvgCandidate) return inlineSvgCandidate;
    }

    for (const element of path) {
      const nestedImage = findNestedImageAtPoint(element, lookup);
      if (nestedImage) {
        const candidate = buildImageCandidate(nestedImage);
        if (candidate) return candidate;
      }

      if (element.matches?.("a[href]")) {
        const href = element.getAttribute("href") || "";
        const linkedImageUrl = pickLinkedImageUrl(href, "", element);
        const candidate = buildUrlImageCandidate(element, linkedImageUrl, {
          lookup,
          mimeType: element.getAttribute("type") || "",
        });
        if (candidate) {
          candidate.allowSmallTarget = candidate.kind === "svg";
          return candidate;
        }
      }

      if (element.matches?.(BACKGROUND_IMAGE_SELECTOR)) {
        const backgroundUrl = getBackgroundImageUrl(element);
        const candidate = buildUrlImageCandidate(element, backgroundUrl, {
          lookup,
        });
        if (candidate) return candidate;
      }
    }

    return null;
  }

  function findHoverCandidate(lookup) {
    const { path } = lookup;
    if (!path.length) return null;

    const siteCandidate = findSiteMediaCandidate(lookup, true);
    if (siteCandidate) return siteCandidate;

    const videoCandidate = findHoverVideoCandidate(path);
    if (videoCandidate) return videoCandidate;

    const imageCandidate = findImageCandidate(lookup);
    if (imageCandidate) {
      return { ...imageCandidate, previewMode: "image" };
    }

    return null;
  }

  function findPopoutCandidate(start, clientX, clientY, event = null) {
    const lookup = createMediaLookup(start, clientX, clientY, event);
    const { path } = lookup;
    if (!path.length) return null;

    const siteCandidate = findSiteMediaCandidate(lookup, false);
    if (siteCandidate) return siteCandidate;

    const videoCandidate = findPopoutVideoCandidate(path);
    if (videoCandidate) return videoCandidate;

    const imageCandidate = findImageCandidate(lookup);
    if (imageCandidate) {
      return { ...imageCandidate, type: "image" };
    }

    return null;
  }

  function findSiteMediaCandidate(lookup, forHover) {
    if (isOnlyFansHost()) {
      const onlyFansCandidate = findOnlyFansMediaCandidate(
        lookup,
        forHover,
      );
      if (onlyFansCandidate) return onlyFansCandidate;
    }

    return null;
  }

  function isOnlyFansHost() {
    try {
      return ONLYFANS_HOST_PATTERN.test(window.location.hostname || "");
    } catch {
      return false;
    }
  }

  function findOnlyFansMediaCandidate(lookup, forHover) {
    const containers = collectOnlyFansMediaContainers(lookup);

    for (const container of containers) {
      const video = findBestNestedMediaElement(
        container,
        "video",
        lookup,
      );
      if (video instanceof HTMLVideoElement) {
        const candidate = forHover
          ? buildHoverVideoCandidate(video)
          : buildPopoutVideoCandidate(video);
        if (candidate) {
          return withOnlyFansContainer(candidate, container, forHover);
        }
      }

      const image = findBestNestedMediaElement(
        container,
        "img",
        lookup,
      );
      if (image instanceof HTMLImageElement) {
        const candidate = buildImageCandidate(image);
        if (candidate) {
          return withOnlyFansContainer(candidate, container, forHover);
        }
      }

      const backgroundUrl = getBackgroundImageUrl(container);
      if (backgroundUrl) {
        const candidate = buildUrlImageCandidate(container, backgroundUrl, {
          lookup,
        });
        if (!candidate) continue;
        return withOnlyFansContainer(
          candidate,
          container,
          forHover,
        );
      }
    }

    return null;
  }

  function withOnlyFansContainer(candidate, container, forHover) {
    if (forHover) {
      return {
        ...candidate,
        element: container,
        hoverTarget: container,
        previewMode: candidate.previewMode || "image",
      };
    }

    return {
      ...candidate,
      element: container,
      type: candidate.type || "image",
    };
  }

  function collectOnlyFansMediaContainers(lookup) {
    const { path } = lookup;
    const containers = [];
    const seen = new Set();

    const push = (element) => {
      if (!(element instanceof Element) || seen.has(element)) return;
      if (!shouldSearchOnlyFansContainer(element, lookup)) return;
      seen.add(element);
      containers.push(element);
    };

    for (const element of path) {
      if (!(element instanceof Element)) continue;

      push(element);

      const closest = element.closest?.(ONLYFANS_MEDIA_CONTAINER_SELECTOR);
      push(closest);
    }

    return containers;
  }

  function shouldSearchOnlyFansContainer(element, lookup) {
    if (!(element instanceof Element)) return false;
    if (element === document.documentElement || element === document.body) return false;

    const rect = getElementRect(element, lookup);
    if (!rect) return false;
    if (!pointWithinRect(rect, lookup.clientX, lookup.clientY)) return false;
    if (rect.width < CONFIG.minTargetPixels || rect.height < CONFIG.minTargetPixels) {
      return false;
    }

    const { width: vw, height: vh } = getViewport();
    const tooLargeToBeMedia = rect.width > vw * 1.25 || rect.height > vh * 1.75;
    if (tooLargeToBeMedia && !element.matches?.(ONLYFANS_MEDIA_CONTAINER_SELECTOR)) {
      return false;
    }

    return true;
  }

  function findBestNestedMediaElement(container, selector, lookup) {
    if (!(container instanceof Element)) return null;

    let bestElement = null;
    let bestArea = -1;

    const push = (element) => {
      if (!(element instanceof Element)) return;
      const rect = getVisibleMediaRect(element, lookup);
      if (!rect || !pointWithinRect(rect, lookup.clientX, lookup.clientY)) return;

      const area = getRectArea(rect);
      if (area > bestArea) {
        bestArea = area;
        bestElement = element;
      }
    };

    if (container.matches?.(selector)) push(container);
    for (const element of querySelectorAllCached(container, selector, lookup)) {
      push(element);
    }

    return bestElement;
  }

  function getVisibleMediaRect(element, lookup = null) {
    if (!(element instanceof Element)) return null;
    if (lookup?.visibleMedia?.has(element)) {
      return lookup.visibleMedia.get(element);
    }

    let visibleRect = null;
    const rect = getElementRect(element, lookup);
    if (
      rect &&
      rect.width >= CONFIG.minTargetPixels &&
      rect.height >= CONFIG.minTargetPixels
    ) {
      visibleRect = rect;
      try {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          visibleRect = null;
        }
      } catch {}
    }

    lookup?.visibleMedia?.set(element, visibleRect);
    return visibleRect;
  }

  function getRectArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function buildPopoutVideoCandidate(video) {
    const videoUrl = pickBestVideoUrl(video);
    if (videoUrl && isReplayableHoverVideoUrl(videoUrl)) {
      return { element: video, type: "video", url: videoUrl };
    }

    const fallbackUrl = pickVideoPreviewUrl(video);
    if (fallbackUrl) {
      return { element: video, type: "image", url: fallbackUrl };
    }

    if (videoUrl) {
      return { element: video, type: "video", url: videoUrl };
    }

    return null;
  }

  function findHoverVideoCandidate(path) {
    for (const element of path) {
      if (element instanceof HTMLVideoElement) {
        const candidate = buildHoverVideoCandidate(element);
        if (candidate) return candidate;
      }

      const linkedCandidate = buildLinkedVideoCandidate(element, true);
      if (linkedCandidate) return linkedCandidate;
    }

    return null;
  }

  function findPopoutVideoCandidate(path) {
    for (const element of path) {
      if (element instanceof HTMLVideoElement) {
        const videoUrl = pickBestVideoUrl(element);
        if (videoUrl) {
          return { element, type: "video", url: videoUrl };
        }
      }

      const linkedCandidate = buildLinkedVideoCandidate(element, false);
      if (linkedCandidate) return linkedCandidate;
    }

    return null;
  }

  function createMediaLookup(start, clientX, clientY, event = null) {
    // One media lookup can touch the same containers repeatedly; keep layout
    // reads and selector walks scoped to this pointer event.
    const lookup = {
      start,
      clientX,
      clientY,
      eventPath: getEventComposedPath(event),
      rects: new WeakMap(),
      selectorResults: new WeakMap(),
      visibleMedia: new WeakMap(),
      path: [],
    };

    lookup.path = getMediaPathAtPoint(lookup);
    return lookup;
  }

  function getEventComposedPath(event) {
    if (!event || typeof event.composedPath !== "function") return [];

    try {
      return event.composedPath();
    } catch {
      return [];
    }
  }

  function getMediaPathAtPoint(lookup) {
    if (!(lookup.start instanceof Element)) return [];
    if (isInsideUserscriptUi(lookup.start)) return [];
    return getElementPathAtPoint(lookup);
  }

  function buildLinkedVideoCandidate(element, forHover) {
    if (!element.matches?.("a[href]")) return null;

    const href = element.getAttribute("href") || "";
    const videoUrl = (
      pickWikimediaMediaViewerAssetUrl(href, "video") ||
      (isLikelyVideoUrl(href) ? resolveUrl(href) : "")
    );
    if (!videoUrl) return null;

    if (!forHover) {
      return { element, type: "video", url: videoUrl };
    }

    return {
      element,
      hoverTarget: element,
      type: "video",
      previewMode: "video",
      url: videoUrl,
      currentTime: 0,
      shouldPlay: false,
      fallbackUrl: "",
    };
  }

  function getElementsAtPoint(lookup) {
    const { start, clientX, clientY } = lookup;
    const elements = [];
    const seen = new Set();

    const push = (element) => {
      if (!(element instanceof Element) || seen.has(element)) return;
      seen.add(element);
      elements.push(element);
    };

    push(start);

    for (const element of lookup.eventPath) {
      push(element);
    }

    if (
      typeof clientX === "number" &&
      typeof clientY === "number" &&
      typeof document.elementsFromPoint === "function"
    ) {
      for (const element of document.elementsFromPoint(clientX, clientY)) {
        push(element);
      }
    } else if (typeof clientX === "number" && typeof clientY === "number") {
      push(document.elementFromPoint(clientX, clientY));
    }

    return elements;
  }

  function getElementPathAtPoint(lookup) {
    const path = [];
    const seen = new Set();

    for (const baseElement of getElementsAtPoint(lookup)) {
      for (let element = baseElement; element; element = element.parentElement) {
        if (seen.has(element)) break;
        seen.add(element);
        path.push(element);
      }
    }

    return path;
  }

  function isInsideUserscriptUi(element) {
    if (!(element instanceof Element)) return false;
    return Boolean(
      element.closest?.(
        `#${IDS.overlay}, #${IDS.hoverWrap}, #${IDS.hoverToast}`,
      ),
    );
  }

  function isTargetLargeEnough(element, lookup = null) {
    const rect = getElementRect(element, lookup);
    if (!rect) return false;
    return (
      rect.width >= CONFIG.minTargetPixels &&
      rect.height >= CONFIG.minTargetPixels
    );
  }

  function setHoverTarget(element, lookup = null) {
    state.hover.target = element;
    state.hover.targetRect = getElementRectSnapshot(element, lookup);
  }

  function pointWithinHoverTarget(x, y) {
    if (!(state.hover.target instanceof Element) || !state.hover.target.isConnected) {
      return false;
    }

    const rect = state.hover.targetRect;
    if (
      rect &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return true;
    }

    const within = pointWithinElement(state.hover.target, x, y);
    if (within) {
      state.hover.targetRect = getElementRectSnapshot(state.hover.target);
    }

    return within;
  }

  function getElementRectSnapshot(element, lookup = null) {
    const rect = getElementRect(element, lookup);
    if (!rect) return null;

    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  function pointWithinElement(element, x, y, lookup = null) {
    const rect = getElementRect(element, lookup);
    if (!rect) return false;
    return pointWithinRect(rect, x, y);
  }

  function pointWithinRect(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getElementRect(element, lookup = null) {
    if (!(element instanceof Element)) return null;

    if (!lookup?.rects) {
      return element.getBoundingClientRect?.() || null;
    }

    if (lookup.rects.has(element)) {
      return lookup.rects.get(element);
    }

    const rect = element.getBoundingClientRect?.() || null;
    lookup.rects.set(element, rect);
    return rect;
  }

  function querySelectorAllCached(element, selector, lookup = null) {
    if (!(element instanceof Element)) return [];
    if (!lookup?.selectorResults) return Array.from(element.querySelectorAll(selector));

    let selectorMap = lookup.selectorResults.get(element);
    if (!selectorMap) {
      selectorMap = new Map();
      lookup.selectorResults.set(element, selectorMap);
    }

    if (!selectorMap.has(selector)) {
      selectorMap.set(selector, Array.from(element.querySelectorAll(selector)));
    }

    return selectorMap.get(selector);
  }

  function buildImageCandidate(image) {
    if (!(image instanceof HTMLImageElement)) return null;

    const imageUrl = pickBestImageUrl(image);
    const link = image.closest("a[href]");
    const linkedUrl = link?.getAttribute("href") || "";
    const linkedImageUrl = pickLinkedImageUrl(linkedUrl, imageUrl, link);
    if (linkedImageUrl) {
      return buildUrlImageCandidate(image, linkedImageUrl, {
        mimeType: link?.getAttribute("type") || "",
      });
    }

    return buildUrlImageCandidate(image, imageUrl);
  }

  function buildUrlImageCandidate(element, url, options = {}) {
    const resolvedUrl = resolveUrl(url || "");
    if (!resolvedUrl) return null;

    const kind = (
      options.kind ||
      (isSvgUrl(resolvedUrl, {
        allowBlob: options.allowSvgBlob,
        mimeType: options.mimeType,
      }) ? "svg" : "")
    );
    const size = getElementFallbackSize(
      options.svgElement || element,
      options.lookup || null,
      kind === "svg",
    );
    const candidate = { element, url: resolvedUrl };

    if (kind) candidate.kind = kind;
    if (options.temporaryUrl) candidate.temporaryUrl = options.temporaryUrl;
    if (size) {
      candidate.fallbackW = size.width;
      candidate.fallbackH = size.height;
    }

    return candidate;
  }

  function buildInlineSvgCandidate(element, lookup) {
    const svg = getInlineSvgElement(element);
    if (!svg) return null;

    const objectUrl = createInlineSvgObjectUrl(svg);
    if (!objectUrl) return null;

    return buildUrlImageCandidate(svg, objectUrl, {
      allowSvgBlob: true,
      kind: "svg",
      lookup,
      svgElement: svg,
      temporaryUrl: objectUrl,
    });
  }

  function getInlineSvgElement(element) {
    if (!(element instanceof Element)) return null;

    if (isInlineSvgRoot(element)) return element;

    const owner = element.ownerSVGElement;
    return isInlineSvgRoot(owner) ? owner : null;
  }

  function isInlineSvgRoot(element) {
    return Boolean(
      element instanceof Element &&
      element.localName?.toLowerCase() === "svg" &&
      element.namespaceURI === SVG_NS,
    );
  }

  function createInlineSvgObjectUrl(svg) {
    try {
      const clone = svg.cloneNode(true);
      if (!(clone instanceof Element)) return "";

      if (!clone.getAttribute("xmlns")) {
        clone.setAttribute("xmlns", SVG_NS);
      }

      const markup = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([markup], {
        type: "image/svg+xml;charset=utf-8",
      });
      return URL.createObjectURL(blob);
    } catch {
      return "";
    }
  }

  function getCandidateFallbackSize(candidate) {
    if (!candidate) return null;

    const width = Math.round(Number(candidate.fallbackW) || 0);
    const height = Math.round(Number(candidate.fallbackH) || 0);
    if (width > 0 && height > 0) {
      return { width, height };
    }

    if (candidate.kind === "svg") {
      return {
        width: CONFIG.hover.fallbackWidth,
        height: CONFIG.hover.fallbackWidth,
      };
    }

    return null;
  }

  function getLoadedImageSize(img, fallbackSize = null) {
    const naturalW = Math.round(img.naturalWidth || 0);
    const naturalH = Math.round(img.naturalHeight || 0);
    if (naturalW > 0 && naturalH > 0) {
      return { width: naturalW, height: naturalH };
    }

    if (fallbackSize?.width && fallbackSize?.height) {
      return fallbackSize;
    }

    return {
      width: CONFIG.hover.fallbackWidth,
      height: CONFIG.hover.fallbackHeight,
    };
  }

  function getElementFallbackSize(element, lookup = null, preferSquare = false) {
    const svgSize = getInlineSvgSize(element);
    if (svgSize) return svgSize;

    const imageSize = getImageAttributeSize(element);
    if (imageSize) return imageSize;

    const rect = getElementRect(element, lookup);
    if (rect?.width > 0 && rect?.height > 0) {
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    if (preferSquare) {
      return {
        width: CONFIG.hover.fallbackWidth,
        height: CONFIG.hover.fallbackWidth,
      };
    }

    return null;
  }

  function getInlineSvgSize(element) {
    if (!isInlineSvgRoot(element)) return null;

    const attrW = parseSvgLength(element.getAttribute("width"));
    const attrH = parseSvgLength(element.getAttribute("height"));
    if (attrW > 0 && attrH > 0) {
      return { width: attrW, height: attrH };
    }

    const viewBox = parseSvgViewBox(element.getAttribute("viewBox"));
    if (viewBox) {
      if (attrW > 0) {
        return {
          width: attrW,
          height: Math.round(attrW * (viewBox.height / viewBox.width)),
        };
      }
      if (attrH > 0) {
        return {
          width: Math.round(attrH * (viewBox.width / viewBox.height)),
          height: attrH,
        };
      }
      return { width: viewBox.width, height: viewBox.height };
    }

    return null;
  }

  function getImageAttributeSize(element) {
    if (!(element instanceof HTMLImageElement)) return null;

    const attrW = parseSvgLength(element.getAttribute("width"));
    const attrH = parseSvgLength(element.getAttribute("height"));
    if (attrW > 0 && attrH > 0) {
      return { width: attrW, height: attrH };
    }

    return null;
  }

  function parseSvgLength(value) {
    const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
    return match ? Math.round(Number(match[1]) || 0) : 0;
  }

  function parseSvgViewBox(value) {
    const parts = String(value || "")
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number(part));

    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    const width = Math.round(parts[2]);
    const height = Math.round(parts[3]);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  function buildHoverVideoCandidate(video) {
    if (!(video instanceof HTMLVideoElement)) return null;

    const videoUrl = pickBestVideoUrl(video);
    const fallbackUrl = pickVideoPreviewUrl(video);
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shouldPlay = !video.paused && !video.ended;

    if (isReplayableHoverVideoUrl(videoUrl)) {
      return {
        element: video,
        hoverTarget: video,
        type: "video",
        previewMode: "video",
        url: videoUrl,
        currentTime,
        shouldPlay,
        fallbackUrl,
      };
    }

    return {
      element: video,
      hoverTarget: video,
      type: "video",
      previewMode: "live",
      url: videoUrl,
      currentTime,
      shouldPlay,
      fallbackUrl,
      liveElement: video,
    };
  }

  function isReplayableHoverVideoUrl(url) {
    return Boolean(
      url &&
      !url.startsWith("blob:") &&
      !url.startsWith("mediasource:"),
    );
  }

  function findNestedImageAtPoint(element, lookup) {
    if (!(element instanceof Element)) return null;
    if (typeof lookup.clientX !== "number" || typeof lookup.clientY !== "number") {
      return null;
    }
    if (!element.matches?.(NESTED_IMAGE_CONTAINER_SELECTOR)) return null;

    for (const image of querySelectorAllCached(element, "img", lookup)) {
      if (pointWithinElement(image, lookup.clientX, lookup.clientY, lookup)) {
        return image;
      }
    }

    return null;
  }

  function pickBestImageUrl(image) {
    const srcsetUrl = pickBestSrcsetUrl(image.getAttribute("srcset") || image.srcset || "");
    if (srcsetUrl) return srcsetUrl;

    const pictureSrcsetUrl = pickBestPictureSourceUrl(image);
    if (pictureSrcsetUrl) return pictureSrcsetUrl;

    for (const attr of LAZY_IMAGE_SRCSET_ATTRS) {
      const value = image.getAttribute(attr) || "";
      const attrSrcsetUrl = pickBestSrcsetUrl(value);
      if (attrSrcsetUrl) return attrSrcsetUrl;
    }

    const currentSrc = resolveUrl(image.currentSrc || "");
    if (currentSrc) return currentSrc;

    for (const attr of LAZY_IMAGE_ATTRS) {
      const value = image.getAttribute(attr);
      if (value) return resolveUrl(value);
    }

    return resolveUrl(image.src || "");
  }

  function pickBestPictureSourceUrl(image) {
    const picture = image.closest?.("picture");
    if (!(picture instanceof HTMLPictureElement)) return "";

    let bestUrl = "";
    for (const source of picture.querySelectorAll("source[srcset]")) {
      const sourceUrl = pickBestSrcsetUrl(source.getAttribute("srcset") || "");
      if (sourceUrl) bestUrl = sourceUrl;
    }

    return bestUrl;
  }

  function pickBestVideoUrl(video) {
    if (!video) return "";

    const current = resolveUrl(video.currentSrc || video.src || "");
    const currentScore = extractQualityScore(current);
    const currentIsBlobLike =
      current.startsWith("blob:") || current.startsWith("data:");

    let bestSourceUrl = "";
    let bestSourceScore = -1;

    for (const source of video.querySelectorAll("source[src]")) {
      const rawUrl = source.getAttribute("src") || source.src || "";
      const url = resolveUrl(rawUrl);
      if (!url) continue;

      const score = Math.max(
        extractQualityScore(source.getAttribute("data-quality")),
        extractQualityScore(source.getAttribute("label")),
        extractQualityScore(source.getAttribute("res")),
        extractQualityScore(source.getAttribute("size")),
        extractQualityScore(source.getAttribute("title")),
        extractQualityScore(url),
      );

      if (score <= bestSourceScore) continue;
      bestSourceUrl = url;
      bestSourceScore = score;
    }

    if (bestSourceUrl) {
      if (currentIsBlobLike) return bestSourceUrl;
      if (!current) return bestSourceUrl;
      if (bestSourceScore > currentScore) return bestSourceUrl;
    }

    return current;
  }

  function pickVideoPreviewUrl(video) {
    if (!(video instanceof HTMLVideoElement)) return "";

    const posterUrl = resolveUrl(video.getAttribute("poster") || video.poster || "");
    if (posterUrl) return posterUrl;

    const cachedFrameUrl = VIDEO_PREVIEW_CACHE.get(video);
    if (cachedFrameUrl) return cachedFrameUrl;

    const frameUrl = captureVideoFrameUrl(video);
    if (frameUrl) {
      VIDEO_PREVIEW_CACHE.set(video, frameUrl);
      return frameUrl;
    }

    return "";
  }

  function captureVideoFrameUrl(video) {
    if (!(video instanceof HTMLVideoElement)) return "";

    const width = Math.round(video.videoWidth || video.clientWidth || 0);
    const height = Math.round(video.videoHeight || video.clientHeight || 0);
    if (!width || !height) return "";

    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) return "";

      context.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      return "";
    }
  }

  function extractQualityScore(value) {
    if (!value) return 0;
    const match = String(value).toLowerCase().match(/(\d{3,4})\s*p?/);
    return match ? Number(match[1]) || 0 : 0;
  }

  function pickBestSrcsetUrl(srcset) {
    const entries = parseSrcset(srcset);
    if (entries.length === 0) return "";

    let bestWidthEntry = null;
    for (const entry of entries) {
      if (typeof entry.width !== "number") continue;
      if (!bestWidthEntry || entry.width > bestWidthEntry.width) {
        bestWidthEntry = entry;
      }
    }
    if (bestWidthEntry) {
      return resolveUrl(bestWidthEntry.url);
    }

    let bestDensityEntry = null;
    for (const entry of entries) {
      if (typeof entry.density !== "number") continue;
      if (!bestDensityEntry || entry.density > bestDensityEntry.density) {
        bestDensityEntry = entry;
      }
    }
    if (bestDensityEntry) {
      return resolveUrl(bestDensityEntry.url);
    }

    return resolveUrl(entries[0].url);
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];

    return srcset
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        const widthMatch = descriptor?.match(/^(\d+)w$/);
        const densityMatch = descriptor?.match(/^(\d+(?:\.\d+)?)x$/);

        return {
          url,
          width: widthMatch ? Number(widthMatch[1]) : null,
          density: densityMatch ? Number(densityMatch[1]) : null,
        };
      })
      .filter((entry) => entry.url);
  }

  function getBackgroundImageUrl(element) {
    try {
      const backgroundImage = getComputedStyle(element).backgroundImage;
      if (!backgroundImage || backgroundImage === "none") return "";

      const urls = extractCssUrls(backgroundImage);
      return (
        urls.find((url) => isSvgUrl(url)) ||
        urls[0] ||
        ""
      );
    } catch {
      return "";
    }
  }

  function extractCssUrls(value) {
    const urls = [];
    const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
    let match;

    while ((match = pattern.exec(String(value || "")))) {
      const rawUrl = match[1] || match[2] || match[3] || "";
      const resolvedUrl = resolveUrl(rawUrl.trim());
      if (resolvedUrl) urls.push(resolvedUrl);
    }

    return urls;
  }

  function pickLinkedImageUrl(url, fallbackUrl = "", link = null) {
    if (!url) return "";

    const mediaViewerUrl = pickWikimediaMediaViewerAssetUrl(url, "image");
    if (mediaViewerUrl) {
      return fallbackUrl || mediaViewerUrl;
    }

    const svgMimeHint = isSvgMimeType(link?.getAttribute?.("type") || "");
    if (!isLikelyImageUrl(url) && !svgMimeHint) return "";

    const resolvedUrl = resolveUrl(url);
    if (!resolvedUrl) return "";

    if (isWikimediaFilePageUrl(resolvedUrl)) {
      return fallbackUrl || "";
    }

    return resolvedUrl;
  }

  function isLikelyImageUrl(url) {
    if (!url) return false;
    if (isSvgUrl(url)) return true;
    if (url.startsWith("data:image/")) return true;

    try {
      const parsed = new URL(url, window.location.href);
      return /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(
        parsed.pathname,
      );
    } catch {
      return false;
    }
  }

  function isSvgUrl(url, options = {}) {
    if (!url) return false;

    const value = String(url).trim();
    if (isSvgMimeType(options.mimeType || "")) return true;
    if (/^data:image\/svg\+xml(?:[;,]|$)/i.test(value)) return true;
    if (options.allowBlob && value.startsWith("blob:")) return true;

    try {
      const parsed = new URL(value, window.location.href);
      if (/\.svg$/i.test(parsed.pathname)) return true;
      return hasSvgQueryHint(parsed);
    } catch {
      return /\.svg(?:[?#]|$)/i.test(value);
    }
  }

  function hasSvgQueryHint(parsed) {
    for (const key of [
      "content-type",
      "content_type",
      "ext",
      "extension",
      "file",
      "filename",
      "format",
      "mime",
      "name",
      "type",
    ]) {
      const value = parsed.searchParams.get(key);
      if (isSvgHintValue(value)) return true;
    }

    return false;
  }

  function isSvgHintValue(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    return (
      normalized === "svg" ||
      normalized === "image/svg+xml" ||
      normalized.endsWith(".svg")
    );
  }

  function isSvgMimeType(value) {
    return String(value || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase() === "image/svg+xml";
  }

  function isWikimediaFilePageUrl(url) {
    if (!url) return false;

    try {
      const parsed = new URL(url, window.location.href);
      const host = parsed.hostname.toLowerCase();
      if (!isWikimediaProjectHost(host)) return false;

      const title = parsed.searchParams.get("title") || "";
      if (/^(File|Media):/i.test(title)) return true;

      if (!parsed.pathname.startsWith("/wiki/")) return false;
      const pageTitle = parsed.pathname.slice("/wiki/".length);
      return /^(File|Media):/i.test(pageTitle);
    } catch {
      return false;
    }
  }

  function pickWikimediaMediaViewerAssetUrl(url, mediaType) {
    if (!url || !mediaType) return "";

    try {
      const parsed = new URL(url, window.location.href);
      if (!isWikimediaProjectHost(parsed.hostname.toLowerCase())) return "";

      const fileName = extractWikimediaMediaViewerFileName(parsed.hash || "");
      if (!fileName) return "";

      if (mediaType === "image" && !isLikelyImageUrl(fileName)) return "";
      if (mediaType === "video" && !isLikelyVideoUrl(fileName)) return "";

      return `${parsed.origin}/wiki/Special:Redirect/file/${encodeURIComponent(fileName)}`;
    } catch {
      return "";
    }
  }

  function extractWikimediaMediaViewerFileName(hash) {
    if (!hash) return "";

    for (const variant of getHashVariants(hash)) {
      const match = variant.match(/^#\/?media\/(?:File|Media):(.+)$/i);
      if (!match) continue;

      const fileName = sanitizeWikimediaFileName(match[1]);
      if (fileName) return fileName;
    }

    return "";
  }

  function getHashVariants(hash) {
    const variants = [];
    if (hash) variants.push(hash);

    const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const decoded = safeDecodeURIComponent(withoutHash);
    if (decoded && decoded !== withoutHash) {
      variants.push(decoded.startsWith("#") ? decoded : `#${decoded}`);
    }

    return variants;
  }

  function sanitizeWikimediaFileName(value) {
    const rawName = String(value).split(/[?#]/, 1)[0].trim();
    if (!rawName) return "";
    return safeDecodeURIComponent(rawName).replace(/\s+/g, "_");
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function isWikimediaProjectHost(host) {
    return /(\.|^)(wikipedia|wikibooks|wikidata|wikimedia|wikinews|wikiquote|wikisource|wikiversity|wikivoyage|wiktionary|mediawiki)\.org$/.test(
      host,
    );
  }

  function isLikelyVideoUrl(url) {
    if (!url) return false;
    if (url.startsWith("data:video/")) return true;

    try {
      const parsed = new URL(url, window.location.href);
      return /\.(m4v|mp4|mov|webm|ogv|m3u8)(?:$|\?)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function resolveUrl(url) {
    if (!url) return "";
    if (url.startsWith("data:image/") || url.startsWith("data:video/")) return url;

    try {
      return normalizeKnownImageUrl(new URL(url, window.location.href).href);
    } catch {
      return normalizeKnownImageUrl(url);
    }
  }

  function normalizeKnownImageUrl(url) {
    if (!url || url.startsWith("data:image/") || url.startsWith("data:video/")) {
      return url;
    }

    try {
      const parsed = new URL(url, window.location.href);
      const host = parsed.hostname.toLowerCase();

      if (host === "upload.wikimedia.org" && parsed.pathname.includes("/thumb/")) {
        const originalPath = getWikimediaOriginalPath(parsed.pathname);
        if (originalPath) {
          parsed.pathname = originalPath;
          parsed.search = "";
          parsed.hash = "";
        }
      }

      if (host.endsWith("twimg.com")) {
        if (parsed.searchParams.has("format") || parsed.searchParams.has("name")) {
          parsed.searchParams.set("name", "orig");
        }
      }

      return parsed.href;
    } catch {
      return url;
    }
  }

  function getWikimediaOriginalPath(pathname) {
    const segments = pathname.split("/").filter(Boolean);
    const thumbIndex = segments.indexOf("thumb");
    if (thumbIndex === -1 || segments.length <= thumbIndex + 2) return "";

    return `/${segments
      .filter((_, index) => index !== thumbIndex && index !== segments.length - 1)
      .join("/")}`;
  }

  function getViewport() {
    const viewport = window.visualViewport;
    if (viewport?.width && viewport?.height) {
      return { width: viewport.width, height: viewport.height };
    }

    return { width: window.innerWidth, height: window.innerHeight };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
