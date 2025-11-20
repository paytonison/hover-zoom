// ==UserScript==
// @name         Image Hover Zoom Combined - Safari Edition
// @namespace    https://paytonison.dev
// @version      4.0.0
// @description  Best-in-class image hover preview with full resolution detection. Combines advanced URL extraction, smart filtering, and smooth performance. Safari-compatible.
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

  const EXTENSION_REGEX = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|heic)(?:[\?#].*)?$/i;
  const POINTER_EVENT = window.PointerEvent ? 'pointermove' : 'mousemove';
  const MIN_SIZE = 40; // Ignore icons/tiny images
  const MIN_ZOOM_GAIN = 1.2; // Only show if at least 20% larger

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

  overlay.appendChild(previewImg);
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

    // 1. Check data attributes (highest priority)
    for (const attr of DATA_ATTRS) {
      const value = element.getAttribute(attr);
      const candidate = firstUrlFrom(value);
      if (candidate) return cacheUrl(element, upgradeUrl(candidate));
    }

    // 2. For IMG elements
    if (element.tagName === 'IMG') {
      // Check parent link
      const parentLink = element.closest('a[href]');
      if (parentLink && parentLink.href && EXTENSION_REGEX.test(parentLink.href)) {
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
    } else {
      // 3. For non-IMG elements, check background image
      const style = element.getAttribute('style');
      if (style && style.includes('background')) {
        const inlineBg = parseBackgroundImage(style);
        if (inlineBg) return cacheUrl(element, upgradeUrl(inlineBg));
        const computedBg = parseBackgroundImage(window.getComputedStyle(element).backgroundImage);
        if (computedBg) return cacheUrl(element, upgradeUrl(computedBg));
      }
    }

    // 4. Check if element is a link to an image
    if (element.tagName === 'A' && element.href && EXTENSION_REGEX.test(element.href)) {
      return cacheUrl(element, upgradeUrl(element.href));
    }

    // 5. Check background image data attribute
    if (element.dataset && element.dataset.backgroundImage) {
      return cacheUrl(element, upgradeUrl(element.dataset.backgroundImage));
    }

    return null;
  }

  // --- Check if element is worth zooming ---
  function isElementWorthZooming(element) {
    if (!element || element.nodeType !== 1) return false;

    const rect = element.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Ignore tiny elements (icons, buttons)
    if (displayWidth < MIN_SIZE || displayHeight < MIN_SIZE) {
      return false;
    }

    // For IMG elements, check if already at full resolution
    if (element.tagName === 'IMG' && element.naturalWidth && element.naturalHeight) {
      const widthRatio = displayWidth / element.naturalWidth;
      const heightRatio = displayHeight / element.naturalHeight;

      // Already showing at ~90%+ of natural size
      if (widthRatio >= 0.9 && heightRatio >= 0.9) {
        return false;
      }
    }

    return true;
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
    }

    const loader = new Image();
    loader.decoding = 'async';
    loader.referrerPolicy = 'no-referrer';
    loader.src = url;
    pendingLoader = loader;

    loader.onload = () => {
      if (pendingLoader !== loader) return;

      const finalize = () => {
        const naturalWidth = loader.naturalWidth || loader.width;
        const naturalHeight = loader.naturalHeight || loader.height;

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

        previewImg.src = url;
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
        pendingLoader = null;
        positionOverlay();
      };

      if (typeof loader.decode === 'function') {
        loader.decode().then(finalize).catch(finalize);
      } else {
        finalize();
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
      pendingLoader = null;
    }

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    previewImg.src = '';
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

  // --- Event: Bust caches when images reload ---
  document.addEventListener('load', (e) => {
    const img = e.target;

    if (img instanceof HTMLImageElement) {
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

  // --- Event: Mouse over images ---
  document.addEventListener('mouseover', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (isTemporarilyRejected(img)) return;

    if (!isElementWorthZooming(img)) {
      markRejected(img);
      return;
    }

    const url = extractImageUrl(img);
    if (!url) {
      markRejected(img);
      return;
    }

    // Don't reload same image
    if (url === activeUrl && img === activeTarget) return;

    showPreview(img, url);
  }, { passive: true });

  // --- Event: Mouse out ---
  document.addEventListener('mouseout', (e) => {
    if (e.target instanceof HTMLImageElement) {
      hidePreview();
    }
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
