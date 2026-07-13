const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "hover-zoom.user.js");
const INIT_MARKER = "  init();";

class FakeElement {
  constructor({ attrs = {}, localName = "div", namespaceURI = "", rect }) {
    this.attrs = { ...attrs };
    this.localName = localName;
    this.namespaceURI = namespaceURI;
    this.ownerSVGElement = null;
    this.rect = rect;
  }

  cloneNode() {
    return new FakeElement({
      attrs: this.attrs,
      localName: this.localName,
      namespaceURI: this.namespaceURI,
      rect: this.rect,
    });
  }

  closest() {
    return null;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
      ? this.attrs[name]
      : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  matches() {
    return false;
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
}

class FakeImageElement extends FakeElement {
  constructor({ attrs = {}, rect }) {
    super({ attrs, localName: "img", rect });
    this.currentSrc = attrs.currentSrc || "";
    this.src = attrs.src || "";
    this.srcset = attrs.srcset || "";
  }
}

class FakeVideoElement extends FakeElement {}
class FakePictureElement extends FakeElement {}

function loadCandidateFinder() {
  const source = fs.readFileSync(SCRIPT_PATH, "utf8");
  const markerCount = source.split(INIT_MARKER).length - 1;
  assert.equal(markerCount, 1, "userscript initialization marker changed");

  const revokedUrls = [];
  let objectUrlSequence = 0;

  class TestURL extends URL {
    static createObjectURL() {
      objectUrlSequence += 1;
      return `blob:hover-zoom-test-${objectUrlSequence}`;
    }

    static revokeObjectURL(url) {
      revokedUrls.push(url);
    }
  }

  const window = {
    location: {
      href: "https://example.test/gallery",
      hostname: "example.test",
    },
  };
  window.self = window;
  window.top = window;

  const sandbox = {
    Blob,
    Element: FakeElement,
    HTMLImageElement: FakeImageElement,
    HTMLPictureElement: FakePictureElement,
    HTMLVideoElement: FakeVideoElement,
    URL: TestURL,
    WeakMap,
    XMLSerializer: class {
      serializeToString() {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
      }
    },
    console,
    localStorage: {
      getItem() {
        return null;
      },
    },
    window,
  };

  const instrumented = source.replace(
    INIT_MARKER,
    "  globalThis.__hoverZoomTest = { findHoverCandidate };",
  );
  vm.runInNewContext(instrumented, sandbox, { filename: SCRIPT_PATH });

  return {
    findHoverCandidate: sandbox.__hoverZoomTest.findHoverCandidate,
    revokedUrls,
  };
}

function rect(width, height) {
  return { bottom: height, height, left: 0, right: width, top: 0, width };
}

function lookupFor(pathAtPoint) {
  return {
    clientX: 8,
    clientY: 8,
    path: pathAtPoint,
    rects: new WeakMap(),
    selectorResults: new WeakMap(),
    visibleMedia: new WeakMap(),
  };
}

test("continues past a small image to the usable media underneath", () => {
  const { findHoverCandidate } = loadCandidateFinder();
  const overlay = new FakeImageElement({
    attrs: { src: "/overlay.png" },
    rect: rect(24, 24),
  });
  const media = new FakeImageElement({
    attrs: { src: "/media.png" },
    rect: rect(640, 480),
  });

  const candidate = findHoverCandidate(lookupFor([overlay, media]));

  assert.equal(candidate.element, media);
  assert.equal(candidate.url, "https://example.test/media.png");
});

test("revokes a rejected inline SVG URL before trying the next candidate", () => {
  const { findHoverCandidate, revokedUrls } = loadCandidateFinder();
  const overlay = new FakeElement({
    attrs: { height: "24", width: "24" },
    localName: "svg",
    namespaceURI: "http://www.w3.org/2000/svg",
    rect: rect(24, 24),
  });
  const media = new FakeImageElement({
    attrs: { src: "/media.png" },
    rect: rect(640, 480),
  });

  const candidate = findHoverCandidate(lookupFor([overlay, media]));

  assert.equal(candidate.element, media);
  assert.deepEqual(revokedUrls, ["blob:hover-zoom-test-1"]);
});
