// #938: system-prompt variants for the local builder's native tool calls. The Line-arm BUILDER-PROMPT describes
// plan-cli as a shell command table ("Run it as `node bench/ecommerce/driver/plan-cli.mjs <command>`") and shows replies
// as bare JSON text ("send {"fix": "f1"}"); qwen2.5-coder's Ollama template asks for <tool_call> tags around a call, and
// in lending r1 the model wrote correct calls without them (0/16 native). The `clean` variant describes the tools only
// through the native `tools` param and names every reply as a tool call; `bare` is a minimal prompt for the probe.
//
//   current  the prompt as it is
//   clean    cleanPrompt(current): no CLI table, no bare-JSON reply examples
//   bare     BARE_PROMPT (probe baseline: no spec, no rules)
export const PROMPT_VARIANTS = Object.freeze(['current', 'clean', 'bare']);

export const BARE_PROMPT = 'You build a web app in a Line project. Use your tools: call exactly one tool per turn.';

const TOOLS_SECTION = `## Your tools

Your tools are the functions you are given; call one per turn. They are the ONLY way to change the project: every call
is recorded, and a change made any other way voids the run. plan_add adds one step ({tool, args, why}, or {fix, why}
for a fix a refusal offered); plan_run_next lands it; plan_status shows the plan and the acceptance points; read_file,
list_dir, plan_rules, plan_findings and plan_validate read; finish stops.

`;

/**
 * The prompt with its CLI command table replaced by a short tools section and every "send {...}" / CLI-command reply
 * written as a tool call. Text without those parts comes back unchanged.
 * @param {string} text
 */
export function cleanPrompt(text) {
  let s = String(text);
  const a = s.indexOf('## Your only tool');
  if (a >= 0) { const b = s.indexOf('\n## ', a + 3); s = `${s.slice(0, a)}${TOOLS_SECTION}${b >= 0 ? s.slice(b + 1) : ''}`; }
  return s
    .replace(/## The tools you will use most/, '## The Line steps you will add most (plan_add with {tool, args, why})')
    .replace(/To apply one, send \{"fix":\s*"f1"\}\./g, 'To apply one, call plan_add with {"fix":"f1"}.')
    .replace(/Send the id you pick: `add --fix f1` \(a tool call: `plan_add \{"fix": "f1", "why": "\.\.\."\}`\)\./g, 'Pick one by calling plan_add with {"fix": "f1", "why": "..."}.')
    .replace(/; send `\{"fix": "f1"\}`\./g, '; call plan_add with {"fix": "f1", "why": "..."}.')
    .replace(/When `run-next` says/g, 'When plan_run_next says')
    .replace(/`read` it first/g, 'call read_file first')
    .replace(/Before you stop,\s+run `validate`\. Then write a short summary:/g, 'Before you stop, call plan_validate. Then call finish with a short summary:');
}

/**
 * The system prompt for a variant.
 * @param {string} current The arm's prompt as systemPrompt() builds it.
 * @param {string} [variant]
 */
export function promptVariant(current, variant = 'current') {
  if (variant === 'clean') return cleanPrompt(current);
  if (variant === 'bare') return BARE_PROMPT;
  return current;
}
