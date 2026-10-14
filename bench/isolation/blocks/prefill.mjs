// prefill (#941, harness arms CD / CD-raw): one function per request, enforced on the request side.
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

// The one way the 1.5b is asked for a function (drive.mjs's try, run.mjs's codeRound): Ollama /api/generate,
// raw: true, ChatML applied here, the assistant turn prefilled with the signature + `{`, stopped at STOP and cut at
// the closing brace. `fetchImpl` is injectable for tests.
//   prefilledGenerate({ ollama: { url, keepAlive, timeoutMs }, model, options, system, user, signature, lang, seed })
//     -> { reply (fenced, complete function), raw (the generation), tokensIn, tokensOut, ms, promptChars }
export async function prefilledGenerate({ ollama, model, options = {}, system, user, signature, lang = 'tsx', seed, fetchImpl = fetch }) {
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  if (!signature) throw new Error('prefilledGenerate needs the function signature');
  const t0 = Date.now();
  const prompt = chatmlPrompt({ system, user, prefill: prefillFor(signature, lang) });
  const res = await fetchImpl(`${ollama.url}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(ollama.timeoutMs ?? 600_000),
    body: JSON.stringify({ model, raw: true, stream: false, keep_alive: ollama.keepAlive, prompt,
      options: { ...options, ...(seed != null ? { seed } : {}), stop: STOP } }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { reply: completeFunction(signature, j.response ?? '', lang), raw: j.response ?? '', tokensIn: j.prompt_eval_count ?? 0,
    tokensOut: j.eval_count ?? 0, ms: Date.now() - t0, promptChars: prompt.length };
}

// The SIGNATURE line of a briefBuilder brief.
export const briefSignature = (brief) => brief.match(/^SIGNATURE: (.+)$/m)?.[1]?.trim() ?? null;
