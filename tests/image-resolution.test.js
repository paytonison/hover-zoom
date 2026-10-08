"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PAGE_URL = "https://example.test/gallery/";
const absolute = (url) => new URL(url, PAGE_URL).href;

// Only the DOM surface used by image discovery is needed. Run the production
// userscript itself, with event registration replaced by a test-only export.
class Element {
  constructor(tagName, attributes = {}) {
    this.localName = tagName;
    this.attributes = attributes;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const match = part.trim().match(/^([a-z]+)(?:\[([a-z-]+)\])?$/);
      return Boolean(
        match &&
          this.localName === match[1] &&
          (!match[2] || this.getAttribute(match[2]) !== null),
      );
    });
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 160, bottom: 120, width: 160, height: 120 };
  }
}

class HTMLImageElement extends Element {
  constructor(attributes = {}, currentSrc = "") {
    super("img", attributes);
    this.currentSrc = currentSrc ? absolute(currentSrc) : "";
    this.src = attributes.src ? absolute(attributes.src) : "";
    this.srcset = attributes.srcset || "";
  }
}

class HTMLPictureElement extends Element {
  constructor() {
    super("picture");
  }
}

class HTMLVideoElement extends Element {}

function loadResolver(mediaMatches = {}) {
  const window = {
    location: new URL(PAGE_URL),
    matchMedia: (query) => ({ matches: mediaMatches[query] ?? true }),
  };
  window.top = window;
  window.self = window;

  const context = vm.createContext({
    window,
    URL,
    Element,
    HTMLImageElement,
    HTMLPictureElement,
    HTMLVideoElement,
    localStorage: { getItem: () => null },
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      backgroundImage: "none",
    }),
  });
  const filename = join(__dirname, "..", "hover-zoom.user.js");
  const source = readFileSync(filename, "utf8");
  assert.equal((source.match(/^  init\(\);$/gm) || []).length, 1);
  vm.runInContext(
    source.replace(
      /^  init\(\);$/m,
      "globalThis.resolver = { pickBestImageUrl, pickBestPictureSourceUrl, buildImageCandidate, findHoverCandidate };",
    ),
    context,
    { filename },
  );
  return context.resolver;
}

const resolver = loadResolver();

function hoveredImage(image, api = resolver) {
  const path = [];
  for (let element = image; element; element = element.parentElement) {
    path.push(element);
  }
  return api.findHoverCandidate({ path, clientX: 80, clientY: 60 });
}

for (const attr of [
  "data-original",
  "data-full",
  "data-full-src",
  "data-hires",
  "data-zoom-src",
  "data-large",
]) {
  test(`${attr} beats a loaded thumbnail and thumbnail srcset`, () => {
    const image = new HTMLImageElement(
      {
        src: "thumb.jpg",
        srcset: "thumb.jpg 160w, thumb-2x.jpg 320w",
        "data-src": "lazy-thumb.jpg",
        [attr]: "original.jpg",
      },
      "thumb.jpg",
    );
    assert.equal(resolver.pickBestImageUrl(image), absolute("original.jpg"));
    assert.equal(hoveredImage(image).url, absolute("original.jpg"));
  });
}

test("an explicit full image beats a picture's thumbnail source", () => {
  const image = new HTMLImageElement(
    { src: "thumb.jpg", "data-original": "original.jpg" },
    "thumb.webp",
  );
  new HTMLPictureElement().append(
    new Element("source", { srcset: "thumb.webp 160w, thumb-2x.webp 320w" }),
    image,
  );
  assert.equal(hoveredImage(image).url, absolute("original.jpg"));
});

for (const attr of ["data-src", "data-url", "data-lazy-src"]) {
  test(`${attr} preserves the loaded source and remains a lazy fallback`, () => {
    const image = new HTMLImageElement(
      { src: "image.jpg", [attr]: "lazy-image.jpg" },
      "image.jpg",
    );
    assert.equal(hoveredImage(image).url, absolute("image.jpg"));
    const fallback = new HTMLImageElement({ [attr]: "lazy-image.jpg" });
    assert.equal(hoveredImage(fallback).url, absolute("lazy-image.jpg"));
  });
}

for (const attr of ["data-preview", "data-thumb", "data-thumbnail", "data-poster"]) {
  test(`${attr} does not replace a loaded image and remains a fallback`, () => {
    const image = new HTMLImageElement(
      { src: "image.jpg", [attr]: "preview.jpg" },
      "image.jpg",
    );
    assert.equal(hoveredImage(image).url, absolute("image.jpg"));
    const fallback = new HTMLImageElement({ [attr]: "preview.jpg" });
    assert.equal(hoveredImage(fallback).url, absolute("preview.jpg"));
  });
}

