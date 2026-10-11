// MIRROR of the expression contract (another agent builds the real one: JSON expression language,
// evaluate(facts, expr) -> failed sentences). Replace on merge; keep the call shape: evaluate(facts, expr) returns the
// plain-English sentences of what failed, [] when the check passes.
//
// Facts snapshot (facts.mjs factsOf): {files: {path: sha256}, library: [{id, kind, name}], features: [{name, items:
// [{id, kind, name, base}]}], findings: [{rule, file, line, key}], findingsNew: [...], plan: [{tool, ok, code?, rule?,
// fixes?}]}.
//
// Expressions (all JSON):
//   {"all": [e, ...]}                      every one passes
//   {"not": e}                             e fails
//   {"hasItem": "<feature>/<kind>/<Name>"} the feature item exists
//   {"hasLibrary": "<kind>/<Name>"}        the library item exists
//   {"basedOn": ["<item id>", "<library id>"]}  the item's base link resolves to that library item
//   {"fileContains": ["<path>", "<text>"]} the file exists and contains the text (facts carry contents only when asked)
//   {"noNewFindings": true}                the change added no finding
//   {"noFinding": {"rule": "LINE-DIR", "file"?: "<path>"}}   no finding of that rule (in that file)
//   {"refused": {"code"?: "UNKNOWN_ITEM", "rule"?: "LINE-DIR", "fixes"?: true}}  the last step was refused that way

const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const but = (expr, reason) => `Expected that ${lower(describe(expr).replace(/\.$/, ''))}, but ${reason}.`;

/**
 * Evaluate one expression over a facts snapshot.
 * @param {any} facts
 * @param {any} expr
 * @returns {string[]} The failed sentences; [] when it passes.
 */
export function evaluate(facts, expr) {
  if (!expr || typeof expr !== 'object') return ['The check is not a valid expression.'];
  if (Array.isArray(expr.all)) return expr.all.flatMap((e) => evaluate(facts, e));
  if ('not' in expr) return evaluate(facts, expr.not).length ? [] : [`It should not be true that ${lower(describe(expr.not).replace(/\.$/, ''))}.`];
  const items = (facts.features ?? []).flatMap((f) => f.items ?? []);
  if (typeof expr.hasItem === 'string') {
    return items.some((i) => i.id === expr.hasItem) ? [] : [but(expr, `it is not there`)];
  }
  if (typeof expr.hasLibrary === 'string') {
    return (facts.library ?? []).some((l) => l.id === expr.hasLibrary) ? [] : [but(expr, `it is not there`)];
  }
  if (Array.isArray(expr.basedOn)) {
    const [id, lib] = expr.basedOn;
    const it = items.find((i) => i.id === id);
    if (!it) return [but(expr, `${nameOf(id)} is not there`)];
    return it.base === lib ? [] : [but(expr, `it is based on ${it.base ? nameOf(it.base) : 'nothing'}`)];
  }
  if (Array.isArray(expr.fileContains)) {
    const [file, text] = expr.fileContains;
    const content = facts.contents?.[file];
    if (content === undefined) return [but(expr, `the file is not there`)];
    return content.includes(text) ? [] : [but(expr, 'it does not')];
  }
  if (expr.noNewFindings === true) {
    const added = facts.findingsNew ?? [];
    return added.length ? [`The change added ${added.length} problem${added.length === 1 ? '' : 's'} (${added.map((f) => f.rule).join(', ')}).`] : [];
  }
  if (expr.noFinding && typeof expr.noFinding === 'object') {
    const left = (facts.findings ?? []).filter((f) => f.rule === expr.noFinding.rule && (!expr.noFinding.file || f.file === expr.noFinding.file));
    return left.length ? [but(expr, `it is still reported`)] : [];
  }
  if (expr.refused && typeof expr.refused === 'object') {
    const last = (facts.plan ?? []).at(-1);
    if (!last) return ['Nothing was tried, so nothing was refused.'];
    if (last.ok) return [but(expr, `the change was made`)];
    if (expr.refused.code && last.code !== expr.refused.code) return [but(expr, `it was refused for another reason (${last.code ?? last.rule ?? 'unknown'})`)];
    if (expr.refused.rule && last.rule !== expr.refused.rule) return [but(expr, `it was refused for another reason (${last.rule ?? last.code ?? 'unknown'})`)];
    if (expr.refused.fixes && !last.fixes) return [but(expr, `the refusal came without a typed fix`)];
    return [];
  }
  return ['The check is not a valid expression.'];
}

const nameOf = (id) => String(id).split('/').pop();
const featureOf = (id) => String(id).split('/')[0];
const KIND_WORD = { components: 'component', pages: 'page', workflows: 'flow', fixtures: 'sample data' };
const kindOf = (id) => KIND_WORD[String(id).split('/').at(-2)] ?? 'item';

/**
 * One expression as a plain-English sentence (what must be true).
 * @param {any} expr
 * @returns {string}
 */
export function describe(expr) {
  if (!expr || typeof expr !== 'object') return 'An unknown check.';
  if (Array.isArray(expr.all)) return expr.all.map(describe).join(' ');
  if ('not' in expr) return `Not: ${lower(describe(expr.not))}`;
  if (typeof expr.hasItem === 'string') return `${featureOf(expr.hasItem)} has a ${kindOf(expr.hasItem)} ${nameOf(expr.hasItem)}.`;
  if (typeof expr.hasLibrary === 'string') return `The library has a ${kindOf(`x/${expr.hasLibrary}`)} ${nameOf(expr.hasLibrary)}.`;
  if (Array.isArray(expr.basedOn)) return `${nameOf(expr.basedOn[0])} is based on the library ${nameOf(expr.basedOn[1])}.`;
  if (Array.isArray(expr.fileContains)) return `${nameOf(expr.fileContains[0])} contains ${JSON.stringify(expr.fileContains[1])}.`;
  if (expr.noNewFindings === true) return 'Validate shows no new problems.';
  if (expr.noFinding) return `No ${expr.noFinding.rule} problem is reported${expr.noFinding.file ? ` in ${nameOf(expr.noFinding.file)}` : ''}.`;
  if (expr.refused) {
    const WHY = { UNKNOWN_ITEM: 'because the item does not exist', NAME_TAKEN: 'because the name is taken', UNKNOWN_FEATURE: 'because the feature does not exist', WRONG_KIND: 'because the kinds do not match' };
    const why = expr.refused.code ? ` ${WHY[expr.refused.code] ?? 'and says why'}` : ' because it would add a problem';
    return `Construct refuses it${why}${expr.refused.fixes ? ', and offers a fix' : ''}.`;
  }
  return 'An unknown check.';
}
