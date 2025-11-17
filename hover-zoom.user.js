// ==UserScript==
// @name         Hover Zoom Follow
// @namespace    https://paytonison.local/userscripts
// @version      1.0.0
// @description  Expand hovered images to their largest viewable size while following the cursor, similar to Hover Zoom+.
// @author       paytonison
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const contentType = typeof document.contentType === 'string' ? document.contentType : '';
  if (contentType.startsWith('image/')) {
    return; // Skip bare image/tab documents.
  }

  const DATA_ATTRS = [
    'data-hover-zoom-src',
    'data-hover-zoom',
    'data-src',
    'data-lazy-src',
    'data-large-src',
    'data-original',
    'data-zoom-src',
    'data-fullsrc',
    'data-full-src',
    'data-image',
    'data-image-src',
    'data-img',
    'data-url'
  ];

  const CANDIDATE_SELECTOR = 'img,[data-hover-zoom-src],[data-hover-zoom],[data-zoom-src],[data-fullsrc],[data-full-src],[data-original],[data-large-src],[data-src],a,[role="img"]';
  const EXTENSION_REGEX = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|heic)(?:[\?#].*)?$/i;
  const POINTER_EVENT = window.PointerEvent ? 'pointermove' : 'mousemove';

  function ready(fn) {
    if (document.readyState === 'loading') {
      const onReady = () => {
        document.removeEventListener('DOMContentLoaded', onReady);
        fn();
      };
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      fn();
    }
  }

  ready(() => {
    if (document.getElementById('codex-hover-zoom-overlay')) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'codex-hover-zoom-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      display: 'none',
      opacity: '0',
      padding: '4px',
      borderRadius: '4px',
      background: 'rgba(15, 15, 15, 0.85)',
      boxShadow: '0 12px 35px rgba(0, 0, 0, 0.45)',
      transform: 'translate3d(0,0,0)',
      transition: 'opacity 80ms ease',
      willChange: 'transform, opacity'
    });

    const image = document.createElement('img');
    image.alt = '';
    Object.assign(image.style, {
      display: 'block',
      maxWidth: 'none',
      maxHeight: 'none',
      objectFit: 'contain',
      borderRadius: '2px'
    });

    overlay.appendChild(image);
    (document.body || document.documentElement).appendChild(overlay);

    let activeTarget = null;
    let lastRejectedTarget = null;
    let activeUrl = '';
    let naturalWidth = 0;
    let naturalHeight = 0;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let pendingLoader = null;
    let rafId = null;
    let lastPosX = -1;
    let lastPosY = -1;
    const margin = 18;

    function firstUrlFrom(raw) {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;

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
          // Ignore JSON parse failures and fall back to the raw string.
        }
      }

      const list = trimmed.split(/\s*[|,]\s*/).filter(Boolean);
      return list.length ? list[0] : trimmed;
    }

    function parseBackgroundImage(value) {
      if (!value || value === 'none') return null;
      const match = value.match(/url\((['"]?)(.*?)\1\)/i);
      return match ? match[2] : null;
    }

    function extractFromSrcSet(img) {
      if (!img.srcset) return null;
      let bestUrl = null;
      let bestScore = 0;
      const entries = img.srcset.split(',').map(item => item.trim()).filter(Boolean);
      for (const entry of entries) {
        const parts = entry.split(/\s+/);
        const candidateUrl = parts[0];
        const descriptor = parts[1] || '';
        let score = 1;
        if (descriptor.endsWith('w')) {
          score = parseFloat(descriptor);
        } else if (descriptor.endsWith('x')) {
          score = parseFloat(descriptor) * 1000;
        }
        if (!Number.isFinite(score)) score = 1;
        if (score >= bestScore) {
          bestScore = score;
          bestUrl = candidateUrl;
        }
      }
      return bestUrl;
    }

    function extractImageUrl(element) {
      if (!element || element.nodeType !== 1) return null;

      for (const attr of DATA_ATTRS) {
        const value = element.getAttribute(attr);
        const candidate = firstUrlFrom(value);
        if (candidate) return candidate;
      }

      if (element.tagName === 'IMG') {
        // Check if the IMG is wrapped in an A tag that points to a full-resolution image
        const parentLink = element.closest('a[href]');
        if (parentLink && parentLink.href && EXTENSION_REGEX.test(parentLink.href)) {
          return parentLink.href;
        }

        const fromSrcSet = extractFromSrcSet(element);
        if (fromSrcSet) return fromSrcSet;
        if (element.currentSrc) return element.currentSrc;
        if (element.src) return element.src;
        // Skip background image check for IMG elements
      } else {
        // Only check background image for non-IMG elements (avoid expensive getComputedStyle)
        const bg = parseBackgroundImage(window.getComputedStyle(element).backgroundImage);
        if (bg) return bg;
      }

      if (element.tagName === 'A' && element.href && EXTENSION_REGEX.test(element.href)) {
        return element.href;
      }

      if (element.dataset && element.dataset.backgroundImage) {
        return element.dataset.backgroundImage;
      }

      return null;
    }

    function applyScale() {
      if (!naturalWidth || !naturalHeight) return;

      const viewportW = window.innerWidth * 0.95;
      const viewportH = window.innerHeight * 0.95;
      const scale = Math.min(viewportW / naturalWidth, viewportH / naturalHeight, 1);

      overlayWidth = Math.max(1, Math.round(naturalWidth * scale));
      overlayHeight = Math.max(1, Math.round(naturalHeight * scale));
      image.style.width = `${overlayWidth}px`;
      image.style.height = `${overlayHeight}px`;

      positionOverlay(pointerX, pointerY);
    }

    function positionOverlay(x, y) {
      if (overlay.style.display === 'none') return;

      let posX = x + margin;
      let posY = y + margin;

      if (posX + overlayWidth + margin > window.innerWidth) {
        posX = x - overlayWidth - margin;
      }
      if (posX < margin) {
        posX = window.innerWidth - overlayWidth - margin;
      }

      if (posY + overlayHeight + margin > window.innerHeight) {
        posY = y - overlayHeight - margin;
      }
      if (posY < margin) {
        posY = window.innerHeight - overlayHeight - margin;
      }

      posX = Math.max(margin, Math.round(posX));
      posY = Math.max(margin, Math.round(posY));

      // Avoid redundant DOM updates if position hasn't changed
      if (posX === lastPosX && posY === lastPosY) return;

      lastPosX = posX;
      lastPosY = posY;
      overlay.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;
    }

    function hideOverlay() {
      if (!activeUrl && overlay.style.display === 'none') return;

      activeTarget = null;
      activeUrl = '';
      naturalWidth = 0;
      naturalHeight = 0;
      overlayWidth = 0;
      overlayHeight = 0;
      lastPosX = -1;
      lastPosY = -1;
      overlay.style.opacity = '0';
      overlay.style.display = 'none';

      if (pendingLoader) {
        pendingLoader.onload = null;
        pendingLoader.onerror = null;
        pendingLoader = null;
      }

      // Cancel any pending RAF and free image memory
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      image.src = '';
    }

    function showImage(target, url) {
      activeTarget = target;
      activeUrl = url;
      naturalWidth = 0;
      naturalHeight = 0;

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

        naturalWidth = loader.naturalWidth || loader.width;
        naturalHeight = loader.naturalHeight || loader.height;
        if (!naturalWidth || !naturalHeight) {
          lastRejectedTarget = target;
          hideOverlay();
          return;
        }

        image.src = url;
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
        pendingLoader = null;
        applyScale();
      };

      loader.onerror = () => {
        if (pendingLoader === loader) {
          lastRejectedTarget = target;
          pendingLoader = null;
          hideOverlay();
        }
      };
    }

    function handlePointerMove(event) {
      if ('pointerType' in event && event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }

      pointerX = event.clientX;
      pointerY = event.clientY;

      // Use RAF to throttle positioning updates for smoothness
      if (overlay.style.display !== 'none') {
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            positionOverlay(pointerX, pointerY);
          });
        }
      }

      const rawTarget = event.target instanceof Element ? event.target : null;
      if (!rawTarget) {
        hideOverlay();
        lastRejectedTarget = null;
        return;
      }

      const candidate = rawTarget.closest(CANDIDATE_SELECTOR) || rawTarget;
      if (!candidate || candidate === document.body || candidate === document.documentElement) {
        hideOverlay();
        lastRejectedTarget = null;
        return;
      }

      if (candidate === activeTarget && activeUrl) {
        return;
      }

      if (candidate === lastRejectedTarget) {
        return;
      }

      const url = extractImageUrl(candidate);
      if (!url) {
        if (candidate !== activeTarget) {
          lastRejectedTarget = candidate;
          hideOverlay();
        }
        return;
      }

      if (url === activeUrl) {
        activeTarget = candidate;
        return;
      }

      lastRejectedTarget = null;
      showImage(candidate, url);
    }

    document.addEventListener(POINTER_EVENT, handlePointerMove, { passive: true });
    document.addEventListener('mouseleave', hideOverlay);
    window.addEventListener('blur', hideOverlay);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideOverlay();
    });
    window.addEventListener('resize', applyScale);
  });
})();
