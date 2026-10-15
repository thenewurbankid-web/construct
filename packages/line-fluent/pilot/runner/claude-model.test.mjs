import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, claudeModel, claudePrompt, textAfterPrefill } from './claude-model.mjs';
import { parseAnswer } from './runner.mjs';

const PREFILL = '{"entry": "Array.prototype.at", "decision": "';
const ANSWER = { entry: 'Array.prototype.at', decision: 'existing', atom: null, existing: 'at', kind: 'value', sentence: 's', js: 'xs.at(i)', params: [], parts: null, reason: null };

test('the call is lean: the request system prompt, JSON output, no tools, MCP servers, settings or saved session', () => {
  const args = claudeArgs({ model: 'haiku', system: 'SYS' });
  assert.deepEqual(args.slice(0, 5), ['-p', '--model', 'haiku', '--system-prompt', 'SYS']);
  for (const flag of ['--no-session-persistence', '--strict-mcp-config', '--tools', '--setting-sources']) assert.ok(args.includes(flag), flag);
  assert.match(claudePrompt({ user: 'Entry: x', prefill: PREFILL }), /^Entry: x\n\n.*Start exactly with: \{"entry"/);
});

test('a reply is cut back to the text after the prefill, so the runner parses it', () => {
  const exact = `${PREFILL}existing", "atom": null}`;
  assert.equal(textAfterPrefill(PREFILL, exact), 'existing", "atom": null}');
  const fenced = `\`\`\`json\n${JSON.stringify(ANSWER, null, 2)}\n\`\`\``;
  const cut = textAfterPrefill(PREFILL, fenced);
  assert.deepEqual(parseAnswer(PREFILL, cut).answer, ANSWER, 'a re-spaced, fenced reply keeps every field');
  assert.deepEqual(Object.keys(parseAnswer(PREFILL, cut).answer), Object.keys(ANSWER), 'and the field order');
  assert.equal(textAfterPrefill(PREFILL, 'I cannot help'), 'I cannot help', 'non-JSON comes back as is and fails to parse');
  const other = JSON.stringify({ ...ANSWER, entry: 'Array.prototype.with' });
  assert.ok(parseAnswer(PREFILL, textAfterPrefill(PREFILL, other)).error, 'an answer for another entry is not rewritten');
});

test('the model returns the CLI result with real token counts and cost', async () => {
  const calls = [];
  const run = async (args, input) => {
    calls.push({ args, input });
    return {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        result: JSON.stringify(ANSWER),
        usage: { input_tokens: 2, cache_creation_input_tokens: 2000, cache_read_input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.004,
      }),
    };
  };
  const model = claudeModel({ model: 'opus', run });
  const reply = await model({ system: 'SYS', user: 'U', prefill: PREFILL });
  assert.deepEqual(parseAnswer(PREFILL, reply.text).answer, ANSWER);
  assert.deepEqual([reply.tokensIn, reply.tokensOut, reply.costUsd, reply.model], [2102, 50, 0.004, 'opus']);
  assert.equal(calls[0].args[2], 'opus');
});

test('a CLI error is an error, never an empty answer', async () => {
  const model = claudeModel({ run: async () => ({ code: 1, stderr: 'rate limited', stdout: '' }) });
  await assert.rejects(model({ system: 's', user: 'u', prefill: PREFILL }), /no JSON result: rate limited/);
  const flagged = claudeModel({ run: async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ is_error: true, result: 'usage limit' }) }) });
  await assert.rejects(flagged({ system: 's', user: 'u', prefill: PREFILL }), /usage limit/);
});
