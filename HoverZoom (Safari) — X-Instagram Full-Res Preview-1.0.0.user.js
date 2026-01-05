// ==UserScript==
// @name         HoverZoom (Safari) — X/Instagram Full-Res Preview
// @namespace    asari.hoverzoom
// @version      1.0.0
// @description  Hover to preview full-resolution images/videos in an overlay. X/Twitter pbs.twimg.com orig rewrite + srcset max pick + pin/open/copy.
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
  'use strict';

  // -------------------------
  // Config
  // -------------------------
  const CFG = {
    enabled: true,
    hoverDelayMs: 140,
    hideDelayMs: 60,
    maxW: 0.70,          // 70vw
    maxH: 0.78,          // 78vh
    offsetPx: 16,
    wheelZoomStep: 0.12, // scale increment per wheel notch
    wheelZoomMin: 0.25,
    wheelZoomMax: 5.0,
    onlyWhenAltHeld: false,   // set true if you want Alt-to-zoom mode
    ignoreWhenTyping: true,
    debug: false,
  };

  const log = (...args) => CFG.debug && console.log('[HoverZoom]', ...args);

  // -------------------------
  // Small utilities
  // -------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isEditableTarget = (t) => {
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable;
  };

  function safeURL(u) {
    try { return new URL(u, location.href); } catch { return null; }
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
    // srcset: "url 320w, url 640w, ..."
    if (!srcset || typeof srcset !== 'string') return null;
    const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
    let best = null;
    let bestW = -1;
    for (const p of parts) {
      const m = p.match(/^(\S+)\s+(\d+)w$/);
      if (m) {
        const url = m[1];
        const w = parseInt(m[2], 10);
        if (w > bestW) { bestW = w; best = url; }
      } else {
        // fallback: if no width descriptor, just take last
        best = p.split(/\s+/)[0];
      }
    }
    return best;
  }

  function extractCssBgUrl(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = cs && cs.backgroundImage;
    if (!bg || bg === 'none') return null;
    const m = bg.match(/url\(["']?(.+?)["']?\)/i);
    return m ? m[1] : null;
  }

  function closestInteresting(el) {
    if (!el) return null;
    const img = el.closest && el.closest('img');
    if (img) return img;
    const vid = el.closest && el.closest('video');
    if (vid) return vid;
    const a = el.closest && el.closest('a[href]');
    if (a) return a;
    return el;
  }

  function elementMediaHint(el) {
    // Try to extract a usable media URL from common attributes.
    if (!el) return null;

    const tag = (el.tagName || '').toLowerCase();

    if (tag === 'img') {
      // currentSrc is usually best (after srcset selection)
      const srcsetBest = pickLargestFromSrcset(el.getAttribute('srcset'));
      return el.currentSrc || srcsetBest || el.src || el.getAttribute('src') ||
             el.getAttribute('data-src') || el.getAttribute('data-url') || null;
    }

    if (tag === 'video') {
      // video might be blob:; use poster as fallback
      const src = el.currentSrc || el.src || el.getAttribute('src');
      if (src && !String(src).startsWith('blob:')) return src;
      return el.poster || el.getAttribute('poster') || null;
    }

    if (tag === 'a') {
      const href = el.href || el.getAttribute('href');
      if (href) return href;
    }

    // background-image candidates (common on X)
    const bg = extractCssBgUrl(el);
    if (bg) return bg;

    // data-* fallbacks
    return el.getAttribute?.('data-src') || el.getAttribute?.('data-url') || null;
  }

  // -------------------------
  // URL resolvers (site-aware)
  // Returns: { type: 'image'|'video', candidates: [url1, url2, ...] }
  // -------------------------
  function resolveMedia(urlStr) {
    const u = safeURL(urlStr);
    if (!u) return null;

    const host = u.hostname;
    const path = u.pathname;

    // If it's an obvious direct image/video, keep it.
    const lowerPath = path.toLowerCase();
    const looksImage = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(urlStr) || /\/media\//i.test(path);
    const looksVideo = /\.(mp4|webm|mov)(\?|$)/i.test(urlStr) || host.includes('video');

    // 1) X/Twitter images: pbs.twimg.com
    // Typical: https://pbs.twimg.com/media/XYZ?format=jpg&name=medium
    // Full:    https://pbs.twimg.com/media/XYZ?format=jpg&name=orig
    // Note: some images 404 if format mismatched; we try fallbacks.  [oai_citation:0‡Gist](https://gist.github.com/Colerar/80da426728e38a907cc811ac821bf307?utm_source=chatgpt.com)
    if (host === 'pbs.twimg.com') {
      // Profile images: remove _normal/_bigger/_mini to get larger.
      if (path.startsWith('/profile_images/')) {
        const base = urlStr.replace(/_(normal|bigger|mini)(?=\.)/i, '');
        return { type: 'image', candidates: uniq([base, urlStr]) };
      }

      // Old suffix style: ...:small / :large / :orig (still seen in some places)
      if (/:small$|:medium$|:large$/i.test(urlStr)) {
        const cand = urlStr.replace(/:(small|medium|large)$/i, ':orig');
        return { type: 'image', candidates: uniq([cand, urlStr]) };
      }

      // Query-param style
      const formatsToTry = ['jpg', 'png', 'webp'];
      const q = u.searchParams;
      const existingFormat = q.get('format');
      const existingName = q.get('name');

      // Try to infer format from path extension if present
      const extMatch = lowerPath.match(/\.(jpg|jpeg|png|webp|gif)$/i);
      const inferred = extMatch ? (extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase()) : null;

      const fmtFirst = existingFormat || inferred || 'jpg';
      const fmtOrder = uniq([fmtFirst, ...formatsToTry]);

      const base = new URL(u.toString());
      base.searchParams.set('name', 'orig');
      // keep any other params that matter, but ensure format gets set per attempt.

      const candidates = [];
      for (const fmt of fmtOrder) {
        const t = new URL(base.toString());
        t.searchParams.set('format', fmt);
        candidates.push(t.toString());
      }

      // Also try a "4096x4096" variant sometimes used by X (nice when it exists)
      if (existingName && /^\d+x\d+$/i.test(existingName)) {
        const t = new URL(u.toString());
        t.searchParams.set('name', 'orig');
        candidates.unshift(t.toString());
      } else {
        const t = new URL(u.toString());
        t.searchParams.set('name', '4096x4096');
        if (existingFormat) t.searchParams.set('format', existingFormat);
        candidates.push(t.toString());
      }

      return { type: 'image', candidates: uniq([...candidates, urlStr]) };
    }

    // 2) Reddit: preview.redd.it -> i.redd.it attempt (best effort)
    // A lot of reddit "preview" URLs have width/crop params; stripping + switching host often helps in-browser.
    if (host === 'preview.redd.it') {
      const noQuery = `${u.origin}${u.pathname}`;
      const iHost = new URL(noQuery);
      iHost.hostname = 'i.redd.it';
      return { type: 'image', candidates: uniq([iHost.toString(), noQuery, urlStr]) };
    }

    // 3) Imgur: remove size suffix letter before extension (e.g. abcdefh.jpg -> abcdef.jpg)
    if (host.endsWith('imgur.com')) {
      // If it's already i.imgur.com direct, normalize sizes; else let user click open.
      // Common sizes: s b t m l h (and more). This targets the classic pattern.
      const direct = urlStr.includes('i.imgur.com') ? urlStr : null;
      const candBase = (direct || urlStr).replace(/([a-zA-Z0-9]+)[sbtmlh](\.(png|jpe?g|gif|webp))(\?.*)?$/i, '$1$2$4');
      if (candBase !== urlStr) {
        return { type: 'image', candidates: uniq([candBase, urlStr]) };
      }
    }

    // 4) Instagram: usually best available is already in srcset; we mainly trust src/srcset.
    // If you hover a CDN URL, prefer the raw path without extra resizing params when present.
    if (host.includes('cdninstagram') || host.includes('instagram')) {
      // Don’t over-rewrite (IG changes constantly); just try removing obvious size params if present.
      // Keep as a best-effort "clean".
      const clean = new URL(u.toString());
      // Some IG URLs include "se=" or "stp=" etc; removing can break auth/CDN, so we keep query.
      return { type: looksVideo ? 'video' : 'image', candidates: uniq([clean.toString(), urlStr]) };
    }

    // Generic: if it looks like media, use as-is
    if (looksVideo) return { type: 'video', candidates: [urlStr] };
    if (looksImage) return { type: 'image', candidates: [urlStr] };

    // If it's a link to a tweet/post page, not a direct media link, we bail (no scraping pages on hover).
    return null;
  }

  // -------------------------
  // Overlay UI (shadow DOM so sites can’t mess with it)
  // -------------------------
  const host = document.createElement('div');
  host.id = 'asari-hoverzoom-host';
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none'; // overlay won’t steal hover
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
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
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const inner = document.createElement('div');
  inner.className = 'inner';

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.textContent = 'HoverZoom';

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Esc: hide • P: pin • O: open • C: copy • Wheel: zoom';

  const spinner = document.createElement('div');
  spinner.className = 'spinner';

  inner.appendChild(spinner);
  inner.appendChild(hud);
  inner.appendChild(hint);
  wrap.appendChild(inner);

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  // Media element (swap between img/video)
  let mediaEl = null;

  function setMediaElement(type) {
    if (mediaEl && mediaEl.parentNode) mediaEl.parentNode.removeChild(mediaEl);

    if (type === 'video') {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.controls = false;
      mediaEl = v;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.decoding = 'async';
      mediaEl.loading = 'eager';
    }
    inner.insertBefore(mediaEl, hud);
  }

  // -------------------------
  // Loading + state
  // -------------------------
  let hoverTimer = null;
  let hideTimer = null;
  let pinned = false;

  let lastTarget = null;
  let lastResolvedUrl = null;
  let lastRaw = null;

  let mouseX = 0;
  let mouseY = 0;

  let zoom = 1;

  function positionOverlay() {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    // We don’t know wrap size until it renders; measure then clamp into viewport.
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
    wrap.style.display = 'block';
    positionOverlay();
  }

  function hideOverlay(force = false) {
    if (pinned && !force) return;
    lastResolvedUrl = null;
    lastRaw = null;
    zoom = 1;
    if (mediaEl) mediaEl.style.transform = 'scale(1)';
    wrap.style.transform = 'translate3d(-9999px,-9999px,0)';
    wrap.style.display = 'none';
    spinner.style.display = 'block';
    if (mediaEl) mediaEl.removeAttribute('src');
  }

  function setHud(text) { hud.textContent = text; }

  function setZoom(z) {
    zoom = clamp(z, CFG.wheelZoomMin, CFG.wheelZoomMax);
    if (mediaEl) mediaEl.style.transform = `scale(${zoom})`;
  }

  async function tryLoadCandidates(type, candidates) {
    candidates = uniq(candidates);

    if (!candidates.length) return null;

    if (type === 'video') {
      // For video, we’ll just try first URL and rely on canplay; many sites stream weirdly.
      return candidates[0];
    }

    // For images, probe each candidate.
    for (const url of candidates) {
      const ok = await new Promise((resolve) => {
        const im = new Image();
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

    // Avoid thrashing if we’re already showing the same thing.
    const key = candidates[0] || rawUrl;
    if (lastResolvedUrl === key && wrap.style.display === 'block') return;

    lastResolvedUrl = key;
    lastRaw = rawUrl;

    setMediaElement(type);
    spinner.style.display = 'block';
    setHud('Loading…');

    showOverlay();

    const chosen = await tryLoadCandidates(type, candidates);
    if (!chosen) {
      setHud('No preview (blocked/404)');
      return;
    }

    // If the user moved on while we were loading, don’t pop old media.
    if (!lastResolvedUrl || lastResolvedUrl !== key) return;

    if (type === 'video') {
      mediaEl.src = chosen;
      try { await mediaEl.play(); } catch {}
      setHud(new URL(chosen).hostname);
    } else {
      mediaEl.src = chosen;
      setHud(new URL(chosen).hostname);
    }

    spinner.style.display = 'none';
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

  // -------------------------
  // Event handlers
  // -------------------------
  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (wrap.style.display === 'block') positionOverlay();
  }

  function shouldIgnore(e) {
    if (!CFG.enabled) return true;
    if (CFG.onlyWhenAltHeld && !e.altKey) return true;
    if (CFG.ignoreWhenTyping && isEditableTarget(e.target)) return true;
    // Don’t preview while user is dragging/selecting.
    if (e.buttons && e.buttons !== 0) return true;
    return false;
  }

  function onPointerOver(e) {
    if (shouldIgnore(e)) return;

    const t = closestInteresting(e.target);
    if (!t || t === lastTarget) return;

    // ignore our own overlay
    if (t === host || shadow.contains(t)) return;

    const raw = elementMediaHint(t);
    if (!raw) return;

    const resolved = resolveMedia(raw);
    if (!resolved) return;

    lastTarget = t;
    cancelHoverTimer();
    if (hideTimer) clearTimeout(hideTimer);

    hoverTimer = setTimeout(() => {
      // If user moved away before delay, bail.
      if (t !== lastTarget) return;
      startPreviewFromUrl(raw);
    }, CFG.hoverDelayMs);
  }

  function onPointerOut(e) {
    if (pinned) return;
    // If leaving the current target, schedule hide.
    const leaving = e.target;
    if (leaving && leaving === lastTarget) {
      lastTarget = null;
      cancelHoverTimer();
      scheduleHide();
    }
  }

  function onKeyDown(e) {
    // Hard stop if typing in a field
    if (CFG.ignoreWhenTyping && isEditableTarget(e.target)) return;

    const k = e.key.toLowerCase();

    if (k === 'escape') {
      pinned = false;
      hideOverlay(true);
      return;
    }

    if (k === 'z') {
      CFG.enabled = !CFG.enabled;
      if (!CFG.enabled) hideOverlay(true);
      return;
    }

    if (k === 'p') {
      if (wrap.style.display === 'block') pinned = !pinned;
      return;
    }

    if (k === 'o') {
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const openUrl = resolved?.candidates?.[0] || lastRaw;
      window.open(openUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (k === 'c') {
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const copyUrl = resolved?.candidates?.[0] || lastRaw;
      if (typeof GM_setClipboard === 'function') GM_setClipboard(copyUrl);
      else navigator.clipboard?.writeText(copyUrl).catch(() => {});
      return;
    }

    if (k === 'd') {
      // Best-effort download
      if (!lastRaw) return;
      const resolved = resolveMedia(lastRaw);
      const dlUrl = resolved?.candidates?.[0] || lastRaw;
      if (typeof GM_download === 'function') {
        const filename = (() => {
          try {
            const uu = new URL(dlUrl);
            const base = uu.pathname.split('/').pop() || 'image';
            return base.split('?')[0];
          } catch { return 'image'; }
        })();
        GM_download({ url: dlUrl, name: filename });
      } else {
        window.open(dlUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }

  function onWheel(e) {
    if (wrap.style.display !== 'block') return;
    // prevent page scroll while zooming preview
    e.preventDefault();

    const delta = Math.sign(e.deltaY);
    const next = zoom * (1 - delta * CFG.wheelZoomStep);
    setZoom(next);
    positionOverlay();
  }

  // -------------------------
  // Menu (Tampermonkey etc.)
  // -------------------------
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Toggle HoverZoom (Z)', () => {
      CFG.enabled = !CFG.enabled;
      if (!CFG.enabled) hideOverlay(true);
    });
    GM_registerMenuCommand('Toggle Alt-only mode', () => {
      CFG.onlyWhenAltHeld = !CFG.onlyWhenAltHeld;
    });
  }

  // -------------------------
  // Hook it up
  // -------------------------
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
  document.addEventListener('pointerout', onPointerOut, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, { capture: true });

  // We want wheel zoom to be non-passive so we can preventDefault.
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  hideOverlay(true);

  log('loaded');
})();