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
  constructor(attributes = {}) {
    super("picture", attributes);
  }
}

class HTMLVideoElement extends Element {}

function loadResolver(mediaMatches = {}, pageUrl = PAGE_URL) {
  const window = {
    location: new URL(pageUrl),
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
    document: { elementsFromPoint: () => [] },
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
      "globalThis.resolver = { pickBestImageUrl, pickBestPictureSourceUrl, buildImageCandidate, findHoverCandidate, findPopoutCandidate };",
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

function assertHoverAndPopout(target, expectedUrl, api = resolver) {
  assert.equal(hoveredImage(target, api)?.url, expectedUrl, "hover URL");
  assert.equal(
    api.findPopoutCandidate(target, 80, 60)?.url,
    expectedUrl,
    "popout URL",
  );
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

for (const tagName of ["div", "figure", "span", "picture", "a"]) {
  test(`a single-image ${tagName} container supplies the full image`, () => {
    const image = new HTMLImageElement(
      { src: "thumb.jpg", srcset: "thumb.jpg 160w, thumb-2x.jpg 320w" },
      "thumb.jpg",
    );
    const attributes = { "data-full-src": "original.jpg" };
    const container = tagName === "picture"
      ? new HTMLPictureElement(attributes)
      : new Element(tagName, attributes);
    container.append(image);
    assertHoverAndPopout(image, absolute("original.jpg"));
  });
}

for (const attr of [
  "data-original", "data-full", "data-full-src", "data-hires", "data-zoom-src", "data-large",
]) {
  test(`container ${attr} is found through a nested image wrapper`, () => {
    const image = new HTMLImageElement({ src: "thumb.jpg" }, "thumb.jpg");
    const inner = new Element("span").append(image);
    new Element("figure", { [attr]: "original.jpg" }).append(inner);
    assertHoverAndPopout(image, absolute("original.jpg"));
  });
}

test("an image's own full-image metadata takes priority over its container", () => {
  const image = new HTMLImageElement(
    { src: "thumb.jpg", "data-original": "image-original.jpg" },
    "thumb.jpg",
  );
  new Element("figure", { "data-zoom-src": "container-original.jpg" }).append(image);
  assertHoverAndPopout(image, absolute("image-original.jpg"));
});

test("a multi-image ancestor cannot assign one image's source to another", () => {
  const first = new HTMLImageElement({ src: "first-thumb.jpg" }, "first-thumb.jpg");
  const second = new HTMLImageElement({ src: "second-thumb.jpg" }, "second-thumb.jpg");
  const firstContainer = new Element("figure", { "data-full": "first-original.jpg" }).append(first);
  const secondContainer = new Element("figure").append(second);
  new Element("div", { "data-original": "unrelated-gallery-original.jpg" })
    .append(firstContainer, secondContainer);
  assertHoverAndPopout(first, absolute("first-original.jpg"));
  assertHoverAndPopout(second, absolute("second-thumb.jpg"));
});

test("container discovery stops at an unrelated structural ancestor", () => {
  const image = new HTMLImageElement({ src: "thumb.jpg" }, "thumb.jpg");
  new Element("div", { "data-full": "unrelated-original.jpg" })
    .append(new Element("section").append(image));
  assertHoverAndPopout(image, absolute("thumb.jpg"));
});

test("Wikipedia's separate thumbnail host resolves to the source image", () => {
  const fileName = "Borealis_in_Welch_Township%2C_May_2024_%28cropped%29.jpg";
  const thumbBase = `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/${fileName}/`;
  const thumbnail = `${thumbBase}960px-${fileName}?utm_source=en.wikipedia.org&utm_content=thumbnail#preview`;
  const image = new HTMLImageElement({
    src: thumbnail,
    srcset: `${thumbBase}500px-${fileName} 500w, ${thumbnail} 960w`,
  }, thumbnail);
  new Element("figure").append(
    new Element("a", { href: `https://en.wikipedia.org/wiki/File:${fileName}` }).append(image),
  );
  assertHoverAndPopout(image, `https://upload.wikimedia.org/wikipedia/commons/a/aa/${fileName}`);
});

test("legacy Wikimedia thumbnail URLs still resolve to their original image", () => {
  const thumbnail = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Photo.jpg/960px-Photo.jpg?width=960#preview";
  const image = new HTMLImageElement({ src: thumbnail }, thumbnail);
  assertHoverAndPopout(image, "https://upload.wikimedia.org/wikipedia/commons/a/aa/Photo.jpg");
});

test("a Wikimedia SVG raster thumbnail resolves to the original SVG", () => {
  const thumbnail = "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/Camera2_mgx.svg/960px-Camera2_mgx.svg.png";
  const image = new HTMLImageElement({ src: thumbnail }, thumbnail);
  assertHoverAndPopout(image, "https://upload.wikimedia.org/wikipedia/commons/6/66/Camera2_mgx.svg");
  assert.equal(resolver.buildImageCandidate(image).kind, "svg");
});

for (const extension of ["apng", "tif", "tiff"]) {
  test(`Wikimedia ${extension} thumbnails resolve to the Safari-supported original`, () => {
    for (const host of ["thumb.wikimedia.org", "upload.wikimedia.org"]) {
      const thumbnail = `https://${host}/wikipedia/commons/thumb/a/aa/Media.${extension}/960px-Media.${extension}.png`;
      const image = new HTMLImageElement({ src: thumbnail }, thumbnail);
      assertHoverAndPopout(image, `https://upload.wikimedia.org/wikipedia/commons/a/aa/Media.${extension}`);
    }
  });
}

for (const extension of ["pdf", "djvu", "webm"]) {
  test(`Wikimedia ${extension} raster previews remain displayable images`, () => {
    for (const host of ["thumb.wikimedia.org", "upload.wikimedia.org"]) {
      const thumbnail = `https://${host}/wikipedia/commons/thumb/a/aa/Media.${extension}/960px-Media.${extension}.jpg`;
      const image = new HTMLImageElement({ src: thumbnail }, thumbnail);
      assertHoverAndPopout(image, thumbnail);
    }
  });
}

test("Wikimedia originals and unrelated thumbnail hosts remain unchanged", () => {
  for (const url of [
    "https://upload.wikimedia.org/wikipedia/commons/a/aa/Photo.jpg",
    "https://example.test/wikipedia/commons/thumb/a/aa/Photo.jpg/960px-Photo.jpg",
    "https://thumb.wikimedia.org.example.test/wikipedia/commons/thumb/a/aa/Photo.jpg/960px-Photo.jpg",
  ]) {
    const image = new HTMLImageElement({ src: url }, url);
    assertHoverAndPopout(image, url);
  }
});

function googleResultImage(href) {
  const thumbnail = "https://encrypted-tbn0.gstatic.com/images?q=tbn:thumbnail";
  const image = new HTMLImageElement({ src: thumbnail }, thumbnail);
  new Element("a", { href }).append(image);
  return image;
}

function googleImageResultUrl(original, origin = "https://www.google.com") {
  return `${origin}/imgres?imgurl=${encodeURIComponent(original)}&imgrefurl=https%3A%2F%2Fexample.test%2Farticle`;
}

test("Google Images opens the declared source instead of the cached thumbnail", () => {
  const original = "https://images.example.test/photo.jpg";
  const image = googleResultImage(googleImageResultUrl(original));
  assertHoverAndPopout(image, original);
});

test("Google image wrappers preserve encoded filenames and source query strings", () => {
  const original = "https://images.example.test/Photo%20%26%20Map.jpg?token=a%2Fb%2Bc&name=one+two&width=4096";
  const image = googleResultImage(googleImageResultUrl(original));
  assertHoverAndPopout(image, original);
});

test("Google image sources can use extensionless HTTP URLs", () => {
  for (const original of ["https://images.example.test/asset/123?quality=original", "http://images.example.test/asset/123"]) {
    assertHoverAndPopout(googleResultImage(googleImageResultUrl(original)), original);
  }
});

test("relative Google Images links resolve against the Google results page", () => {
  const api = loadResolver({}, "https://www.google.com/search?q=photos&udm=2");
  const original = "https://images.example.test/photo.jpg";
  const image = googleResultImage(`/imgres?imgurl=${encodeURIComponent(original)}`);
  assertHoverAndPopout(image, original, api);
});

test("regional Google Images result links resolve the original image", () => {
  const original = "https://images.example.test/photo.jpg";
  for (const origin of ["https://www.google.co.uk", "https://www.google.com.au", "https://www.google.de", "https://www.google.cat"]) {
    assertHoverAndPopout(googleResultImage(googleImageResultUrl(original, origin)), original);
  }
});

test("a Google result container hit resolves its nested image source", () => {
  const original = "https://images.example.test/photo.jpg";
  const image = googleResultImage(googleImageResultUrl(original));
  assertHoverAndPopout(image.parentElement, original);
});

test("Google-like hosts and unrelated routes cannot unwrap an imgurl parameter", () => {
  const original = "https://images.example.test/photo.jpg";
  for (const href of [
    googleImageResultUrl(original, "https://notgoogle.com"),
    googleImageResultUrl(original, "https://www.google.com.example.test"),
    googleImageResultUrl(original, "https://example.test"),
    `https://www.google.com/search?imgurl=${encodeURIComponent(original)}`,
  ]) {
    const image = googleResultImage(href);
    assertHoverAndPopout(image, image.currentSrc);
  }
});

test("Google wrappers with unsafe or malformed source URLs retain the thumbnail", () => {
  for (const original of [
    "javascript:alert(1)", "data:image/png;base64,AAAA", "file:///tmp/photo.jpg",
    "blob:https://example.test/123", "/photo.jpg", "https://",
  ]) {
    const image = googleResultImage(googleImageResultUrl(original));
    assertHoverAndPopout(image, image.currentSrc);
  }
});

test("Google wrappers without an image source retain the thumbnail", () => {
  for (const href of ["https://www.google.com/imgres", "https://www.google.com/imgres?imgurl=&imgrefurl=https%3A%2F%2Fexample.test%2Farticle"]) {
    const image = googleResultImage(href);
    assertHoverAndPopout(image, image.currentSrc);
  }
});
