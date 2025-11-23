// ==UserScript==
// @name         Image Hover Zoom Combined - Safari Edition
// @namespace    https://paytonison.dev
// @version      4.1.0
// @description  Best-in-class image/video hover preview with full resolution detection. Combines advanced URL extraction, smart filtering, and smooth performance. Safari-compatible.
// @author       Payton Ison
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Skip bare image documents
  const contentType = typeof document.contentType === 'string' ? document.contentType : '';
  if (contentType.startsWith('image/')) {
    return;
  }

  // --- Priority data attributes for full-resolution URLs ---
  const DATA_ATTRS = [
    'data-hover-zoom-src',
    'data-hover-zoom',
    'data-full-src',
    'data-fullsrc',
    'data-large-src',
    'data-original',
    'data-original-src',
    'data-zoom-src',
    'data-zoom-image',
    'data-image-full',
    'data-src',
    'data-lazy-src',
    'data-image',
    'data-image-src',
    'data-img',
    'data-url',
    'data-high-res-src',
    'data-hires'
  ];

  const VIDEO_EXTENSION_REGEX = /\.(?:mp4|webm|ogg|ogv|mov|m4v)(?:[\?#].*)?$/i;
  const MEDIA_EXTENSION_REGEX = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|heic|mp4|webm|ogg|ogv|mov|m4v)(?:[\?#].*)?$/i;
  const POINTER_EVENT = window.PointerEvent ? 'pointermove' : 'mousemove';
  const MIN_SIZE = 40; // Ignore icons/tiny images
  const MIN_ZOOM_GAIN = 1.2; // Only show if at least 20% larger
  const MAX_PARENT_SEARCH = 5; // How far up the tree we'll look for a media URL

  // --- Create overlay ---
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    display: 'none',
    opacity: '0',
    padding: '10px',
    borderRadius: '12px',
    background: 'rgba(0, 0, 0, 0.85)',
    boxShadow: '0 12px 35px rgba(0, 0, 0, 0.5)',
    transform: 'translate3d(0, 0, 0)',
    transition: 'opacity 0.12s ease',
    willChange: 'transform, opacity'
  });

  const previewImg = document.createElement('img');
  previewImg.alt = '';
  Object.assign(previewImg.style, {
    display: 'block',
    maxWidth: '90vw',
    maxHeight: '90vh',
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    borderRadius: '6px'
  });

  const previewVideo = document.createElement('video');
  previewVideo.muted = true;
  previewVideo.loop = true;
  previewVideo.playsInline = true;
  previewVideo.preload = 'metadata';
  previewVideo.style.display = 'none';
  Object.assign(previewVideo.style, {
    maxWidth: '90vw',
    maxHeight: '90vh',
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    borderRadius: '6px'
  });

  overlay.appendChild(previewImg);
  overlay.appendChild(previewVideo);
  document.body.appendChild(overlay);

  // --- State ---
  let activeTarget = null;
  let activeUrl = '';
  let pointerX = 0;
  let pointerY = 0;
  let rafId = null;
  let lastPosX = -1;
  let lastPosY = -1;
  let pendingLoader = null;
  const margin = 18;
  const urlCache = new WeakMap();
  const rejectionCache = new WeakMap();
  const REJECTION_COOLDOWN = 1500;
  const getTime = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  const isOverlayVisible = () => overlay.style.display !== 'none';

  function cacheUrl(element, url) {
    if (!element || !url) return null;
    urlCache.set(element, url);
    rejectionCache.delete(element);
    return url;
  }

  function markRejected(element) {
    if (!element) return;
    rejectionCache.set(element, getTime() + REJECTION_COOLDOWN);
  }

  function isTemporarilyRejected(element) {
    if (!element) return false;
    const expiresAt = rejectionCache.get(element);
    return typeof expiresAt === 'number' && expiresAt > getTime();
  }

  // --- Helper: Extract first URL from various formats (including JSON) ---
  function firstUrlFrom(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Handle JSON arrays or objects
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const candidate = parsed.find(item => typeof item === 'string' && item.trim());
          if (candidate) return candidate.trim();
        } else if (parsed && typeof parsed === 'object') {
          for (const value of Object.values(parsed)) {
            if (typeof value === 'string' && value.trim()) {
              return value.trim();
            }
          }
        }
      } catch (_) {
        // Fall through to string handling
      }
    }

    const list = trimmed.split(/\s*[|,]\s*/).filter(Boolean);
    return list.length ? list[0] : trimmed;
  }

  // --- Helper: Parse background-image CSS ---
  function parseBackgroundImage(value) {
    if (!value || value === 'none') return null;
    const match = value.match(/url\((['"]?)(.*?)\1\)/i);
    return match ? match[2] : null;
  }

  // --- Helper: Extract highest resolution from srcset ---
  function extractFromSrcSet(element) {
    if (!element.srcset) return null;
    let bestUrl = null;
    let bestScore = 0;
    const entries = element.srcset.split(',').map(item => item.trim()).filter(Boolean);

    for (const entry of entries) {
      const parts = entry.split(/\s+/);
      const candidateUrl = parts[0];
      if (!candidateUrl) continue;

      const descriptor = parts[1] || '';
      let score = 1;

      if (descriptor.endsWith('w')) {
        score = parseFloat(descriptor) || 1;
      } else if (descriptor.endsWith('x')) {
        score = (parseFloat(descriptor) || 1) * 1000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestUrl = candidateUrl;
      }
    }

    return bestUrl;
  }

  // --- Helper: Upgrade thumbnail URLs to full resolution ---
  function upgradeUrl(url) {
    if (!url) return url;
    if (VIDEO_EXTENSION_REGEX.test(url)) return url;

    // Site-specific patterns
    // Twitter/X
    if (url.includes('twimg.com')) {
      url = url.replace(/name=\w+/, 'name=orig').replace(/:(\w+)$/, ':orig');
    }

    // Imgur
    url = url.replace(/([a-z0-9]+)([stmloh])\.(jpg|png|gif|webp)$/i, '$1.$3');

    // Flickr
    url = url.replace(/_[bcmnostz]\.jpg/i, '.jpg');

    // Google Photos
    url = url.replace(/=s\d+-c/i, '=s0');

    // Generic thumbnail patterns
    const patterns = [
      { find: /_thumb(\.[^.]+)$/i, replace: '_large$1' },
      { find: /_small(\.[^.]+)$/i, replace: '_large$1' },
      { find: /_medium(\.[^.]+)$/i, replace: '_large$1' },
      { find: /\/thumb\//i, replace: '/large/' },
      { find: /\/small\//i, replace: '/large/' },
      { find: /\/medium\//i, replace: '/large/' },
      { find: /\/thumbnails\//i, replace: '/images/' },
      { find: /\/thumbs\//i, replace: '/images/' },
      { find: /-thumb(\.[^.]+)$/i, replace: '-large$1' },
      { find: /-small(\.[^.]+)$/i, replace: '-large$1' },
      { find: /-medium(\.[^.]+)$/i, replace: '-large$1' },
      { find: /_t(\.[^.]+)$/i, replace: '_o$1' },
      { find: /_m(\.[^.]+)$/i, replace: '_o$1' },
      { find: /\/w\d+\//i, replace: '/w2000/' },
      { find: /\/h\d+\//i, replace: '/h2000/' },
      { find: /([?&])(w|width|h|height)=\d+/gi, replace: '$1$2=2048' }
    ];

    for (const pattern of patterns) {
      if (pattern.find.test(url)) {
        return url.replace(pattern.find, pattern.replace);
      }
    }

    return url;
  }

  // --- Main: Extract best image URL ---
  function extractImageUrl(element) {
    if (!element || element.nodeType !== 1) return null;

    const cached = urlCache.get(element);
    if (cached) return cached;

    const tagName = element.tagName;

    // 1. Check data attributes (highest priority)
    for (const attr of DATA_ATTRS) {
      const value = element.getAttribute(attr);
      const candidate = firstUrlFrom(value);
      if (candidate) return cacheUrl(element, upgradeUrl(candidate));
    }

    // 2. Background image data attribute
    if (element.dataset && element.dataset.backgroundImage) {
      const candidate = firstUrlFrom(element.dataset.backgroundImage);
      if (candidate) return cacheUrl(element, upgradeUrl(candidate));
    }

    // 3. For IMG elements
    if (tagName === 'IMG') {
      // Check parent link
      const parentLink = element.closest('a[href]');
      if (parentLink && parentLink.href && MEDIA_EXTENSION_REGEX.test(parentLink.href)) {
        return cacheUrl(element, upgradeUrl(parentLink.href));
      }

      // Check picture element
      const parentPicture = element.closest('picture');
      if (parentPicture) {
        const sources = parentPicture.querySelectorAll('source[srcset]');
        for (const source of sources) {
          const fromSourceSrcSet = extractFromSrcSet(source);
          if (fromSourceSrcSet) return cacheUrl(element, upgradeUrl(fromSourceSrcSet));
        }
      }

      // Check srcset
      const fromSrcSet = extractFromSrcSet(element);
      if (fromSrcSet) return cacheUrl(element, upgradeUrl(fromSrcSet));

      // Fallback to src
      if (element.currentSrc) return cacheUrl(element, upgradeUrl(element.currentSrc));
      if (element.src) return cacheUrl(element, upgradeUrl(element.src));
    }

    // 4. For VIDEO elements
    if (tagName === 'VIDEO') {
      if (element.poster) {
        const poster = firstUrlFrom(element.poster);
        if (poster) return cacheUrl(element, upgradeUrl(poster));
      }
      if (element.currentSrc) return cacheUrl(element, upgradeUrl(element.currentSrc));
      if (element.src) return cacheUrl(element, upgradeUrl(element.src));
    }

    // 5. For non-IMG elements, check background image (inline first, then computed)
    if (tagName !== 'IMG') {
      const style = element.getAttribute('style');
      if (style && style.includes('background')) {
        const inlineBg = parseBackgroundImage(style);
        if (inlineBg) return cacheUrl(element, upgradeUrl(inlineBg));
      }

      const computedStyle = window.getComputedStyle(element);
      if (computedStyle) {
        const computedBg = parseBackgroundImage(computedStyle.backgroundImage);
        if (computedBg) return cacheUrl(element, upgradeUrl(computedBg));
      }
    }

    // 6. Check if element is a link to a media file
    if (tagName === 'A' && element.href && MEDIA_EXTENSION_REGEX.test(element.href)) {
      return cacheUrl(element, upgradeUrl(element.href));
    }

    return null;
  }

  // --- Check if element is worth zooming ---
  function isElementWorthZooming(element) {
    if (!element || element.nodeType !== 1) return false;

    const tagName = element.tagName;

    // Text links pointing directly at media should be allowed regardless of size.
    if (tagName === 'A') {
      return true;
    }

    const rect = element.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Ignore tiny elements (icons, buttons)
    if (displayWidth < MIN_SIZE || displayHeight < MIN_SIZE) {
      return false;
    }

    // For IMG elements, check if already at full resolution
    if (tagName === 'IMG' && element.naturalWidth && element.naturalHeight) {
      const widthRatio = displayWidth / element.naturalWidth;
      const heightRatio = displayHeight / element.naturalHeight;

      // Already showing at ~90%+ of natural size
      if (widthRatio >= 0.9 && heightRatio >= 0.9) {
        return false;
      }
    }

    return true;
  }

  // --- Walk up the DOM to find the nearest element with a usable media URL ---
  function findHoverTarget(startElement) {
    let el = startElement instanceof Element ? startElement : null;
    let steps = 0;

    while (el && steps <= MAX_PARENT_SEARCH) {
      if (!(el instanceof HTMLElement)) break;

      if (isTemporarilyRejected(el)) {
        el = el.parentElement;
        steps += 1;
        continue;
      }

      const url = extractImageUrl(el);
      if (url) {
        if (isElementWorthZooming(el)) {
          return { element: el, url };
        }
        markRejected(el);
      }

      el = el.parentElement;
      steps += 1;
    }

    return null;
  }

  // --- Position overlay near cursor ---
  function positionOverlay() {
    if (overlay.style.display === 'none') return;

    const rect = overlay.getBoundingClientRect();
    let x = pointerX + margin;
    let y = pointerY + margin;

    // Keep within viewport
    if (x + rect.width > window.innerWidth) {
      x = pointerX - rect.width - margin;
    }
    if (y + rect.height > window.innerHeight) {
      y = pointerY - rect.height - margin;
    }

    x = Math.max(margin, Math.round(x));
    y = Math.max(margin, Math.round(y));

    // Avoid redundant DOM updates
    if (x === lastPosX && y === lastPosY) return;

    lastPosX = x;
    lastPosY = y;
    overlay.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  // --- Show preview ---
  function showPreview(target, url) {
    activeTarget = target;
    activeUrl = url;

    if (pendingLoader) {
      pendingLoader.onload = null;
      pendingLoader.onerror = null;
      if (pendingLoader.onloadedmetadata) {
        pendingLoader.onloadedmetadata = null;
      }
      if (typeof pendingLoader.pause === 'function') {
        pendingLoader.pause();
      }
      pendingLoader = null;
    }

    const finalize = (naturalWidth, naturalHeight, type) => {
      // Target disappeared from the DOM while loading; bail out.
      if (target && !document.documentElement.contains(target)) {
        hidePreview();
        return;
      }

      if (!naturalWidth || !naturalHeight) {
        hidePreview();
        markRejected(target);
        return;
      }

      // Validate zoom gain: only show if significantly larger
      if (target && target.getBoundingClientRect) {
        const rect = target.getBoundingClientRect();
        const widthGain = naturalWidth / rect.width;
        const heightGain = naturalHeight / rect.height;

        if (widthGain < MIN_ZOOM_GAIN && heightGain < MIN_ZOOM_GAIN) {
          hidePreview();
          markRejected(target);
          return;
        }
      }

      if (type === 'video') {
        previewImg.style.display = 'none';
        previewImg.src = '';
        previewVideo.style.display = 'block';
        if (previewVideo.src !== url) {
          previewVideo.src = url;
          try {
            previewVideo.load();
          } catch (_) {
            // Ignore load errors; play() will surface failure if any.
          }
        }

        const playPromise = previewVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } else {
        previewVideo.pause();
        previewVideo.src = '';
        previewVideo.style.display = 'none';
        previewImg.style.display = 'block';
        previewImg.src = url;
      }

      overlay.style.display = 'block';
      overlay.style.opacity = '1';
      pendingLoader = null;
      positionOverlay();
    };

    if (VIDEO_EXTENSION_REGEX.test(url)) {
      const loader = document.createElement('video');
      loader.preload = 'metadata';
      loader.muted = true;
      loader.playsInline = true;
      loader.src = url;
      pendingLoader = loader;

      loader.onloadedmetadata = () => {
        if (pendingLoader !== loader) return;
        const naturalWidth = loader.videoWidth || loader.clientWidth;
        const naturalHeight = loader.videoHeight || loader.clientHeight;
        finalize(naturalWidth, naturalHeight, 'video');
      };

      loader.onerror = () => {
        if (pendingLoader === loader) {
          pendingLoader = null;
          hidePreview();
          markRejected(target);
        }
      };

      try {
        loader.load();
      } catch (_) {
        // Some browsers ignore load() when preloading metadata; let the events sort it out.
      }
    } else {
      const loader = new Image();
      loader.decoding = 'async';
      loader.referrerPolicy = 'no-referrer';
      loader.src = url;
      pendingLoader = loader;

      const finishImage = () => finalize(loader.naturalWidth || loader.width, loader.naturalHeight || loader.height, 'image');

      loader.onload = () => {
        if (pendingLoader !== loader) return;

        if (typeof loader.decode === 'function') {
          loader.decode().then(finishImage).catch(finishImage);
        } else {
          finishImage();
        }
      };

      loader.onerror = () => {
        if (pendingLoader === loader) {
          pendingLoader = null;
          hidePreview();
          markRejected(target);
        }
      };
    }
  }

  // --- Hide preview ---
  function hidePreview() {
    activeTarget = null;
    activeUrl = '';
    lastPosX = -1;
    lastPosY = -1;
    overlay.style.opacity = '0';
    overlay.style.display = 'none';

    if (pendingLoader) {
      pendingLoader.onload = null;
      pendingLoader.onerror = null;
      if (pendingLoader.onloadedmetadata) {
        pendingLoader.onloadedmetadata = null;
      }
      if (typeof pendingLoader.pause === 'function') {
        pendingLoader.pause();
      }
      pendingLoader = null;
    }

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    previewImg.src = '';
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo.style.display = 'none';
  }

  // --- Event: Pointer/mouse move ---
  document.addEventListener(POINTER_EVENT, (e) => {
    // Ignore touch events
    if ('pointerType' in e && e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
      return;
    }

    pointerX = e.clientX;
    pointerY = e.clientY;

    const visible = isOverlayVisible();

    if (visible && activeTarget) {
      const stillInDom = document.documentElement.contains(activeTarget);
      const stillOverTarget = activeTarget === e.target || activeTarget.contains(e.target);
      if (!stillInDom || !stillOverTarget) {
        hidePreview();
      }
    }

    // Throttle positioning with RAF
    if (isOverlayVisible()) {
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          positionOverlay();
        });
      }
    }
  }, { passive: true });

  // --- Event: Bust caches when media reload ---
  document.addEventListener('load', (e) => {
    const img = e.target;

    if (img instanceof HTMLImageElement || img instanceof HTMLVideoElement) {
      urlCache.delete(img);
      rejectionCache.delete(img);

      // When the underlying image finishes loading, refresh the preview in case we showed a placeholder URL.
      if (activeTarget === img) {
        const refreshedUrl = extractImageUrl(img);
        if (refreshedUrl) {
          showPreview(img, refreshedUrl);
        } else {
          hidePreview();
        }
      }
    }
  }, true);

  // --- Event: Mouse over potential media ---
  document.addEventListener('mouseover', (e) => {
    const info = findHoverTarget(e.target);
    if (!info) return;

    const { element, url } = info;

    // Don't reload same media
    if (url === activeUrl && element === activeTarget) return;

    showPreview(element, url);
  }, { passive: true });

  // --- Event: Mouse out ---
  document.addEventListener('mouseout', (e) => {
    if (!activeTarget) return;

    const leftActive = activeTarget === e.target || activeTarget.contains(e.target);
    if (!leftActive) return;

    const next = e.relatedTarget;
    const stillInside = next && (next === activeTarget || activeTarget.contains(next));

    if (!stillInside) hidePreview();
  }, { passive: true });

  // --- Event: Hide when pointer leaves the viewport entirely ---
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) {
      hidePreview();
    }
  });

  // --- Event: Hide on scroll, blur, escape ---
  window.addEventListener('scroll', hidePreview, true);
  window.addEventListener('blur', hidePreview);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hidePreview();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePreview();
  });

})();
