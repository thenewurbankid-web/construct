// LIN-90 §2: editing one endpoint's request/response example from the Map's contract panel. Pure, unit-tested
// logic only — the DOM/fetch wiring lives in trace.mjs (see its own header for why: real-browser-only there).
//
//   parseEdited(text)                       validate one textarea's JSON; { ok, value } | { ok: false, error }
//   patchExample(doc, api, where, value)     clone `doc` (a parsed openapi.json) with that endpoint's
//                                            request/response `example` replaced; throws a user-facing Error
//                                            when the endpoint or its `application/json` body isn't there to
//                                            patch (only the canonical `content["application/json"].example`
//                                            shape is supported today — the shape every Trace-generated
//                                            contract in examples/ actually uses).

/**
 * Validate the text of one edited request/response textarea.
 *
 * @param {string} text
 * @returns {{ok: true, value: unknown}|{ok: false, error: string}}
 */
export function parseEdited(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
}

function operationOf(doc, method, path) {
  const item = doc.paths?.[path];
  if (!item) return null;
  const key = Object.keys(item).find((k) => k.toLowerCase() === String(method).toLowerCase());
  return key ? item[key] : null;
}

/**
 * A deep clone of `doc` with the given endpoint's request or response `application/json` example replaced.
 *
 * @param {object} doc A parsed openapi.json document.
 * @param {{method: string, path: string}} api The endpoint being edited.
 * @param {"request"|"response"} where
 * @param {unknown} value The new example value (already parsed JSON).
 * @returns {object} The patched clone. Nothing is mutated on the input.
 * @throws {Error} With a message fit to show the user, when the endpoint or its JSON body isn't in the doc.
 */
export function patchExample(doc, api, where, value) {
  const clone = structuredClone(doc);
  const op = operationOf(clone, api.method, api.path);
  if (!op) throw new Error(`Can't find ${api.method} ${api.path} in the contract file to save.`);
  if (where === "request") {
    const media = op.requestBody?.content?.["application/json"];
    if (!media) throw new Error("This endpoint's request has no application/json body in the contract to edit.");
    media.example = value;
  } else {
    const codes = Object.keys(op.responses ?? {});
    const code = codes.find((c) => op.responses[c]?.content?.["application/json"]);
    const media = code ? op.responses[code].content["application/json"] : null;
    if (!media) throw new Error("This endpoint's response has no application/json body in the contract to edit.");
    media.example = value;
  }
  return clone;
}
