const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAIRS_PATH = path.join(__dirname, 'training-data', 'pairs.jsonl');

function ensureDir() {
  fs.mkdirSync(path.dirname(PAIRS_PATH), { recursive: true });
}

function pairKey(codeA, codeB) {
  const [a, b] = [codeA, codeB].sort();
  return crypto.createHash('sha1').update(a + '\u0000' + b).digest('hex');
}

function loadExistingKeys() {
  ensureDir();
  if (!fs.existsSync(PAIRS_PATH)) return new Set();
  const lines = fs.readFileSync(PAIRS_PATH, 'utf8').split('\n').filter(Boolean);
  return new Set(lines.map((l) => JSON.parse(l).key));
}

function appendPairs(records) {
  ensureDir();
  const existing = loadExistingKeys();
  const fresh = records.filter((r) => !existing.has(r.key));
  if (!fresh.length) return 0;
  fs.appendFileSync(PAIRS_PATH, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return fresh.length;
}

// Every time findSimilarShapes finds duplicate-shape groups, log them as
// contrastive (text, text, label) pairs -- label 1 for two snippets from the
// SAME AST-shape group, label 0 for snippets from DIFFERENT groups. This is
// exactly the training format sentence-transformers expects for fine-tuning
// an embedding model on "same shape" rather than "same words". Collected as
// a free byproduct of normal use; nothing here trains anything yet.
function recordFromGroups(groups) {
  if (groups.length < 1) return 0;
  const records = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const members = groups[gi].members;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        records.push({
          key: pairKey(members[i].code, members[j].code),
          textA: members[i].code,
          textB: members[j].code,
          label: 1,
          suggestedName: groups[gi].suggestedName,
        });
      }
    }
    if (groups.length > 1) {
      const other = groups[(gi + 1) % groups.length];
      records.push({
        key: pairKey(members[0].code, other.members[0].code),
        textA: members[0].code,
        textB: other.members[0].code,
        label: 0,
      });
    }
  }
  return appendPairs(records);
}

function stats() {
  ensureDir();
  if (!fs.existsSync(PAIRS_PATH)) return { total: 0, positive: 0, negative: 0, sample: [] };
  const lines = fs
    .readFileSync(PAIRS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return {
    total: lines.length,
    positive: lines.filter((l) => l.label === 1).length,
    negative: lines.filter((l) => l.label === 0).length,
    sample: lines.slice(-6),
  };
}

module.exports = { recordFromGroups, stats, PAIRS_PATH };