test("a responsive image chooses the largest declared width", () => {
  const image = new HTMLImageElement(
    {
      src: "small.jpg",
      srcset: "large.jpg 1600w, small.jpg 160w, medium.jpg 800w",
      "data-src": "lazy.jpg",
    },
    "small.jpg",
  );
  assert.equal(hoveredImage(image).url, absolute("large.jpg"));
});

test("a responsive image chooses the largest declared density", () => {
  const image = new HTMLImageElement(
    { src: "small.jpg", srcset: "small.jpg 1x, large.jpg 3x, medium.jpg 2x" },
    "small.jpg",
  );
  assert.equal(hoveredImage(image).url, absolute("large.jpg"));
});

for (const attr of ["data-srcset", "data-lazy-srcset", "data-original-srcset"]) {
  test(`${attr} remains a responsive source`, () => {
    const image = new HTMLImageElement(
      { src: "small.jpg", [attr]: "small.jpg 160w, large.jpg 1600w" },
      "small.jpg",
    );
    assert.equal(hoveredImage(image).url, absolute("large.jpg"));
  });
}

test("picture fallback img srcset remains usable when no source is selected", () => {
  const image = new HTMLImageElement(
    { src: "fallback-small.jpg", srcset: "fallback-small.jpg 160w, fallback-large.jpg 1600w" },
    "fallback-small.jpg",
  );
  new HTMLPictureElement().append(
    new Element("source", {
      type: "image/unsupported-format",
      srcset: "unsupported-small.bin 160w, unsupported-large.bin 1600w",
    }),
    image,
  );
  assert.equal(hoveredImage(image).url, absolute("fallback-large.jpg"));
});

test("picture with no source elements still upgrades the fallback img srcset", () => {
  const image = new HTMLImageElement(
    { src: "small.jpg", srcset: "small.jpg 160w, large.jpg 1600w" },
    "small.jpg",
  );
  new HTMLPictureElement().append(image);
  assert.equal(hoveredImage(image).url, absolute("large.jpg"));
});

test("picture upgrades the active source while respecting media and art direction", () => {
  const api = loadResolver({ "(max-width: 600px)": false, "(min-width: 601px)": true });
  const image = new HTMLImageElement({ src: "fallback.jpg" }, "desktop-small.webp");
  new HTMLPictureElement().append(
    new Element("source", {
      media: "(max-width: 600px)",
      srcset: "desktop-small.webp 160w, mobile-large.webp 4000w",
    }),
    new Element("source", {
      media: "(min-width: 601px)",
      srcset: "desktop-small.webp 160w, desktop-large.webp 1600w",
    }),
    image,
  );
  assert.equal(api.pickBestPictureSourceUrl(image), absolute("desktop-large.webp"));
  assert.equal(hoveredImage(image, api).url, absolute("desktop-large.webp"));
});

test("picture uses the source the browser selected, even when it is not first", () => {
  const image = new HTMLImageElement({ src: "fallback.jpg" }, "selected-small.webp");
  new HTMLPictureElement().append(
    new Element("source", { srcset: "other-small.avif 160w, other-large.avif 2400w" }),
    new Element("source", { srcset: "selected-small.webp 160w, selected-large.webp 1600w" }),
    image,
  );
  assert.equal(hoveredImage(image).url, absolute("selected-large.webp"));
});

test("a direct image link is retained as the full image target", () => {
  const image = new HTMLImageElement(
    { src: "thumb.jpg", "data-original": "declared-original.jpg" },
    "thumb.jpg",
  );
  new Element("a", { href: "linked-original.jpg" }).append(image);
  assert.equal(resolver.buildImageCandidate(image).url, absolute("linked-original.jpg"));
  assert.equal(hoveredImage(image).url, absolute("linked-original.jpg"));
});

test("an unrelated surrounding page link does not replace the image URL", () => {
  const image = new HTMLImageElement(
    { src: "thumb.jpg", "data-original": "original.jpg" },
    "thumb.jpg",
  );
  new Element("a", { href: "/article/123" }).append(image);
  assert.equal(hoveredImage(image).url, absolute("original.jpg"));
});

test("a plain image remains usable with or without currentSrc", () => {
  for (const currentSrc of ["", "image.jpg"]) {
    const image = new HTMLImageElement({ src: "image.jpg" }, currentSrc);
    const candidate = hoveredImage(image);
    assert.equal(candidate.url, absolute("image.jpg"));
    assert.equal(candidate.sourceElement, image);
    assert.equal(candidate.type, "image");
  }
});
