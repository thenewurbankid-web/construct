// The 3D pill hero on the Drop in screen: the controller. It decides whether to show the 3D pill or the static mark,
// loads the Three.js bundle lazily, and owns every listener and observer, so that leaving the screen tears everything
// down (renderer, geometries, materials, listeners) and coming back builds it again.
//
// Modes (see decideMode in geometry.mjs): animated | static (reduced motion) | svg (the static mark: no WebGL, low power,
// load failure, ?hero=svg) | off (?hero=off, or a narrow window). The static mark is in the page from the start, so
// nothing shifts and nothing shows an error; the canvas fades in over it once the first 3D frame is drawn.
import { decideMode, parseColor, isDarkBackground } from "/demo/hero3d/geometry.mjs";

const BUNDLE = "/demo/hero3d/hero.bundle.mjs";
const root = document.getElementById("hero3d");
const screen = document.getElementById("s-drop");

if (root && screen) {
  const rootEl = document.documentElement;
  const param = new URLSearchParams(location.search).get("hero");
  const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  const mqNarrow = matchMedia("(max-width: 1000px)");
  const mqDark = matchMedia("(prefers-color-scheme: dark)");

  let gen = 0;                 // bumped on every mount and unmount: an async step that sees an older number stops
  let inst = null, canvas = null, cleanups = [], bundle = null, bundleFailed = false;
  const dbg = { mounts: 0, unmounts: 0, listeners: 0, mode: "pending", reason: "" };

  // every listener and observer goes through here so teardown is one loop, and a test can count what is left over
  const track = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); dbg.listeners++; cleanups.push(() => { target.removeEventListener(type, fn, opts); dbg.listeners--; }); };
  const trackObs = (obs) => { dbg.listeners++; cleanups.push(() => { obs.disconnect(); dbg.listeners--; }); return obs; };
  const setState = (s) => { root.dataset.hero = s; };

  const hasWebGL = () => {
    try {
      const c = document.createElement("canvas"), gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return false;
      gl.getExtension("WEBGL_lose_context")?.loseContext(); // give the probe's context straight back
      return true;
    } catch { return false; }
  };
  const lowBattery = async () => {
    try {
      if (!navigator.getBattery) return false;
      const b = await Promise.race([navigator.getBattery(), new Promise((r) => setTimeout(r, 250))]);
      return !!b && !b.charging && b.level <= 0.2;
    } catch { return false; }
  };
  const readColors = () => {
    const cs = getComputedStyle(rootEl), v = (n, f) => parseColor(cs.getPropertyValue(n), f);
    const bg = v("--bg", [0.09, 0.09, 0.08]);
    return { a: v("--mark-a", [0.56, 0.69, 1]), b: v("--mark-b", [0.29, 0.39, 0.96]), bg, dark: isDarkBackground(bg) };
  };

  function unmount() {
    gen++;
    for (const fn of cleanups.splice(0)) fn();
    if (inst) { inst.dispose(); inst = null; dbg.unmounts++; }
    if (canvas) { canvas.remove(); canvas = null; }
  }

  async function mount() {
    unmount();
    const my = gen;
    const narrow = mqNarrow.matches;
    const quick = decideMode({ param, narrow, webgl: true }); // the cheap answers first, before probing anything
    if (quick.mode === "off") { dbg.mode = "off"; dbg.reason = quick.reason; setState("off"); return; }
    const saveData = navigator.connection?.saveData === true;
    let d = decideMode({ param, webgl: hasWebGL(), reducedMotion: mqReduce.matches, saveData, loadFailed: bundleFailed });
    setState("svg"); // the static mark is showing from here on, whatever happens next
    if (d.mode === "animated" || d.mode === "static") {
      const lb = await lowBattery();
      if (my !== gen) return;
      d = decideMode({ param, webgl: true, reducedMotion: mqReduce.matches, saveData, lowBattery: lb, loadFailed: bundleFailed });
    }
    dbg.mode = d.mode; dbg.reason = d.reason;
    if (d.mode !== "animated" && d.mode !== "static") return;

    try { bundle ??= await import(BUNDLE); } catch { bundleFailed = true; dbg.mode = "svg"; dbg.reason = "the 3D module didn't load"; return; }
    if (my !== gen) return;

    canvas = document.createElement("canvas");
    canvas.className = "hero3d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    root.appendChild(canvas);
    const animate = d.mode === "animated";
    try {
      inst = bundle.createScene({ canvas, animate, onState: (s) => setState(s === "lost" ? "svg" : "3d") });
    } catch { canvas.remove(); canvas = null; inst = null; bundleFailed = true; dbg.mode = "svg"; dbg.reason = "WebGL couldn't start"; return; }
    dbg.mounts++;

    const size = () => { const r = root.getBoundingClientRect(); if (r.width > 0 && r.height > 0) inst?.resize(r.width, r.height); };
    inst.setColors(readColors());
    size();

    // ---- watch things that change ----
    trackObs(new ResizeObserver(size)).observe(root);
    const recolor = () => inst?.setColors(readColors());
    trackObs(new MutationObserver(recolor)).observe(rootEl, { attributes: true, attributeFilter: ["data-theme"] }); // the theme toggle
    track(mqDark, "change", recolor);

    if (animate) {
      let visible = document.visibilityState === "visible", onScreen = true;
      const sync = () => { if (inst) (visible && onScreen ? inst.start() : inst.stop()); };
      track(document, "visibilitychange", () => { visible = document.visibilityState === "visible"; sync(); });
      trackObs(new IntersectionObserver((es) => { onScreen = es.at(-1).isIntersecting; sync(); })).observe(root);
      track(window, "pointermove", (e) => { if (e.pointerType !== "touch") inst?.setPointer(e.clientX, e.clientY, innerWidth, innerHeight); }, { passive: true });
      track(document.documentElement, "mouseleave", () => inst?.setPointer(innerWidth / 2, innerHeight / 2, innerWidth, innerHeight));
      // "Wire it" pressed: a brief brighter pulse. (The shell leaves this screen straight away, so this is the moment it can show.)
      const wire = document.getElementById("bWire");
      if (wire) {
        const press = () => { if (!wire.disabled) inst?.pulse(); };
        track(wire, "pointerdown", press);
        track(wire, "keydown", (e) => { if (e.key === " " || e.key === "Enter") press(); });
      }
      sync();
    } else inst.start(); // reduced motion: one frame, no loop; it redraws only when the size or the theme changes

    requestAnimationFrame(() => { if (my === gen && inst && !inst.lost) setState("3d"); });
  }

  // ---- when to be mounted: the Drop in screen is showing and the window is wide enough ----
  let was = false;
  function wantSync() {
    const want = !screen.hidden && !mqNarrow.matches;
    if (want === was) return;
    was = want;
    if (want) mount(); else { unmount(); dbg.mode = "pending"; }
  }
  new MutationObserver(wantSync).observe(screen, { attributes: true, attributeFilter: ["hidden"] }); // the shell's go(screen)
  mqNarrow.addEventListener("change", wantSync);
  mqReduce.addEventListener("change", () => { if (was) mount(); });
  wantSync();

  // Debug hook (what the hero is doing, and whether anything was left behind): NEVER on a deployed build. It needs ?canvasdebug in the URL AND
  // the server saying it is a dev checkout ({ dev: true } from /api/build: no build-info.json next to it).
  if (new URLSearchParams(location.search).has("canvasdebug")) {
    fetch("/api/build").then((r) => r.json()).then((b) => {
      if (b?.dev !== true) return;
      globalThis.__traceHero = { // read-only debugging hook: what the hero is doing, and whether anything was left behind
        get mode() { return dbg.mode; }, get reason() { return dbg.reason; },
        get mounts() { return dbg.mounts; }, get unmounts() { return dbg.unmounts; }, get listeners() { return dbg.listeners; },
        get scene() { return inst; }, stats: () => inst?.stats() ?? null,
      };
    }).catch(() => {});
  }
}
