// ==UserScript==
// @name         Hover Zoom Follow (Safari)
// @namespace    https://github.com/paytonison/hover-zoom
// @version      1.0.0
// @description  Pop out the highest-resolution image as you hover thumbnails or background images.
// @author       Payton Ison
// @match        *://*/*
// @run-at       document-idle
// @compatible   safari
// ==/UserScript==

(function () {
  'use strict';

  if (window.__hoverZoomFollowLoaded) {
    return;
  }
  window.__hoverZoomFollowLoaded = true;

  const contentType = document.contentType || '';
  if (/^image\//i.test(contentType)) {
    return; // do not interfere with direct image documents
  }

  const PREVIEW_ID = 'codex-hover-zoom-overlay';
  if (document.getElementById(PREVIEW_ID)) {
    return; // overlay already exists
  }

  const POINTER_EVENT = 'PointerEvent' in window ? 'pointermove' : 'mousemove';
  const POINTER_TYPES = new Set(['mouse', 'pen', '']);
  const VIEWPORT_MARGIN = 18;
  const POINTER_OFFSET = 24;
  const DATA_ATTRS = [
    'data-src',
    'data-srcset',
    'data-original',
    'data-original-src',
    'data-orig-src',
    'data-full',
    'data-fullsrc',
    'data-full-src',
    'data-full-image',
    'data-full-image-url',
    'data-large',
    'data-large-src',
    'data-large-image',
    'data-hires',
    'data-highres',
    'data-zoom-src',
    'data-zoom-image',
    'data-zoom-url',
    'data-image',
    'data-image-src',
    'data-image-url',
    'data-photo',
    'data-media',
    'data-picture',
    'data-url',
    'data-href',
    'data-lazy',
    'data-lazy-src',
    'data-preview',
  ];
  const DATASET_HINT_RE = /(full|hires|large|orig|source|image|img|photo|media|url|zoom)/i;
  const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
  const SRCSET_DESCRIPTOR_RE = /\s+\d+(?:\.\d+)?[wx](?:\s|$)/;
  const BACKGROUND_URL_RE = /url\((['"]?)(.*?)\1\)/ig;
  const JSON_PRIORITY_KEYS = [
    'original',
    'orig',
    'source',
    'srcset',
    'src',
    'url',
    'href',
    'download',
    'image',
    'images',
    'media',
    'photo',
    'poster',
    'large',
    'largest',
    'hires',
    'full',
    'fullsize',
    'fullSize',
    'preview',
  ];

  const overlay = document.createElement('div');
  overlay.id = PREVIEW_ID;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.pointerEvents = 'none';
  overlay.style.padding = '12px';
  overlay.style.background = 'rgba(15, 15, 15, 0.92)';
  overlay.style.borderRadius = '10px';
  overlay.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.45)';
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 120ms ease';
  overlay.style.transform = 'translate(-9999px, -9999px)';
  overlay.style.willChange = 'transform, opacity';

  const overlayImage = document.createElement('img');
  overlayImage.alt = '';
  overlayImage.decoding = 'async';
  overlayImage.loading = 'eager';
  overlayImage.style.display = 'block';
  overlayImage.style.maxWidth = 'none';
  overlayImage.style.maxHeight = 'none';
  overlayImage.style.width = '0';
  overlayImage.style.height = '0';
  overlayImage.style.borderRadius = 'inherit';
  overlayImage.style.objectFit = 'contain';
  overlay.appendChild(overlayImage);

  const mountOverlay = () => {
    (document.body || document.documentElement).appendChild(overlay);
  };
  if (document.body) {
    mountOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
  }

  const resolvedUrls = new WeakMap();
  const rejectedTargets = new WeakSet();
  const backgroundCache = new WeakMap();

  let activeTarget = null;
  let activeUrl = '';
  let naturalSize = null;
  let displaySize = null;
  let rafHandle = 0;
  let pointerX = 0;
  let pointerY = 0;
  let loadToken = 0;

  document.addEventListener(POINTER_EVENT, handlePointerMove, { passive: true });
  const leaveEvent = POINTER_EVENT === 'pointermove' ? 'pointerleave' : 'mouseleave';
  document.addEventListener(leaveEvent, () => dismissPreview(true), { passive: true });
  window.addEventListener('resize', () => {
    if (!naturalSize || !activeUrl) {
      return;
    }
    displaySize = fitToViewport(naturalSize.width, naturalSize.height);
    overlayImage.style.width = displaySize.width + 'px';
    overlayImage.style.height = displaySize.height + 'px';
    requestPositionUpdate();
  });
  window.addEventListener('scroll', () => requestPositionUpdate(), { passive: true, capture: true });
  window.addEventListener('blur', () => dismissPreview(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      dismissPreview(true);
    }
  });

  function handlePointerMove(event) {
    if (POINTER_EVENT === 'pointermove') {
      const type = event.pointerType || '';
      if (!POINTER_TYPES.has(type)) {
        return;
      }
      if (event.isPrimary === false) {
        return;
      }
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      dismissPreview(true);
      return;
    }

    pointerX = event.clientX;
    pointerY = event.clientY;

    const candidate = findCandidate(target);
    if (!candidate) {
      dismissPreview(true);
      return;
    }

    if (candidate !== activeTarget) {
      activeTarget = candidate;
      attemptResolve(candidate);
    }

    requestPositionUpdate();
  }

  function findCandidate(node) {
    let el = node instanceof Element ? node : node.parentElement;
    while (el && el !== document.documentElement) {
      if (elementHasMedia(el)) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function elementHasMedia(el) {
    if (el instanceof HTMLImageElement || el instanceof HTMLPictureElement || el instanceof SVGImageElement) {
      return true;
    }
    if (el instanceof HTMLVideoElement && el.poster) {
      return true;
    }
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href');
      if (href && looksLikeImage(href)) {
        return true;
      }
    }
    if (el.getAttribute('role') === 'img') {
      return true;
    }
    for (const attr of DATA_ATTRS) {
      if (el.hasAttribute(attr)) {
        return true;
      }
    }
    if (el.dataset) {
      for (const key of Object.keys(el.dataset)) {
        if (DATASET_HINT_RE.test(key)) {
          return true;
        }
      }
    }
    return Boolean(getBackgroundImage(el));
  }

  function attemptResolve(el) {
    if (rejectedTargets.has(el)) {
      dismissPreview();
      return;
    }

    const cachedUrl = resolvedUrls.get(el);
    if (cachedUrl) {
      queueImage(el, cachedUrl);
      return;
    }

    const url = resolveUrl(el);
    if (url) {
      resolvedUrls.set(el, url);
      queueImage(el, url);
    } else {
      rejectedTargets.add(el);
      dismissPreview();
    }
  }

  function resolveUrl(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const fromData = extractFromDataAttrs(node);
      if (fromData) {
        return fromData;
      }

      if (node instanceof HTMLImageElement) {
        const fromImg = extractFromImage(node);
        if (fromImg) {
          return fromImg;
        }
      } else if (node instanceof HTMLPictureElement) {
        const fromPicture = extractFromPicture(node);
        if (fromPicture) {
          return fromPicture;
        }
      } else if (node instanceof HTMLVideoElement) {
        const poster = sanitizeUrl(node.poster);
        if (poster) {
          return poster;
        }
      }

      const bgUrl = getBackgroundImage(node);
      if (bgUrl) {
        return bgUrl;
      }

      if (node instanceof HTMLAnchorElement) {
        const href = sanitizeUrl(node.getAttribute('href'));
        if (href && looksLikeImage(href)) {
          return href;
        }
      }

      node = node.parentElement;
    }
    return null;
  }

  function extractFromImage(img) {
    const dataCandidate = extractFromDataAttrs(img);
    if (dataCandidate) {
      return dataCandidate;
    }

    const srcsetCandidate = pickBestFromSrcset(img.getAttribute('srcset'));
    if (srcsetCandidate) {
      return srcsetCandidate;
    }

    const current = sanitizeUrl(img.currentSrc || img.getAttribute('src'));
    if (current) {
      return current;
    }

    return null;
  }

  function extractFromPicture(picture) {
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      const fromData = extractFromDataAttrs(source);
      if (fromData) {
        return fromData;
      }
      const srcset = pickBestFromSrcset(source.getAttribute('srcset'));
      if (srcset) {
        return srcset;
      }
    }

    const img = picture.querySelector('img');
    if (img) {
      return extractFromImage(img);
    }

    return null;
  }

  function extractFromDataAttrs(el) {
    for (const attr of DATA_ATTRS) {
      if (!el.hasAttribute(attr)) {
        continue;
      }
      const candidate = normalizeAttrValue(el.getAttribute(attr));
      if (candidate) {
        return candidate;
      }
    }

    if (el.dataset) {
      for (const key of Object.keys(el.dataset)) {
        if (!DATASET_HINT_RE.test(key)) {
          continue;
        }
        const candidate = normalizeAttrValue(el.dataset[key]);
        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  function normalizeAttrValue(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed[0] === '{' || trimmed[0] === '[') {
      const jsonCandidate = extractUrlFromJson(trimmed);
      if (jsonCandidate) {
        return jsonCandidate;
      }
    }

    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
      const fromParts = pickFromList(parts);
      if (fromParts) {
        return fromParts;
      }
    }

    if (trimmed.includes(',') && (trimmed.match(/https?:/gi) || []).length > 1) {
      const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
      const fromList = pickFromList(parts);
      if (fromList) {
        return fromList;
      }
    }

    if (SRCSET_DESCRIPTOR_RE.test(trimmed)) {
      const srcsetCandidate = pickBestFromSrcset(trimmed);
      if (srcsetCandidate) {
        return srcsetCandidate;
      }
    }

    return normalizeSingle(trimmed);
  }

  function pickFromList(parts) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const normalized = normalizeSingle(parts[i]);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  function normalizeSingle(value) {
    if (!value) {
      return null;
    }
    let cleaned = value.trim();
    cleaned = cleaned.replace(/^url\(\s*/i, '').replace(/\s*\)$/i, '');
    cleaned = cleaned.replace(/^['"]|['"]$/g, '');
    if (!cleaned) {
      return null;
    }

    const direct = sanitizeUrl(cleaned);
    if (direct) {
      return direct;
    }

    const extracted = extractUrlFromText(cleaned);
    return extracted ? sanitizeUrl(extracted) : null;
  }

  function extractUrlFromJson(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      return drillForUrl(parsed);
    } catch (_error) {
      return null;
    }
  }

  function drillForUrl(payload) {
    if (!payload) {
      return null;
    }
    if (typeof payload === 'string') {
      return normalizeSingle(payload);
    }
    if (Array.isArray(payload)) {
      for (let i = payload.length - 1; i >= 0; i -= 1) {
        const candidate = drillForUrl(payload[i]);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }
    if (typeof payload === 'object') {
      for (const key of JSON_PRIORITY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          const candidate = drillForUrl(payload[key]);
          if (candidate) {
            return candidate;
          }
        }
      }
      for (const value of Object.values(payload)) {
        const candidate = drillForUrl(value);
        if (candidate) {
          return candidate;
        }
      }
    }
    return null;
  }

  function extractUrlFromText(text) {
    const match = text.match(/(https?:\/\/[^\s'"`]+|\/[^\s'"`]+\.(?:avif|bmp|gif|jpe?g|png|svg|webp))/i);
    return match ? match[0] : null;
  }

  function pickBestFromSrcset(srcset) {
    if (!srcset) {
      return null;
    }
    let bestUrl = null;
    let bestScore = -Infinity;
    for (const rawEntry of srcset.split(',')) {
      const entry = rawEntry.trim();
      if (!entry) {
        continue;
      }
      const lastSpace = entry.lastIndexOf(' ');
      let urlPart = entry;
      let descriptor = '';
      if (lastSpace > -1) {
        urlPart = entry.slice(0, lastSpace).trim();
        descriptor = entry.slice(lastSpace + 1).trim();
      }
      if (!urlPart) {
        continue;
      }
      const score = descriptorScore(descriptor);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = urlPart;
      }
    }
    return bestUrl ? sanitizeUrl(bestUrl) : null;
  }

  function descriptorScore(descriptor) {
    const match = descriptor.match(/^([\d.]+)([wx])$/);
    if (!match) {
      return descriptor ? 1 : 0;
    }
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return match[2] === 'w' ? value : value * 1000;
  }

  function getBackgroundImage(el) {
    if (!el || !(el instanceof Element)) {
      return null;
    }
    if (backgroundCache.has(el)) {
      return backgroundCache.get(el) || null;
    }
    const style = window.getComputedStyle(el);
    const value = style ? style.backgroundImage : '';
    if (!value || value === 'none') {
      backgroundCache.set(el, null);
      return null;
    }
    BACKGROUND_URL_RE.lastIndex = 0;
    const match = BACKGROUND_URL_RE.exec(value);
    BACKGROUND_URL_RE.lastIndex = 0;
    const url = match && match[2] ? sanitizeUrl(match[2]) : null;
    backgroundCache.set(el, url);
    return url;
  }

  function sanitizeUrl(value) {
    if (typeof value !== 'string') {
      return null;
    }
    let trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    trimmed = trimmed.replace(/^url\(\s*/i, '').replace(/\s*\)$/i, '');
    trimmed = trimmed.replace(/^['"]|['"]$/g, '');
    if (!trimmed) {
      return null;
    }
    if (/^javascript:/i.test(trimmed)) {
      return null;
    }
    if (/^(?:data|blob):/i.test(trimmed)) {
      return trimmed;
    }
    try {
      const url = new URL(trimmed, document.baseURI);
      if (/^https?:$/i.test(url.protocol)) {
        return url.href;
      }
      return null;
    } catch (_error) {
      return null;
    }
  }

  function looksLikeImage(url) {
    if (!url) {
      return false;
    }
    const cleaned = url.split('#')[0].split('?')[0];
    return IMAGE_EXT_RE.test(cleaned);
  }

  function queueImage(target, url) {
    if (!url) {
      dismissPreview();
      return;
    }
    if (url === activeUrl && displaySize) {
      showOverlay();
      requestPositionUpdate();
      return;
    }

    const token = ++loadToken;
    activeUrl = url;
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.onload = () => {
      if (loadToken !== token || target !== activeTarget) {
        return;
      }
      naturalSize = {
        width: img.naturalWidth || overlayImage.naturalWidth || 0,
        height: img.naturalHeight || overlayImage.naturalHeight || 0,
      };
      if (!naturalSize.width || !naturalSize.height) {
        naturalSize.width = img.width || 0;
        naturalSize.height = img.height || 0;
      }
      displaySize = fitToViewport(Math.max(naturalSize.width, 1), Math.max(naturalSize.height, 1));
      overlayImage.src = url;
      overlayImage.style.width = displaySize.width + 'px';
      overlayImage.style.height = displaySize.height + 'px';
      showOverlay();
      requestPositionUpdate();
    };
    img.onerror = () => {
      if (loadToken !== token) {
        return;
      }
      rejectedTargets.add(target);
      if (activeTarget === target) {
        dismissPreview();
      }
    };
    img.src = url;
  }

  function fitToViewport(width, height) {
    const maxWidth = Math.max(120, window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(120, window.innerHeight - VIEWPORT_MARGIN * 2);
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(1, widthRatio, heightRatio);
    return {
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    };
  }

  function requestPositionUpdate() {
    if (!displaySize) {
      return;
    }
    if (rafHandle) {
      return;
    }
    rafHandle = window.requestAnimationFrame(updateOverlayPosition);
  }

  function updateOverlayPosition() {
    rafHandle = 0;
    if (!displaySize) {
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = displaySize.width;
    const height = displaySize.height;

    let left = pointerX + POINTER_OFFSET;
    let top = pointerY + POINTER_OFFSET;

    if (left + width + VIEWPORT_MARGIN > viewportWidth) {
      left = Math.max(VIEWPORT_MARGIN, pointerX - POINTER_OFFSET - width);
    } else {
      left = Math.max(VIEWPORT_MARGIN, left);
    }

    if (top + height + VIEWPORT_MARGIN > viewportHeight) {
      top = Math.max(VIEWPORT_MARGIN, pointerY - POINTER_OFFSET - height);
    } else {
      top = Math.max(VIEWPORT_MARGIN, top);
    }

    overlay.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showOverlay() {
    overlay.removeAttribute('aria-hidden');
    overlay.style.opacity = '1';
  }

  function dismissPreview(resetTarget) {
    if (resetTarget) {
      activeTarget = null;
    }
    displaySize = null;
    naturalSize = null;
    activeUrl = '';
    overlayImage.removeAttribute('src');
    overlayImage.style.width = '0';
    overlayImage.style.height = '0';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.opacity = '0';
    overlay.style.transform = 'translate(-9999px, -9999px)';
    loadToken += 1;
  }
})();
