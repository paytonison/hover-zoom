// ==UserScript==
// @name         Image Popout (Safari)
// @namespace    https://github.com/paytonison/hover-zoom
// @version      0.2.2
// @description  Hover images for a near-cursor preview (click pins; Z toggles; Esc hides). Alt/Option-click opens a movable, resizable overlay.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  if (window.top !== window.self) return;

  const OPTIONS = {
    trigger: "alt-click", // Only alt/option click for now.
    minWidth: 260,
    minHeight: 200,
    maxScaleUp: 2.5,
    viewportPadding: 12,
    maxViewportFraction: 0.82,
  };

  const STATE = {
    overlay: null,
    popout: null,
    titlebar: null,
    img: null,
    title: null,
    popoutAutoFit: true,
    drag: null,
    resize: null,
    lastUrl: null,
  };

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

  function isLikelyImageUrl(url) {
    if (!url) return false;
    if (url.startsWith("data:image/")) return true;
    try {
      const parsed = new URL(url, window.location.href);
      const path = parsed.pathname.toLowerCase();
      return /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/.test(path);
    } catch {
      return false;
    }
  }

  function resolveUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        const desc = descriptor?.trim() ?? "";
        const widthMatch = desc.match(/^(\d+)w$/);
        const densityMatch = desc.match(/^(\d+(?:\.\d+)?)x$/);
        return {
          url,
          width: widthMatch ? Number(widthMatch[1]) : null,
          density: densityMatch ? Number(densityMatch[1]) : null,
        };
      })
      .filter((e) => e.url);
  }

  function pickBestSrcsetUrl(srcset) {
    const entries = parseSrcset(srcset);
    if (entries.length === 0) return "";

    // Prefer the largest width descriptor if present; otherwise the largest density.
    const withWidth = entries.filter((e) => typeof e.width === "number");
    if (withWidth.length) {
      withWidth.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      const best = withWidth[0]?.url ?? "";
      return best ? resolveUrl(best) : "";
    }

    const withDensity = entries.filter((e) => typeof e.density === "number");
    if (withDensity.length) {
      withDensity.sort((a, b) => (b.density ?? 0) - (a.density ?? 0));
      const best = withDensity[0]?.url ?? "";
      return best ? resolveUrl(best) : "";
    }

    return resolveUrl(entries[0]?.url ?? "");
  }

  function getBackgroundImageUrl(el) {
    if (!el) return "";
    try {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") return "";
      const match = bg.match(/url\(["']?(.*?)["']?\)/i);
      return resolveUrl(match?.[1] ?? "");
    } catch {
      return "";
    }
  }

  function pickBestImageUrl(imgEl) {
    if (imgEl.currentSrc) return imgEl.currentSrc;

    const srcset = imgEl.getAttribute("srcset") || imgEl.srcset || "";
    const bestSrcset = pickBestSrcsetUrl(srcset);
    if (bestSrcset) return bestSrcset;

    for (const key of LAZY_IMAGE_ATTRS) {
      const value = imgEl.getAttribute(key);
      if (value) return resolveUrl(value);
    }

    return imgEl.src || null;
  }

  function pickBestUrlFromElement(el) {
    if (!el) return "";

    if (el.tagName === "IMG") {
      return pickBestImageUrl(el) || "";
    }

    const anchor = el.closest?.("a[href]");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (isLikelyImageUrl(href)) return resolveUrl(href);
    }

    const bg = getBackgroundImageUrl(el);
    if (bg) return bg;

    return "";
  }

  function extractImageUrlFromEventTarget(target) {
    if (!(target instanceof Element)) return null;

    if (target.closest?.("#ip-popout-overlay")) return null;
    if (target.closest?.("#ip-hover-wrap")) return null;
    if (target.closest?.("#ip-hover-toast")) return null;

    const img = target.closest("img");
    if (img) {
      const anchor = img.closest("a[href]");
      if (anchor && isLikelyImageUrl(anchor.href)) return anchor.href;
      return pickBestImageUrl(img);
    }

    const anchor = target.closest("a[href]");
    if (anchor && isLikelyImageUrl(anchor.href)) return anchor.href;

    const bgEl = target.closest("div,span,a,button,figure,section");
    if (bgEl) {
      const bgUrl = getBackgroundImageUrl(bgEl);
      if (bgUrl) return bgUrl;
    }

    return null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getViewport() {
    const vv = window.visualViewport;
    if (vv?.width && vv?.height) return { width: vv.width, height: vv.height };
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function ensureStyles() {
    if (document.getElementById("ip-popout-style")) return;
    const style = document.createElement("style");
    style.id = "ip-popout-style";
    style.textContent = `
      :root {
        --ip-glass-blur: 12px;
        --ip-glass-sat: 150%;
        --ip-glass-radius-xl: 16px;
        --ip-glass-radius-lg: 14px;
        --ip-glass-radius-md: 10px;
        --ip-glass-radius-sm: 8px;
        --ip-glass-text: rgba(26, 26, 28, 0.92);
        --ip-glass-text-muted: rgba(26, 26, 28, 0.65);
        --ip-glass-surface: rgba(255, 255, 255, 0.52);
        --ip-glass-surface-strong: rgba(255, 255, 255, 0.64);
        --ip-glass-surface-soft: rgba(255, 255, 255, 0.38);
        --ip-glass-border: rgba(255, 255, 255, 0.55);
        --ip-glass-border-soft: rgba(0, 0, 0, 0.1);
        --ip-glass-border-hairline: rgba(0, 0, 0, 0.22);
        --ip-glass-shadow:
          0 26px 60px rgba(18, 18, 20, 0.16),
          0 4px 12px rgba(18, 18, 20, 0.1);
        --ip-glass-shadow-soft: 0 10px 28px rgba(18, 18, 20, 0.16);
        --ip-glass-highlight: rgba(255, 255, 255, 0.8);
        --ip-glass-backdrop: rgba(10, 10, 12, 0.2);
        --ip-glass-image-backdrop: rgba(0, 0, 0, 0.08);
        --ip-glass-toast: rgba(255, 255, 255, 0.72);
        --ip-glass-accent: rgba(0, 122, 255, 0.85);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --ip-glass-text: rgba(245, 245, 247, 0.92);
          --ip-glass-text-muted: rgba(245, 245, 247, 0.7);
          --ip-glass-surface: rgba(28, 28, 32, 0.6);
          --ip-glass-surface-strong: rgba(34, 34, 38, 0.7);
          --ip-glass-surface-soft: rgba(24, 24, 28, 0.44);
          --ip-glass-border: rgba(255, 255, 255, 0.26);
          --ip-glass-border-soft: rgba(255, 255, 255, 0.1);
          --ip-glass-border-hairline: rgba(0, 0, 0, 0.55);
          --ip-glass-shadow:
            0 28px 70px rgba(0, 0, 0, 0.42),
            0 4px 12px rgba(0, 0, 0, 0.28);
          --ip-glass-shadow-soft: 0 12px 30px rgba(0, 0, 0, 0.48);
          --ip-glass-highlight: rgba(255, 255, 255, 0.24);
          --ip-glass-backdrop: rgba(5, 5, 7, 0.38);
          --ip-glass-image-backdrop: rgba(0, 0, 0, 0.35);
          --ip-glass-toast: rgba(32, 32, 36, 0.8);
          --ip-glass-accent: rgba(10, 132, 255, 0.9);
        }
      }
      #ip-popout-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        color-scheme: light dark;
      }
      #ip-popout-overlay.ip-open { display: block; }
      #ip-popout-backdrop {
        position: absolute;
        inset: 0;
        background: var(--ip-glass-backdrop);
        backdrop-filter: blur(18px) saturate(160%);
        -webkit-backdrop-filter: blur(18px) saturate(160%);
      }
      #ip-popout-window {
        position: absolute;
        background: var(--ip-glass-surface);
        color: var(--ip-glass-text);
        border-radius: var(--ip-glass-radius-xl);
        box-shadow: var(--ip-glass-shadow),
          var(--ip-glass-shadow-soft),
          0 0 0 0.5px var(--ip-glass-border-hairline),
          inset 0 1px 0 var(--ip-glass-highlight);
        overflow: hidden;
        border: 1px solid var(--ip-glass-border);
        backdrop-filter: blur(var(--ip-glass-blur))
          saturate(var(--ip-glass-sat));
        -webkit-backdrop-filter: blur(var(--ip-glass-blur))
          saturate(var(--ip-glass-sat));
      }
      #ip-popout-titlebar {
        height: 44px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        background: linear-gradient(
          180deg,
          var(--ip-glass-surface-strong),
          var(--ip-glass-surface)
        );
        border-bottom: 1px solid var(--ip-glass-border-soft);
        user-select: none;
        cursor: move;
        position: relative;
        backdrop-filter: blur(14px) saturate(170%);
        -webkit-backdrop-filter: blur(14px) saturate(170%);
      }
      #ip-popout-titlebar::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.42),
          rgba(255, 255, 255, 0)
        );
        opacity: 0.5;
        pointer-events: none;
      }
      #ip-popout-titlebar > * {
        position: relative;
        z-index: 1;
      }
      #ip-popout-title {
        flex: 1;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: var(--ip-glass-text);
        letter-spacing: 0.01em;
        opacity: 0.92;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ip-btn {
        appearance: none;
        border: 1px solid var(--ip-glass-border);
        background: var(--ip-glass-surface-soft);
        color: var(--ip-glass-text);
        border-radius: var(--ip-glass-radius-sm);
        padding: 6px 10px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        cursor: pointer;
        backdrop-filter: blur(10px) saturate(160%);
        -webkit-backdrop-filter: blur(10px) saturate(160%);
        box-shadow: inset 0 1px 0 var(--ip-glass-highlight),
          0 1px 2px rgba(0, 0, 0, 0.12);
        transition: background 120ms ease,
          box-shadow 120ms ease,
          transform 80ms ease;
      }
      .ip-btn:hover { background: var(--ip-glass-surface-strong); }
      .ip-btn:active {
        transform: translateY(1px) scale(0.98);
        box-shadow: inset 0 1px 0 var(--ip-glass-highlight);
      }
      .ip-btn:focus-visible {
        outline: 2px solid var(--ip-glass-accent);
        outline-offset: 1px;
      }
      #ip-popout-close {
        width: 28px;
        height: 28px;
        text-align: center;
        padding: 0;
        font-weight: 600;
        border-radius: 999px;
      }
      #ip-popout-close:hover {
        background: rgba(255, 59, 48, 0.22);
        border-color: rgba(255, 59, 48, 0.35);
      }
      #ip-popout-body {
        width: 100%;
        height: calc(100% - 44px);
        background: var(--ip-glass-image-backdrop);
      }
      #ip-popout-img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        background: var(--ip-glass-image-backdrop);
      }
      #ip-popout-resize {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
        background:
          linear-gradient(
            135deg,
            transparent 52%,
            rgba(255, 255, 255, 0.45) 52%
          ),
          linear-gradient(
            135deg,
            transparent 68%,
            rgba(255, 255, 255, 0.28) 68%
          ),
          linear-gradient(
            135deg,
            transparent 82%,
            rgba(255, 255, 255, 0.18) 82%
          );
        background-size: 18px 18px;
        background-repeat: no-repeat;
        opacity: 0.55;
        filter: drop-shadow(0 1px 0 var(--ip-glass-highlight));
      }
      #ip-popout-toast {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        background: var(--ip-glass-toast);
        color: var(--ip-glass-text);
        border: 1px solid var(--ip-glass-border);
        border-radius: 999px;
        padding: 8px 12px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-shadow: var(--ip-glass-shadow);
        backdrop-filter: blur(16px) saturate(160%);
        -webkit-backdrop-filter: blur(16px) saturate(160%);
        opacity: 0;
        transition: opacity 140ms ease;
        pointer-events: none;
      }
      #ip-popout-toast.ip-show { opacity: 1; }
    `;
    document.documentElement.appendChild(style);
  }

  function buildUi() {
    if (STATE.overlay) return;
    ensureStyles();

    const overlay = document.createElement("div");
    overlay.id = "ip-popout-overlay";

    const backdrop = document.createElement("div");
    backdrop.id = "ip-popout-backdrop";

    const win = document.createElement("div");
    win.id = "ip-popout-window";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "true");

    const titlebar = document.createElement("div");
    titlebar.id = "ip-popout-titlebar";

    const title = document.createElement("div");
    title.id = "ip-popout-title";
    title.textContent = "Image Popout";

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "ip-btn";
    btnCopy.textContent = "Copy URL";
    btnCopy.dataset.action = "copy";

    const btnOpen = document.createElement("button");
    btnOpen.type = "button";
    btnOpen.className = "ip-btn";
    btnOpen.textContent = "Open";
    btnOpen.dataset.action = "open";

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "ip-btn";
    btnClose.id = "ip-popout-close";
    btnClose.textContent = "×";
    btnClose.dataset.action = "close";
    btnClose.setAttribute("aria-label", "Close");

    const body = document.createElement("div");
    body.id = "ip-popout-body";

    const img = document.createElement("img");
    img.id = "ip-popout-img";
    img.alt = "";
    img.decoding = "async";

    const resize = document.createElement("div");
    resize.id = "ip-popout-resize";
    resize.setAttribute("role", "presentation");

    const toast = document.createElement("div");
    toast.id = "ip-popout-toast";
    toast.textContent = "";

    body.appendChild(img);
    titlebar.appendChild(title);
    titlebar.appendChild(btnCopy);
    titlebar.appendChild(btnOpen);
    titlebar.appendChild(btnClose);

    win.appendChild(titlebar);
    win.appendChild(body);
    win.appendChild(resize);

    overlay.appendChild(backdrop);
    overlay.appendChild(win);
    overlay.appendChild(toast);

    overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.id === "ip-popout-backdrop") {
        closePopout();
        return;
      }

      const action = target
        .closest("[data-action]")
        ?.getAttribute("data-action");
      if (action === "close") closePopout();
      if (action === "open") openInNewTab();
      if (action === "copy") copyUrlToClipboard();
    });

    titlebar.addEventListener("pointerdown", startDrag, { passive: false });
    resize.addEventListener("pointerdown", startResize, { passive: false });

    document.documentElement.appendChild(overlay);

    STATE.overlay = overlay;
    STATE.popout = win;
    STATE.titlebar = titlebar;
    STATE.img = img;
    STATE.title = title;
  }

  let popoutToastTimer = 0;
  function showPopoutToast(message) {
    const toast = document.getElementById("ip-popout-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("ip-show");
    window.clearTimeout(popoutToastTimer);
    popoutToastTimer = window.setTimeout(
      () => toast.classList.remove("ip-show"),
      1200,
    );
  }

  function openInNewTab() {
    if (!STATE.lastUrl) return;
    window.open(STATE.lastUrl, "_blank", "noopener,noreferrer");
  }

  async function copyUrlToClipboard() {
    if (!STATE.lastUrl) return;
    try {
      await navigator.clipboard.writeText(STATE.lastUrl);
      showPopoutToast("Copied URL");
    } catch {
      // Fallback: prompt (works on most pages even when Clipboard API is restricted)
      window.prompt("Copy image URL:", STATE.lastUrl);
    }
  }

  function maximizePopoutToViewport() {
    if (!STATE.popout) return;
    const { width: vw, height: vh } = getViewport();
    const padding = OPTIONS.viewportPadding;
    const winW = Math.max(1, Math.floor(vw - padding * 2));
    const winH = Math.max(1, Math.floor(vh - padding * 2));

    STATE.popout.style.left = `${padding}px`;
    STATE.popout.style.top = `${padding}px`;
    STATE.popout.style.width = `${winW}px`;
    STATE.popout.style.height = `${winH}px`;
  }

  function openPopout(url) {
    buildUi();
    if (!STATE.overlay || !STATE.popout || !STATE.img || !STATE.title) return;

    STATE.lastUrl = url;
    STATE.title.textContent = url;
    STATE.popoutAutoFit = true;

    maximizePopoutToViewport();

    STATE.overlay.classList.add("ip-open");

    // Load image
    const img = STATE.img;
    img.src = "";
    img.src = url;

    img.onload = () => clampPopoutToViewport();

    img.onerror = () => showPopoutToast("Failed to load image");
  }

  function closePopout() {
    if (!STATE.overlay) return;
    STATE.overlay.classList.remove("ip-open");
  }

  function clampPopoutToViewport() {
    if (!STATE.overlay || !STATE.popout) return;
    if (!STATE.overlay.classList.contains("ip-open")) return;

    const popout = STATE.popout;
    const { width: vw, height: vh } = getViewport();
    const padding = OPTIONS.viewportPadding;

    const rect = popout.getBoundingClientRect();
    const maxW = Math.max(1, Math.floor(vw - padding * 2));
    const maxH = Math.max(1, Math.floor(vh - padding * 2));

    const nextW = clamp(rect.width, 1, maxW);
    const nextH = clamp(rect.height, 1, maxH);

    let left = Number.parseFloat(popout.style.left);
    let top = Number.parseFloat(popout.style.top);
    if (!Number.isFinite(left)) left = rect.left;
    if (!Number.isFinite(top)) top = rect.top;

    left = clamp(left, padding, Math.max(padding, vw - nextW - padding));
    top = clamp(top, padding, Math.max(padding, vh - nextH - padding));

    popout.style.left = `${Math.floor(left)}px`;
    popout.style.top = `${Math.floor(top)}px`;
    popout.style.width = `${Math.floor(nextW)}px`;
    popout.style.height = `${Math.floor(nextH)}px`;
  }

  function startDrag(event) {
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0) return;

    const titlebar = event.currentTarget;
    if (!(titlebar instanceof Element)) return;

    event.preventDefault();
    STATE.popoutAutoFit = false;

    if (!STATE.popout) return;
    const popout = STATE.popout;

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = Number.parseFloat(popout.style.left) || 0;
    const startTop = Number.parseFloat(popout.style.top) || 0;

    const onMove = (moveEvent) => {
      if (!(moveEvent instanceof PointerEvent)) return;
      const { width: vw, height: vh } = getViewport();
      const padding = OPTIONS.viewportPadding;
      const rect = popout.getBoundingClientRect();

      const nextLeft = clamp(
        startLeft + (moveEvent.clientX - startX),
        padding,
        Math.max(padding, vw - rect.width - padding),
      );
      const nextTop = clamp(
        startTop + (moveEvent.clientY - startY),
        padding,
        Math.max(padding, vh - rect.height - padding),
      );

      popout.style.left = `${nextLeft}px`;
      popout.style.top = `${nextTop}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      document.documentElement.style.userSelect = "";
    };

    document.documentElement.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  }

  function startResize(event) {
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    STATE.popoutAutoFit = false;

    if (!STATE.popout) return;
    const popout = STATE.popout;

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = popout.getBoundingClientRect();
    const startW = rect.width;
    const startH = rect.height;
    const startLeft = rect.left;
    const startTop = rect.top;

    const onMove = (moveEvent) => {
      if (!(moveEvent instanceof PointerEvent)) return;
      const { width: vw, height: vh } = getViewport();
      const padding = OPTIONS.viewportPadding;

      const maxW = Math.max(1, vw - startLeft - padding);
      const maxH = Math.max(1, vh - startTop - padding);
      const minW = maxW >= OPTIONS.minWidth ? OPTIONS.minWidth : 1;
      const minH = maxH >= OPTIONS.minHeight ? OPTIONS.minHeight : 1;

      const nextW = clamp(startW + (moveEvent.clientX - startX), minW, maxW);
      const nextH = clamp(startH + (moveEvent.clientY - startY), minH, maxH);

      popout.style.width = `${Math.floor(nextW)}px`;
      popout.style.height = `${Math.floor(nextH)}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      document.documentElement.style.userSelect = "";
    };

    document.documentElement.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  }

  // ----- Hover preview -----
  const HOVER_STORE_KEY = "img_popout_safari_v1";
  const HOVER_DEFAULTS = {
    enabled: true,
    pinned: false,
    offset: 16,
    maxViewportFrac: 1.0,
    borderRadius: 14,
  };

  const HOVER_VIEWPORT_PAD = 8;
  const HOVER_WRAP_PADDING = 10; // keep in sync with hoverWrap styles
  const HOVER_WRAP_BORDER = 1; // keep in sync with hoverWrap styles
  const HOVER_WRAP_CHROME = HOVER_WRAP_PADDING * 2 + HOVER_WRAP_BORDER * 2;

  function loadHoverState() {
    try {
      const raw = localStorage.getItem(HOVER_STORE_KEY);
      if (!raw) return { ...HOVER_DEFAULTS };
      return { ...HOVER_DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...HOVER_DEFAULTS };
    }
  }

  const hoverState = loadHoverState();

  function saveHoverState() {
    try {
      localStorage.setItem(
        HOVER_STORE_KEY,
        JSON.stringify({
          enabled: hoverState.enabled,
          pinned: hoverState.pinned,
        }),
      );
    } catch {}
  }

  const hoverWrap = document.createElement("div");
  hoverWrap.id = "ip-hover-wrap";
  hoverWrap.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    // Keep below the modal overlay.
    "z-index:2147483646",
    "display:none",
    "pointer-events:none",
    "background: var(--ip-glass-surface-soft)",
    "backdrop-filter: blur(18px) saturate(160%)",
    "-webkit-backdrop-filter: blur(18px) saturate(160%)",
    `border:${HOVER_WRAP_BORDER}px solid var(--ip-glass-border)`,
    "box-shadow: var(--ip-glass-shadow)",
    `border-radius:${HOVER_DEFAULTS.borderRadius}px`,
    `padding:${HOVER_WRAP_PADDING}px`,
  ].join(";");

  const hoverImg = document.createElement("img");
  hoverImg.alt = "";
  hoverImg.decoding = "async";
  hoverImg.loading = "eager";
  hoverImg.style.cssText = [
    "display:block",
    "max-width: none",
    "max-height: none",
    `border-radius:${HOVER_DEFAULTS.borderRadius - 6}px`,
    "background: var(--ip-glass-image-backdrop)",
    "box-shadow: inset 0 0 0 1px var(--ip-glass-border-soft)",
  ].join(";");

  const hoverBadge = document.createElement("div");
  hoverBadge.style.cssText = [
    "position:absolute",
    "right:10px",
    "top:10px",
    "padding:4px 7px",
    "border-radius:999px",
    "font: 12px -apple-system, BlinkMacSystemFont, sans-serif",
    "color: var(--ip-glass-text)",
    "background: var(--ip-glass-surface-strong)",
    "border: 1px solid var(--ip-glass-border)",
    "backdrop-filter: blur(12px) saturate(160%)",
    "-webkit-backdrop-filter: blur(12px) saturate(160%)",
    "box-shadow: 0 6px 16px rgba(0,0,0,0.18)",
    "letter-spacing: 0.04em",
    "display:none",
  ].join(";");
  hoverBadge.textContent = "PINNED";

  hoverWrap.appendChild(hoverImg);
  hoverWrap.appendChild(hoverBadge);
  document.documentElement.appendChild(hoverWrap);

  const hoverToast = document.createElement("div");
  hoverToast.id = "ip-hover-toast";
  hoverToast.style.cssText = [
    "position: fixed",
    "left: 14px",
    "bottom: 14px",
    "z-index: 2147483646",
    "padding: 8px 10px",
    "border-radius: 12px",
    "background: var(--ip-glass-toast)",
    "color: var(--ip-glass-text)",
    "font: 12px -apple-system, BlinkMacSystemFont, sans-serif",
    "box-shadow: var(--ip-glass-shadow)",
    "border: 1px solid var(--ip-glass-border)",
    "backdrop-filter: blur(16px) saturate(160%)",
    "-webkit-backdrop-filter: blur(16px) saturate(160%)",
    "opacity: 0",
    "transform: translateY(6px)",
    "transition: opacity 140ms ease, transform 140ms ease",
    "pointer-events: none",
  ].join(";");
  document.documentElement.appendChild(hoverToast);

  let hoverToastTimer = 0;
  function showHoverToast(message) {
    hoverToast.textContent = message;
    hoverToast.style.opacity = "1";
    hoverToast.style.transform = "translateY(0px)";
    window.clearTimeout(hoverToastTimer);
    hoverToastTimer = window.setTimeout(() => {
      hoverToast.style.opacity = "0";
      hoverToast.style.transform = "translateY(6px)";
    }, 900);
  }

  const hoverActive = {
    el: null,
    url: "",
    lastMouse: { x: 0, y: 0 },
    natural: { w: 0, h: 0 },
  };

  function showHoverWrap() {
    hoverWrap.style.display = "block";
    hoverBadge.style.display = hoverState.pinned ? "block" : "none";
  }

  function hideHoverWrap() {
    hoverWrap.style.display = "none";
    hoverWrap.style.left = "-9999px";
    hoverWrap.style.top = "-9999px";
    hoverActive.el = null;
    hoverActive.url = "";
  }

  function hoverTargetIsTooSmall(el) {
    const rect = el.getBoundingClientRect?.();
    if (!rect) return true;
    return rect.width < 48 || rect.height < 48;
  }

  function findHoverZoomableTarget(startEl) {
    if (!(startEl instanceof Element)) return null;
    if (startEl === hoverWrap || hoverWrap.contains(startEl)) return null;
    if (startEl === hoverToast || hoverToast.contains(startEl)) return null;
    if (startEl.closest?.("#ip-popout-overlay")) return null;

    const imgEl = startEl.closest?.("img");
    if (imgEl) return imgEl;

    const el = startEl.closest?.("div,span,a,button,figure,section");
    if (!el) return null;

    const bg = getBackgroundImageUrl(el);
    if (bg) return el;

    return null;
  }

  function computeHoverFitSize(naturalW, naturalH) {
    const { width: vw, height: vh } = getViewport();
    const maxWrapW = Math.min(
      vw * hoverState.maxViewportFrac,
      vw - HOVER_VIEWPORT_PAD * 2,
    );
    const maxWrapH = Math.min(
      vh * hoverState.maxViewportFrac,
      vh - HOVER_VIEWPORT_PAD * 2,
    );
    const maxImgW = Math.max(1, Math.floor(maxWrapW - HOVER_WRAP_CHROME));
    const maxImgH = Math.max(1, Math.floor(maxWrapH - HOVER_WRAP_CHROME));
    const minImgW = Math.min(40, maxImgW);
    const minImgH = Math.min(40, maxImgH);

    const safeW = Math.max(1, naturalW);
    const safeH = Math.max(1, naturalH);

    const finalScale = Math.min(maxImgW / safeW, maxImgH / safeH);

    return {
      w: Math.max(minImgW, Math.floor(safeW * finalScale)),
      h: Math.max(minImgH, Math.floor(safeH * finalScale)),
    };
  }

  function updateHoverPosition(x, y) {
    const { width: vw, height: vh } = getViewport();

    const rect = hoverWrap.getBoundingClientRect();
    const w = rect.width || 300;
    const h = rect.height || 300;
    const pad = HOVER_VIEWPORT_PAD;

    let left = x + hoverState.offset;
    let top = y + hoverState.offset;

    if (left + w + pad > vw) left = x - hoverState.offset - w;
    if (top + h + pad > vh) top = y - hoverState.offset - h;

    left = clamp(left, pad, Math.max(pad, vw - w - pad));
    top = clamp(top, pad, Math.max(pad, vh - h - pad));

    hoverWrap.style.left = `${left}px`;
    hoverWrap.style.top = `${top}px`;
  }

  function applyHoverSize() {
    const naturalW = hoverActive.natural.w || 800;
    const naturalH = hoverActive.natural.h || 600;
    const { w, h } = computeHoverFitSize(naturalW, naturalH);
    hoverImg.style.width = `${w}px`;
    hoverImg.style.height = `${h}px`;
  }

  function setHoverImageUrl(url) {
    hoverImg.src = url;
    hoverImg.srcset = "";
    hoverImg.sizes = "";
    hoverActive.natural.w = 0;
    hoverActive.natural.h = 0;

    const maybeSet = () => {
      if (hoverImg.naturalWidth && hoverImg.naturalHeight) {
        hoverActive.natural.w = hoverImg.naturalWidth;
        hoverActive.natural.h = hoverImg.naturalHeight;
        applyHoverSize();
      }
    };

    maybeSet();
    if (!hoverActive.natural.w) {
      hoverImg.onload = () => {
        maybeSet();
      };
    }
  }

  function activateHoverTarget(el, mouseX, mouseY) {
    if (!hoverState.enabled) return;
    if (!el || hoverTargetIsTooSmall(el)) return;

    const url = pickBestUrlFromElement(el);
    if (!url) return;

    hoverActive.el = el;
    hoverActive.url = url;

    showHoverWrap();
    setHoverImageUrl(url);
    updateHoverPosition(mouseX, mouseY);
  }

  function disableHoverPreviewForPopout() {
    if (!hoverState.pinned && !hoverActive.el) return;
    hoverState.pinned = false;
    saveHoverState();
    hideHoverWrap();
  }

  function onHoverMouseOver(event) {
    if (!hoverState.enabled) return;
    if (hoverState.pinned) return;

    const target = findHoverZoomableTarget(event.target);
    if (!target) return;

    if (target !== hoverActive.el)
      activateHoverTarget(target, event.clientX, event.clientY);
  }

  function onHoverMouseMove(event) {
    hoverActive.lastMouse.x = event.clientX;
    hoverActive.lastMouse.y = event.clientY;

    if (!hoverState.enabled) return;
    if (!hoverActive.el) return;

    if (!hoverState.pinned) {
      const rect = hoverActive.el.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!inside) {
        hideHoverWrap();
        return;
      }
    }

    updateHoverPosition(event.clientX, event.clientY);
  }

  function onHoverClick(event) {
    if (!hoverState.enabled) return;
    if (event.altKey) return;

    const target = findHoverZoomableTarget(event.target);
    if (!target) return;

    if (!hoverActive.el) {
      activateHoverTarget(
        target,
        hoverActive.lastMouse.x,
        hoverActive.lastMouse.y,
      );
    }

    hoverState.pinned = !hoverState.pinned;
    saveHoverState();
    hoverBadge.style.display = hoverState.pinned ? "block" : "none";
    showHoverToast(hoverState.pinned ? "Pinned preview" : "Unpinned");
  }

  // ----- Shared keyboard handling -----
  function onKeyDown(event) {
    if (!(event instanceof KeyboardEvent)) return;

    if (event.key === "Escape") {
      closePopout();
      hoverState.pinned = false;
      saveHoverState();
      hideHoverWrap();
      return;
    }

    const tag = (event.target && event.target.tagName) || "";
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      event.target?.isContentEditable
    ) {
      return;
    }

    if (event.key === "z" || event.key === "Z") {
      hoverState.enabled = !hoverState.enabled;
      saveHoverState();
      showHoverToast(
        hoverState.enabled ? "Image preview: ON" : "Image preview: OFF",
      );
      if (!hoverState.enabled) hideHoverWrap();
      return;
    }

    if (event.key === "p" || event.key === "P") {
      if (!hoverActive.el && !hoverState.pinned) return;
      hoverState.pinned = !hoverState.pinned;
      saveHoverState();
      hoverBadge.style.display = hoverState.pinned ? "block" : "none";
      showHoverToast(hoverState.pinned ? "Pinned preview" : "Unpinned");

      if (!hoverState.pinned && hoverActive.el) {
        const rect = hoverActive.el.getBoundingClientRect();
        const x = hoverActive.lastMouse.x;
        const y = hoverActive.lastMouse.y;
        const inside =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        if (!inside) hideHoverWrap();
      }
    }
  }

  function onAltClick(event) {
    if (!(event instanceof MouseEvent)) return;
    if (!event.altKey) return;
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;

    const url = extractImageUrlFromEventTarget(event.target);
    if (!url) return;

    event.preventDefault();
    event.stopPropagation();

    disableHoverPreviewForPopout();
    openPopout(url);
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("click", onAltClick, true);
  window.addEventListener("resize", () => {
    if (
      STATE.overlay?.classList.contains("ip-open") &&
      STATE.popout &&
      STATE.popoutAutoFit
    ) {
      maximizePopoutToViewport();
    }
    clampPopoutToViewport();
    if (hoverWrap.style.display === "block") {
      applyHoverSize();
      updateHoverPosition(hoverActive.lastMouse.x, hoverActive.lastMouse.y);
    }
  });

  document.addEventListener("mouseover", onHoverMouseOver, true);
  document.addEventListener("mousemove", onHoverMouseMove, true);
  document.addEventListener("click", onHoverClick, true);

  showHoverToast(
    hoverState.enabled
      ? "Image preview ready (Z toggles)"
      : "Image preview OFF (press Z)",
  );
})();
