// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./orgs-items.domain.js";

const items = [
  {
    id: 1,
    name: "Pallet Jack",
    sku: "PJ-100",
    qty: 6,
  },
  {
    id: 2,
    name: "Shrink Wrap",
    sku: "SW-220",
    qty: 48,
  },
  {
    id: 3,
    name: "Barcode Scanner",
    sku: "BS-310",
    qty: 15,
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["name", "sku", "qty"];
  const rows = domain
    .toOrgsItemRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 3), [
    {
      name: "Pallet Jack",
      sku: "PJ-100",
      qty: "6",
    },
    {
      name: "Shrink Wrap",
      sku: "SW-220",
      qty: "48",
    },
    {
      name: "Barcode Scanner",
      sku: "BS-310",
      qty: "15",
    },
  ]);
});

test("itemCount matches the design", () => {
  assert.equal(domain.itemCount(items), "3");
});

test("qtyTotal matches the design", () => {
  assert.equal(domain.qtyTotal(items), "69");
});
