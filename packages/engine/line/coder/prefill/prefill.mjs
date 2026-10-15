// prefill (#948, lifted from bench/isolation/blocks/prefill.mjs, #941): one function per request, enforced on the
// request side. Added here: takeBody (the body of a reply, `trailing` when it goes past the closing brace) and
// FILL_EXAMPLE (the concrete example a refusal carries).
//   - fnGoal: the task statement narrowed to one target function (never mentions the other targets).
//   - chatmlPrompt: Qwen2.5's ChatML template applied by us (Ollama /api/generate with raw: true), with the
//     assistant turn prefilled by the exact signature line plus `{`, so the model can only write that body.
//   - completeFunction: cuts the generation at the prefilled function's closing brace (brace depth, skipping
//     strings, template literals and comments) and returns signature + body + `}` as a fenced reply for
//     spliceApplier, which still parses and checks it.
//   STOP: the Ollama stop sequence, a `}` at column 0 (the generation is also cut by depth if it runs on).

export const STOP = ['\n}'];

export function fnGoal(goal, fn, names) {
  if (names.length < 2) return goal;
  const other = names.filter((n) => n !== fn);
  const sentences = goal.split(/(?<=\.)\s+(?=[A-Z])/);
  const out = [];
  for (const s of sentences) {
    const hits = names.map((n) => ({ n, i: s.search(new RegExp(`\\b${n}\\(`)) })).filter((h) => h.i >= 0).sort((a, b) => a.i - b.i);
    if (!hits.length) { out.push(s); continue; }
    const mine = hits.findIndex((h) => h.n === fn);
    if (mine < 0) continue;
    const end = hits[mine + 1]?.i ?? s.length;
    const clause = s.slice(hits[mine].i, end).replace(/[\s,;]*(and\s*)?$/, '').replace(/\.$/, '');
    out.push(`Export ${clause}.`);
  }
  return out.filter((s) => !other.some((o) => new RegExp(`\\b${o}\\b`).test(s))).join(' ');
}

export const chatmlPrompt = ({ system, user, prefill }) =>
  `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n${prefill}`;

export const prefillFor = (signature, lang = 'tsx') => `\`\`\`${lang}\n${signature.replace(/\s*\{?\s*$/, '')} {\n`;

// Position just after the brace that closes depth `start` (the prefilled `{`), or -1 when the text never closes it.
export function closingBrace(text, start = 1) {
  let depth = start; const tpl = []; // tpl: depth at which each open template literal's ${ began
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'") { for (i++; i < text.length && text[i] !== c && text[i] !== '\n'; i++) if (text[i] === '\\') i++; continue; }
    if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === depth)) {
      if (c === '}') tpl.pop();
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '`') break;
        if (text[i] === '$' && text[i + 1] === '{') { tpl.push(depth); i++; break; }
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

export function completeFunction(signature, generated, lang = 'tsx') {
  const head = prefillFor(signature, lang).slice(lang.length + 4); // drop the opening fence
  const cut = closingBrace(generated);
  const body = cut >= 0 ? generated.slice(0, cut) : `${generated.replace(/\s*$/, '')}\n}`;
  return `\`\`\`${lang}\n${head}${body}\n\`\`\`\n`;
}

/**
 * The body a prefilled generation wrote: the text up to the prefilled function's closing brace (#948). A reply that
 * restates the signature (a provider that cannot prefill) or opens a fence is unwrapped first. `trailing` is true when
 * the reply goes on past that closing brace (a second function, prose): the caller rejects it with FILL_EXAMPLE.
 * @param {string} generated The model's continuation.
 * @param {string} prefill The prefilled signature through its `{`.
 * @returns {{body: string, trailing: boolean, closed: boolean}}
 */
export function takeBody(generated, prefill) {
  let text = String(generated ?? '').replace(/^\s*```[\w.+-]*[ \t]*\n/, '');
  const head = String(prefill ?? '').replace(/^```[\w.+-]*\n/, '').trim().replace(/\s*\{\s*$/, '').split('\n')[0].trim();
  const at = head ? text.indexOf(head) : -1;
  if (at >= 0 && text.slice(0, at).trim() === '') { const open = text.indexOf('{', at + head.length); if (open >= 0) text = text.slice(open + 1).replace(/^[ \t]*\n/, ""); }
  const cut = closingBrace(text);
  if (cut < 0) return { body: text.replace(/\s*```\s*$/, '').replace(/\s+$/, ''), trailing: false, closed: false };
  const rest = text.slice(cut).replace(/```/g, '').trim();
  return { body: text.slice(0, cut - 1).replace(/\s+$/, ''), trailing: rest.length > 0, closed: true };
}

/** A concrete example of a valid reply to a prefilled request, from another domain so nothing is copied (#948). */
export const FILL_EXAMPLE = 'For the prefilled `export function total(items: Item[]): number {` a valid reply is only\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\nand nothing after that closing brace.';
