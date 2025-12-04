// ==UserScript==
// @name         Hover Zoom (Full-res + IG/FB/Twitter Upscale)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Full-res hover zoom near cursor, height-limited, with URL upscalers for Instagram, Facebook, and Twitter/X.
// @author       You
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- CONFIG ----------------------------------------------------

  const MIN_TARGET_SIZE = 40;     // ignore tiny icons etc.
  const MAX_HEIGHT_VH   = 100;    // constrain only by viewport height
  const CURSOR_OFFSET   = 20;     // distance from cursor to image

  // --- STATE -----------------------------------------------------

  let previewContainer = null;
  let previewImg = null;
  let activeOwner = null;
  let activeUrl = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // --- UTILITIES -------------------------------------------------

  function createPreview() {
    if (previewContainer) return;

    previewContainer = document.createElement('div');
    previewContainer.style.position = 'fixed';
    previewContainer.style.zIndex = '999999';
    previewContainer.style.pointerEvents = 'none';
    previewContainer.style.display = 'none';
    previewContainer.style.background = 'rgba(0, 0, 0, 0.9)';
    previewContainer.style.padding = '4px';
    previewContainer.style.borderRadius = '4px';
    previewContainer.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
    previewContainer.style.transition = 'opacity 0.08s ease-out';
    previewContainer.style.opacity = '0';

    previewImg = document.createElement('img');
    previewImg.style.display = 'block';

    // Full resolution, only limited by viewport height
    previewImg.style.width = 'auto';
    previewImg.style.height = 'auto';
    previewImg.style.maxHeight = MAX_HEIGHT_VH + 'vh';
    previewImg.style.maxWidth = 'none'; // no artificial width cap

    previewContainer.appendChild(previewImg);
    document.body.appendChild(previewContainer);
  }

  function hidePreview() {
    activeOwner = null;
    activeUrl = null;
    if (previewContainer) {
      previewContainer.style.display = 'none';
      previewContainer.style.opacity = '0';
    }
  }

  function showPreview(url) {
    createPreview();
    if (!previewContainer || !previewImg) return;

    previewImg.onload = function () {
      clampPreviewIntoViewport();
      previewContainer.style.opacity = '1';
    };

    previewImg.src = url;
    previewContainer.style.display = 'block';
    previewContainer.style.opacity = '0';

    updatePreviewPosition(lastMouseX, lastMouseY);
  }

  function updatePreviewPosition(clientX, clientY) {
    if (!previewContainer) return;

    lastMouseX = clientX;
    lastMouseY = clientY;

    let x = clientX + CURSOR_OFFSET;
    let y = clientY + CURSOR_OFFSET;

    previewContainer.style.left = x + 'px';
    previewContainer.style.top = y + 'px';

    clampPreviewIntoViewport();
  }

  function clampPreviewIntoViewport() {
    if (!previewContainer || previewContainer.style.display === 'none') return;

    const rect = previewContainer.getBoundingClientRect();
    const margin = 8;
    let x = rect.left;
    let y = rect.top;
    let changed = false;

    if (rect.right > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - margin - rect.width);
      changed = true;
    }
    if (rect.bottom > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - margin - rect.height);
      changed = true;
    }
    if (rect.left < margin) {
      x = margin;
      changed = true;
    }
    if (rect.top < margin) {
      y = margin;
      changed = true;
    }

    if (changed) {
      previewContainer.style.left = x + 'px';
      previewContainer.style.top = y + 'px';
    }
  }

  // --- URL UPSCALERS ---------------------------------------------

  function upscaleImageUrl(rawUrl) {
    // Leave data/blob/etc alone
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
      return rawUrl;
    }

    let u;
    try {
      u = new URL(rawUrl, location.href);
    } catch {
      return rawUrl;
    }

    const host = u.hostname;
    let changed = false;

    // Twitter / X (pbs.twimg.com)
    if (host.includes('twimg.com')) {
      // Highest quality version is usually `name=orig`
      if (u.searchParams.get('name') !== 'orig') {
        u.searchParams.set('name', 'orig');
        changed = true;
      }
    }

    // Facebook / Instagram CDNs
    if (
      host.includes('fbcdn.net') ||
      host.includes('facebook.com') ||
      host.includes('cdninstagram.com') ||
      host.includes('instagram.com')
    ) {
      let path = u.pathname;
      const originalPath = path;

      // Remove size/crop segments like /s150x150/, /p206x206/, /c0.0.1080.1080/
      path = path.replace(/\/[sp]\d+x\d+\//g, '/');
      path = path.replace(/\/c\d+\.\d+\.\d+\.\d+\//g, '/');

      if (path !== originalPath) {
        u.pathname = path;
        changed = true;
      }

      // Optionally nuke aggressive resize params (conservative subset)
      const resizeParams = ['w', 'h', 'width', 'height'];
      for (const key of resizeParams) {
        if (u.searchParams.has(key)) {
          u.searchParams.delete(key);
          changed = true;
        }
      }
    }

    return changed ? u.toString() : rawUrl;
  }

  // --- IMAGE SOURCE HELPERS --------------------------------------

  function getBestImageUrlFromImg(img) {
    let url = null;

    if (img.currentSrc) {
      url = img.currentSrc;
    } else if (img.srcset) {
      let bestUrl = null;
      let bestScore = 0;
      const candidates = img.srcset.split(',');

      for (const part of candidates) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const pieces = trimmed.split(/\s+/);
        const candidateUrl = pieces[0];
        let score = 0;
        if (pieces[1]) {
          const m = pieces[1].match(/(\d+)(w|x)/);
          if (m) score = parseInt(m[1], 10) || 0;
        }
        if (!bestUrl || score > bestScore) {
          bestUrl = candidateUrl;
          bestScore = score;
        }
      }

      url = bestUrl || img.src || null;
    } else {
      url = img.src || null;
    }

    if (!url) return null;
    return upscaleImageUrl(url);
  }

  function getBackgroundImageUrl(node) {
    const style = window.getComputedStyle(node);
    const bg = style && style.backgroundImage;
    if (!bg || bg === 'none') return null;

    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (!match) return null;

    const url = match[1];
    return upscaleImageUrl(url);
  }

  function isBigEnough(node) {
    const rect = node.getBoundingClientRect();
    return rect.width >= MIN_TARGET_SIZE && rect.height >= MIN_TARGET_SIZE;
  }

  function findImageAtElement(startEl) {
    let node = startEl;

    while (node && node !== document.body && node !== document.documentElement) {
      if (node.tagName === 'IMG') {
        const img = node;
        if (!isBigEnough(img)) {
          // Skip tiny UI icons but keep climbing
        } else {
          const url = getBestImageUrlFromImg(img);
          if (url) {
            return { url: url, owner: img };
          }
        }
      }

      const bgUrl = getBackgroundImageUrl(node);
      if (bgUrl && isBigEnough(node)) {
        return { url: bgUrl, owner: node };
      }

      node = node.parentElement;
    }

    return null;
  }

  // --- EVENT HANDLERS --------------------------------------------

  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) {
      hidePreview();
      return;
    }

    const info = findImageAtElement(el);
    if (!info) {
      hidePreview();
      return;
    }

    const { url, owner } = info;

    if (
      previewContainer &&
      previewContainer.style.display !== 'none' &&
      activeOwner === owner &&
      activeUrl === url
    ) {
      updatePreviewPosition(e.clientX, e.clientY);
      return;
    }

    activeOwner = owner;
    activeUrl = url;
    showPreview(url);
    updatePreviewPosition(e.clientX, e.clientY);
  }

  function onScrollOrResize() {
    hidePreview();
  }

  function init() {
    createPreview();
    document.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
