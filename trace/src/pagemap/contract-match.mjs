// What the API contract's example data says about a page's text. Pure and deterministic; the only I/O is reading the
// example folder's contract through loadContract/readSpec (src/contract.mjs). No model.
//
// A text that EQUALS something the contract can produce (a field of the response envelope or of a list item, shown as
// text or through one of the closed library's formatters, or a count/sum/average/max/min of the list) is a strong hint
// that the text is data. A text that only CONTAINS a string value of the contract ("Grains" inside a sentence) is a weak
// hint. Equal-by-coincidence is real (a bare "6" is also a count), so short bare numbers and aggregates are weak.
import { readSpec } from "../contract.mjs";
import { findEndpoints, flatItems, envScalars } from "../match.mjs";
import { FORMATTERS, AGGREGATES, normalize } from "../transforms.mjs";

const MIN_MENTION = 4;

/**
 * Build the matcher for an example folder.
 *
 * @param {string} dir Example folder (holds feature.json and the openapi file).
 * @returns {{file:string, fields:number, lookup:(text:string)=>{field:string, formatter:string, source:string}[], mentions:(text:string)=>string[]}|null}
 *   `null` when there is no usable contract (or no list with examples); then nothing is claimed.
 */
export function contractMatcher(dir) {
  let spec;
  try { spec = readSpec(dir); } catch { return null; }
  if (!spec.contract?.usable) return null;
  const endpoints = findEndpoints(spec.apis, spec.list);
  const items = flatItems(endpoints);
  const env = envScalars(endpoints);
  const index = new Map(); // normalised text -> hits
  const add = (text, hit) => {
    const key = normalize(text);
    if (!index.has(key)) index.set(key, []);
    const list = index.get(key);
    if (!list.some((h) => h.field === hit.field && h.formatter === hit.formatter && h.source === hit.source)) list.push(hit);
  };
  const shows = (val, hit) => {
    for (const fmt of FORMATTERS) {
      if (fmt.accepts && !fmt.accepts(val)) continue;
      let text;
      try { text = fmt.fn(val); } catch { continue; }
      add(text, { ...hit, formatter: fmt.name });
    }
  };
  for (const [path, val] of Object.entries(env)) if (val != null) shows(val, { field: path, source: "envelope" });
  for (const it of items) for (const [f, val] of Object.entries(it)) if (val != null) shows(val, { field: f, source: "item" });
  const fields = Object.keys(items[0] ?? {});
  if (items.length) {
    for (const agg of AGGREGATES) {
      for (const field of agg.needsField ? fields : [null]) {
        let v;
        try { v = agg.fn(items, field); } catch { continue; }
        if (typeof v === "number" && !Number.isNaN(v)) shows(v, { field: field ? `${agg.name}(${field})` : `${agg.name}()`, source: "aggregate" });
      }
    }
  }
  // string values that can be mentioned inside a sentence
  const strings = new Set();
  for (const v of [...Object.values(env), ...items.flatMap((i) => Object.values(i))]) if (typeof v === "string" && v.length >= MIN_MENTION && /[A-Za-z]{3}/.test(v) && !/^\d{4}-\d\d-\d\d/.test(v)) strings.add(v);
  // the names of the data items (response fields and item fields), for mapping a chart's labels to data
  const fieldNames = [...new Set([...Object.keys(env), ...fields])].sort();
  const words = (s) => String(s).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const mention = [...strings].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return {
    file: spec.contract.file,
    fields: Object.keys(env).length + fields.length,
    lookup: (text) => index.get(normalize(text)) ?? [],
    mentions: (text) => mention.filter((s) => text.includes(s)).slice(0, 3),
    fieldNames,
    /** Data items a label (a series, an axis or a legend text) could stand for: a value it equals, or a field whose name has all its words. */
    dataItemsFor: (label) => {
      const lw = words(label).filter((w) => w.length > 1);
      const byName = lw.length ? fieldNames.filter((f) => { const fw = words(f.split(".").at(-1)); return lw.every((w) => fw.includes(w)) || (fw.length > 0 && fw.every((w) => lw.includes(w))); }) : [];
      const byValue = (index.get(normalize(label)) ?? []).map((h) => h.field);
      return [...new Set([...byValue, ...byName])].slice(0, 4);
    },
  };
}
