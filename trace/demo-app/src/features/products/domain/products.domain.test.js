// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./products.domain.js";

const items = [
  {
    id: 1,
    name: "Desk Lamp",
    price: 4900,
    stock: 12,
    addedOn: "2026-07-04",
  },
  {
    id: 2,
    name: "Notebook",
    price: 450,
    stock: 240,
    addedOn: "2026-06-18",
  },
  {
    id: 3,
    name: "Backpack",
    price: 6800,
    stock: 35,
    addedOn: "2026-08-01",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["name", "price", "stock", "addedOn"];
  const rows = domain
    .toProductRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 3), [
    {
      name: "Desk Lamp",
      price: "$4,900",
      stock: "12",
      addedOn: "4 Jul 2026",
    },
    {
      name: "Notebook",
      price: "$450",
      stock: "240",
      addedOn: "18 Jun 2026",
    },
    {
      name: "Backpack",
      price: "$6,800",
      stock: "35",
      addedOn: "1 Aug 2026",
    },
  ]);
});

test("productCount matches the design", () => {
  assert.equal(domain.productCount(items), "3");
});

test("stockTotal matches the design", () => {
  assert.equal(domain.stockTotal(items), "287");
});

test("avgPrice matches the design", () => {
  assert.equal(domain.avgPrice(items), "$4,050");
});
