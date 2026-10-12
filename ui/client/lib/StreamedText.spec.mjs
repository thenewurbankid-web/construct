// lib/StreamedText.tsx's rendering, through the real flowtoken (AnimatedMarkdown) and the sanitizer it is always given:
// whitelisted tags render the screen's components, an unknown tag or a script renders as text, and with reduced motion
// (animation null) the words are not animated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sanitizeStream } from './streamedTextTags.ts';

const require = createRequire(import.meta.url);
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AnimatedMarkdown } = require('flowtoken');

const card = (p) => createElement('button', { 'data-card': p.name }, `Open ${p.name}`);
const render = (text, { animation = null } = {}) =>
  renderToStaticMarkup(createElement(AnimatedMarkdown, { content: sanitizeStream(text, ['ProjectCard']), animation, sep: 'word', customComponents: { projectcard: card } }));

test('a whitelisted tag renders our component', () => {
  const html = render('Here are your projects: <ProjectCard name="shop"/> <ProjectCard name="notes"/> One click opens one.');
  assert.match(html, /<button data-card="shop">Open shop<\/button>/);
  assert.match(html, /<button data-card="notes">Open notes<\/button>/);
  assert.match(html, /Here are your projects:.*One click opens one\./);
});

test('an unknown tag, raw HTML or a script renders as text, never as an element', () => {
  const html = render('Before <script>alert(1)</script> <img src=x onerror="alert(1)"> <Unknown a="b"/> <OptionChips ids="x"/> after.');
  assert.doesNotMatch(html, /<script|<img|<unknown|<optionchips/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;Unknown a=&quot;b&quot;\/&gt;/);
});

test('animated, the words are split for the fade; with reduced motion they are plain text', () => {
  assert.match(render('Fade these words in.', { animation: 'fadeIn' }), /ft-fadeIn|animation/);
  assert.equal(render('Plain words.'), '<p>Plain words.</p>');
});
