// A part's expected data type (LIN-90 §4.4): read deterministically from the design side, never guessed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extract } from "../extract.mjs";
import { match } from "../match.mjs";
import { dataTypeOf, formDataType, buildTree } from "./model.mjs";

test("dataTypeOf reads a design example's own shape: numeric-looking, boolean words, else text", () => {
  assert.equal(dataTypeOf("72"), "number");
  assert.equal(dataTypeOf("$3.2M"), "number");
  assert.equal(dataTypeOf("32.7%"), "number");
  assert.equal(dataTypeOf("-4"), "number");
  assert.equal(dataTypeOf("true"), "boolean");
  assert.equal(dataTypeOf("No"), "boolean");
  assert.equal(dataTypeOf("Fjord"), "string");
  assert.equal(dataTypeOf(""), null);
  assert.equal(dataTypeOf(undefined), null);
});

test("formDataType reads an input's own type attribute, not its example text", () => {
  assert.equal(formDataType("number"), "number");
  assert.equal(formDataType("checkbox"), "boolean");
  assert.equal(formDataType("radio"), "boolean");
  assert.equal(formDataType("email"), "string");
  assert.equal(formDataType("text"), "string");
  assert.equal(formDataType(undefined), "string");
});

const orders = [{ id: 1, name: "Fjord", balance: 7470000 }, { id: 2, name: "Tundra", balance: 2500000 }];
const apis = [{ method: "GET", path: "/api/orders", response: orders }];
const row = (o) => `<tr><td data-dyn="name">${o.name}</td></tr>`;
const page = `export default function P() { return (<main>
  <p>{" total "}<span data-dyn="total">$9.97M</span></p>
  <table><tbody data-list="orders">${orders.map(row).join("")}</tbody></table>
</main>); }`;
const spec = { feature: "orders", route: "/orders", page: "page.jsx", apis };

test("buildTree attaches the design's own inferred type to a value and a list field's design cell", () => {
  const m = match(extract(page), spec);
  const tree = buildTree(m, spec);
  const leaves = tree.groups.flatMap((g) => g.leaves);
  assert.equal(leaves.find((l) => l.id === "value.total").cells[0].dataType, "number");
  assert.equal(leaves.find((l) => l.id === "list.name").cells[0].dataType, "string");
});
