const NEW_VIEW = "::view-transition-new(root)";
const DURATION = 1000;

/** A wide, falling reveal: horizontal spread leads the downward flow. */
export function waterfallFrames(
  x: number,
  y: number,
  width: number,
  height: number,
): Keyframe[] {
  const reachX = Math.max(x, width - x, 1) * 1.8;
  const reachY = Math.max(y, height - y, 1) * 1.8;
  return Array.from({ length: 33 }, (_, index) => {
    const progress = index / 32;
    const spread = 1 - (1 - progress) ** 2;
    const flow = progress * progress * (3 - 2 * progress);
    const rx = reachX * spread;
    const ry = reachY * flow;
    return {
      offset: progress,
      "--theme-rx": `${rx.toFixed(2)}px`,
      "--theme-ry": `${ry.toFixed(2)}px`,
      clipPath: `ellipse(${rx.toFixed(2)}px ${ry.toFixed(2)}px at ${x.toFixed(2)}px ${y.toFixed(2)}px)`,
    };
  });
}

/** Registered lengths let the feathered mask interpolate instead of jumping. */
function enableSoftMask(win: Window & typeof globalThis): boolean {
  if (
    typeof win.CSS?.registerProperty !== "function" ||
    !win.CSS.supports("mask-image", "radial-gradient(black, transparent)")
  )
    return false;
  try {
    for (const name of ["--theme-rx", "--theme-ry"]) {
      win.CSS.registerProperty({
        name,
        syntax: "<length>",
        inherits: false,
        initialValue: "0px",
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function initThemeToggle(doc: Document = document): void {
  const toggle = doc.querySelector<HTMLButtonElement>("#theme-toggle");
  const win = doc.defaultView;
  if (!toggle || !win || toggle.dataset.themeBound) return;
  toggle.dataset.themeBound = "true";

  const root = doc.documentElement;
  const softMask = enableSoftMask(win);
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  let requestedDark = root.classList.contains("dark");
  let running = false;
  let active:
    | {
        transition?: ViewTransition;
        animation?: Animation;
        cancelled: boolean;
      }
    | undefined;

  const syncButton = () => {
    const dark = root.classList.contains("dark");
    const labels =
      root.lang === "zh-HK"
        ? ["轉用淺色模式", "轉用深色模式"]
        : root.lang === "en"
          ? ["Switch to light mode", "Switch to dark mode"]
          : ["切换浅色模式", "切换深色模式"];
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", labels[dark ? 0 : 1]);
  };
  const syncBrowserColor = () => {
    doc
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        root.classList.contains("dark") ? "#0e2035" : "#e9f1f6",
      );
  };
  const applyTheme = (dark: boolean) => {
    root.classList.toggle("dark", dark);
    try {
      win.localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // Private browsing/storage restrictions must not block the theme switch.
    }
    syncButton();
  };
  const cancelActive = () => {
    if (!active) return;
    active.cancelled = true;
    active.transition?.skipTransition();
    active.animation?.cancel();
  };

  const run = async (): Promise<void> => {
    if (running || requestedDark === root.classList.contains("dark")) return;
    running = true;
    const nextDark = requestedDark;
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      applyTheme(nextDark);
    };

    // Older browsers and reduced-motion users still get a working theme button.
    if (
      motion.matches ||
      doc.hidden ||
      typeof doc.startViewTransition !== "function" ||
      typeof root.animate !== "function"
    ) {
      apply();
      syncBrowserColor();
      running = false;
      return;
    }

    const rect = toggle.getBoundingClientRect();
    const width = Math.max(win.innerWidth, 1);
    const height = Math.max(win.innerHeight, 1);
    const x = Math.min(width, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(height, Math.max(0, rect.top + rect.height / 2));
    const state: NonNullable<typeof active> = { cancelled: false };
    active = state;
    root.style.setProperty("--theme-x", `${x}px`);
    root.style.setProperty("--theme-y", `${y}px`);
    root.classList.add("theme-transitioning");
    root.classList.toggle("theme-soft-mask", softMask);
    toggle.setAttribute("aria-busy", "true");

    // A lost frame or a backgrounded tab must never leave an invisible overlay.
    const timeout = win.setTimeout(cancelActive, 2400);
    let updated: Promise<unknown> | undefined;
    let finished: Promise<unknown> | undefined;
    try {
      const transition = doc.startViewTransition(apply);
      state.transition = transition;
      // Observe both immediately, including the skipped/rejected paths.
      updated = transition.updateCallbackDone.catch(() => undefined);
      finished = transition.finished.catch(() => undefined);
      await transition.ready;
      if (state.cancelled || motion.matches || doc.hidden) {
        transition.skipTransition();
      } else {
        const animation = root.animate(waterfallFrames(x, y, width, height), {
          duration: DURATION,
          easing: "linear",
          fill: "both",
          pseudoElement: NEW_VIEW,
        });
        state.animation = animation;
        // Some older engines ignore pseudoElement and would clip the live page.
        const animationDone = animation.finished.catch(() => undefined);
        if (
          (animation.effect as KeyframeEffect | null)?.pseudoElement !==
          NEW_VIEW
        ) {
          animation.cancel();
          transition.skipTransition();
        }
        await animationDone;
      }
      await finished;
    } catch {
      // Skips (resize, unsupported effects, hidden documents) still apply once.
      state.transition?.skipTransition();
      state.animation?.cancel();
      await updated;
      await finished;
    } finally {
      win.clearTimeout(timeout);
      apply();
      state.animation?.cancel();
      root.classList.remove("theme-transitioning");
      root.classList.remove("theme-soft-mask");
      root.style.removeProperty("--theme-x");
      root.style.removeProperty("--theme-y");
      toggle.removeAttribute("aria-busy");
      active = undefined;
      running = false;
      syncBrowserColor();
      // Coalesce rapid clicks to the last requested theme, never overlap captures.
      if (requestedDark !== root.classList.contains("dark")) void run();
    }
  };

  toggle.addEventListener("click", () => {
    requestedDark = !requestedDark;
    void run();
  });
  win.addEventListener("lang-changed", syncButton);
  win.addEventListener("resize", cancelActive, { passive: true });
  win.addEventListener("scroll", cancelActive, { passive: true });
  win.addEventListener("pagehide", cancelActive);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) cancelActive();
  });
  motion.addEventListener("change", () => {
    if (motion.matches) cancelActive();
  });
  syncButton();
  syncBrowserColor();
}
