// ==UserScript==
// @name         Image Popout Preview (Safari)
// @namespace    imagepopout.safari.local
// @version      1.0.0
// @description  Hover images to pop out a larger preview near the cursor. Wheel resizes. Click pins. Z toggles. Esc hides.
// @match        *://*/*
// @run-at       document-end
// @noframes
// @inject-into  auto
// ==/UserScript==

(() => {
  "use strict";

  const STORE_KEY = "img_popout_safari_v1";

  const DEFAULTS = {
    enabled: true,
    pinned: false,
    // scale factor of the preview relative to its "fit-to-viewport" size
    scale: 1.0,          // wheel adjusts
    minScale: 0.45,
    maxScale: 2.25,
    offset: 16,          // preview offset from cursor
    maxViewportFrac: 0.72, // preview max size as fraction of viewport
    borderRadius: 14,
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveState() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          pinned: state.pinned,
          scale: state.scale,
        })
      );
    } catch {}
  }

  const state = loadState();

  // ---------- UI ----------
  const wrap = document.createElement("div");
  wrap.id = "img-popout-wrap";
  wrap.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    "z-index:2147483647",
    "display:none",
    "pointer-events:none",
    "background:rgba(12,12,12,0.78)",
    "backdrop-filter: blur(6px)",
    "-webkit-backdrop-filter: blur(6px)",
    "border:1px solid rgba(255,255,255,0.20)",
    "box-shadow: 0 12px 36px rgba(0,0,0,0.35)",
    `border-radius:${DEFAULTS.borderRadius}px`,
    "padding:10px",
  ].join(";");

  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";
  img.style.cssText = [
    "display:block",
    "max-width: none",
    "max-height: none",
    `border-radius:${DEFAULTS.borderRadius - 6}px`,
    "background: rgba(0,0,0,0.25)",
  ].join(";");

  const badge = document.createElement("div");
  badge.style.cssText = [
    "position:absolute",
    "right:10px",
    "top:10px",
    "padding:4px 7px",
    "border-radius:999px",
    "font: 12px -apple-system, BlinkMacSystemFont, sans-serif",
    "color: rgba(255,255,255,0.90)",
    "background: rgba(0,0,0,0.35)",
    "border: 1px solid rgba(255,255,255,0.15)",
    "display:none",
  ].join(";");
  badge.textContent = "PINNED";

  wrap.appendChild(img);
  wrap.appendChild(badge);
  document.documentElement.appendChild(wrap);

  const toast = document.createElement("div");
  toast.style.cssText = [
    "position: fixed",
    "left: 14px",
    "bottom: 14px",
    "z-index: 2147483647",
    "padding: 8px 10px",
    "border-radius: 10px",
    "background: rgba(15,15,15,0.80)",
    "color: rgba(255,255,255,0.92)",
    "font: 12px -apple-system, BlinkMacSystemFont, sans-serif",
    "box-shadow: 0 10px 28px rgba(0,0,0,0.30)",
    "border: 1px solid rgba(255,255,255,0.20)",
    "backdrop-filter: blur(6px)",
    "-webkit-backdrop-filter: blur(6px)",
    "opacity: 0",
    "transform: translateY(6px)",
    "transition: opacity 140ms ease, transform 140ms ease",
    "pointer-events: none",
  ].join(";");
  document.documentElement.appendChild(toast);

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0px)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
    }, 900);
  }

  function showWrap() {
    wrap.style.display = "block";
    badge.style.display = state.pinned ? "block" : "none";
  }
  function hideWrap() {
    wrap.style.display = "none";
    wrap.style.left = "-9999px";
    wrap.style.top = "-9999px";
    active.el = null;
    active.url = "";
  }

  // ---------- Target picking ----------
  const active = {
    el: null,
    url: "",
    lastMouse: { x: 0, y: 0 },
    natural: { w: 0, h: 0 },
  };

  function parseSrcset(srcset) {
    const parts = srcset
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(entry => {
        const [u, d] = entry.split(/\s+/, 2);
        if (!u) return null;
        let score = 0;
        if (d?.endsWith("w")) score = parseFloat(d) || 0;
        else if (d?.endsWith("x")) score = (parseFloat(d) || 0) * 10000;
        return { url: u, score };
      })
      .filter(Boolean);
    if (!parts.length) return "";
    parts.sort((a, b) => b.score - a.score);
    return parts[0].url;
  }

  function looksLikeImageUrl(u) {
    if (!u) return false;
    const clean = u.split("#")[0];
    return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(clean);
  }

  function getBackgroundImageUrl(el) {
    try {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") return "";
      const m = bg.match(/url\(["']?(.*?)["']?\)/i);
      return m?.[1] || "";
    } catch {
      return "";
    }
  }

  function pickBestUrl(el) {
    if (!el) return "";

    if (el.tagName === "IMG") {
      const im = el;

      if (im.currentSrc) return im.currentSrc;

      const srcset = im.getAttribute("srcset") || im.srcset;
      const best = srcset ? parseSrcset(srcset) : "";
      if (best) return best;

      const lazyKeys = [
        "data-src", "data-original", "data-url", "data-lazy-src",
        "data-zoom-src", "data-hires", "data-full", "data-large"
      ];
      for (const k of lazyKeys) {
        const v = im.getAttribute(k);
        if (v) return v;
      }

      if (im.src) return im.src;
    }

    // link to image?
    const a = el.closest?.("a[href]");
    if (a) {
      const href = a.getAttribute("href") || "";
      if (looksLikeImageUrl(href)) return href;
    }

    // background-image
    const bg = getBackgroundImageUrl(el);
    if (bg) return bg;

    return "";
  }

  function findZoomableTarget(startEl) {
    if (!startEl) return null;
    if (startEl === wrap || wrap.contains(startEl) || startEl === toast || toast.contains(startEl)) return null;

    const im = startEl.closest?.("img");
    if (im) return im;

    const el = startEl.closest?.("div,span,a,button,figure,section");
    if (el) {
      const bg = getBackgroundImageUrl(el);
      if (bg) return el;
    }
    return null;
  }

  function targetIsTooSmall(el) {
    const r = el.getBoundingClientRect?.();
    if (!r) return true;
    return r.width < 48 || r.height < 48;
  }

  // ---------- Sizing & positioning ----------
  function computeFitSize(nw, nh) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const maxW = vw * state.maxViewportFrac;
    const maxH = vh * state.maxViewportFrac;

    // scale to fit within maxW/maxH, then apply user scale
    const fitScale = Math.min(maxW / nw, maxH / nh, 1);
    const finalScale = clamp(fitScale * state.scale, 0.05, 10);

    return {
      w: Math.max(40, Math.round(nw * finalScale)),
      h: Math.max(40, Math.round(nh * finalScale)),
    };
  }

  function updatePosition(x, y) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rect = wrap.getBoundingClientRect();
    const w = rect.width || 300;
    const h = rect.height || 300;

    let left = x + state.offset;
    let top = y + state.offset;

    if (left + w + 10 > vw) left = x - state.offset - w;
    if (top + h + 10 > vh) top = y - state.offset - h;

    left = clamp(left, 8, vw - w - 8);
    top = clamp(top, 8, vh - h - 8);

    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
  }

  function applySize() {
    const nw = active.natural.w || 800;
    const nh = active.natural.h || 600;
    const { w, h } = computeFitSize(nw, nh);
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
  }

  async function setImageUrl(url) {
    // load image so we know natural size, but keep it snappy
    img.src = url;
    img.srcset = "";
    img.sizes = "";
    active.natural.w = 0;
    active.natural.h = 0;

    // If it already has natural sizes, use them
    const maybeSet = () => {
      if (img.naturalWidth && img.naturalHeight) {
        active.natural.w = img.naturalWidth;
        active.natural.h = img.naturalHeight;
        applySize();
      }
    };

    maybeSet();
    if (!active.natural.w) {
      img.onload = () => {
        maybeSet();
      };
    }
  }

  function activateTarget(el, mouseX, mouseY) {
    if (!state.enabled) return;
    if (!el || targetIsTooSmall(el)) return;

    const url = pickBestUrl(el);
    if (!url) return;

    active.el = el;
    active.url = url;

    showWrap();
    setImageUrl(url);
    updatePosition(mouseX, mouseY);
  }

  // ---------- Events ----------
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!state.enabled) return;
      if (state.pinned) return;

      const t = findZoomableTarget(e.target);
      if (!t) return;

      if (t !== active.el) activateTarget(t, e.clientX, e.clientY);
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      active.lastMouse.x = e.clientX;
      active.lastMouse.y = e.clientY;

      if (!state.enabled) return;
      if (!active.el) return;

      if (!state.pinned) {
        const r = active.el.getBoundingClientRect();
        const inside =
          e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom;

        if (!inside) {
          hideWrap();
          return;
        }
      }

      updatePosition(e.clientX, e.clientY);
    },
    true
  );

  // Pin/unpin with click while preview is visible.
  document.addEventListener(
    "click",
    (e) => {
      if (!state.enabled) return;

      // clicking the hovered image toggles pin
      const t = findZoomableTarget(e.target);
      if (!t) return;

      if (!active.el) activateTarget(t, active.lastMouse.x, active.lastMouse.y);

      state.pinned = !state.pinned;
      saveState();
      badge.style.display = state.pinned ? "block" : "none";
      showToast(state.pinned ? "Pinned preview" : "Unpinned");
    },
    true
  );

  document.addEventListener(
    "wheel",
    (e) => {
      if (!state.enabled) return;
      if (!active.el || wrap.style.display !== "block") return;

      // prevent page scroll only when we're actively previewing
      e.preventDefault();

      const delta = Math.sign(e.deltaY);
      const step = e.shiftKey ? 0.10 : 0.06;

      state.scale = clamp(state.scale + delta * step, state.minScale, state.maxScale);
      saveState();
      applySize();
      updatePosition(active.lastMouse.x, active.lastMouse.y);

      showToast(`Preview: ${(state.scale * 100).toFixed(0)}%`);
    },
    { passive: false, capture: true }
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;

      if (e.key === "Escape") {
        state.pinned = false;
        saveState();
        hideWrap();
      } else if (e.key === "z" || e.key === "Z") {
        state.enabled = !state.enabled;
        saveState();
        showToast(state.enabled ? "Image popout: ON" : "Image popout: OFF");
        if (!state.enabled) hideWrap();
      } else if (e.key === "p" || e.key === "P") {
        if (!active.el && !state.pinned) return;
        state.pinned = !state.pinned;
        saveState();
        badge.style.display = state.pinned ? "block" : "none";
        showToast(state.pinned ? "Pinned preview" : "Unpinned");
        if (!state.pinned && active.el) {
          const r = active.el.getBoundingClientRect();
          const x = active.lastMouse.x, y = active.lastMouse.y;
          const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          if (!inside) hideWrap();
        }
      }
    },
    true
  );

  showToast(state.enabled ? "Image popout ready (Z toggles)" : "Image popout OFF (press Z)");
})();// ==UserScript==
// @name         New Userscript
// @namespace    http://tampermonkey.net/
// @version      2026-02-03
// @description  try to take over the world!
// @author       You
// @match        https://www.youtube.com/watch?v=NGhp84H5jUY
// @icon         http://youtube.com/favicon.ico
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Your code here...
})();