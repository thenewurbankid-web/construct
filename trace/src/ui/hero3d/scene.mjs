// The Three.js side of the 3D pill hero, kept thin: everything that can be computed without Three lives in
// geometry.mjs. This file is the entry point of hero.bundle.mjs (see `npm run build:hero`), so only the handful of
// Three classes imported here end up in the bundle.
//
// Look: three tubes around the mark's outline. The core is opaque and takes the mark's gradient; two wider, translucent
// copies fake the glow: their opacity falls off toward the silhouette (a few lines of shader), so they read as a soft
// halo rather than as solid shells. Plain alpha blending, so the same halo works on the dark page and on the light
// "paper" (additive light would vanish there). Unlit, no post-processing, no textures.
import { WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, BufferAttribute, ShaderMaterial } from "three";
import { capsuleLoop, loopColors, tubeGeometry, tubeColors, poseAt, STATIC_POSE, damp, parallaxTarget, pointerNorm, pulseEnvelope, fitDistance, shouldDraw } from "./geometry.mjs";

const FOV = 20, LOOP = 176, CORE_R = 0.85;
// The wide tubes must stay narrower than the pill's own end radius (5.5), or their inner side folds over itself.
const LAYERS = [
  { radius: CORE_R, radial: 14, glow: false },
  { radius: CORE_R * 2.3, radial: 12, glow: true, power: 2, dark: 0.6, light: 0.42 },
  { radius: CORE_R * 4.3, radial: 10, glow: true, power: 3, dark: 0.36, light: 0.26 },
];
// One vertex shader for all three: how squarely the surface faces the viewer (vF, 1 in the middle of the tube, 0 at its
// silhouette) and how far from the camera it is (vD, 0..1 across the turn).
const VERT = `uniform float uPower; uniform vec2 uDepth; varying vec3 vColor; varying float vF; varying float vD;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vF = pow(clamp(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)), 0.0, 1.0), uPower);
  vD = smoothstep(uDepth.x, uDepth.y, -mv.z);
  vColor = color;
  gl_Position = projectionMatrix * mv;
}`;
// The core: the mark's gradient, shaded a little toward the silhouette so it reads as a round tube, and the far side of
// the turn fades toward the page colour (a cheap depth cue).
const CORE_FRAG = `uniform vec3 uBg; uniform vec2 uShade; uniform float uBoost; uniform float uFade; varying vec3 vColor; varying float vF; varying float vD;
void main() { gl_FragColor = vec4(mix(vColor * (uShade.x + uShade.y * vF) * uBoost, uBg, vD * uFade), 1.0); }`;
// The glow: colour with an opacity that falls off toward the silhouette; premultiplied, plain alpha blending.
const GLOW_FRAG = `uniform float uOpacity; varying vec3 vColor; varying float vF; varying float vD;
void main() { float a = uOpacity * vF * (1.0 - 0.5 * vD); gl_FragColor = vec4(vColor * a, a); }`;

// What is alive right now, so a test can prove that mounting and unmounting repeatedly leaks nothing.
export const live = { renderers: 0, geometries: 0, materials: 0, created: 0 };

