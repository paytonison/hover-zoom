// ==UserScript==
// @name         HoverZoom (Safari) — X/Instagram Full-Res Preview
// @namespace    asari.hoverzoom
// @version      1.1.0
// @description  Hover to preview full-resolution images/videos in an overlay. Fixes Instagram (CDN URLs often live in CSS background-image inside anchors).
// @author       Asari
// @match        *://x.com/*
// @match        *://*.x.com/*
// @match        *://twitter.com/*
// @match        *://*.twitter.com/*
// @match        *://www.instagram.com/*
// @match        *://instagram.com/*
// @match        *://www.reddit.com/*
// @match        *://old.reddit.com/*
// @match        *://new.reddit.com/*
// @match        *://*.redd.it/*
// @match        *://imgur.com/*
// @match        *://*.imgur.com/*
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_download
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const CFG = {
    enabled: true,
    hoverDelayMs: 140,
    hideDelayMs: 60,
    maxW: 0.7,
    maxH: 0.78,
    offsetPx: 16,
    wheelZoomStep: 0.12,
    wheelZoomMin: 0.25,
    wheelZoomMax: 5.0,
    onlyWhenAltHeld: false,
    ignoreWhenTyping: true,
    debug: false,
  };

  const log = (...args) => CFG.debug && console.log("[HoverZoom]", ...args);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isEditableTarget = (t) => {
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || t.isContentEditable;
  };

  function safeURL(u) {
    try {
      return new URL(u, location.href);
    } catch {
      return null;
    }
  }

  function uniq(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      if (!x || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  }

  function pickLargestFromSrcset(srcset) {
    if (!srcset || typeof srcset !== "string") return null;
    const parts = srcset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let best = null;
    let bestW = -1;
    for (const p of parts) {
      const m = p.match(/^(\S+)\s+(\d+)w$/);
      if (m) {
        const url = m[1];
        const w = parseInt(m[2], 10);
        if (w > bestW) {
          bestW = w;
          best = url;
        }
      } else {
        best = p.split(/\s+/)[0];
      }
    }
    return best;
  }

  function extractCssBgUrl(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = cs && cs.backgroundImage;
    if (!bg || bg === "none") return null;
    const m = bg.match(/url\(["']?(.+?)["']?\)/i);
    return m ? m[1] : null;
  }

  // Walk up a bit: stable enough to not thrash on IG
  function closestInteresting(el) {
    if (!el) return null;
    const img = el.closest && el.closest("img");
    if (img) return img;
    const vid = el.closest && el.closest("video");
    if (vid) return vid;

    // Don’t immediately jump to <a>. IG often wraps media in <a> but the actual URL is inside.
    const a = el.closest && el.closest("a[href]");
    if (a) return a;

    // Background-image tiles often live on divs; fallback to nearest element
    return el;
  }

  // Scan descendants (limited) looking for CSS background-image urls.
  function findBgUrlInSubtree(root, maxNodes = 80) {
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = 0;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const bg = extractCssBgUrl(el);
      if (bg) return bg;
      n++;
      if (n >= maxNodes) break;
    }
    return null;
  }

  // For IG: anchors wrap the media; prefer media inside anchor over href.
  function elementMediaHint(el) {
    if (!el) return null;
    const tag = (el.tagName || "").toLowerCase();

    if (tag === "img") {
      const srcsetBest = pickLargestFromSrcset(el.getAttribute("srcset"));
      return (
        el.currentSrc ||
        srcsetBest ||
        el.src ||
        el.getAttribute("src") ||
        el.getAttribute("data-src") ||
        el.getAttribute("data-url") ||
        null
      );
    }

    if (tag === "video") {
      const src = el.currentSrc || el.src || el.getAttribute("src");
      if (src && !String(src).startsWith("blob:")) return src;
      return el.poster || el.getAttribute("poster") || null;
    }

    // IMPORTANT: handle <a> specially (Instagram)
    if (tag === "a") {
      // 1) look for img inside (IG often uses <img ... srcset=...>)
      const img = el.querySelector("img");
      if (img) {
        const srcsetBest = pickLargestFromSrcset(img.getAttribute("srcset"));
        const got =
          img.currentSrc ||
          srcsetBest ||
          img.src ||
          img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-url");
        if (got) return got;
      }

      // 2) look for video inside
      const vid = el.querySelector("video");
      if (vid) {
        const src = vid.currentSrc || vid.src || vid.getAttribute("src");
        if (src && !String(src).startsWith("blob:")) return src;
        const poster = vid.poster || vid.getAttribute("poster");
        if (poster) return poster;
      }

      // 3) look for CSS background-image inside anchor (THIS is your scontent-… case)
      const bg = findBgUrlInSubtree(el, 120);
      if (bg) return bg;

      // 4) only now fall back to href
      return el.href || el.getAttribute("href") || null;
    }

    // Non-anchor: check background-image on self first
    const bg = extractCssBgUrl(el);
    if (bg) return bg;

    // data-* fallbacks
    return (
      el.getAttribute?.("data-src") || el.getAttribute?.("data-url") || null
    );
  }

  // -------------------------
  // URL resolvers
  // -------------------------
  function resolveMedia(urlStr) {
    const u = safeURL(urlStr);
    if (!u) return null;

    const host = u.hostname;
    const path = u.pathname;
    const lowerPath = path.toLowerCase();

    const looksImage =
      /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(urlStr) ||
      /\/media\//i.test(path);
    const looksVideo = /\.(mp4|webm|mov)(\?|$)/i.test(urlStr);

    // Avoid trying to preview IG post pages (we want the CDN asset)
    if (
      (host === "instagram.com" || host.endsWith(".instagram.com")) &&
      /^\/(p|reel|tv)\//i.test(path)
    ) {
      return null;
    }

    // X/Twitter images
    if (host === "pbs.twimg.com") {
      if (path.startsWith("/profile_images/")) {
        const base = urlStr.replace(/_(normal|bigger|mini)(?=\.)/i, "");
        return { type: "image", candidates: uniq([base, urlStr]) };
      }

      if (/:small$|:medium$|:large$/i.test(urlStr)) {
        const cand = urlStr.replace(/:(small|medium|large)$/i, ":orig");
        return { type: "image", candidates: uniq([cand, urlStr]) };
      }

      const formatsToTry = ["jpg", "png", "webp"];
      const q = u.searchParams;
      const existingFormat = q.get("format");
      const existingName = q.get("name");
      const extMatch = lowerPath.match(/\.(jpg|jpeg|png|webp|gif)$/i);
      const inferred = extMatch
        ? extMatch[1].toLowerCase() === "jpeg"
          ? "jpg"
          : extMatch[1].toLowerCase()
        : null;

      const fmtFirst = existingFormat || inferred || "jpg";
      const fmtOrder = uniq([fmtFirst, ...formatsToTry]);

      const base = new URL(u.toString());
      base.searchParams.set("name", "orig");

      const candidates = [];
      for (const fmt of fmtOrder) {
        const t = new URL(base.toString());
        t.searchParams.set("format", fmt);
        candidates.push(t.toString());
      }

      const t4096 = new URL(u.toString());
      t4096.searchParams.set("name", "4096x4096");
      if (existingFormat) t4096.searchParams.set("format", existingFormat);
      candidates.push(t4096.toString());

      return { type: "image", candidates: uniq([...candidates, urlStr]) };
    }

    // Reddit preview -> i.redd.it attempt
    if (host === "preview.redd.it") {
      const noQuery = `${u.origin}${u.pathname}`;
      const iHost = new URL(noQuery);
      iHost.hostname = "i.redd.it";
      return {
        type: "image",
        candidates: uniq([iHost.toString(), noQuery, urlStr]),
      };
    }

    // Imgur size suffix stripping
    if (host.endsWith("imgur.com")) {
      const candBase = urlStr.replace(
        /([a-zA-Z0-9]+)[sbtmlh](\.(png|jpe?g|gif|webp))(\?.*)?$/i,
        "$1$2$4",
      );
      if (candBase !== urlStr) {
        return { type: "image", candidates: uniq([candBase, urlStr]) };
      }
    }

    // Instagram CDN assets: keep query params (they often matter)
    if (
      host.includes("cdninstagram") ||
      host.includes("scontent") ||
      host.includes("instagram")
    ) {
      if (looksVideo)
        return { type: "video", candidates: [u.toString(), urlStr] };
      if (looksImage)
        return { type: "image", candidates: [u.toString(), urlStr] };

      // Sometimes IG assets don’t end with an extension in weird cases; treat as image anyway.
      if (host.includes("cdninstagram") || host.includes("scontent")) {
        return { type: "image", candidates: [u.toString(), urlStr] };
      }
    }

    if (looksVideo) return { type: "video", candidates: [urlStr] };
    if (looksImage) return { type: "image", candidates: [urlStr] };

    return null;
  }

  // -------------------------
  // Overlay UI (shadow DOM)
  // -------------------------
  const host = document.createElement("div");
  host.id = "asari-hoverzoom-host";
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .wrap {
      position: fixed;
      left: 0; top: 0;
      transform: translate3d(-9999px,-9999px,0);
      max-width: ${Math.round(CFG.maxW * 100)}vw;
      max-height:${Math.round(CFG.maxH * 100)}vh;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 18px 60px rgba(0,0,0,.35);
      background: rgba(10,10,12,.86);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,.10);
      pointer-events: none;
      display: none;
    }
    .inner {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      position: relative;
    }
    img, video {
      display:block;
      max-width: 100%;
      max-height:${Math.round(CFG.maxH * 100)}vh;
      object-fit: contain;
      transform-origin: center center;
      will-change: transform;
    }
    .hud {
      position:absolute;
      left: 10px;
      top: 10px;
      font: 12px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: rgba(255,255,255,.92);
      background: rgba(0,0,0,.50);
      padding: 6px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.14);
      letter-spacing: .2px;
      user-select: none;
      max-width: calc(100% - 20px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      position:absolute;
      left: 10px;
      bottom: 10px;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: rgba(255,255,255,.85);
      background: rgba(0,0,0,.45);
      padding: 5px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.12);
      user-select: none;
      max-width: calc(100% - 20px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spinner {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 2px solid rgba(255,255,255,.25);
      border-top-color: rgba(255,255,255,.85);
      animation: spin .8s linear infinite;
      margin: 18px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const inner = document.createElement("div");
  inner.className = "inner";

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.textContent = "HoverZoom";

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Esc: hide • P: pin • O: open • C: copy • Wheel: zoom";

  const spinner = document.createElement("div");
  spinner.className = "spinner";

  inner.appendChild(spinner);
  inner.appendChild(hud);
  inner.appendChild(hint);
  wrap.appendChild(inner);

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  let mediaEl = null;

  function setMediaElement(type) {
    if (mediaEl && mediaEl.parentNode) mediaEl.parentNode.removeChild(mediaEl);

    if (type === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.controls = false;
      // Help some CDNs that care about Referer; keep origin on cross-site.
      v.referrerPolicy = "strict-origin-when-cross-origin";
      mediaEl = v;
    } else {
      const img = document.createElement("img");
      img.decoding = "async";
      img.loading = "eager";
      img.referrerPolicy = "strict-origin-when-cross-origin";
      mediaEl = img;
    }
    inner.insertBefore(mediaEl, hud);
  }

  let hoverTimer = null;
  let hideTimer = null;
  let pinned = false;

  let lastTarget = null;
  let lastResolvedKey = null;
  let lastRaw = null;

  let mouseX = 0;
  let mouseY = 0;
  let zoom = 1;

  function positionOverlay() {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    const rect = wrap.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 240;

    let x = mouseX + CFG.offsetPx;
    let y = mouseY + CFG.offsetPx;

    if (x + w > vpW - 8) x = mouseX - CFG.offsetPx - w;
    if (y + h > vpH - 8) y = mouseY - CFG.offsetPx - h;

    x = clamp(x, 8, vpW - w - 8);
    y = clamp(y, 8, vpH - h - 8);

    wrap.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  function showOverlay() {
    wrap.style.display = "block";
    positionOverlay();
  }

  function hideOverlay(force = false) {
    if (pinned && !force) return;
    lastResolvedKey = null;
    lastRaw = null;
    zoom = 1;
    if (mediaEl) mediaEl.style.transform = "scale(1)";
    wrap.style.transform = "translate3d(-9999px,-9999px,0)";
    wrap.style.display = "none";
    spinner.style.display = "block";
    if (mediaEl) mediaEl.removeAttribute("src");
  }

  function setHud(text) {
    hud.textContent = text;
  }
  function setZoom(z) {
    zoom = clamp(z, CFG.wheelZoomMin, CFG.wheelZoomMax);
    if (mediaEl) mediaEl.style.transform = `scale(${zoom})`;
  }

  async function tryLoadCandidates(type, candidates) {
    candidates = uniq(candidates);
    if (!candidates.length) return null;

    if (type === "video") return candidates[0];

    for (const url of candidates) {
      const ok = await new Promise((resolve) => {
        const im = new Image();
        im.referrerPolicy = "strict-origin-when-cross-origin";
        im.onload = () => resolve(true);
        im.onerror = () => resolve(false);
        im.src = url;
      });
      if (ok) return url;
    }
    return null;
  }

  async function startPreviewFromUrl(rawUrl) {
    const resolved = resolveMedia(rawUrl);
    if (!resolved) return;

    const { type, candidates } = resolved;
    const key = candidates[0] || rawUrl;

    if (lastResolvedKey === key && wrap.style.display === "block") return;

    lastResolvedKey = key;
    lastRaw = rawUrl;

    setMediaElement(type);
    spinner.style.display = "block";
    setHud("Loading…");
    showOverlay();

    const chosen = await tryLoadCandidates(type, candidates);
    if (!chosen) {
      setHud("No preview (blocked/expired)");
      return;
    }

    if (!lastResolvedKey || lastResolvedKey !== key) return;

    if (type === "video") {
      mediaEl.src = chosen;
      try {
        await mediaEl.play();
      } catch {}
      setHud(new URL(chosen).hostname);
    } else {
      mediaEl.src = chosen;
      setHud(new URL(chosen).hostname);
    }

    spinner.style.display = "none";
    setZoom(1);
    positionOverlay();
  }

  function cancelHoverTimer() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideOverlay(false), CFG.hideDelayMs);
  }

  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (wrap.style.display === "block") positionOverlay();
  }

  function shouldIgnore(e) {
    if (!CFG.enabled) return true;
    if (CFG.onlyWhenAltHeld && !e.altKey) return true;
    if (CFG.ignoreWhenTyping && isEditableTarget(e.target)) return true;
    if (e.buttons && e.buttons !== 0) return true;
    return false;
  }

  function onPointerOver(e) {
    if (shouldIgnore(e)) return;

    const t = closestInteresting(e.target);
    if (!t || t === lastTarget) return;
    if (t === host || shadow.contains(t)) return;

    const raw = elementMediaHint(t);
    if (!raw) return;

    const resolved = resolveMedia(raw);
    if (!resolved) return;

    lastTarget = t;
    cancelHoverTimer();
    if (hideTimer) clearTimeout(hideTimer);

    hoverTimer = setTimeout(() => {
      if (t !== lastTarget) return;
      startPreviewFromUrl(raw);
    }, CFG.hoverDelayMs);
  }

  function onPointerOut(e) {
    if (pinned) return;
    const leaving = e.target;
    if (leaving && leaving === lastTarget) {
      lastTarget = null;
      cancelHoverTimer();
      scheduleHide();
    }
  }

  function onKeyDown(e) {
    if (CFG.ignoreWhenTyping && isEditableTarget(e.target)) return;
    const k = e.key.toLowerCase();

    if (k === "escape") {
      pinned = false;
      hideOverlay(true);
      return;
    }
    if (k === "z") {
      CFG.enabled = !CFG.enabled;
      if (!CFG.enabled) hideOverlay(true);
      return;
    }
    if (k === "p") {
      if (wrap.style.display === "block") pinned = !pinned;
      return;
    }

    if (k === "o") {
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const openUrl = resolved?.candidates?.[0] || lastRaw;
      window.open(openUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (k === "c") {
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const copyUrl = resolved?.candidates?.[0] || lastRaw;
      if (typeof GM_setClipboard === "function") GM_setClipboard(copyUrl);
      else navigator.clipboard?.writeText(copyUrl).catch(() => {});
      return;
    }

    if (k === "d") {
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const dlUrl = resolved?.candidates?.[0] || lastRaw;
      if (typeof GM_download === "function") {
        const filename = (() => {
          try {
            const uu = new URL(dlUrl);
            const base = uu.pathname.split("/").pop() || "image";
            return base.split("?")[0];
          } catch {
            return "image";
          }
        })();
        GM_download({ url: dlUrl, name: filename });
      } else {
        window.open(dlUrl, "_blank", "noopener,noreferrer");
      }
    }
  }

  function onWheel(e) {
    if (wrap.style.display !== "block") return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const next = zoom * (1 - delta * CFG.wheelZoomStep);
    setZoom(next);
    positionOverlay();
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Toggle HoverZoom (Z)", () => {
      CFG.enabled = !CFG.enabled;
      if (!CFG.enabled) hideOverlay(true);
    });
    GM_registerMenuCommand("Toggle Alt-only mode", () => {
      CFG.onlyWhenAltHeld = !CFG.onlyWhenAltHeld;
    });
  }

  document.addEventListener("pointermove", onPointerMove, {
    capture: true,
    passive: true,
  });
  document.addEventListener("pointerover", onPointerOver, {
    capture: true,
    passive: true,
  });
  document.addEventListener("pointerout", onPointerOut, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });

  hideOverlay(true);
  log("loaded");
})();

