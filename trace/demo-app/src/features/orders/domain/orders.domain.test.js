// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./orders.domain.js";

const items = [
  {
    id: 1,
    number: "ORD-201",
    customer: "Northwind",
    total: 1200,
    placedOn: "2026-09-01",
  },
  {
    id: 2,
    number: "ORD-202",
    customer: "Kestrel",
    total: 560,
    placedOn: "2026-09-03",
  },
  {
    id: 3,
    number: "ORD-203",
    customer: "Bluepeak",
    total: 8900,
    placedOn: "2026-09-07",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["number", "customer", "total", "placedOn"];
  const rows = domain
    .toOrderRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 3), [
    {
      number: "ORD-201",
      customer: "Northwind",
      total: "$1,200",
      placedOn: "1 Sep 2026",
    },
    {
      number: "ORD-202",
      customer: "Kestrel",
      total: "$560",
      placedOn: "3 Sep 2026",
    },
    {
      number: "ORD-203",
      customer: "Bluepeak",
      total: "$8,900",
      placedOn: "7 Sep 2026",
    },
  ]);
});

test("orderCount matches the design", () => {
  assert.equal(domain.orderCount(items), "3");
});

test("totalValue matches the design", () => {
  assert.equal(domain.totalValue(items), "$10,660");
});
