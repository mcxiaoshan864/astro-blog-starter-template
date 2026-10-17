import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the shipped controller without adding a browser/runtime dependency.
const source = await readFile(
  new URL("../src/scripts/theme-toggle.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { initThemeToggle, waterfallFrames } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Element extends EventTarget {
  dataset = {};
  attributes = new Map();
  styles = new Map();
  classes = new Set();
  lang = "zh-CN";
  classList = {
    contains: (name) => this.classes.has(name),
    add: (name) => this.classes.add(name),
    remove: (name) => this.classes.delete(name),
    toggle: (name, force) => {
      const on = force ?? !this.classes.has(name);
      on ? this.classes.add(name) : this.classes.delete(name);
      return on;
    },
  };
  style = {
    setProperty: (k, v) => this.styles.set(k, v),
    removeProperty: (k) => this.styles.delete(k),
  };
  setAttribute(k, v) {
    this.attributes.set(k, v);
  }
  getAttribute(k) {
    return this.attributes.get(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  getBoundingClientRect() {
    return { left: 326, top: 22, width: 40, height: 40 };
  }
}
function harness(options = {}) {
  const root = new Element(),
    button = new Element(),
    meta = new Element();
  root.classList.toggle("dark", !!options.dark);
  const motion = new EventTarget();
  motion.matches = !!options.reduced;
  const win = new EventTarget();
  const storage = new Map(),
    timers = new Map();
  let timerId = 0;
  Object.assign(win, {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: () => motion,
    localStorage: {
      setItem: (k, v) => {
        if (options.storageError) throw Error("blocked");
        storage.set(k, v);
      },
    },
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  if (options.softMask || options.registrationFails) {
    win.CSS = {
      supports: () => true,
      registerProperty: () => {
        if (options.registrationFails) throw Error("unsupported registration");
      },
    };
  }
  const doc = new EventTarget();
  Object.assign(doc, {
    defaultView: win,
    documentElement: root,
    hidden: !!options.hidden,
    querySelector: (selector) => (selector === "#theme-toggle" ? button : meta),
  });
  const transitions = [],
    animations = [];
  if (!options.unsupported)
    doc.startViewTransition = (update) => {
      if (options.startThrows) throw Error("unsupported snapshot");
      const ready = deferred(),
        updated = deferred(),
        finished = deferred();
      const item = {
        ready: ready.promise,
        updateCallbackDone: updated.promise,
        finished: finished.promise,
        skipped: false,
        updated: false,
        skipTransition() {
          item.skipped = true;
          ready.reject(Error("skipped"));
          if (item.updated) finished.resolve();
        },
        complete() {
          finished.resolve();
        },
      };
      transitions.push(item);
      queueMicrotask(() => {
        update();
        item.updated = true;
        updated.resolve();
        if (options.readyRejects) {
          item.skipped = true;
          ready.reject(Error("capture failed"));
          finished.resolve();
        } else if (item.skipped) finished.resolve();
        else ready.resolve();
      });
      return item;
    };
  root.animate = (frames, config) => {
    if (options.animateThrows) throw Error("pseudo animation unsupported");
    const done = deferred(),
      transition = transitions.at(-1);
    const item = {
      frames,
      config,
      effect: {
        pseudoElement: options.ignoresPseudo ? null : config.pseudoElement,
      },
      finished: done.promise,
      cancel() {
        done.reject(Error("cancelled"));
      },
      finish() {
        done.resolve();
        transition.complete();
      },
    };
    animations.push(item);
    return item;
  };
  initThemeToggle(doc);
  return {
    root,
    button,
    meta,
    motion,
    win,
    doc,
    storage,
    timers,
    transitions,
    animations,
    click: () => button.dispatchEvent(new Event("click")),
    assertClean() {
      assert.equal(root.classList.contains("theme-transitioning"), false);
      assert.equal(button.getAttribute("aria-busy"), undefined);
      assert.equal(root.styles.size, 0);
      assert.equal(timers.size, 0);
      assert.equal(root.classList.contains("theme-soft-mask"), false);
    },
  };
}

test("reveal grows from a point and covers every corner on phone, tablet and desktop", () => {
  for (const [w, h, x, y] of [
    [320, 720, 276, 42],
    [390, 844, 346, 42],
    [691, 1536, 620, 80],
    [1440, 900, 1340, 52],
    [2560, 1440, 2490, 50],
  ]) {
    const frames = waterfallFrames(x, y, w, h);
    assert.equal(frames.length, 33);
    assert.ok(frames[0].clipPath.startsWith("ellipse(0.00px 0.00px"));
    const [rx, ry] = frames
      .at(-1)
      .clipPath.match(/[\d.]+/g)
      .map(Number);
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ])
      assert.ok(((cx - x) / rx) ** 2 + ((cy - y) / ry) ** 2 < 1);
    for (let i = 1; i < frames.length; i++)
      assert.ok(frames[i].offset > frames[i - 1].offset);
  }
});
for (const options of [
  { unsupported: true },
  { reduced: true },
  { hidden: true },
  { unsupported: true, storageError: true },
]) {
  test("direct switching still works: " + JSON.stringify(options), async () => {
    const h = harness(options);
    h.click();
    await flush();
    assert.equal(h.root.classList.contains("dark"), true);
    assert.equal(h.transitions.length, 0);
    assert.equal(h.button.getAttribute("aria-pressed"), "true");
    assert.equal(h.meta.getAttribute("content"), "#0e2035");
    h.click();
    await flush();
    assert.equal(h.root.classList.contains("dark"), false);
    h.assertClean();
  });
}
test("both directions use the new theme snapshot, preserve preference, and clean up", async () => {
  const h = harness();
  for (const dark of [true, false]) {
    h.click();
    await flush();
    assert.equal(h.root.classList.contains("dark"), dark);
    const a = h.animations.at(-1);
    assert.equal(a.config.pseudoElement, "::view-transition-new(root)");
    assert.equal(a.config.duration, 1000);
    assert.ok(a.frames[0].clipPath.endsWith("at 346.00px 42.00px)"));
    a.finish();
    await flush();
    h.assertClean();
    assert.equal(h.storage.get("theme"), dark ? "dark" : "light");
    assert.equal(h.meta.getAttribute("content"), dark ? "#0e2035" : "#e9f1f6");
  }
});
for (const clicks of [2, 3, 8, 9]) {
  test(`${clicks} rapid clicks converge without overlapping captures`, async () => {
    const h = harness();
    for (let n = 0; n < clicks; n++) h.click();
    await flush();
    assert.equal(h.transitions.length, 1);
    h.animations[0].finish();
    await flush();
    if (clicks % 2 === 0) {
      assert.equal(h.transitions.length, 2);
      h.animations[1].finish();
      await flush();
    }
    assert.equal(h.root.classList.contains("dark"), clicks % 2 === 1);
    h.assertClean();
  });
}
for (const options of [
  { startThrows: true },
  { readyRejects: true },
  { animateThrows: true },
  { ignoresPseudo: true },
]) {
  test(
    "failed/unsupported animation settles safely: " + JSON.stringify(options),
    async () => {
      const h = harness(options);
      h.click();
      await flush();
      assert.equal(h.root.classList.contains("dark"), true);
      h.assertClean();
      h.click();
      await flush();
      assert.equal(h.root.classList.contains("dark"), false);
      h.assertClean();
    },
  );
}
for (const interruption of [
  "resize",
  "scroll",
  "pagehide",
  "hidden",
  "reduce",
  "timeout",
]) {
  test("interruption leaves a usable page: " + interruption, async () => {
    const h = harness();
    h.click();
    await flush();
    if (interruption === "hidden") {
      h.doc.hidden = true;
      h.doc.dispatchEvent(new Event("visibilitychange"));
    } else if (interruption === "reduce") {
      h.motion.matches = true;
      h.motion.dispatchEvent(new Event("change"));
    } else if (interruption === "timeout") [...h.timers.values()][0]();
    else h.win.dispatchEvent(new Event(interruption));
    await flush();
    assert.equal(h.root.classList.contains("dark"), true);
    h.assertClean();
    h.doc.hidden = false;
    h.motion.matches = false;
    h.click();
    await flush();
    h.animations.at(-1).finish();
    await flush();
    assert.equal(h.root.classList.contains("dark"), false);
    h.assertClean();
  });
}
test("cancellation before capture still applies once and releases busy state", async () => {
  const h = harness();
  h.click();
  h.win.dispatchEvent(new Event("resize"));
  await flush();
  assert.equal(h.root.classList.contains("dark"), true);
  assert.equal(h.animations.length, 0);
  h.assertClean();
});
test("keyboard clicks use button bounds; repeated initialization and locale changes are safe", async () => {
  const h = harness({ reduced: true });
  initThemeToggle(h.doc);
  h.root.lang = "zh-HK";
  h.win.dispatchEvent(new Event("lang-changed"));
  assert.equal(h.button.getAttribute("aria-label"), "轉用深色模式");
  h.click();
  await flush();
  assert.equal(h.root.classList.contains("dark"), true);
  assert.equal(h.button.getAttribute("aria-label"), "轉用淺色模式");
  h.root.lang = "en";
  h.win.dispatchEvent(new Event("lang-changed"));
  assert.equal(h.button.getAttribute("aria-label"), "Switch to light mode");
  h.assertClean();
});

test("feather is fully opaque at all viewport corners before the transition ends", () => {
  for (const [w, h, x, y] of [
    [320, 720, 276, 42],
    [390, 844, 346, 42],
    [1440, 900, 1340, 52],
  ]) {
    const last = waterfallFrames(x, y, w, h).at(-1);
    const rx = parseFloat(last["--theme-rx"]) * 0.88;
    const ry = parseFloat(last["--theme-ry"]) * 0.88;
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ])
      assert.ok(((cx - x) / rx) ** 2 + ((cy - y) / ry) ** 2 < 1);
  }
});

test("soft mask animates registered radii and is removed after the reveal", async () => {
  const h = harness({ softMask: true });
  h.click();
  await flush();
  assert.equal(h.root.classList.contains("theme-soft-mask"), true);
  assert.ok(h.animations[0].frames.at(-1)["--theme-rx"]);
  assert.ok(h.animations[0].frames.at(-1)["--theme-ry"]);
  h.animations[0].finish();
  await flush();
  h.assertClean();
});
test("failed mask registration retains a usable clip reveal", async () => {
  const h = harness({ registrationFails: true });
  h.click();
  await flush();
  assert.equal(h.root.classList.contains("theme-soft-mask"), false);
  assert.ok(h.animations[0].frames.at(-1).clipPath.startsWith("ellipse("));
  h.animations[0].finish();
  await flush();
  h.assertClean();
});

test('route preparation cancels the theme reveal and route completion keeps the button usable', async () => {
 const h=harness();h.click();await flush();h.doc.dispatchEvent(new Event('astro:before-preparation'));await flush();h.assertClean();
 h.doc.dispatchEvent(new Event('astro:page-load'));h.click();await flush();h.animations.at(-1).finish();await flush();assert.equal(h.root.classList.contains('dark'),false);h.assertClean();
});
test('theme clicks during route preparation apply directly without overlapping page captures', async () => {
 const h=harness();h.doc.dispatchEvent(new Event('astro:before-preparation'));h.click();await flush();assert.equal(h.transitions.length,0);assert.equal(h.root.classList.contains('dark'),true);
 h.doc.dispatchEvent(new Event('astro:page-load'));h.click();await flush();h.animations.at(-1).finish();await flush();assert.equal(h.root.classList.contains('dark'),false);h.assertClean();
});
