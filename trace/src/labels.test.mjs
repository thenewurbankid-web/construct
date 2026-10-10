// designLabels: the design's words for each dynamic part, from the page source alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designLabels } from "./labels.mjs";

const page = (body) => `export default function P() { return (<main>${body}</main>); }`;

test("a value gets its own name and the text right before it", () => {
  const l = designLabels(page(`<p>{" items "}<b data-dyn="itemCount">8</b>{" open "}<b data-dyn="openCount">8</b>{" largest open "}<b data-dyn="topOpen">$7.5M</b></p>`));
  assert.deepEqual(l.values.openCount, { name: "openCount", inline: "open", label: "" });
  assert.equal(l.values.topOpen.inline, "largest open");
  assert.equal(l.values.itemCount.inline, "items");
});

test("inline text is the last three words only", () => {
  const l = designLabels(page(`<p>{"Savings raised but not yet accepted, oldest waiting "}<b data-dyn="days">9</b></p>`));
  assert.equal(l.values.days.inline, "accepted, oldest waiting");
  const l2 = designLabels(page(`<p>{"one two three four five "}<b data-dyn="n">9</b></p>`));
  assert.equal(l2.values.n.inline, "three four five");
});

test("a card label above the value is found through the value's wrapper", () => {
  const l = designLabels(page(`<div><p className="label">Categories covered</p><p className="big"><span data-dyn="coveredCount">21</span></p></div>`));
  assert.equal(l.values.coveredCount.label, "Categories covered");
});

test("another data part in between is not this part's label", () => {
  const l = designLabels(page(`<div><p className="label">Savings <b data-dyn="a">1</b></p><p><b data-dyn="b">2</b></p></div>`));
  assert.equal(l.values.b.label, "");
});

test("a list column gets the header above its cell; the first header is the row noun", () => {
  const l = designLabels(page(`<table><thead><tr><th>Project</th><th>Owner</th><th></th></tr></thead><tbody data-list="roster"><tr><td data-dyn="name">A</td><td><span data-dyn="lead">Bo</span></td><td><button data-action="edit">Edit</button></td></tr></tbody></table>`));
  assert.equal(l.fields.name.header, "Project");
  assert.equal(l.fields.lead.header, "Owner");
  assert.deepEqual(l.list, { name: "roster", header: "Project" });
  assert.deepEqual(Object.keys(l.values), []);
});

test("values inside the list are fields, not values; a page with no list has no list labels", () => {
  const l = designLabels(page(`<b data-dyn="x">1</b>`));
  assert.deepEqual(l.list, { name: "", header: "" });
  assert.deepEqual(Object.keys(l.fields), []);
  assert.deepEqual(Object.keys(l.values), ["x"]);
});

test("it is deterministic, and TSX pages parse too", () => {
  const src = `export default function P(): JSX.Element { return (<div><p>Total</p><b data-dyn="t">3</b></div>); }`;
  assert.deepEqual(designLabels(src), designLabels(src));
  assert.equal(designLabels(src).values.t.label, "Total");
});
