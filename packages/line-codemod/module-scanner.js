const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generate = require('@babel/generator').default;

// "Depth" here = usage count: how many concrete (leaf) organism/tissue classes
// end up with this atom, whether by inheriting it or by being the class it's
// defined on directly. Widely-shared atoms (will/and/if/is) score high;
// tissue-specific methods (text()/equalTo()) score 1.
function scanModules(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const classes = {};

  for (const file of files) {
    const filePath = path.join(dir, file);
    const code = fs.readFileSync(filePath, 'utf8');
    const ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript'] });

    traverse(ast, {
      ClassDeclaration(path) {
        const node = path.node;
        if (!node.id) return;
        const name = node.id.name;
        const superClass = node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null;
        const methods = node.body.body
          .filter((m) => m.type === 'ClassMethod' && m.kind === 'method')
          .map((m) => ({
            name: m.key.name,
            code: code.slice(m.start, m.end),
          }));
        classes[name] = { superClass, methods, file };
      },
    });
  }

  const children = {};
  for (const name of Object.keys(classes)) children[name] = [];
  for (const [name, info] of Object.entries(classes)) {
    if (info.superClass && classes[info.superClass]) {
      children[info.superClass].push(name);
    }
  }

  function leafDescendants(name, seen) {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const kids = children[name] || [];
    if (kids.length === 0) return new Set([name]);
    const result = new Set();
    for (const kid of kids) {
      for (const leaf of leafDescendants(kid, seen)) result.add(leaf);
    }
    return result;
  }

  const atoms = [];
  for (const [name, info] of Object.entries(classes)) {
    const usageCount = leafDescendants(name, new Set()).size;
    for (const method of info.methods) {
      atoms.push({ name: method.name, code: method.code, definedIn: name, file: info.file, usageCount });
    }
  }

  atoms.sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
  return atoms;
}

// A method's "shape" = its control-flow skeleton with every identifier and
// literal blanked out. Two methods with the same shape but different names/
// literals/types produce the exact same fingerprint string. This used to be
// done with embeddings (nomic-embed-text), but that measures semantic/word
// similarity, not structural similarity: resultFor() in TextCheck vs
// FieldCheck scored only 0.76 despite being the identical if/else shape,
// because the embedding model reacted to 'valid'/'invalid' vs
// 'static'/'dynamic' being different words. AST comparison doesn't have that
// problem and needs no model call at all.
function shapeFingerprint(code) {
  const ast = parser.parse(`class __W__ {\n${code}\n}`, { sourceType: 'module', plugins: ['typescript'] });
  traverse(ast, {
    Identifier(path) {
      path.node.name = 'id';
    },
    PrivateName(path) {
      path.node.id.name = 'id';
    },
    StringLiteral(path) {
      path.node.value = 'str';
      path.node.extra = undefined;
    },
    NumericLiteral(path) {
      path.node.value = 0;
      path.node.extra = undefined;
    },
    TSTypeReference(path) {
      path.node.typeName = t.identifier('T');
    },
  });
  return generate(ast, { retainLines: false, compact: true }).code;
}

// Two methods with usageCount 1 (not yet sharing a base class) can still be
// the same shape written twice in different classes -- e.g. resultFor() in
// TextCheck and FieldCheck. Detection is pure AST comparison, no model
// involved; the local model is used for exactly one thing below: naming the
// shared method once a duplicate group is already found deterministically.
async function findSimilarShapes(atoms, ollamaUrl, model) {
  const candidates = atoms.filter((a) => a.usageCount === 1);
  const fingerprints = candidates.map((a) => shapeFingerprint(a.code));

  const groups = [];
  const used = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      if (fingerprints[i] === fingerprints[j]) group.push(j);
    }
    if (group.length > 1) {
      group.forEach((k) => used.add(k));
      groups.push(group);
    }
  }

  const results = [];
  for (const group of groups) {
    const members = group.map((i) => candidates[i]);
    const suggestedName = await suggestName(members, ollamaUrl, model);
    results.push({ suggestedName, members });
  }
  return results;
}

async function suggestName(members, ollamaUrl, model) {
  const prompt = `These methods, from different classes, have the same shape (same structure, different literal values):\n\n${members
    .map((m) => `// from ${m.definedIn} (${m.file})\n${m.code}`)
    .join('\n\n')}\n\nSuggest ONE short camelCase method name for a shared base-class version of this. Reply with ONLY the identifier, nothing else.`;

  try {
    const r = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_ctx: 1024, num_predict: 20 },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    const candidate = (data.message?.content || '').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
    if (/^[a-z][a-zA-Z0-9]*$/.test(candidate)) return candidate;
  } catch {
    // fall through to the deterministic fallback below
  }
  return members[0].name;
}

module.exports = { scanModules, findSimilarShapes };
