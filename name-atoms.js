#!/usr/bin/env node
// No-LLM naming mode: finds duplicate-shape methods across arbitrary
// glob-matched files (pure AST comparison, same shapeFingerprint logic as
// module-scanner.js) and prompts YOU for a name instead of asking a model.
// This only covers "two methods already have the same shape" -- it cannot
// decide where to split a single multi-concern method, since there's
// nothing to compare a first occurrence against. That half still needs a
// human (or an LLM) to actually do the split.
const fs = require('fs');
const readline = require('readline');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generate = require('@babel/generator').default;

function shapeFingerprint(code) {
  // extends __Base__ so a constructor's super() call parses in isolation --
  // this class is never resolved/run, only parsed, so it doesn't need to exist.
  const ast = parser.parse(`class __W__ extends __Base__ {\n${code}\n}`, { sourceType: 'module', plugins: ['typescript'] });
  traverse(ast, {
    Identifier(path) {
      path.node.name = 'id';
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

function findMethods(files) {
  const methods = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript'] });
    } catch (e) {
      console.error(`Skipping ${file} (parse error): ${e.message}`);
      continue;
    }
    traverse(ast, {
      ClassMethod(path) {
        const node = path.node;
        methods.push({
          file,
          className: path.parentPath.parent.id ? path.parentPath.parent.id.name : '(anonymous)',
          name: node.key.name || '(computed)',
          code: code.slice(node.start, node.end),
        });
      },
    });
  }
  return methods;
}

function groupByShape(methods) {
  const fingerprints = methods.map((m) => shapeFingerprint(m.code));
  const groups = [];
  const used = new Set();
  for (let i = 0; i < methods.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < methods.length; j++) {
      if (used.has(j)) continue;
      if (fingerprints[i] === fingerprints[j]) group.push(j);
    }
    if (group.length > 1) {
      group.forEach((k) => used.add(k));
      groups.push(group.map((k) => methods[k]));
    }
  }
  return groups;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const patterns = process.argv.slice(2);
  if (!patterns.length) {
    console.error('Usage: node name-atoms.js <glob...>');
    process.exit(1);
  }

  const files = new Set();
  for (const pattern of patterns) {
    for (const f of fs.globSync(pattern, { cwd: process.cwd() })) {
      if (fs.statSync(f).isFile()) files.add(f);
    }
  }

  const methods = findMethods([...files]);
  const groups = groupByShape(methods);

  if (!groups.length) {
    console.log(`No duplicate shapes found across ${files.size} file(s).`);
    return;
  }

  console.log(`Found ${groups.length} duplicate-shape group(s) across ${files.size} file(s).\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const results = [];

  for (const group of groups) {
    console.log('---');
    group.forEach((m) => console.log(`// ${m.className}.${m.name} (${m.file})\n${m.code}\n`));
    const name = await ask(rl, 'Name for this shared method (blank to skip): ');
    if (name.trim()) {
      results.push({ name: name.trim(), members: group.map((m) => `${m.className}.${m.name} (${m.file})`) });
    }
  }
  rl.close();

  console.log('\n=== Summary ===');
  results.forEach((r) => {
    console.log(`${r.name}:`);
    r.members.forEach((m) => console.log(`  - ${m}`));
  });
  if (!results.length) console.log('(nothing named)');
}

main();
