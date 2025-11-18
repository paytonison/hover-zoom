// ==UserScript==
// @name         Image Hover Zoom – Full Resolution (Safari 2025 Stable)
// @namespace    https://paytonison.dev
// @version      3.0
// @description  Hover images to preview full resolution. Safari-compatible, fast, and works on X/Twitter, Reddit, Imgur, Instagram, Flickr, etc.
// @author       Payton
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- Create the floating preview image ---
    const preview = document.createElement('img');
    Object.assign(preview.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        objectFit: 'contain',
        pointerEvents: 'none',
        zIndex: '2147483647',
        background: 'rgba(0,0,0,0.85)',
        borderRadius: '12px',
        padding: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        opacity: '0',
        transition: 'opacity 0.12s linear',
    });

    document.body.appendChild(preview);

    let lastX = 0, lastY = 0;

    function updatePosition() {
        if (!preview.src) return;

        const rect = preview.getBoundingClientRect();
        let x = lastX + 18;
        let y = lastY + 18;

        // Keep within viewport
        if (x + rect.width > window.innerWidth) {
            x = lastX - rect.width - 18;
        }
        if (y + rect.height > window.innerHeight) {
            y = lastY - rect.height - 18;
        }

        preview.style.left = Math.max(6, x) + 'px';
        preview.style.top  = Math.max(6, y) + 'px';
    }

    document.addEventListener('mousemove', e => {
        lastX = e.clientX;
        lastY = e.clientY;
        updatePosition();
    }, true);

    function showPreview(url) {
        preview.src = '';
        preview.src = url;
        preview.style.opacity = '1';
    }

    function hidePreview() {
        preview.style.opacity = '0';
        preview.src = '';
    }

    preview.onload = updatePosition;

    // --- Full resolution resolver (cleaned + fixed) ---
    function getBestImageUrl(img) {
        let src = img.currentSrc || img.src;
        if (!src) return null;

        src = new URL(src, location.href).href;

        // srcset: highest res candidate
        if (img.srcset) {
            const candidates = img.srcset.split(',').map(s => {
                const [url, descriptor] = s.trim().split(/\s+/);
                const abs = new URL(url, location.href).href;
                const size = descriptor && descriptor.endsWith('w') ? parseInt(descriptor) :
                             descriptor && descriptor.endsWith('x') ? parseFloat(descriptor) : 0;
                return { abs, size };
            }).filter(c => c.size > 0);

            if (candidates.length) {
                candidates.sort((a,b) => b.size - a.size);
                return candidates[0].abs;
            }
        }

        // Parent link to image
        const a = img.closest('a');
        if (a && /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i.test(a.href)) {
            return new URL(a.href, location.href).href;
        }

        // Twitter/X
        if (src.includes("twimg.com")) {
            src = src.replace(/name=\w+/, 'name=orig').replace(/:(\w+)$/, ':orig');
        }

        // Imgur
        src = src.replace(/([a-z0-9]+)([stmloh])\.(jpg|png|gif|webp)$/i, '$1.$3');

        // Flickr
        src = src.replace(/_[bcmnostz]\.jpg/i, '.jpg');

        return src;
    }

    // --- Event delegation ---
    document.body.addEventListener('mouseover', e => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;

        if (img.clientWidth < 40 || img.clientHeight < 40) return;

        const url = getBestImageUrl(img);
        if (url) showPreview(url);
    }, true);

    document.body.addEventListener('mouseout', e => {
        if (e.target instanceof HTMLImageElement) hidePreview();
    }, true);

    // Hide during scroll / escape
    window.addEventListener('scroll', hidePreview, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') hidePreview();
    });

})();