// Draws a tree model (see model.mjs) as inline SVG. Browser-safe: no imports, no Node APIs.
// Used by the live UI (served to the browser as-is) and by the static REPORT.html.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, w) => {
  const max = Math.floor((w - 20) / 6.3);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

export const COLS = [
  { label: "", w: 200 },
  { label: "", w: 170 },
  { label: "DESIGN PART · LAYER", w: 200 },
  { label: "ƒ TRANSFORM · LAYER", w: 240 },
  { label: "API · LAYER", w: 280 },
];
const GAP = 56, ROW = 50, NODE_H = 38, TOP = 34, GROUP_GAP = 22;

// tree = { root: node, groups: [{ key, node, leaves: [{ id, cells: [part, transform, api] }] }] }
// node = { title, sub, state: ok | static | ask | missing | placeholder }
/**
 * Lay out a match tree (see `tree/model.mjs`) into positioned nodes and connecting links, for {@link markup}.
 *
 * @param {{root: object, groups: {key: string, node: object, leaves: {id: string, cells: (object|null)[]}[]}[]}}
 *   tree From `foundTree`/`buildTree`.
 * @returns {{width: number, height: number, cx: number[], nodes: object[], links: object[]}}
 *   The layout: overall size, each column's x offset, positioned nodes, and links between them.
 */
