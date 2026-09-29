const synonyms = require('./synonyms.json');

// LIN-119 block 8: local, tiered autosuggest for the words a user types into
// a step (block 7's "+ word" input). Entirely deterministic and offline --
// no LLM, no network call -- so it stays fast (well under the ~20ms/keystroke
// budget) and the UI can rely on it being available even when Ollama isn't
// running. Tier 3 (embedding similarity) from the spec is NOT implemented
// here: the spec itself requires the UI work fully with it off, and wiring
// it in means an Ollama round trip per keystroke, which the budget above
// rules out anyway -- flagging as deferred rather than bolting on something
// that would violate the same latency goal it's meant to serve.

function tokenize(s) {
  return (String(s).toLowerCase().match(/[a-z0-9']+/g) || []);
}

// Same splitting rule to-english.js's camelToWords uses, duplicated locally
// so this module has no dependency on the AST-handling half of the codebase.
function camelToWords(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

// Crude suffix-stripping stemmer -- enough to fold validate/validating/
// validation and remove/removed/removes onto a shared stem without a
// dependency. Longest suffix first so "ization" doesn't leave "-tion" behind.
const SUFFIXES = ['izations', 'ization', 'ications', 'ication', 'ations', 'ation', 'ating', 'edly', 'tion', 'ing', 'ed', 'es', 's'];
function stem(word) {
  for (const suf of SUFFIXES) {
    if (word.length - suf.length >= 3 && word.endsWith(suf)) return word.slice(0, -suf.length);
  }
  return word;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function synonymGroupsOf(word) {
  return synonyms.groups.filter((g) => g.includes(word));
}

// Tier 1 (lexical) then tier 2 (stemming + synonyms) for a single word pair.
// Returns the BEST match found, tier 1 preferred over tier 2 at equal words.
function wordMatch(qWord, cWord) {
  if (qWord === cWord) return { tier: 1, score: 1, reason: 'exact' };
  if (qWord.length >= 2 && cWord.length >= 2 && cWord.startsWith(qWord)) return { tier: 1, score: 0.9, reason: 'prefix' };
  if (qWord.length >= 2 && cWord.length >= 2) {
    const maxDist = qWord.length <= 4 ? 1 : 2;
    if (levenshtein(qWord, cWord) <= maxDist) return { tier: 1, score: 0.7, reason: 'fuzzy match' };
  }
  const qStem = stem(qWord);
  const cStem = stem(cWord);
  if (qStem.length >= 3 && qStem === cStem) return { tier: 2, score: 0.6, reason: `stem of "${cWord}"` };
  const qGroups = synonymGroupsOf(qWord);
  if (qGroups.some((g) => g.includes(cWord))) return { tier: 2, score: 0.55, reason: `synonym of "${cWord}"` };
  return null;
}

// Phrase-level synonyms ("number of" <-> "how many") can't be found word by
// word since neither side shares a word with the other. Checked as whole
// substrings of the typed text and the candidate text.
function phraseSynonymMatch(queryText, candidateText) {
  const q = ` ${queryText.toLowerCase()} `;
  const c = ` ${candidateText.toLowerCase()} `;
  for (const group of synonyms.groups) {
    const qHit = group.find((p) => p.includes(' ') && q.includes(` ${p} `));
    const cHit = group.find((p) => c.includes(` ${p} `));
    if (qHit && cHit && qHit !== cHit) return { score: 0.65, reason: `synonym of "${cHit}"` };
  }
  return null;
}

// How well `candidateText` matches the typed `queryText`: every query word
// is matched against its best-scoring word in the candidate; words that
// don't match at all drop coverage. A candidate needs at least half its
// query words matched to be considered a hit at all.
function scoreCandidate(queryText, candidateText) {
  const qWords = tokenize(queryText);
  const cWords = tokenize(candidateText);
  if (!qWords.length || !cWords.length) return null;

  // The candidate's overall tier is the WORST (highest) tier any matched
  // word needed -- a query that's half exact-match and half synonym-match
  // is a tier-2 match overall, not tier 1, since a synonym lookup is what
  // made the difference.
  let totalScore = 0;
  let matchedCount = 0;
  let worstTier = 0;
  let reason = null;
  for (const qw of qWords) {
    let best = null;
    for (const cw of cWords) {
      const m = wordMatch(qw, cw);
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best) {
      matchedCount++;
      totalScore += best.score;
      if (best.tier > worstTier) { worstTier = best.tier; reason = best.reason; }
      else if (!reason) reason = best.reason;
    }
  }

  const phraseHit = phraseSynonymMatch(queryText, candidateText);
  if (phraseHit && matchedCount < qWords.length) {
    matchedCount = qWords.length;
    totalScore += phraseHit.score;
    if (2 > worstTier) { worstTier = 2; reason = phraseHit.reason; }
  }

  if (matchedCount === 0) return null;
  const coverage = matchedCount / qWords.length;
  if (coverage < 0.5) return null;
  return { score: (totalScore / qWords.length) * coverage, tier: worstTier, reason };
}

// Ranks candidates for the typed `query`: registered atoms (matched on
// their stored English, falling back to their camelCase name split into
// words), in-scope identifiers (matched on their camelCase split), and
// connectives. Type/arity-compatible + in-scope candidates sort first (all
// of the above already are, by construction -- callers only pass in atoms
// of the right kind and identifiers actually in scope at this step), then
// by score. The last item is always "add implementation" for whatever was
// typed, the same fallback block 7 already wires up when nothing resolves.
function suggest(query, { atoms = [], identifiers = [], connectives = ['and', 'then', 'or'] } = {}, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const results = [];
  for (const atom of atoms) {
    const label = atom.english || camelToWords(atom.name);
    const m = scoreCandidate(q, label);
    if (m) results.push({ text: atom.name, label, kind: 'atom', ...m });
  }
  for (const id of identifiers) {
    const label = camelToWords(id);
    const m = scoreCandidate(q, label) || scoreCandidate(q, id);
    if (m) results.push({ text: id, label: id, kind: 'identifier', ...m });
  }
  for (const c of connectives) {
    const m = scoreCandidate(q, c);
    if (m) results.push({ text: c, label: c, kind: 'connective', ...m });
  }

  results.sort((a, b) => b.score - a.score);

  const limit = opts.limit || 8;
  const top = results.slice(0, limit);
  top.push({ text: q, label: `Add implementation for "${q}"`, kind: 'add-implementation' });
  return top;
}

module.exports = {
  tokenize,
  camelToWords,
  stem,
  levenshtein,
  wordMatch,
  phraseSynonymMatch,
  scoreCandidate,
  suggest,
};
