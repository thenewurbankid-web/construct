// UAT walk, row cs2 (docs/line/review.md, "cs2 (rule factory): jev and Claude grow the static layer, offline"), through
// `construct line rules propose|gate|apply` on a copy of examples/line-sample:
// 1. propose, offline with jev off: collects static code's misses, the rules label what they can and say so, and the
//    proposals and labelling file are written into the project's line/rules/.
// 2. gate: each proposal is measured on the held-out evals; one that lifts no held-out score is held back, with why.
// 3. apply: refuses what the gate did not pass (by default and by --id), and the Construct checkout's rule files stay
//    untouched.
// 4. apply is a person's command: no agent surface offers it (the MCP server's tools, Line's plan tools).
// Takes a few minutes: the gate re-runs Train Line's and the drafter's held-out evals per proposal.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, say, construct, show, tempDir, copyDir, walk } from './walk.mjs';

const RULE_FILES = ['packages/engine/line/drafter/lexicon.json', 'packages/engine/line/fix-ranking.json', 'packages/rule-factory/applied.json'];
const hashes = () => RULE_FILES.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, f))).digest('hex'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const t = tempDir('cs2');
const project = copyDir(path.join(REPO, 'examples/line-sample'), path.join(t.dir, 'sample'));
// A fresh per-user state folder: no decision traces from this machine leak into the walk.
const env = { CONSTRUCT_STATE_DIR: path.join(t.dir, 'state') };
await walk('cs2 rule factory', async () => {
  const ruleFilesBefore = hashes();

  say('-- 1. propose, offline, jev off');
  const p = construct(['line', 'rules', 'propose', '--dir', project, '--no-jev'], { env });
  assert.equal(p.code, 0, p.all);
  show(p.out, 12);
  assert.match(p.out, /^Collected \d+ decisions?, \d+ miss(es)? by static code:/m);
  assert.match(p.out, /jev was not available \(it was turned off for this run with --no-jev\), so the rules labelled \d+ of \d+ misses/);
  const proposals = readJson(path.join(project, 'line/rules/proposals.json')).proposals;
  assert.ok(fs.existsSync(path.join(project, 'line/rules/labelling.jsonl')), 'the labelling file is written');
  assert.ok(proposals.length >= 1, 'at least one rule proposal to gate');
  for (const x of proposals) assert.ok(x.test, `${x.id} carries its own test`);
  say(`  > ${proposals.length} proposal(s), each with its own test: ${proposals.map((x) => x.id).join(', ')}`);

  say('-- 2. gate on the held-out evals (a few minutes)');
  const g = construct(['line', 'rules', 'gate', '--dir', project], { env });
  assert.equal(g.code, 0, g.all);
  show(g.out.split('\n').filter((l) => !/^(Measuring|Scoring|Running)/.test(l)).join('\n'), 10);
  const report = readJson(path.join(project, 'line/rules/gate.json'));
  assert.ok(report.baseline?.train && report.baseline?.drafter, 'the report has the held-out baseline');
  const held = report.results.filter((r) => !report.passed.includes(r.proposalId));
  assert.ok(held.length >= 1, 'a proposal is held back');
  for (const r of held) assert.match(`${r.sentence} ${r.ownTest.sentence}`, /no held-out score rose|fell|now fails|own test fails|broke/i, `${r.proposalId} says why it was held back`);
  // The rest of the walk relies on nothing passing: apply would otherwise write to this checkout's rule files.
  assert.deepEqual(report.passed, [], `nothing passed the gate this run (${report.passed.join(', ')}); stop before apply writes the checkout`);
  say(`  > held back: ${held.map((r) => `${r.proposalId} (${r.sentence})`).join('; ')}`);

  say('-- 3. apply refuses what did not pass');
  const a = construct(['line', 'rules', 'apply', '--dir', project], { env });
  assert.equal(a.code, 1);
  assert.match(a.out, /No proposal passed the gate, so there is nothing to apply\./);
  show(a.out, 2);
  const id = held[0].proposalId;
  const a2 = construct(['line', 'rules', 'apply', '--dir', project, '--id', id], { env });
  assert.equal(a2.code, 1);
  assert.match(a2.out, new RegExp(`${id} did not pass the gate, so it is not applied\\.`));
  show(a2.out, 2);
  assert.deepEqual(hashes(), ruleFilesBefore, 'the lexicon, fix ranking and applied.json are unchanged');
  say('  > the checkout\'s lexicon.json, fix-ranking.json and applied.json are unchanged');

  say('-- 4. apply is a person\'s command: no agent surface offers it');
  const { TOOLS, PLAN_TOOLS, IMPORT_AGENT_TOOLS, TRAIN_MCP_TOOLS } = await import(pathToFileURL(path.join(REPO, 'packages/mcp/src/server.mjs')).href);
  const mcp = [...TOOLS, ...PLAN_TOOLS, ...IMPORT_AGENT_TOOLS, ...TRAIN_MCP_TOOLS].map((x) => x.name);
  assert.ok(mcp.length > 10 && !mcp.some((n) => /rule|apply/i.test(n)), `no MCP tool applies rules (${mcp.join(', ')})`);
  say(`  > the MCP server's ${mcp.length} tools: none proposes, gates or applies rules`);
  const spec = construct(['line', 'spec', '--topic', 'line-tools']);
  assert.equal(spec.code, 0, spec.all);
  const lineTools = Object.values(JSON.parse(spec.out).topics['line-tools']).flat().map((x) => x.name);
  assert.ok(lineTools.length > 3 && !lineTools.some((n) => /rule/i.test(n)), `no Line plan tool applies rules (${lineTools.join(', ')})`);
  say(`  > Line's ${lineTools.length} plan tools: none applies rules (an agent can only reach apply by running the CLI itself)`);
}, t.cleanup);
