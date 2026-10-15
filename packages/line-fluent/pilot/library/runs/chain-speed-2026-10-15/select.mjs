// The test set: the first 15 Array and first 15 String reference entries (reference order) for which the rules build no answer
// (builtAnswers returns none, with the lexicon a fresh run trains from the catalog alone). Writes keys.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOG_PATH, REFERENCE_PATH } from '../../../../generator/generator.mjs';
import { builtAnswers } from '../../../build/build.mjs';
import { corpusFrom, train } from '../../../lexicon/lexicon.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const catalog = readJson(CATALOG_PATH).atoms;
const verbWords = new Set(readJson(new URL('../../../../../line-smith/src/atoms/naming.json', import.meta.url)).grammar.verbs);
const lexicon = train(corpusFrom(catalog, []));
const sections = new Set(['Array', 'String']);
const unbuilt = readJson(REFERENCE_PATH).entries.filter((e) => sections.has(e.section) && !builtAnswers(e, catalog, { lexicon, verbWords }).answers.length);
const keys = ['Array', 'String'].flatMap((s) => unbuilt.filter((e) => e.section === s).slice(0, 15).map((e) => e.key));
writeFileSync(new URL('./keys.json', import.meta.url), `${JSON.stringify(keys, null, 2)}\n`);
console.log(`${unbuilt.length} unbuilt Array/String entries (${unbuilt.filter((e) => e.section === 'String').length} String); took ${keys.length}:`, keys.join(', '));