export function layoutTree(tree) {
  const cx = [];
  let x = 0;
  for (const c of COLS) { cx.push(x); x += c.w + GAP; }
  const width = x - GAP;

  const nodes = [], links = [];
  const put = (key, col, y, n, leaf) => nodes.push({ key, col, leaf, x: cx[col], y: y - NODE_H / 2, w: COLS[col].w, ...n });
  const link = (key, c1, y1, c2, y2, state, leaf) => {
    const x1 = cx[c1] + COLS[c1].w, x2 = cx[c2], mid = (x1 + x2) / 2;
    links.push({ key, state, leaf, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` });
  };

  let row = 0;
  const placed = tree.groups.map((g) => {
    const ys = g.leaves.map(() => TOP + row++ * ROW);
    row += GROUP_GAP / ROW;
    return { g, ys, y: ys.length ? (ys[0] + ys.at(-1)) / 2 : TOP + row * ROW };
  }).filter((p) => p.ys.length);
  const height = TOP + Math.max(row, 1) * ROW;
  const rootY = placed.length ? (placed[0].y + placed.at(-1).y) / 2 : TOP;

  if (tree.root) put("root", 0, rootY, tree.root);
  for (const { g, ys, y } of placed) {
    put(`g:${g.key}`, 1, y, g.node);
    link(`l:root>${g.key}`, 0, rootY, 1, y, g.node.state === "missing" && g.key === "gaps" ? "missing" : "root");
    g.leaves.forEach((leaf, i) => {
      let prevCol = 1, prevY = y, prevKey = `g:${g.key}`, prevState = "ok";
      leaf.cells.forEach((n, c) => {
        if (!n) return;
        const col = c + 2, key = `${leaf.id}:${col}`;
        put(key, col, ys[i], n, leaf.id);
        const has = (v) => n.state === v || prevState === v;
        const state = has("missing") ? "missing" : has("ask") ? "ask" : has("placeholder") ? "placeholder" : has("static") ? "static" : "ok";
        link(`l:${prevKey}>${key}`, prevCol, prevY, col, ys[i], state, leaf.id);
        prevCol = col; prevY = ys[i]; prevKey = key; prevState = n.state;
      });
    });
  }
  return { width, height, cx, nodes, links };
}

// fresh: Set of keys to animate in (live UI); focus: node key prefix to pulse (the question being asked).
/**
 * Render a laid-out tree as inline SVG. Browser-safe: no imports, no Node APIs. Used by both the live UI and the
 * static `REPORT.html`.
 *
 * @param {{width: number, height: number, cx: number[], nodes: object[], links: object[]}} layout From
 *   {@link layoutTree}.
 * @param {{fresh?: Set<string>|null, focus?: string|null}} [options] `fresh`: node/link keys to animate in (live
 *   UI only). `focus`: a node-key prefix to pulse (the question currently being asked).
 * @returns {string} The `<svg>` markup.
 */
export function markup(layout, { fresh = null, focus = null } = {}) {
  const heads = COLS.map((c, i) => (c.label ? `<text x="${layout.cx[i]}" y="14" class="h">${c.label}</text>` : "")).join("");
  const links = layout.links.map((l) => `<path class="l ${l.state}${fresh?.has(l.key) ? " enter" : ""}"${l.leaf ? ` data-leaf="${esc(l.leaf)}"` : ""} d="${l.d}"/>`).join("");
  const boxes = layout.nodes.map((n) => {
    const cls = `n ${n.state}${n.kind === "transform" ? " xf" : ""}${fresh?.has(n.key) ? " enter" : ""}${focus && n.key.startsWith(focus + ":") ? " focus" : ""}`;
    const title = (n.kind === "transform" ? "ƒ " : "") + n.title;
    return `<g transform="translate(${n.x},${n.y})"${n.leaf ? ` data-leaf="${esc(n.leaf)}"` : ""}><g class="${cls}"><title>${esc(title)}${n.sub ? " — " + esc(n.sub) : ""}${n.layer ? " [" + esc(n.layer) + " layer]" : ""}</title>` +
      `<rect width="${n.w}" height="${NODE_H}" rx="7"/>` +
      `<text x="10" y="${n.sub ? 16 : 24}" class="t">${esc(clip(title, n.w - (n.layer ? 66 : 0)))}</text>` +
      (n.layer ? `<text x="${n.w - 8}" y="14" text-anchor="end" class="ly ly-${n.layer}">${n.layer}</text>` : "") +
      (n.sub ? `<text x="10" y="30" class="s">${esc(clip(n.sub, n.w))}</text>` : "") + `</g></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="Match tree">${heads}${links}${boxes}</svg>`;
}

// ---- Colour tokens: the ONE source of truth for every colour in the UI, the tree SVG and REPORT.html ----
// Served as /theme.css by the server (src/server.mjs) so any other page can <link> it; index.html and REPORT.html use
// the same THEME_CSS. Light is the default; dark applies with the system setting (prefers-color-scheme) unless the
// page sets <html data-theme="light">, and always with <html data-theme="dark">.
//
//   surfaces   bg      page background            card     raised surfaces: dock, windows, cards, chat
//              stat    quiet fill: static nodes, badges, hovers, code chips
//   text       fg      body text                  mut      secondary text
//   lines      bd      soft, decorative borders and dividers
//              bd2     borders of controls (buttons, inputs) and default tree links: 3:1 against bg and card
//              line    tree link colour           sb       scrollbar thumb      sel   text-selection background
//   meaning    grn     Fit / connected            amb (+ambbg)   needs an answer / tie
//              red (+redbg)  Gap / missing        ph (+phbg)     Stub / placeholder
//              acc     accent: links, focus, selected     on-acc   text on a filled accent or team-coloured button
//   layers     ly-Page ly-Component ly-Controller ly-Domain ly-Service ly-Workflow ly-Route
//              (the four team colours reuse acc, ph, ly-Workflow, ly-Component)
//   depth      shadow (bar, menus)   shadow-lg (windows)
// Every text token is contrast-checked against the surfaces it sits on in src/tree/theme.test.mjs (WCAG AA).
export const TOKENS = {
  light: {
    bg: "#efece6", card: "#f8f6f1", stat: "#e6e2d9",
    fg: "#24211d", mut: "#5e584f",
    bd: "#d8d3c8", bd2: "#877f72", line: "#877f72", sb: "#c4bdae", sel: "#cfdcf3",
    grn: "#17683a", amb: "#8a5300", ambbg: "#f4e5c2", red: "#b3261e", redbg: "#f5ddd7", ph: "#6b3fbf", phbg: "#e8e0f3",
    acc: "#1d56c9", "on-acc": "#fffdf8",
    "ly-Page": "#0a6795", "ly-Component": "#0b6d64", "ly-Controller": "#ad4508", "ly-Domain": "#17683a", "ly-Service": "#4338ca", "ly-Workflow": "#b0245f", "ly-Route": "#5e584f",
    shadow: "0 6px 22px rgba(70,52,28,.16)", "shadow-lg": "0 18px 60px rgba(70,52,28,.28)",
  },
  dark: {
    bg: "#141413", card: "#1f1e1c", stat: "#1a1918",
    fg: "#f5f5f4", mut: "#a8a29e",
    bd: "#3d3a36", bd2: "#77716a", line: "#77716a", sb: "#4a4640", sel: "#2b4a7c",
    grn: "#4ade80", amb: "#fbbf24", ambbg: "#3a2c10", red: "#f87171", redbg: "#3a1b1b", ph: "#a78bfa", phbg: "#2a2140",
    acc: "#60a5fa", "on-acc": "#0d1117",
    "ly-Page": "#38bdf8", "ly-Component": "#2dd4bf", "ly-Controller": "#fb923c", "ly-Domain": "#4ade80", "ly-Service": "#a5b4fc", "ly-Workflow": "#f472b6", "ly-Route": "#a8a29e",
    shadow: "0 6px 22px rgba(0,0,0,.28)", "shadow-lg": "0 18px 60px rgba(0,0,0,.5)",
  },
};
const decl = (t, scheme) => `color-scheme:${scheme};` + Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";");
export const THEME_CSS = `
:root{${decl(TOKENS.light, "light")}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${decl(TOKENS.dark, "dark")}}}
:root[data-theme="dark"]{${decl(TOKENS.dark, "dark")}}
html{scrollbar-color:var(--sb) transparent}
::selection{background:var(--sel);color:var(--fg)}
`;

export const TREE_CSS = `
.l{fill:none;stroke:var(--line);stroke-width:1.6}
.l.ok{stroke:var(--grn);stroke-width:1.8}
.l.static{stroke:var(--mut);stroke-dasharray:2 4}
.l.placeholder{stroke:var(--ph);stroke-dasharray:6 3}
svg.dim .l,svg.dim .n{opacity:.18}svg.dim .hl,svg.dim .hl .n{opacity:1}svg.dim .l.hl{stroke-width:3.2}
.l.missing{stroke:var(--red);stroke-dasharray:5 4}
.l.ask{stroke:var(--amb);stroke-dasharray:2 4}
.l.placeholder{stroke:var(--ph);stroke-dasharray:6 3}
.n rect{fill:var(--card);stroke:var(--bd2);stroke-width:1.2}
.n.static rect{fill:var(--stat);stroke-dasharray:3 3}
.n.ask rect{fill:var(--ambbg);stroke:var(--amb);stroke-width:1.5}
.n.placeholder rect{fill:var(--phbg);stroke:var(--ph);stroke-width:1.5;stroke-dasharray:6 3}
.n.missing rect{fill:var(--redbg);stroke:var(--red);stroke-width:1.5;stroke-dasharray:5 3}
.n .t{font-size:12.5px;font-weight:600;fill:var(--fg)}.n .s{font-size:11px;fill:var(--mut)}
.n.ask .t,.n.ask .s{fill:var(--amb)}
.n.missing .t,.n.missing .s{fill:var(--red)}
.n.placeholder .t,.n.placeholder .s{fill:var(--ph)}
.ly{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.ly-Page{--c:var(--ly-Page)}.ly-Component{--c:var(--ly-Component)}.ly-Controller{--c:var(--ly-Controller)}.ly-Domain{--c:var(--ly-Domain)}.ly-Service{--c:var(--ly-Service)}.ly-Workflow{--c:var(--ly-Workflow)}.ly-Route{--c:var(--ly-Route)}
svg .ly{fill:var(--c)}
.n.xf .t{font-style:italic}
.layers{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.layer{border:1px solid var(--bd);border-radius:10px;padding:10px;background:var(--card)}
.lname{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}.lname small{color:var(--mut);font-size:11.5px}
.lname .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--c);align-self:center}
.blks{display:flex;flex-wrap:wrap;gap:6px}
.blk{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;border:1.5px solid var(--bd2);border-radius:6px;padding:2px 8px;background:var(--card);color:var(--fg)}
.blk.transform{font-style:italic}
.blk.placeholder{border:1.5px dashed var(--ph);background:var(--phbg);color:var(--ph)}
.blk.missing{border:1.5px dashed var(--red);background:var(--redbg);color:var(--red)}
.blk.ask{border:1.5px solid var(--amb);background:var(--ambbg);color:var(--amb)}
.blk{display:inline-flex;flex-direction:column;gap:3px}
.blk .stripe{display:flex;gap:2px}.blk .sg{flex:1;min-width:5px;height:4px;border-radius:2px;background:var(--grn)}
.blk .sg.static{background:var(--mut)}.blk .sg.ask{background:var(--amb)}.blk .sg.placeholder{background:var(--ph)}.blk .sg.missing{background:var(--red)}
.blk.linked{border-color:color-mix(in srgb,var(--grn) 55%,var(--bd))}
.layers.dim .blk{opacity:.3}.layers.dim .blk.hl{opacity:1;box-shadow:0 0 0 2px var(--acc)}
.blk.enter{animation:pop .5s ease-out both}
.h{font-size:10.5px;letter-spacing:.08em;fill:var(--mut);font-weight:600}
.n.enter{animation:pop .55s ease-out both}.l.enter{animation:fade .7s ease-out both}
.n.focus rect{stroke-width:2.5;animation:pulse 1.1s ease-in-out infinite}
@keyframes pop{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pulse{50%{stroke-opacity:.35}}
@media (prefers-reduced-motion:reduce){.n.enter,.l.enter,.n.focus rect{animation:none}}
`;

// The generated layers as nested blocks: layer -> functions/components inside it. Transforms carry ƒ.
// states: leaf id -> ok | static | placeholder | ask | missing. Each block gets a stripe with one colour per
// design part it serves, so the connections (and the broken ones) show in the layers too.
/**
 * Render the "Generated layers" view: layer -> its functions/components, each as a block (transforms marked
 * with ƒ), with a colour stripe per design part it serves.
 *
 * @param {{layer: string, file: string, blocks: object[]}[]} layers From `tree/layers.mjs` `buildLayers`.
 * @param {{animate?: boolean, states?: Object<string, string>}} [options] `animate`: stagger blocks in (live UI).
 *   `states`: leaf id -> `"ok"|"static"|"placeholder"|"ask"|"missing"`, for the stripes.
 * @returns {string} The HTML markup.
 */
export function layersMarkup(layers, { animate = false, states = {} } = {}) {
  return `<div class="layers">` + layers.map((L, i) =>
    `<div class="layer"><div class="lname ly-${L.layer}"><i class="dot"></i><b>${esc(L.layer)}</b><small>${esc(L.file)}</small></div><div class="blks">` +
    L.blocks.map((b, j) => {
      const sv = b.serves ?? [];
      const stripe = sv.length ? `<span class="stripe">${sv.map((id) => `<i class="sg ${states[id] ?? "ok"}" title="${esc(id)}: ${states[id] ?? "connected"}"></i>`).join("")}</span>` : "";
      const why = (b.why || b.kind) + (sv.length ? ` — serves ${sv.length} part${sv.length > 1 ? "s" : ""}` : "");
      return `<span class="blk ${b.state} ${b.kind}${sv.length ? " linked" : ""}${animate ? " enter" : ""}"${sv.length ? ` data-serves="${esc(sv.join("|"))}"` : ""} style="animation-delay:${(i * 4 + j) * 50}ms" title="${esc(why)}"><span class="bt">${b.kind === "transform" ? "ƒ " : ""}${esc(b.name)}</span>${stripe}</span>`;
    }).join("") + `</div></div>`).join("") + `</div>`;
}
