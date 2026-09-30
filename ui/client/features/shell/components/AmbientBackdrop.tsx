'use client';

import { useEffect, useRef } from 'react';

/**
 * Ambient animated backdrop: one full-viewport WebGL layer behind the whole Cockpit (#bg only -- see
 * the note on layering below). It adds slow motion to the glow the body already paints statically
 * via --bg-glow-1 / --bg-glow-2, and takes its colours from those same tokens, so it follows the
 * theme instead of hard-coding a palette.
 *
 * LAYERING. The reference (zeus2point0) stacks three canvases and puts a lightning layer ABOVE the
 * interface with mix-blend-mode: screen. That suits a showpiece; it does not suit a tool. Anything
 * drawn over a diff, a log or a form competes with the work, so this is a single layer at
 * --z-backdrop, beneath every surface, with pointer-events: none. Adding a foreground layer later is
 * a design decision, not a code one.
 *
 * COST. Ambient motion must never compete with the app for frames: the loop is capped at ~30fps,
 * the drawing buffer at 1.5x DPR, and it stops entirely while the tab is hidden.
 *
 * ACCESSIBILITY. The global `prefers-reduced-motion` rule in tokens.css only stops CSS animation --
 * a requestAnimationFrame loop is invisible to it. So this checks the query itself and paints a
 * single static frame instead of animating. `<html data-fx="off">` disables it outright.
 *
 * If WebGL is unavailable the component renders the canvas and leaves it blank: the body gradient
 * underneath is the design, and this is decoration on top of it.
 */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

// Domain-warped fbm: two noise lookups steer a third, which reads as slow drifting plumes rather
// than the obvious rolling waves a single noise octave gives. Output is premultiplied (the canvas
// is premultipliedAlpha by default), hence rgb * a.
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uT;uniform vec3 uA;uniform vec3 uB;uniform float uAmp;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=uv*vec2(uRes.x/uRes.y,1.)*1.6;
  float t=uT*.02;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
  float f=fbm(p+2.*q+t*.5);
  float m=smoothstep(.25,.95,f);
  // Bias the brightness toward the top-right, where globals.css already places its second glow.
  float vig=smoothstep(1.3,.1,length(uv-vec2(.85,.05)));
  float a=m*vig*uAmp;
  gl_FragColor=vec4(mix(uA,uB,m)*a,a);
}`;

/** `rgba(90, 110, 150, 0.16)` -> `{ rgb: [0..1, 0..1, 0..1], a }`. Null when the token is unreadable. */
function readColor(value: string): { rgb: [number, number, number]; a: number } | null {
  const m = value.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  return { rgb: [r / 255, g / 255, b / 255], a: m.length > 3 ? Number(m[3]) : 1 };
}

function compile(gl: WebGLRenderingContext): WebGLProgram | null {
  const build = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = build(gl.VERTEX_SHADER, VERT);
  const fs = build(gl.FRAGMENT_SHADER, FRAG);
  const prog = vs && fs ? gl.createProgram() : null;
  if (!prog || !vs || !fs) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

export function AmbientBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return; // no WebGL: the body gradient is still the design

    const prog = compile(gl);
    if (!prog) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    const u = {
      res: gl.getUniformLocation(prog, 'uRes'),
      t: gl.getUniformLocation(prog, 'uT'),
      a: gl.getUniformLocation(prog, 'uA'),
      b: gl.getUniformLocation(prog, 'uB'),
      amp: gl.getUniformLocation(prog, 'uAmp'),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied source

    /** Pull the palette from the live tokens so a theme switch is just a re-read. */
    const applyTheme = () => {
      const s = getComputedStyle(document.documentElement);
      const g1 = readColor(s.getPropertyValue('--bg-glow-1')) ?? { rgb: [0.35, 0.43, 0.59] as [number, number, number], a: 0.16 };
      const g2 = readColor(s.getPropertyValue('--bg-glow-2')) ?? { rgb: [0.24, 0.27, 0.35] as [number, number, number], a: 0.14 };
      const amp = Number(s.getPropertyValue('--bg-motion-amp')) || 1;
      gl.uniform3fv(u.a, g1.rgb);
      gl.uniform3fv(u.b, g2.rgb);
      // The tokens' own alpha sets the ceiling, so the light theme (much fainter glows) stays faint.
      gl.uniform1f(u.amp, Math.max(g1.a, g2.a) * 2.2 * amp);
    };

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const nw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const nh = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.res, w, h);
    };

    const draw = (tSec: number) => {
      resize();
      gl.uniform1f(u.t, tSec);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    applyTheme();

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const themeWatch = new MutationObserver(() => {
      applyTheme();
      if (still.matches) draw(0);
    });
    themeWatch.observe(document.documentElement, { attributeFilter: ['data-theme'] });

    let raf = 0;
    let last = 0;
    const FRAME = 1000 / 30; // ambient motion does not need the app's frame budget
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (ms - last < FRAME) return;
      last = ms;
      draw(ms / 1000);
    };

    const start = () => {
      if (!raf && !still.matches && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotionPref = () => {
      stop();
      if (still.matches) draw(0);
      else start();
    };

    if (still.matches) draw(0);
    else start();

    document.addEventListener('visibilitychange', onVisibility);
    still.addEventListener('change', onMotionPref);
    const onResize = () => {
      if (still.matches || document.hidden) draw(0);
    };
    window.addEventListener('resize', onResize);

    return () => {
      stop();
      themeWatch.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      still.removeEventListener('change', onMotionPref);
      window.removeEventListener('resize', onResize);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className="ambient-backdrop" aria-hidden="true" />;
}
