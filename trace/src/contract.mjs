// The API contract of one feature: a Swagger/OpenAPI file that lives in the feature's own folder
// (examples/<name>/openapi.json, .yaml or .yml). It is the only source of the API: feature.json no longer lists it.
// One loader for the pipeline, the CLI, the server, watch mode and reset.
//
//   loadContract(dir)  -> { present, file, format, usable, state, error, notice, apis, listKey, gaps, endpoints }
//   readSpec(dir)      -> feature.json + { apis, list, contract }, the shape the pipeline reads
//   saveContract(dir, text)   validates an uploaded file and stores it as the folder's only openapi file
//
// A run WITHOUT a contract is allowed; it is just honest about it (see contractBlock and hints.mjs).
import fs from "node:fs";
import path from "node:path";
import { readOpenApi, parseDocument, MAX_BYTES } from "./openapi.mjs";
import { isWired } from "./endpoint-paths.mjs";

export const CONTRACT_FILES = ["openapi.json", "openapi.yaml", "openapi.yml"];
export const NO_CONTRACT = "No API contract for this feature: upload a Swagger/OpenAPI file";
export const UPLOAD_HINT = "Upload the Swagger/OpenAPI file for this feature (it is saved as openapi.json or openapi.yaml in the feature folder), then run again.";

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

/**
 * Load a feature's API contract: the Swagger/OpenAPI file in its folder (`openapi.json`, `.yaml` or `.yml`).
 * A run without a contract is allowed; this just says so (`state: "none"`).
 *
 * @param {string} dir The feature's directory.
 * @returns {{present: boolean, file: string|null, format: string|null, usable: boolean,
 *   state: "none"|"invalid"|"empty"|"ok", error: string|null, notice: string|null, apis: object[],
 *   listKey: string|null, gaps: object[], endpoints: object, extraFiles: string[]}}
 *   The loaded contract; `usable` is true only for `state: "ok"`. `extraFiles` lists any other contract files
 *   found (only the first, in {@link CONTRACT_FILES} order, is read).
 */
export function loadContract(dir) {
  const feature = readJson(path.join(dir, "feature.json")) ?? {};
  const found = CONTRACT_FILES.filter((f) => fs.existsSync(path.join(dir, f)));
  const empty = { present: false, file: null, format: null, usable: false, state: "none", error: null, apis: [], listKey: null, gaps: [], endpoints: [], extraFiles: found.slice(1) };
  if (!found.length) {
    // an old feature.json still carrying `apis`: say why it is not used, once
    const legacy = Array.isArray(feature.apis) && feature.apis.length ? ' feature.json still has an "apis" list, but it is not read any more: convert it with scripts/apis-to-openapi.mjs.' : "";
    return { ...empty, notice: `${NO_CONTRACT}.${legacy}` };
  }
  const file = found[0];
  const c = { ...empty, present: true, file };
  try {
    const r = readOpenApi(fs.readFileSync(path.join(dir, file), "utf8"), { listKey: typeof feature.list === "string" ? feature.list : null });
    Object.assign(c, { format: r.format, apis: r.apis, listKey: r.listKey, gaps: r.gaps, endpoints: r.endpoints });
  } catch (e) {
    return { ...c, state: "invalid", error: e.message, notice: `No usable API contract for this feature: ${file} could not be read (${e.message}). Fix it or upload another Swagger/OpenAPI file.` };
  }
  if (found.length > 1) c.gaps.push({ kind: "note", endpoint: "", where: "file", text: `There is more than one openapi file in the folder; ${file} is used and ${found.slice(1).join(", ")} ignored.` });
  if (!c.apis.some((a) => isWired(a.path))) return { ...c, state: "empty", error: "no endpoints", notice: `No usable API contract for this feature: ${file} has no endpoint the generator can use. Upload another Swagger/OpenAPI file.` };
  return { ...c, usable: true, state: "ok", notice: null };
}

// feature.json (route, page, docs...) plus the contract. An explicit "list" in feature.json is only an override for
// envelope responses with several array properties; normally the list key is found in the contract.
/**
 * Read a feature's spec: `feature.json` (route, page, docs, ...) merged with its loaded contract, in the shape
 * the pipeline expects.
 *
 * @param {string} dir The feature's directory.
 * @returns {object} `feature.json`'s own fields (its `apis`/`list` are dropped), plus `apis` and `list` from the
 *   contract (an explicit `list` in `feature.json` only overrides which envelope property is used when a
 *   response has more than one array property; normally the list key is found in the contract itself), plus
 *   `contract` (the result of {@link loadContract}).
 */