export function createScene({ canvas, animate = true, onState = () => {} }) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  live.renderers++; live.created++;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene(), camera = new PerspectiveCamera(FOV, 1.6, 1, 400), group = new Group();
  scene.add(group);

  const depth = { value: [40, 80] }, bgU = { value: [0, 0, 0] }, shadeU = { value: [0.72, 0.4] }, fadeU = { value: 0.4 }; // shared by the three materials
  const loop = capsuleLoop(LOOP), base = new Float32Array(LOOP * 3);
  const layers = LAYERS.map((L) => {
    const g = tubeGeometry(loop, L.radius, L.radial), geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(g.positions, 3));
    geo.setAttribute("normal", new BufferAttribute(g.normals, 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(g.vertexCount * 3), 3));
    geo.setIndex(new BufferAttribute(g.indices, 1));
    const uniforms = { uPower: { value: L.glow ? L.power : 0.9 }, uDepth: depth, uOpacity: { value: 0 }, uBg: bgU, uShade: shadeU, uFade: fadeU, uBoost: { value: 1 } };
    const mat = new ShaderMaterial({ vertexColors: true, transparent: L.glow, depthWrite: !L.glow, premultipliedAlpha: true, uniforms, vertexShader: VERT, fragmentShader: L.glow ? GLOW_FRAG : CORE_FRAG });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    if (L.glow) mesh.renderOrder = 1;
    group.add(mesh);
    live.geometries++; live.materials++;
    return { ...L, geo, mat, mesh };
  });

  let dark = true, running = false, lost = false, disposed = false;
  let raf = 0, last = null, time = 3, w = 1, h = 1;
  let px = 0, py = 0, tpx = 0, tpy = 0, pulseAt = -1, pulseT = 0; // pointer (eased, target), pulse
  let cpu = 0, frames = 0;

  function setColors({ a, b, bg, dark: isDark }) {
    dark = isDark;
    loopColors(loop, a, b, base);
    for (const L of layers) {
      const attr = L.geo.getAttribute("color");
      tubeColors(base, L.radial, attr.array);
      attr.needsUpdate = true;
    }
    bgU.value = bg;
    shadeU.value = dark ? [0.72, 0.4] : [0.66, 0.34];
    fadeU.value = dark ? 0.4 : 0.22; // less on paper, where the far side must keep its contrast
    draw(); // repaint now if nothing is animating
  }
  function resize(width, height) {
    w = Math.max(1, Math.round(width)); h = Math.max(1, Math.round(height));
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const d = fitDistance({ aspect: camera.aspect, fovDeg: FOV });
    camera.position.set(0, 0, d);
    depth.value = [d - 12, d + 16]; // the far side of the turn fades a little toward the page colour
    camera.updateProjectionMatrix();
    draw();
  }
  function paint(t, pulse) {
    let pose = animate ? poseAt(t) : STATIC_POSE, dx = 0, dy = 0;
    if (animate) { const p = parallaxTarget({ x: px, y: py }); pose = { yaw: pose.yaw + p.yaw, pitch: pose.pitch + p.pitch, roll: pose.roll }; dx = p.dx; dy = p.dy; }
    group.rotation.set(pose.pitch, pose.yaw, pose.roll, "YXZ");
    group.position.set(dx, dy, 0);
    for (const L of layers) {
      if (L.glow) L.mat.uniforms.uOpacity.value = (dark ? L.dark : L.light) * (1 + 0.9 * pulse);
      else L.mat.uniforms.uBoost.value = 1 + 0.22 * pulse;
    }
    renderer.render(scene, camera);
  }
  function draw() { // one frame on demand (static mode, theme change, resize, context restore); the loop draws its own
    if (disposed || lost || running) return;
    paint(time, 0);
  }
  function frame(now) {
    raf = 0;
    if (!running || disposed) return;
    raf = requestAnimationFrame(frame);
    if (!shouldDraw(now, last)) return;
    const dt = last == null ? 0 : Math.min(now - last, 100) / 1000;
    last = now;
    const t0 = performance.now();
    time += dt;
    px = damp(px, tpx, 4, dt); py = damp(py, tpy, 4, dt);
    const pulse = pulseAt >= 0 ? pulseEnvelope(time - pulseAt) : 0;
    if (pulse === 0) pulseAt = -1;
    paint(time, pulse);
    cpu += performance.now() - t0; frames++;
  }
  function start() {
    if (disposed) return;
    if (!animate || lost) { draw(); return; }
    if (running) return;
    running = true; last = null;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  const loseExt = renderer.getContext().getExtension("WEBGL_lose_context");
  const onLost = (e) => { e.preventDefault(); lost = true; stop(); onState("lost"); };
  const onRestored = () => { lost = false; onState("restored"); };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const ext = () => loseExt; // fetched once: a lost context no longer hands out extensions
  return {
    start, stop, resize, setColors,
    pulse() { if (animate && running) pulseAt = time; },
    setPointer(x, y, ww, wh) { const n = pointerNorm(x, y, ww, wh); tpx = n.x; tpy = n.y; },
    get lost() { return lost; },
    stats() { return { memory: { ...renderer.info.memory }, render: { ...renderer.info.render }, frames, cpuMsPerFrame: frames ? cpu / frames : 0, running, lost, live: { ...live } }; },
    debug: { seek(t, pulse = 0) { stop(); time = t; if (!disposed && !lost) paint(t, pulse); }, loseContext: () => ext()?.loseContext(), restoreContext: () => ext()?.restoreContext() },
    dispose() {
      if (disposed) return;
      stop(); disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const L of layers) { group.remove(L.mesh); L.geo.dispose(); L.mat.dispose(); live.geometries--; live.materials--; }
      renderer.dispose();
      renderer.forceContextLoss(); // hand the GPU context back now, browsers only allow a handful per page
      live.renderers--;
    },
  };
}
