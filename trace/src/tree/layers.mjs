// The generated code as nested blocks: layer -> the functions/components inside it, taken from the plan.
// Transforms (formatters, aggregates, row/input conversions, placeholders that compute a value) are marked;
// placeholders are violet, values the API can't back are red, skipped ones amber.
import { fnNames, handlerName, eventName } from "../emit.mjs";
import { FORMATTERS } from "../transforms.mjs";

/**
 * Build the generated code as nested blocks (layer -> functions/components inside it), for the "Generated
 * layers" view. Transforms are marked; each block's `serves` lists the tree leaf ids it is part of, so the UI
 * can stripe a block by the connection state of everything it serves.
 *
 * @param {object} plan From `plan.mjs` `makePlan`.
 * @returns {{layer: string, file: string, blocks: {name: string, kind: string, state: string, why: string,
 *   serves: string[]}[]}[]}
 *   One entry per generated file, in the order they are emitted.
 */
export function buildLayers(plan) {
  const n = plan.names, F = fnNames(n), e = plan.endpoints;
  // serves: the tree leaf ids a block is part of; the UI colours a stripe per leaf so connections show in the layers too.
  const blk = (name, kind, state = "ok", why = "", serves) => ({ name, kind, state, why, serves });
  const rowIds = plan.rowFields.map((f) => `list.${f.name}`);
  const sortIds = plan.rowFields.length ? ["list.sort"] : [];
  const valueIds = plan.values.map((v) => `value.${v.name}`);
  const actId = (a) => `action.${a.scope}.${a.name}`;
  const formIds = plan.form ? [...plan.form.fields.map((f) => `form.${f.name}`), ...plan.form.missing.map((k) => `form.missing.${k}`)] : [];
  const dataRows = plan.rowFields.filter((f) => f.field || (f.custom && f.from === "fields")).map((f) => `list.${f.name}`);
  const dataValues = plan.values.filter((v) => v.agg || (v.custom && v.from === "fields")).map((v) => `value.${v.name}`);
  const actsOf = (...kinds) => plan.actions.filter((a) => kinds.includes(a.kind)).map(actId);
  const layers = [];
  const L = (layer, file, blocks) => layers.push({ layer, file, blocks });

  L("Route", `route/${n.Feature}Route.jsx`, [blk(`${n.Feature}Route`, "component", "ok", `path ${plan.route}`)]);

  const ctl = [blk(`${n.Feature}Controller`, "component", "ok", "wires the workflow and domain to the page")];
  for (const f of plan.rowFields) if (f.custom && f.from === "controller") ctl.push(blk(`${f.fn}()`, "placeholder", "placeholder", `row.${f.name} — provided by the controller`, [`list.${f.name}`]));
  for (const v of plan.values) if (v.custom && v.from === "controller") ctl.push(blk(`${v.fn}()`, "placeholder", "placeholder", `${v.name} — provided by the controller`, [`value.${v.name}`]));
  for (const a of plan.actions) {
    if (a.kind === "custom") ctl.push(blk(`${a.fn}()`, "placeholder", "placeholder", `${a.name} — your own handler`, [actId(a)]));
    else ctl.push(blk(handlerName(a.name), "function", "ok", `${a.name} button`, [actId(a)]));
  }
  L("Controller", `controller/${n.Feature}Controller.jsx`, ctl);

  const events = plan.actions.filter((a) => ["save", "create", "update", "remove", "select", "clear", "reload"].includes(a.kind));
  L("Workflow", `workflow/${n.feature}.workflow.js`, [
    blk(`${n.feature}Workflow`, "machine", "ok", "XState machine"),
    ...events.map((a) => blk(eventName(a.name), "event", "ok", `${a.kind}`, [actId(a)])),
  ]);

  const used = new Set([...plan.rowFields.filter((f) => f.field).map((f) => f.formatter), ...plan.values.filter((v) => v.agg).map((v) => v.formatter)]);
  const dom = [];
  for (const f of FORMATTERS.filter((x) => used.has(x.name))) dom.push(blk(`${f.name}()`, f.name === "asText" ? "function" : "transform", "ok", "formatter", [
    ...plan.rowFields.filter((r) => r.field && r.formatter === f.name).map((r) => `list.${r.name}`),
    ...plan.values.filter((v) => v.agg && v.formatter === f.name).map((v) => `value.${v.name}`),
  ]));
  dom.push(blk(`to${n.Item}Rows()`, "transform", "ok", plan.sort.field ? `rows, sorted by ${plan.sort.field} ${plan.sort.dir}` : "rows for the list", [...dataRows, ...sortIds]));
  for (const v of plan.values) {
    if (v.agg) dom.push(blk(`${v.name}()`, "transform", "ok", `${v.agg}${v.field ? `(${v.field})` : ""} → ${v.formatter}`, [`value.${v.name}`]));
    else if (v.custom && v.from === "fields") dom.push(blk(`${v.fn}()`, "transform", "placeholder", `${v.name} — placeholder built from ${v.inputs.join(", ")}`, [`value.${v.name}`]));
    else if (v.todo) dom.push(blk(`${v.name}()`, "function", v.skipped ? "ask" : "missing", v.skipped ? "skipped — returns — until answered" : "not in the API — returns —", [`value.${v.name}`]));
  }
  for (const f of plan.rowFields) if (f.custom && f.from === "fields") dom.push(blk(`${f.fn}()`, "transform", "placeholder", `row.${f.name} — placeholder built from ${f.inputs.join(", ")}`, [`list.${f.name}`]));
  dom.push(blk(`find${n.Item}()`, "function", "ok", "", formIds));
  if (plan.form) dom.push(blk(`to${n.Item}Input()`, "transform", "ok", "form text → the types the API expects", formIds), blk("toFormValues()", "function", "ok", "", formIds));
  L("Domain", `domain/${n.feature}.domain.js`, dom);

  L("Page", `page/${n.Feature}Page.jsx`, [blk(`${n.Feature}Page`, "component", "ok", "props in, JSX out", [...valueIds, ...formIds, ...plan.actions.filter((a) => a.scope === "page").map(actId), ...sortIds])]);
  if (plan.rowFields.length) L("Component", `component/${n.Item}Row.jsx`, [blk(`${n.Item}Row`, "component", "ok", "one list row", [...rowIds, ...plan.actions.filter((a) => a.scope === "row").map(actId)])]);

  const svc = [];
  if (e.list) svc.push(blk(`${F.list}()`, "function", "ok", `${e.list.method} ${e.list.path}`, [...dataRows, ...dataValues, ...sortIds, ...actsOf("reload")]));
  if (e.create) svc.push(blk(`${F.create}()`, "function", "ok", `${e.create.method} ${e.create.path}`, [...actsOf("create", "save"), ...formIds]));
  if (e.update) svc.push(blk(`${F.update}()`, "function", "ok", `${e.update.method} ${e.update.path}`, [...actsOf("update", "save"), ...formIds]));
  if (e.remove) svc.push(blk(`${F.remove}()`, "function", "ok", `${e.remove.method} ${e.remove.path}`, actsOf("remove")));
  for (const v of plan.values) if (v.custom && v.from === "api") svc.push(blk(`${v.fn}()`, "placeholder", "placeholder", `${v.name} — needs an endpoint that doesn't exist yet`, [`value.${v.name}`]));
  L("Service", `service/${n.feature}.service.js`, svc);
  return layers;
}
