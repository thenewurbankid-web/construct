#!/usr/bin/env node
// Deterministic (no-LLM) Projects v2 hygiene sync.
//   node tools/project-board/sync.mjs [--dry-run] [--archive-days N]
//        [--owner thenewurbankid-web] [--repo construct] [--project 1]
// Auth: PROJECT_TOKEN (preferred) or GH_TOKEN env var. It must be a token that can
// write user-owned Projects v2 (classic: `project` + `repo`; fine-grained: Projects
// read/write + Issues read). The default Actions GITHUB_TOKEN cannot.
// Never prints the token. Exits 0 with a notice when no token is available.
import { planActions, DEFAULT_ARCHIVE_DAYS } from './plan.mjs';

function parseArgs(argv) {
  const o = { dryRun: false, archiveDays: DEFAULT_ARCHIVE_DAYS, owner: 'thenewurbankid-web', repo: 'construct', project: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--archive-days') o.archiveDays = Number(argv[++i]);
    else if (a === '--owner') o.owner = argv[++i];
    else if (a === '--repo') o.repo = argv[++i];
    else if (a === '--project') o.project = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const token = process.env.PROJECT_TOKEN || process.env.GH_TOKEN;
if (!token) {
  console.log('::notice::PROJECT_TOKEN is not set; skipping project-board sync. See docs/PROJECT_BOARD.md.');
  console.log('Skipped: no PROJECT_TOKEN.');
  process.exit(0);
}

async function gql(query, variables = {}) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`GraphQL error (${r.status}): ${JSON.stringify(j.errors || j.message)}`);
  return j.data;
}

async function paged(fetchPage) {
  const out = [];
  let cursor = null;
  for (;;) {
    const { nodes, pageInfo } = await fetchPage(cursor);
    out.push(...nodes);
    if (!pageInfo.hasNextPage) return out;
    cursor = pageInfo.endCursor;
  }
}

async function loadProject() {
  const d = await gql(
    `query($o:String!,$n:Int!){user(login:$o){projectV2(number:$n){id
      fields(first:50){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}}}}`,
    { o: opts.owner, n: opts.project },
  );
  const p = d.user?.projectV2;
  if (!p) throw new Error(`Project #${opts.project} of ${opts.owner} not found or not accessible with this token`);
  return p;
}

async function loadIssues() {
  return paged(async (after) => {
    const d = await gql(
      `query($o:String!,$r:String!,$c:String){repository(owner:$o,name:$r){issues(first:100,after:$c){
        pageInfo{hasNextPage endCursor} nodes{id number state closedAt}}}}`,
      { o: opts.owner, r: opts.repo, c: after },
    );
    return d.repository.issues;
  });
}

async function loadItems(projectId) {
  const nodes = await paged(async (after) => {
    const d = await gql(
      `query($p:ID!,$c:String){node(id:$p){... on ProjectV2{items(first:100,after:$c){pageInfo{hasNextPage endCursor}
        nodes{id isArchived content{__typename ... on Issue{number}}
        fieldValues(first:20){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}}}}}}}}`,
      { p: projectId, c: after },
    );
    return d.node.items;
  });
  const fv = (n, name) => n.fieldValues.nodes.find(v => v.field?.name === name)?.name ?? null;
  return nodes
    .filter(n => n.content?.__typename === 'Issue') // never touch PR items
    .map(n => ({
      itemId: n.id, number: n.content.number, isArchived: n.isArchived,
      status: fv(n, 'Status'), module: fv(n, 'Module'), subModule: fv(n, 'Sub-module'), area: fv(n, 'Area'),
      kind: fv(n, 'Kind'), priority: fv(n, 'Priority'),
    }));
}

async function runBatches(mutations, size = 15) {
  for (let i = 0; i < mutations.length; i += size) {
    const chunk = mutations.slice(i, i + size);
    await gql('mutation{' + chunk.map((m, j) => `m${j}:${m}`).join('\n') + '}');
  }
}

const project = await loadProject();
const [issues, items] = await Promise.all([loadIssues(), loadItems(project.id)]);
const plan = planActions({ issues, items, now: new Date(), archiveDays: opts.archiveDays });

const statusField = project.fields.nodes.find(f => f.name === 'Status');
const optId = (name) => {
  const o = statusField?.options.find(x => x.name === name);
  if (!o) throw new Error(`Status option "${name}" not found on the board`);
  return o.id;
};

const label = opts.dryRun ? '[dry-run] would' : 'did';
console.log(`Board ${opts.owner}/#${opts.project}: ${issues.length} issues, ${items.filter(i => !i.isArchived).length} active issue items, ${items.filter(i => i.isArchived).length} archived.`);
console.log(`${label} add ${plan.add.length} missing issue(s): ${plan.add.map(a => `#${a.number}(${a.status})`).join(' ') || '-'}`);
console.log(`${label} change status on ${plan.setStatus.length}: ${plan.setStatus.map(s => `#${s.number} ${s.from ?? 'none'}->${s.status}`).join(' ') || '-'}`);
console.log(`${label} archive ${plan.archive.length} Done item(s) closed >${opts.archiveDays}d ago: ${plan.archive.map(a => `#${a.number}`).join(' ') || '-'}`);
console.log(`${label} fix Area on ${plan.setArea.length}: ${plan.setArea.map(s => `#${s.number}->${s.area}`).join(' ') || '-'}`);
console.log(`report: missing Module ${JSON.stringify(plan.report.missingModule)}; missing Sub-module ${JSON.stringify(plan.report.missingSubModule)}; Area problems ${JSON.stringify(plan.report.areaProblems)}; missing Kind ${JSON.stringify(plan.report.missingKind)}; open without Priority ${JSON.stringify(plan.report.openWithoutPriority)}`);

if (!opts.dryRun) {
  // Newly added items get their status set in a second pass (need the new item id).
  const addMuts = plan.add.map(a => `addProjectV2ItemById(input:{projectId:"${project.id}",contentId:"${a.contentId}"}){item{id}}`);
  const added = [];
  for (const [i, m] of addMuts.entries()) {
    const d = await gql(`mutation{r:${m}}`);
    added.push({ itemId: d.r.item.id, status: plan.add[i].status });
  }
  const statusMuts = [...plan.setStatus, ...added].map(s =>
    `updateProjectV2ItemFieldValue(input:{projectId:"${project.id}",itemId:"${s.itemId}",fieldId:"${statusField.id}",value:{singleSelectOptionId:"${optId(s.status)}"}}){projectV2Item{id}}`);
  await runBatches(statusMuts);
  const areaField = project.fields.nodes.find(f => f.name === 'Area');
  const areaMuts = plan.setArea.map(s => {
    const o = areaField?.options.find(x => x.name === s.area);
    if (!o) { console.log(`::warning::Area option "${s.area}" does not exist on the board (add it to the Area field)`); return null; }
    return `updateProjectV2ItemFieldValue(input:{projectId:"${project.id}",itemId:"${s.itemId}",fieldId:"${areaField.id}",value:{singleSelectOptionId:"${o.id}"}}){projectV2Item{id}}`;
  }).filter(Boolean);
  await runBatches(areaMuts);
  await runBatches(plan.archive.map(a => `archiveProjectV2Item(input:{projectId:"${project.id}",itemId:"${a.itemId}"}){item{id}}`));
  console.log('Applied.');
}
