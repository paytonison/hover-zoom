// ==UserScript==
// @name         Image Popout (Safari)
// @namespace    https://github.com/paytonison/hover-zoom
// @version      0.2.4
// @description  Hover images for a near-cursor preview (click pins; Z toggles; Esc hides). Alt/Option-click opens a movable, resizable overlay.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
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
    video: null,
    title: null,
    popoutAutoFit: true,
    drag: null,
    resize: null,
    lastUrl: null,
    lastMediaType: "image",
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

  function isLikelyVideoUrl(url) {
    if (!url) return false;
    if (url.startsWith("data:video/")) return true;
    try {
      const parsed = new URL(url, window.location.href);
      const path = parsed.pathname.toLowerCase();
      return /\.(m4v|mp4|mov|webm|ogv|m3u8)(?:$|\?)/.test(path);
    } catch {
      return false;
    }
  }

  function normalizeKnownImageUrl(url) {
    if (!url) return url;
    if (url.startsWith("data:image/")) return url;
    try {
      const parsed = new URL(url, window.location.href);
      const host = parsed.hostname.toLowerCase();

      // X / Twitter CDN: prefer original-size assets when possible.
      if (host.endsWith("twimg.com")) {
        if (parsed.searchParams.has("format")) {
          parsed.searchParams.set("name", "orig");
        } else if (parsed.searchParams.has("name")) {
          parsed.searchParams.set("name", "orig");
        }
        return parsed.href;
      }

      return parsed.href;
    } catch {
      return url;
    }
  }

  function resolveUrl(url) {
    if (!url) return "";
    try {
      return normalizeKnownImageUrl(new URL(url, window.location.href).href);
    } catch {
      return normalizeKnownImageUrl(url);
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

  function pickBestImageDownloadUrl(imgEl) {
    const srcset = imgEl.getAttribute("srcset") || imgEl.srcset || "";
    const bestSrcset = pickBestSrcsetUrl(srcset);
    if (bestSrcset) return bestSrcset;

    if (imgEl.currentSrc) return resolveUrl(imgEl.currentSrc);

    for (const key of LAZY_IMAGE_ATTRS) {
      const value = imgEl.getAttribute(key);
      if (value) return resolveUrl(value);
    }

    return imgEl.src ? resolveUrl(imgEl.src) : "";
  }

  function extractQualityScore(value) {
    if (!value) return 0;
    const text = String(value).toLowerCase();
    const match = text.match(/(\d{3,4})\s*p?/);
    if (!match) return 0;
    return Number(match[1]) || 0;
  }

  function pickBestVideoUrl(videoEl) {
    const current = resolveUrl(videoEl.currentSrc || videoEl.src || "");
    const currentScore = extractQualityScore(current);
    const currentIsBlobLike = current.startsWith("blob:") || current.startsWith("data:");

    const sourceCandidates = Array.from(videoEl.querySelectorAll("source[src]"))
      .map((source) => {
        const rawUrl = source.getAttribute("src") || source.src || "";
        const url = resolveUrl(rawUrl);
        if (!url) return null;

        const score = Math.max(
          extractQualityScore(source.getAttribute("size")),
          extractQualityScore(source.getAttribute("label")),
          extractQualityScore(source.getAttribute("res")),
          extractQualityScore(source.getAttribute("data-quality")),
          extractQualityScore(source.getAttribute("title")),
          extractQualityScore(url),
        );

        return { url, score };
      })
      .filter(Boolean);

    if (sourceCandidates.length) {
      sourceCandidates.sort((a, b) => b.score - a.score);
      const best = sourceCandidates[0] || null;
      if (best?.url) {
        if (currentIsBlobLike) return best.url;
        if (!current) return best.url;
        if ((best.score || 0) > currentScore) return best.url;
      }
    }

    return current;
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

  function extractMediaFromEventTarget(target) {
    if (!(target instanceof Element)) return null;

    if (target.closest?.("#ip-popout-overlay")) return null;
    if (target.closest?.("#ip-hover-wrap")) return null;
    if (target.closest?.("#ip-hover-toast")) return null;

    const video = target.closest("video");
    if (video) {
      const url = pickBestVideoUrl(video);
      if (url) return { type: "video", url };
    }

    const img = target.closest("img");
    if (img) {
      const anchor = img.closest("a[href]");
      if (anchor && isLikelyImageUrl(anchor.href))
        return { type: "image", url: anchor.href };
      const url = pickBestImageDownloadUrl(img);
      if (url) return { type: "image", url };
      return null;
    }

    const anchor = target.closest("a[href]");
    if (anchor && isLikelyImageUrl(anchor.href))
      return { type: "image", url: anchor.href };
    if (anchor && isLikelyVideoUrl(anchor.href))
      return { type: "video", url: anchor.href };

    const bgEl = target.closest("div,span,a,button,figure,section");
    if (bgEl) {
      const bgUrl = getBackgroundImageUrl(bgEl);
      if (bgUrl) return { type: "image", url: bgUrl };
    }

    return null;
  }

  const EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };

  const KNOWN_EXTENSIONS = new Set([
    "jpeg",
    "jpg",
    "png",
    "webp",
    "avif",
    "gif",
    "mp4",
    "webm",
  ]);

  function isPopoutOpen() {
    return Boolean(STATE.overlay?.classList.contains("ip-open"));
  }

  function inferExtensionFromContentType(contentType) {
    if (!contentType) return "";
    const normalized = String(contentType).toLowerCase().split(";")[0].trim();
    return EXT_BY_CONTENT_TYPE[normalized] || "";
  }

  function inferExtensionFromUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, window.location.href);
      const pathExtMatch = parsed.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
      if (pathExtMatch) {
        const ext = pathExtMatch[1];
        if (KNOWN_EXTENSIONS.has(ext)) return ext === "jpg" ? "jpeg" : ext;
      }

      const possibleKeys = ["format", "ext", "extension", "mime"];
      for (const key of possibleKeys) {
        const value = parsed.searchParams.get(key);
        if (!value) continue;
        const normalized = value.toLowerCase().replace(/^image\//, "").replace(/^video\//, "");
        if (KNOWN_EXTENSIONS.has(normalized)) {
          return normalized === "jpg" ? "jpeg" : normalized;
        }
      }
    } catch {}
    return "";
  }

  function parseContentTypeFromHeaders(headers) {
    if (!headers) return "";
    const match = String(headers).match(/^\s*content-type\s*:\s*([^\r\n]+)/im);
    return match ? match[1].trim() : "";
  }

  function buildDownloadBaseName() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const host = (window.location.hostname || "site").replace(/[^a-z0-9.-]+/gi, "_");
    return `ip_${host}_${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
  }

  function buildDownloadFilename(url, contentType) {
    const ext =
      inferExtensionFromContentType(contentType) ||
      inferExtensionFromUrl(url) ||
      "bin";
    return `${buildDownloadBaseName()}.${ext}`;
  }

  function getCurrentPopoutMediaForDownload() {
    if (!isPopoutOpen()) return null;

    if (STATE.lastMediaType === "video") {
      const videoUrl = STATE.video ? pickBestVideoUrl(STATE.video) : "";
      if (videoUrl) return { type: "video", url: videoUrl };
    }

    const imageUrl = STATE.img ? pickBestImageDownloadUrl(STATE.img) : "";
    if (imageUrl) return { type: "image", url: imageUrl };

    if (STATE.lastUrl) {
      return { type: STATE.lastMediaType || "image", url: resolveUrl(STATE.lastUrl) };
    }

    return null;
  }

  function runGMDownload(url, name) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== "function") {
        reject(new Error("GM_download unavailable"));
        return;
      }

      try {
        GM_download({
          url,
          name,
          saveAs: false,
          onload: () => resolve(),
          onerror: (error) => reject(error || new Error("GM_download failed")),
          ontimeout: () => reject(new Error("GM_download timeout")),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function fetchBlobViaGM(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }

      try {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType: "blob",
          anonymous: false,
          onload: (response) => {
            const status = Number(response?.status) || 0;
            if (status && (status < 200 || status >= 400)) {
              reject(new Error(`Request failed with status ${status}`));
              return;
            }
            const headers = parseContentTypeFromHeaders(response?.responseHeaders || "");
            let blob = response?.response;
            if (!(blob instanceof Blob) && blob != null) {
              blob = new Blob([blob], {
                type:
                  inferExtensionFromContentType(headers) ? headers : "application/octet-stream",
              });
            }
            if (!(blob instanceof Blob)) {
              reject(new Error("No blob response"));
              return;
            }
            resolve({ blob, contentType: headers || blob.type || "" });
          },
          onerror: (error) => reject(error || new Error("GM_xmlhttpRequest failed")),
          ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout")),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function downloadBlobToDisk(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    (document.body || document.documentElement).appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      link.remove();
    }, 1000);
  }

  async function downloadCurrentMedia() {
    const media = getCurrentPopoutMediaForDownload();
    const url = media?.url || "";
    if (!url) return;

    const fallbackName = buildDownloadFilename(url, "");
    try {
      await runGMDownload(url, fallbackName);
      showPopoutToast("Download started");
      return;
    } catch {}

    try {
      const { blob, contentType } = await fetchBlobViaGM(url);
      const finalName = buildDownloadFilename(url, contentType);
      downloadBlobToDisk(blob, finalName);
      showPopoutToast("Downloaded");
    } catch (error) {
      console.error("[Image Popout] Download failed:", error);
      showPopoutToast("Download failed");
    }
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
        --ip-glass-border-outer: rgba(255, 255, 255, 0.33);
        --ip-glass-border-outer-soft: rgba(255, 255, 255, 0.2);
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
          --ip-glass-border-outer: rgba(255, 255, 255, 0.33);
          --ip-glass-border-outer-soft: rgba(255, 255, 255, 0.22);
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
        isolation: isolate;
        background: var(--ip-glass-surface);
        color: var(--ip-glass-text);
        border-radius: var(--ip-glass-radius-xl);
        box-shadow: var(--ip-glass-shadow),
          var(--ip-glass-shadow-soft),
          0 0 0 0.5px var(--ip-glass-border-hairline),
          inset 0 1px 0 var(--ip-glass-highlight);
        overflow: hidden;
        border: 1px solid transparent;
        backdrop-filter: blur(var(--ip-glass-blur))
          saturate(var(--ip-glass-sat));
        -webkit-backdrop-filter: blur(var(--ip-glass-blur))
          saturate(var(--ip-glass-sat));
      }
      #ip-popout-window::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background:
          radial-gradient(
            120% 78% at 10% -12%,
            color-mix(in srgb, var(--ip-glass-highlight) 70%, transparent),
            transparent 46%
          ),
          radial-gradient(
            118% 80% at 92% 114%,
            color-mix(in srgb, var(--ip-glass-border-outer-soft) 85%, transparent),
            transparent 52%
          ),
          linear-gradient(
            155deg,
            color-mix(in srgb, var(--ip-glass-highlight) 48%, var(--ip-glass-border-outer)),
            var(--ip-glass-border-outer) 45%,
            var(--ip-glass-border-outer-soft)
          );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        mask-composite: exclude;
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, var(--ip-glass-highlight) 68%, transparent),
          inset 0 -1px 0 color-mix(in srgb, var(--ip-glass-border-outer-soft) 88%, transparent);
        pointer-events: none;
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
          var(--ip-glass-highlight),
          transparent
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
        background: var(--ip-glass-danger, rgba(255, 59, 48, 0.22));
        border-color: var(--ip-glass-danger-border, rgba(255, 59, 48, 0.35));
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
      #ip-popout-video {
        width: 100%;
        height: 100%;
        display: none;
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
            color-mix(in srgb, transparent 55%, var(--ip-glass-highlight)) 52%
          ),
          linear-gradient(
            135deg,
            transparent 68%,
            color-mix(in srgb, transparent 72%, var(--ip-glass-highlight)) 68%
          ),
          linear-gradient(
            135deg,
            transparent 82%,
            color-mix(in srgb, transparent 82%, var(--ip-glass-highlight)) 82%
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

    const btnDownload = document.createElement("button");
    btnDownload.type = "button";
    btnDownload.className = "ip-btn";
    btnDownload.textContent = "Download";
    btnDownload.dataset.action = "download";

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

    const video = document.createElement("video");
    video.id = "ip-popout-video";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";

    const resize = document.createElement("div");
    resize.id = "ip-popout-resize";
    resize.setAttribute("role", "presentation");

    const toast = document.createElement("div");
    toast.id = "ip-popout-toast";
    toast.textContent = "";

    body.appendChild(img);
    body.appendChild(video);
    titlebar.appendChild(title);
    titlebar.appendChild(btnCopy);
    titlebar.appendChild(btnOpen);
    titlebar.appendChild(btnDownload);
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
      if (action === "download") void downloadCurrentMedia();
    });

    titlebar.addEventListener("pointerdown", startDrag, { passive: false });
    resize.addEventListener("pointerdown", startResize, { passive: false });

    document.documentElement.appendChild(overlay);

    STATE.overlay = overlay;
    STATE.popout = win;
    STATE.titlebar = titlebar;
    STATE.img = img;
    STATE.video = video;
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

  function openPopout(media) {
    buildUi();
    if (!STATE.overlay || !STATE.popout || !STATE.img || !STATE.title) return;

    const mediaUrl =
      typeof media === "string"
        ? media
        : typeof media?.url === "string"
          ? media.url
          : "";
    const mediaType =
      typeof media === "object" && media?.type === "video" ? "video" : "image";
    if (!mediaUrl) return;

    STATE.lastUrl = mediaUrl;
    STATE.lastMediaType = mediaType;
    STATE.title.textContent = mediaUrl;
    STATE.popoutAutoFit = true;

    maximizePopoutToViewport();

    STATE.overlay.classList.add("ip-open");

    const img = STATE.img;
    const video = STATE.video;

    if (mediaType === "video" && video) {
      img.style.display = "none";
      img.src = "";

      video.style.display = "block";
      video.pause();
      video.src = "";
      video.src = mediaUrl;
      video.load();
      video.onloadedmetadata = () => clampPopoutToViewport();
      video.onerror = () => showPopoutToast("Failed to load video");
    } else {
      if (video) {
        video.pause();
        video.style.display = "none";
        video.src = "";
      }

      img.style.display = "block";
      img.src = "";
      img.src = mediaUrl;
      img.onload = () => clampPopoutToViewport();
      img.onerror = () => showPopoutToast("Failed to load image");
    }
  }

  function closePopout() {
    if (!STATE.overlay) return;
    if (STATE.video) STATE.video.pause();
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

    const downTarget = event.target;
    if (downTarget instanceof Element && downTarget.closest(".ip-btn")) return;

    event.preventDefault();
    STATE.popoutAutoFit = false;

    const pointerId = event.pointerId;
    try {
      titlebar.setPointerCapture(pointerId);
    } catch {}

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
      try {
        titlebar.releasePointerCapture(pointerId);
      } catch {}
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

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    if (handle instanceof Element) {
      try {
        handle.setPointerCapture(pointerId);
      } catch {}
    }

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
      if (handle instanceof Element) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch {}
      }
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
  const HOVER_FOLLOW_IDLE_MS = 120;

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
    "left:0",
    "top:0",
    "transform: translate3d(-9999px, -9999px, 0)",
    "will-change: transform",
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
    "box-shadow: var(--ip-glass-shadow-soft)",
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
  const hoverLayout = {
    wrapW: 300,
    wrapH: 300,
    lastMoveAt: 0,
    lastFrameMouseX: Number.NaN,
    lastFrameMouseY: Number.NaN,
  };

  let hoverMoveRaf = 0;
  function stopHoverFollowLoop() {
    if (!hoverMoveRaf) return;
    window.cancelAnimationFrame(hoverMoveRaf);
    hoverMoveRaf = 0;
  }

  function runHoverFollowLoop() {
    hoverMoveRaf = 0;

    if (!hoverState.enabled) return;
    if (!hoverActive.el) return;
    if (hoverState.pinned) return;
    if (hoverWrap.style.display !== "block") return;

    const now = performance.now();
    if (now - hoverLayout.lastMoveAt > HOVER_FOLLOW_IDLE_MS) return;

    const x = hoverActive.lastMouse.x;
    const y = hoverActive.lastMouse.y;
    const moved =
      x !== hoverLayout.lastFrameMouseX || y !== hoverLayout.lastFrameMouseY;

    if (!moved) {
      hoverMoveRaf = window.requestAnimationFrame(runHoverFollowLoop);
      return;
    }

    const rect = hoverActive.el.getBoundingClientRect();

    const inside =
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom;

    if (!inside) {
      hideHoverWrap();
      return;
    }

    updateHoverPosition(x, y);
    hoverLayout.lastFrameMouseX = x;
    hoverLayout.lastFrameMouseY = y;
    hoverMoveRaf = window.requestAnimationFrame(runHoverFollowLoop);
  }

  function startHoverFollowLoop() {
    if (hoverMoveRaf) return;
    if (!hoverState.enabled) return;
    if (!hoverActive.el) return;
    if (hoverState.pinned) return;
    if (hoverWrap.style.display !== "block") return;
    hoverMoveRaf = window.requestAnimationFrame(runHoverFollowLoop);
  }

  function showHoverWrap() {
    hoverWrap.style.display = "block";
    hoverBadge.style.display = hoverState.pinned ? "block" : "none";
  }

  function hideHoverWrap() {
    stopHoverFollowLoop();
    hoverWrap.style.display = "none";
    hoverWrap.style.transform = "translate3d(-9999px, -9999px, 0)";
    hoverActive.el = null;
    hoverActive.url = "";
    hoverLayout.lastFrameMouseX = Number.NaN;
    hoverLayout.lastFrameMouseY = Number.NaN;
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

    const w = hoverLayout.wrapW;
    const h = hoverLayout.wrapH;
    const pad = HOVER_VIEWPORT_PAD;

    let left = x + hoverState.offset;
    let top = y + hoverState.offset;

    if (left + w + pad > vw) left = x - hoverState.offset - w;
    if (top + h + pad > vh) top = y - hoverState.offset - h;

    left = clamp(left, pad, Math.max(pad, vw - w - pad));
    top = clamp(top, pad, Math.max(pad, vh - h - pad));

    hoverWrap.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function applyHoverSize() {
    const naturalW = hoverActive.natural.w || 800;
    const naturalH = hoverActive.natural.h || 600;
    const { w, h } = computeHoverFitSize(naturalW, naturalH);
    hoverImg.style.width = `${w}px`;
    hoverImg.style.height = `${h}px`;
    hoverLayout.wrapW = w + HOVER_WRAP_CHROME;
    hoverLayout.wrapH = h + HOVER_WRAP_CHROME;
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
    hoverActive.lastMouse.x = mouseX;
    hoverActive.lastMouse.y = mouseY;
    hoverLayout.lastMoveAt = performance.now();
    hoverLayout.lastFrameMouseX = Number.NaN;
    hoverLayout.lastFrameMouseY = Number.NaN;

    showHoverWrap();
    setHoverImageUrl(url);
    updateHoverPosition(mouseX, mouseY);
    startHoverFollowLoop();
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
    hoverLayout.lastMoveAt = performance.now();

    if (!hoverState.enabled) return;
    if (!hoverActive.el) return;

    startHoverFollowLoop();
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
    if (hoverState.pinned) stopHoverFollowLoop();
    else startHoverFollowLoop();
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

    if (
      isPopoutOpen() &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === "d" || event.key === "D")
    ) {
      event.preventDefault();
      if (!event.repeat) void downloadCurrentMedia();
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
      if (hoverState.pinned) stopHoverFollowLoop();
      else startHoverFollowLoop();
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

    const media = extractMediaFromEventTarget(event.target);
    if (!media?.url) return;

    event.preventDefault();
    event.stopPropagation();

    disableHoverPreviewForPopout();
    openPopout(media);
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
  if ("PointerEvent" in window) {
    document.addEventListener("pointermove", onHoverMouseMove, {
      capture: true,
      passive: true,
    });
  } else {
    document.addEventListener("mousemove", onHoverMouseMove, {
      capture: true,
      passive: true,
    });
  }
  document.addEventListener("click", onHoverClick, true);

  showHoverToast(
    hoverState.enabled
      ? "Image preview ready (Z toggles)"
      : "Image preview OFF (press Z)",
  );
})();
