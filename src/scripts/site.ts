import { initThemeToggle } from "./theme-toggle";

const installed = new WeakSet<Document>();
const originalText = new WeakMap<Element, string>();
const words = {
  "zh-CN": { home: "首页", blog: "日志", about: "关于" },
  "zh-TW": { home: "首頁", blog: "日誌", about: "關於" },
  en: { home: "Home", blog: "Journal", about: "About" },
};
type Language = keyof typeof words;
function language(value: string | null): Language {
  return value === "en" || value === "zh-TW" ? value : "zh-CN";
}
export function navigationIndex(pathname: string): number {
  return /^\/blog(?:\/|$)/.test(pathname) ? 1 : /^\/about(?:\/|$)/.test(pathname) ? 2 : 0;
}

export function initSite(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win || installed.has(doc)) return;
  installed.add(doc);
  let selectedLanguage: Language = "zh-CN";
  try { selectedLanguage = language(win.localStorage.getItem("site-lang")); } catch {}

  const translate = (page: Document) => {
    page.documentElement.lang = selectedLanguage === "zh-TW" ? "zh-HK" : selectedLanguage;
    const select = page.getElementById("language") as HTMLSelectElement | null;
    if (select) select.value = selectedLanguage;
    page.querySelectorAll<HTMLElement>("[data-nav]").forEach(el => {
      const key = el.dataset.nav as keyof typeof words[Language];
      el.textContent = words[selectedLanguage][key];
    });
    page.querySelectorAll<HTMLElement>("[data-en]").forEach(el => {
      if (!originalText.has(el)) originalText.set(el, el.textContent || "");
      el.textContent = selectedLanguage === "en" ? el.dataset.en || originalText.get(el)!
        : selectedLanguage === "zh-TW" ? el.dataset.tw || originalText.get(el)!
        : originalText.get(el)!;
    });
  };
  const syncNavigation = () => {
    const index = navigationIndex(win.location.pathname);
    const nav = doc.querySelector<HTMLElement>(".site-header nav");
    nav?.style.setProperty("--nav-index", String(index));
    const links = doc.querySelectorAll<HTMLAnchorElement>(".site-header [data-nav]");
    links.forEach((link, position) => {
      const active = position === index;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  const syncPage = () => {
    translate(doc);
    syncNavigation();
    win.dispatchEvent(new CustomEvent("lang-changed", { detail: selectedLanguage }));
  };

  // Seed the incoming DOM before capture, so dark mode and translated text do not flash.
  doc.addEventListener("astro:before-swap", event => {
    const next = (event as Event & { newDocument: Document }).newDocument;
    next.documentElement.classList.toggle("dark", doc.documentElement.classList.contains("dark"));
    next.querySelector('meta[name="theme-color"]')?.setAttribute("content", doc.documentElement.classList.contains("dark") ? "#0e2035" : "#e9f1f6");
    translate(next);
  });
  doc.addEventListener("astro:after-swap", syncPage);
  doc.addEventListener("astro:page-load", () => { syncPage(); initThemeToggle(doc); });
  doc.addEventListener("change", event => {
    const select = event.target as HTMLSelectElement | null;
    if (select?.id !== "language") return;
    selectedLanguage = language(select.value);
    try { win.localStorage.setItem("site-lang", selectedLanguage); } catch {}
    syncPage();
  });

  // One delegated handler works for new page controls as well as the persistent header.
  const hover = win.matchMedia("(hover: hover)");
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  doc.addEventListener("pointermove", event => {
    if (!hover.matches || motion.matches) return;
    const control = (event.target as Element | null)?.closest<HTMLElement>(".glass-control");
    if (!control) return;
    const rect = control.getBoundingClientRect();
    control.style.setProperty("--light-x", `${(event.clientX - rect.left) / Math.max(rect.width, 1) * 100}%`);
    control.style.setProperty("--light-y", `${(event.clientY - rect.top) / Math.max(rect.height, 1) * 100}%`);
  });
  doc.addEventListener("pointerout", event => {
    const control = (event.target as Element | null)?.closest<HTMLElement>(".glass-control");
    if (!control || (event.relatedTarget instanceof win.Node && control.contains(event.relatedTarget))) return;
    control.style.removeProperty("--light-x");
    control.style.removeProperty("--light-y");
  });
  syncPage();
  initThemeToggle(doc);
}
