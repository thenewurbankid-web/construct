// "What is this question about?" For the part being asked, gather what a person needs to decide: what the design
// shows, what the API holds for it (sample values per candidate), and where the answer would land in the code.
// Sent with the question, so the page, the tree and the layers can light up the same part.
import { FORMATTERS, AGGREGATES } from "./transforms.mjs";
import { flatItems, envScalars } from "./match.mjs";
import { makeNames } from "./plan.mjs";
import { fnNames, handlerName, eventName } from "./emit.mjs";

const fmt = (name, v) => { try { return String(FORMATTERS.find((f) => f.name === name)?.fn(v) ?? v); } catch { return String(v); } };
const short = (v) => { const s = String(v); return s.length > 28 ? s.slice(0, 27) + "…" : s; };

/**
 * Gather what a person needs to decide a question about one part: what the design shows, sample values from the
 * API per candidate answer, and where the answer would land in the generated code. Sent alongside the question
 * so the page, tree and layers views can highlight the same part.
 *
 * @param {{focusId?: string, id: string}} q The question (its `focusId`, or `id`, names the part; a `#`-suffix
 *   variant is stripped).
 * @param {object} m The match result (`endpoints`, `list`, `values`).
 * @param {object} spec `{feature, apis}` for the example.
 * @returns {{id: string, label: string, endpoint: string|null, design: string[], candidates: object[],
 *   available: object[], blocks: {layer: string, name: string}[]}}
 *   The context: a human label, the endpoint summary (list part only), design values, candidate answers with
 *   samples, the raw fields to fall back to when there is no real candidate, and the code layers the answer
 *   affects. Fields are left at their defaults when `id` does not match a known part shape (list, list.sort,
 *   value, action).
 */
export function questionContext(q, m, spec) {
  const id = (q.focusId ?? q.id).split("#")[0];
  const e = m.endpoints, N = makeNames(spec.feature), F = fnNames(N);
  const items = flatItems(e), idx = m.list?.alignedIdx ?? [];
  const env = envScalars(e);
  const svc = { layer: "Service", name: `${F.list}()` };
  const ctx = { id, label: id, endpoint: e.list ? `${e.list.method} ${e.list.path}${e.listKey ? ` → ${e.listKey}[]` : ""}` : null, design: [], candidates: [], available: [], blocks: [] };

  if (id === "list.sort") {
    ctx.label = "row order";
    const first = m.list?.fields?.[0];
    ctx.design = (first?.examples ?? []).slice(0, 4).map(short);
    ctx.candidates = (m.list?.sort ?? []).map((s) => ({ label: s.label, samples: [] }));
    ctx.blocks = [{ layer: "Domain", name: `${F.rows ?? `to${N.Item}Rows`}()` }, svc];
  } else if (id.startsWith("list.")) {
    const f = m.list?.fields.find((x) => `list.${x.name}` === id);
    if (f) {
      ctx.label = `row.${f.name}`;
      ctx.design = f.examples.slice(0, 4).map(short);
      const real = f.candidates.filter((c) => !c.custom); // a placeholder answer has no API field to show
      ctx.candidates = real.map((c) => ({ label: `${c.field} · ${c.formatter}`, samples: [0, 1, 2].map((i) => short(fmt(c.formatter, items[idx[i]]?.[c.field]))) }));
      if (!real.length) ctx.available = Object.entries(items[0] ?? {}).slice(0, 10).map(([k, v]) => ({ label: k, sample: short(v) }));
      ctx.blocks = [{ layer: "Component", name: `${N.Item}Row` }, { layer: "Domain", name: `to${N.Item}Rows()` }, svc];
    }
  } else if (id.startsWith("value.")) {
    const v = m.values.find((x) => `value.${x.name}` === id);
    if (v) {
      ctx.label = v.name;
      ctx.design = [short(v.example)];
      const real = v.candidates.filter((c) => !c.custom);
      ctx.candidates = real.map((c) => {
        let text = "";
        try { text = c.agg === "field" ? fmt(c.formatter, env[c.field]) : fmt(c.formatter, AGGREGATES.find((a) => a.name === c.agg).fn(items, c.field)); } catch {}
        return { label: c.agg === "field" ? `field ${c.field} · ${c.formatter}` : `${c.agg}(${c.field ?? ""}) · ${c.formatter}`, samples: [short(text)] };
      });
      if (!real.length) ctx.available = Object.entries(env).slice(0, 10).map(([k, val]) => ({ label: k, sample: short(val) }));
      ctx.blocks = [{ layer: "Page", name: `prop ${v.name}` }, { layer: "Domain", name: `${v.name}()` }, svc];
    }
  } else if (id.startsWith("action.")) {
    const [, scope, name] = id.split(".");
    ctx.label = `${name} (${scope} button)`;
    ctx.design = [name];
    ctx.available = spec.apis.map((a) => ({ label: `${a.method} ${a.path}`, sample: "" }));
    ctx.blocks = [{ layer: scope === "row" ? "Component" : "Page", name: handlerName(name) }, { layer: "Workflow", name: `event ${eventName(name)}` }];
  }
  return ctx;
}
