// Prototype "logic map" block: every decision, effect, data call, navigation and handler in a route's files,
// each with a stable id (file#function:kind:n) so an import can be checked unit by unit.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/shashank/Repositories/construct/package.json');
const ts = require('typescript');
const [app, listFile, outFile] = process.argv.slice(2);
const files = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
const units = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(app, rel), 'utf8');
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const counters = {};
  const fnStack = [];
  const nameOf = (n) => (n.name && n.name.getText?.(sf)) || (ts.isVariableDeclaration(n.parent) ? n.parent.name.getText(sf) : ts.isPropertyAssignment(n.parent) ? n.parent.name.getText(sf) : ts.isJsxExpression(n.parent) && ts.isJsxAttribute(n.parent.parent) ? `on:${n.parent.parent.name.getText(sf)}` : '<anon>');
  const add = (kind, node, detail) => {
    const fn = fnStack.filter((x) => x !== '<anon>').at(-1) ?? '<module>';
    const key = `${rel}#${fn}:${kind}`; counters[key] = (counters[key] ?? 0) + 1;
    units.push({ id: `${key}:${counters[key]}`, file: rel, fn, kind, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, detail: detail.replace(/\s+/g, ' ').slice(0, 140) });
  };
  const visit = (node) => {
    const isFn = ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
    if (isFn) fnStack.push(nameOf(node));
    if (ts.isIfStatement(node)) add('branch', node, `if (${node.expression.getText(sf)})`);
    else if (ts.isConditionalExpression(node)) add('branch', node, `${node.condition.getText(sf)} ? …`);
    else if (ts.isSwitchStatement(node)) node.caseBlock.clauses.forEach((c) => add('branch', c, `case ${ts.isCaseClause(c) ? c.expression.getText(sf) : 'default'}`));
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind) && (ts.isJsxExpression(node.parent) || ts.isParenthesizedExpression(node.parent) && ts.isJsxExpression(node.parent.parent))) add('render-if', node, node.left.getText(sf));
    else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const arg0 = node.arguments[0]?.getText(sf) ?? '';
      if (/^use(State|Reducer)$/.test(callee)) add('state', node, `${ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : ''} = ${callee}(${arg0.slice(0, 60)})`);
      else if (/^use(Effect|LayoutEffect)$/.test(callee)) add('effect', node, `deps ${node.arguments[1]?.getText(sf) ?? 'none'}`);
      else if (/^use(Memo|Callback)$/.test(callee)) add('derived', node, `deps ${node.arguments[1]?.getText(sf) ?? ''}`);
      else if (/^use\w+(Query|Mutation)$/.test(callee)) add('data', node, `${callee}(${arg0.slice(0, 80)})`);
      else if (/router\.(push|replace|back|refresh)|\.set\(|URLSearchParams|searchParams\.get/.test(callee + (callee.includes('searchParams') ? '' : ''))) add('navigation', node, `${callee}(${arg0.slice(0, 80)})`);
      else if (/searchParams\.get|params\.get/.test(callee)) add('url-read', node, `${callee}(${arg0})`);
      else if (/(analyticsService|matomo|track)/.test(callee)) add('analytics', node, `${callee}(${arg0.slice(0, 60)})`);
      else if (/maxToast|toast/.test(callee)) add('toast', node, `${callee}(${arg0.slice(0, 60)})`);
      else if (/localStorage|sessionStorage/.test(callee)) add('storage', node, `${callee}(${arg0.slice(0, 60)})`);
      else if (/\b(fetch|axios)\b/.test(callee)) add('io', node, `${callee}(${arg0.slice(0, 60)})`);
    } else if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(sf)) && node.initializer) add('handler', node, `${node.name.getText(sf)}=${node.initializer.getText(sf).slice(0, 80)}`);
    else if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) add('export', node, ts.isFunctionDeclaration(node) ? `function ${node.name?.getText(sf)}` : node.declarationList.declarations.map((d) => d.name.getText(sf)).join(','));
    ts.forEachChild(node, visit);
    if (isFn) fnStack.pop();
  };
  visit(sf);
}
fs.writeFileSync(outFile, units.map((u) => JSON.stringify(u)).join('\n') + '\n');
const by = (k) => units.reduce((m, u) => ((m[u[k]] = (m[u[k]] ?? 0) + 1), m), {});
console.log('units', units.length); console.log(by('kind')); console.log(Object.entries(by('file')).map(([f, n]) => `${n}\t${f.split('/').pop()}`).join('\n'));
