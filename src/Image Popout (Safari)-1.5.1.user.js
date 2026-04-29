// ==UserScript==
// @name         Image Popout (Safari)
// @namespace    https://github.com/paytonison/hover-zoom
// @version      1.5.1
// @description  Hover images or videos for a near-cursor preview. P pins, Z toggles, Esc hides, and Alt/Option-click opens a movable overlay.
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
  const CONTEXT_MENU_SUPPRESSION_MS = 2000;
  const BACKGROUND_IMAGE_SELECTOR =
    "div, span, a, button, figure, section, article, li";
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
  ];

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
      padding: 10,
      borderWidth: 1,
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
      videoCurrentTime: 0,
      videoShouldPlay: false,
      live: null,
      toastTimer: 0,
    },
    popout: {
      open: false,
      url: "",
      mediaType: "image",
      autoFit: true,
      loadToken: 0,
      drag: null,
      resize: null,
      toastTimer: 0,
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
    },
  };

  init();

  function init() {
    injectStyles();
    buildUi();
    bindEvents();
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
        background: var(--hz-backdrop);
        backdrop-filter: blur(14px) saturate(140%);
        -webkit-backdrop-filter: blur(14px) saturate(140%);
      }

      #${IDS.window} {
        position: absolute;
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid var(--hz-border);
        background: var(--hz-surface);
        box-shadow: var(--hz-shadow);
        backdrop-filter: blur(12px) saturate(150%);
        -webkit-backdrop-filter: blur(12px) saturate(150%);
      }

      #${IDS.titlebar} {
        height: ${CONFIG.popout.titlebarHeight}px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        border-bottom: 1px solid var(--hz-border-soft);
        background: linear-gradient(
          180deg,
          var(--hz-surface-strong),
          var(--hz-surface)
        );
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
      }

      .hz-btn {
        appearance: none;
        border: 1px solid var(--hz-border);
        background: var(--hz-surface-soft);
        color: var(--hz-text);
        border-radius: 9px;
        padding: 6px 10px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .hz-btn:hover {
        background: var(--hz-surface-strong);
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
        width: 100%;
        height: calc(100% - ${CONFIG.popout.titlebarHeight}px);
        background: var(--hz-image-bg);
      }

      #${IDS.popoutImg},
      #${IDS.popoutVideo} {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: var(--hz-image-bg);
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
        opacity: 0.55;
        background:
          linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.65) 50%),
          linear-gradient(135deg, transparent 68%, rgba(255, 255, 255, 0.55) 68%),
          linear-gradient(135deg, transparent 84%, rgba(255, 255, 255, 0.45) 84%);
      }

      #${IDS.popoutToast},
      #${IDS.hoverToast} {
        position: fixed;
        z-index: 2147483647;
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid var(--hz-border);
        background: var(--hz-surface-strong);
        color: var(--hz-text);
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: var(--hz-shadow);
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
        border-radius: ${CONFIG.hover.borderRadius}px;
        border: ${CONFIG.hover.borderWidth}px solid var(--hz-border);
        background: var(--hz-surface-soft);
        box-shadow: var(--hz-shadow);
        backdrop-filter: blur(14px) saturate(150%);
        -webkit-backdrop-filter: blur(14px) saturate(150%);
        transform: translate3d(-9999px, -9999px, 0);
        will-change: transform;
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
        border-radius: ${CONFIG.hover.borderRadius - 6}px;
        background: var(--hz-image-bg);
        box-shadow: inset 0 0 0 1px var(--hz-border-soft);
      }

      #${IDS.hoverVideo},
      #${IDS.hoverLiveHost} {
        display: none;
      }

      #${IDS.hoverVideo} {
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
      }

      #${IDS.hoverToast} {
        left: 14px;
        bottom: 14px;
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
    window.addEventListener("pointermove", onWindowPointerMove, true);
    window.addEventListener("pointerup", onWindowPointerUp, true);
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
    if (action === "close") closePopout();
    if (action === "open") openPopoutUrlInNewTab();
    if (action === "copy") copyPopoutUrl();
    if (action === "download") void downloadCurrentMedia();
  }

  function onDocumentClick(event) {
    if (!(event instanceof MouseEvent)) return;

    if (shouldSuppressDocumentClick()) return;
    if (isInsideUserscriptUi(event.target)) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;

    if (event.altKey) {
      handleAltClick(event);
      return;
    }

    // Plain clicks should pass through to the page. Pinning is keyboard-only.
  }

  function onDocumentMouseDown(event) {
    if (!(event instanceof MouseEvent)) return;

    const plainPrimaryClick = (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey
    );

    if (!plainPrimaryClick) {
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
  function onDocumentMouseMove(event) {
    state.hover.mouseX = event.clientX;
    state.hover.mouseY = event.clientY;

    if (!state.hover.enabled || state.popout.open || state.hover.pinned) return;

    if (event.target !== state.hover.lastEventTarget) {
      state.hover.lastEventTarget = event.target;
      const candidate = findHoverCandidate(
        event.target,
        event.clientX,
        event.clientY,
      );
      if (candidate && isTargetLargeEnough(candidate.element)) {
        activateHover(candidate, event.clientX, event.clientY);
      } else if (
        state.hover.target &&
        !pointWithinElement(
          state.hover.target,
          event.clientX,
          event.clientY,
        )
      ) {
        hideHover();
        return;
      }
    }

    if (!state.hover.target) return;

    if (
      !pointWithinElement(state.hover.target, event.clientX, event.clientY)
    ) {
      const candidate = findHoverCandidate(
        document.elementFromPoint(event.clientX, event.clientY),
        event.clientX,
        event.clientY,
      );
      if (candidate && isTargetLargeEnough(candidate.element)) {
        activateHover(candidate, event.clientX, event.clientY);
      } else {
        hideHover();
      }
      return;
    }

    updateHoverPosition(event.clientX, event.clientY);
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
  }

  function onViewportChange() {
    if (state.popout.open) {
      if (state.popout.autoFit) fitPopoutToMedia();
      clampPopoutToViewport();
    }

    if (!isHoverVisible()) return;

    applyHoverSize();
    if (state.hover.pinned) return;

    if (
      state.hover.target &&
      pointWithinElement(state.hover.target, state.hover.mouseX, state.hover.mouseY)
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
    if (!state.hover.pinned) hideHover();
  }

  function onDocumentMouseLeave() {
    if (!state.hover.pinned) hideHover();
  }

  function scheduleViewportChange() {
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
    );
    if (!candidate) return;

    event.preventDefault();
    event.stopPropagation();

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
      !pointWithinElement(state.hover.target, state.hover.mouseX, state.hover.mouseY)
    ) {
      hideHover();
    }

    showHoverToast(state.hover.pinned ? "Pinned preview" : "Unpinned");
  }

  function activateHover(candidate, mouseX, mouseY) {
    const previewMode = candidate.previewMode || "image";

    state.hover.url = candidate.url || "";
    state.hover.previewMode = previewMode;
    state.hover.fallbackUrl = candidate.fallbackUrl || "";
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
      state.hover.target = attachHoverLiveElement(candidate);
    } else if (previewMode === "video") {
      state.hover.target = candidate.hoverTarget || candidate.element;
      setHoverVideoCandidate(candidate);
    } else {
      state.hover.target = candidate.hoverTarget || candidate.element;
      if (
        state.ui.hoverImg.src !== candidate.url ||
        !state.hover.naturalW ||
        !state.hover.naturalH
      ) {
        setHoverImageUrl(candidate.url);
      } else {
        showHoverPreviewMode("image");
        clearHoverVideo();
        teardownHoverLiveElement();
        applyHoverSize();
      }
    }

    updateHoverPosition(mouseX, mouseY);
  }

  function hideHover() {
    cancelHoverPositionFrame();
    teardownHoverLiveElement();
    clearHoverVideo();
    showHoverPreviewMode("image");
    state.hover.target = null;
    state.hover.url = "";
    state.hover.previewMode = "image";
    state.hover.fallbackUrl = "";
    state.hover.videoCurrentTime = 0;
    state.hover.videoShouldPlay = false;
    state.hover.naturalW = 0;
    state.hover.naturalH = 0;
    state.hover.lastEventTarget = null;
    state.ui.hoverBadge.style.display = "none";
    state.ui.hoverWrap.style.display = "none";
    state.ui.hoverWrap.style.transform = "translate3d(-9999px, -9999px, 0)";
    updateHoverInteractivity();
  }

  function isHoverVisible() {
    return state.ui.hoverWrap.style.display === "block";
  }

  function setHoverImageUrl(url) {
    const token = ++state.hover.loadToken;
    const img = state.ui.hoverImg;

    showHoverPreviewMode("image");
    clearHoverVideo();
    teardownHoverLiveElement();
    state.hover.naturalW = 0;
    state.hover.naturalH = 0;
    applyHoverSize();

    img.onload = () => {
      if (token !== state.hover.loadToken) return;
      state.hover.naturalW = img.naturalWidth || CONFIG.hover.fallbackWidth;
      state.hover.naturalH = img.naturalHeight || CONFIG.hover.fallbackHeight;
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
      state.hover.naturalW = img.naturalWidth;
      state.hover.naturalH = img.naturalHeight || CONFIG.hover.fallbackHeight;
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

    state.ui.hoverWrap.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function openPopout(media) {
    const mediaUrl =
      typeof media === "string"
        ? media
        : typeof media?.url === "string"
          ? media.url
          : "";
    const mediaType =
      typeof media === "object" && media?.type === "video" ? "video" : "image";

    if (!mediaUrl) return;

    state.popout.open = true;
    state.popout.url = mediaUrl;
    state.popout.mediaType = mediaType;
    state.popout.autoFit = true;
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
    const img = state.ui.popoutImg;
    const video = state.ui.popoutVideo;

    img.onload = null;
    img.onerror = null;
    video.onloadedmetadata = null;
    video.onerror = null;

    if (mediaType === "video") {
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
      return;
    }

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
    state.popout.drag = null;
    state.popout.resize = null;
    state.ui.popoutVideo.pause();
    state.ui.overlay.classList.remove("is-open");
    state.ui.popoutToast.classList.remove("is-visible");
    document.documentElement.style.userSelect = "";
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
    showToast(
      state.ui.hoverToast,
      "hover",
      message,
      900,
    );
  }

  function showPopoutToast(message) {
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

    capturePointer(event.currentTarget, event.pointerId);
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
      isVideo ? media.videoWidth || maxWidth : media.naturalWidth || maxWidth,
    );
    const naturalH = Math.max(
      1,
      isVideo
        ? media.videoHeight || maxBodyHeight
        : media.naturalHeight || maxBodyHeight,
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

  function findImageCandidate(path, clientX, clientY) {
    for (const element of path) {
      if (element instanceof HTMLImageElement) {
        const candidate = buildImageCandidate(element);
        if (candidate) return candidate;
      }
    }

    for (const element of path) {
      const nestedImage = findNestedImageAtPoint(element, clientX, clientY);
      if (nestedImage) {
        const candidate = buildImageCandidate(nestedImage);
        if (candidate) return candidate;
      }

      if (element.matches?.("a[href]")) {
        const href = element.getAttribute("href") || "";
        const linkedImageUrl = pickLinkedImageUrl(href);
        if (linkedImageUrl) {
          return { element, url: linkedImageUrl };
        }
      }

      if (element.matches?.(BACKGROUND_IMAGE_SELECTOR)) {
        const backgroundUrl = getBackgroundImageUrl(element);
        if (backgroundUrl) {
          return { element, url: backgroundUrl };
        }
      }
    }

    return null;
  }

  function findHoverCandidate(start, clientX, clientY) {
    const path = getMediaPathAtPoint(start, clientX, clientY);
    if (!path.length) return null;

    const videoCandidate = findHoverVideoCandidate(path);
    if (videoCandidate) return videoCandidate;

    const imageCandidate = findImageCandidate(path, clientX, clientY);
    if (imageCandidate) {
      return { ...imageCandidate, previewMode: "image" };
    }

    return null;
  }

  function findPopoutCandidate(start, clientX, clientY) {
    const path = getMediaPathAtPoint(start, clientX, clientY);
    if (!path.length) return null;

    const videoCandidate = findPopoutVideoCandidate(path);
    if (videoCandidate) return videoCandidate;

    const imageCandidate = findImageCandidate(path, clientX, clientY);
    if (imageCandidate) {
      return { ...imageCandidate, type: "image" };
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

  function getMediaPathAtPoint(start, clientX, clientY) {
    if (!(start instanceof Element)) return [];
    if (isInsideUserscriptUi(start)) return [];
    return getElementPathAtPoint(start, clientX, clientY);
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

  function getElementsAtPoint(start, clientX, clientY) {
    const elements = [];
    const seen = new Set();

    const push = (element) => {
      if (!(element instanceof Element) || seen.has(element)) return;
      seen.add(element);
      elements.push(element);
    };

    push(start);

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

  function getElementPathAtPoint(start, clientX, clientY) {
    const path = [];
    const seen = new Set();

    for (const baseElement of getElementsAtPoint(start, clientX, clientY)) {
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

  function isTargetLargeEnough(element) {
    const rect = element.getBoundingClientRect?.();
    if (!rect) return false;
    return (
      rect.width >= CONFIG.minTargetPixels &&
      rect.height >= CONFIG.minTargetPixels
    );
  }

  function pointWithinElement(element, x, y) {
    const rect = element.getBoundingClientRect?.();
    if (!rect) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function buildImageCandidate(image) {
    if (!(image instanceof HTMLImageElement)) return null;

    const imageUrl = pickBestImageUrl(image);
    const linkedUrl = image.closest("a[href]")?.getAttribute("href") || "";
    const linkedImageUrl = pickLinkedImageUrl(linkedUrl, imageUrl);
    if (linkedImageUrl) {
      return { element: image, url: linkedImageUrl };
    }

    if (!imageUrl) return null;

    return { element: image, url: imageUrl };
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

  function findNestedImageAtPoint(element, clientX, clientY) {
    if (!(element instanceof Element)) return null;
    if (typeof clientX !== "number" || typeof clientY !== "number") return null;
    if (!element.matches?.(NESTED_IMAGE_CONTAINER_SELECTOR)) return null;

    for (const image of element.querySelectorAll("img")) {
      if (pointWithinElement(image, clientX, clientY)) return image;
    }

    return null;
  }

  function pickBestImageUrl(image) {
    const srcsetUrl = pickBestSrcsetUrl(image.getAttribute("srcset") || image.srcset || "");
    if (srcsetUrl) return srcsetUrl;

    const currentSrc = resolveUrl(image.currentSrc || "");
    if (currentSrc) return currentSrc;

    for (const attr of LAZY_IMAGE_ATTRS) {
      const value = image.getAttribute(attr);
      if (value) return resolveUrl(value);
    }

    return resolveUrl(image.src || "");
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

      const match = backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
      return resolveUrl(match?.[1] || "");
    } catch {
      return "";
    }
  }

  function pickLinkedImageUrl(url, fallbackUrl = "") {
    if (!url) return "";

    const mediaViewerUrl = pickWikimediaMediaViewerAssetUrl(url, "image");
    if (mediaViewerUrl) {
      return fallbackUrl || mediaViewerUrl;
    }

    if (!isLikelyImageUrl(url)) return "";

    const resolvedUrl = resolveUrl(url);
    if (!resolvedUrl) return "";

    if (isWikimediaFilePageUrl(resolvedUrl)) {
      return fallbackUrl || "";
    }

    return resolvedUrl;
  }

  function isLikelyImageUrl(url) {
    if (!url) return false;
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
