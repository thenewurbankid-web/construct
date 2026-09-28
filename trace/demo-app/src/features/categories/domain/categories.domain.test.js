// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./categories.domain.js";

const items = [
  {
    id: 1,
    name: "Logistics",
    spend: 78400000,
    owner: "Prerna",
  },
  {
    id: 2,
    name: "Packaging",
    spend: 62800000,
    owner: "Arjun",
  },
  {
    id: 3,
    name: "IT Services",
    spend: 45200000,
    owner: "Mia",
  },
  {
    id: 4,
    name: "Grains & Cereals",
    spend: 91600000,
    owner: "Lena",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["name", "spend", "owner"];
  const rows = domain
    .toCategoryRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 4), [
    {
      name: "Grains & Cereals",
      spend: "$91.6M",
      owner: "Lena",
    },
    {
      name: "Logistics",
      spend: "$78.4M",
      owner: "Prerna",
    },
    {
      name: "Packaging",
      spend: "$62.8M",
      owner: "Arjun",
    },
    {
      name: "IT Services",
      spend: "$45.2M",
      owner: "Mia",
    },
  ]);
});

test("categoryCount matches the design", () => {
  assert.equal(domain.categoryCount(items), "4");
});

test("totalSpend matches the design", () => {
  assert.equal(domain.totalSpend(items), "$278.0M");
});

test("largestSpend matches the design", () => {
  assert.equal(domain.largestSpend(items), "$91.6M");
});