export function readSpec(dir) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8"));
  const contract = loadContract(dir);
  const { apis: _ignored, list: _list, ...rest } = spec;
  return { ...rest, apis: contract.apis, ...(contract.listKey ? { list: contract.listKey } : {}), contract };
}

// What the parts of a run that can't be settled should say. null when the contract is fine.
//   missing     no file, or one that can't be used: every part waits for it
//   no-example  the list endpoint has no example, so there is no data to match against
/**
 * What every unsettled part of a run should say about the contract, when the contract itself is the blocker.
 *
 * @param {object|null} contract The result of {@link loadContract}, or `null` when there is nothing to check.
 * @param {{list?: {noExample?: boolean, method: string, path: string}}} [endpoints] The matched endpoints.
 * @returns {{kind: "missing"|"no-example", id: string, part: string, why: string, hint: string, partWhy: string,
 *   partHint: string}|null} The block to show, or `null` when the contract is fine (usable, and the list
 *   endpoint has an example).
 */
export function contractBlock(contract, endpoints) {
  if (!contract) return null;
  if (!contract.usable) {
    return {
      kind: "missing", id: "contract", part: "API contract",
      why: contract.notice,
      hint: contract.state === "invalid" ? `Fix ${contract.file}, or ${UPLOAD_HINT.charAt(0).toLowerCase()}${UPLOAD_HINT.slice(1)}` : UPLOAD_HINT,
      partWhy: contract.state === "invalid" ? `The API contract ${contract.file} could not be read, so this part can't be matched to the API yet.` : "There is no API contract for this feature, so this part can't be matched to the API yet.",
      partHint: "Upload the Swagger/OpenAPI file for this feature and run again; this part is matched as soon as the contract has what it needs.",
    };
  }
  const l = endpoints?.list;
  if (l?.noExample) {
    const why = `The contract has no example for the response of ${l.method} ${l.path}, so there is no data to match the page against.`;
    return {
      kind: "no-example", id: "contract.examples", part: "API contract examples",
      why,
      hint: `Add an "example" to that response (or to each of its fields) in ${contract.file}, then upload it again.`,
      partWhy: why,
      partHint: `Add an example to the ${l.method} ${l.path} response in ${contract.file} and upload it again; this part is matched as soon as there is data.`,
    };
  }
  return null;
}

// The contract as the UI and the API show it.
/**
 * The contract, trimmed to what the UI and the API responses show.
 *
 * @param {object} c The result of {@link loadContract}.
 * @returns {{hasContract: boolean, file: string|null, format: string|null, error: string|null,
 *   notice: string|null, listKey: string|null, endpoints: object, gaps: object[]}} The public shape.
 */
export function describeContract(c) {
  return {
    hasContract: c.usable,
    file: c.file,
    format: c.format,
    error: c.error,
    notice: c.notice,
    listKey: c.listKey,
    endpoints: c.endpoints,
    gaps: c.gaps,
  };
}

// An uploaded file: validated, then saved as the folder's ONLY openapi file (json stays json, yaml/yml become .yaml).
// Throws an Error with a message fit to show the user; nothing is written when it throws.
/**
 * Validate an uploaded contract and save it as the feature folder's only openapi file, removing any other
 * {@link CONTRACT_FILES}. Nothing is written when validation fails.
 *
 * @param {string} dir The feature's directory.
 * @param {string} text The uploaded file's text (JSON or YAML).
 * @returns {string} The saved file's name (`"openapi.json"` or `"openapi.yaml"`).
 * @throws {Error} With a message fit to show the user, when the file is unusable (bad size, syntax, version, or
 *   no endpoint the generator can wire — see {@link isWired}).
 */
export function saveContract(dir, text) {
  const parsed = readOpenApi(text); // size, syntax, version, paths
  // endpoints with two path parameters, or one that is not last, are listed but the generator cannot call them: a file with only those is no contract
  if (!parsed.apis.some((a) => isWired(a.path))) {
    throw new Error("it has no endpoint the generator can use (GET, POST, PUT, PATCH or DELETE, with no path parameter or one as the last segment)");
  }
  const name = parsed.format === "json" ? "openapi.json" : "openapi.yaml";
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, path.join(dir, name));
  for (const f of CONTRACT_FILES) if (f !== name) fs.rmSync(path.join(dir, f), { force: true });
  return name;
}

export { MAX_BYTES, parseDocument };
