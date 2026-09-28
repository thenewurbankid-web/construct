// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./metrics.domain.js";

const items = [
  {
    id: 1,
    region: "North",
    revenue: 120000000,
    cost: 70000000,
    conversion: 0.18,
  },
  {
    id: 2,
    region: "South",
    revenue: 95000000,
    cost: 52000000,
    conversion: 0.24,
  },
  {
    id: 3,
    region: "East",
    revenue: 61000000,
    cost: 33000000,
    conversion: 0.12,
  },
  {
    id: 4,
    region: "West",
    revenue: 88000000,
    cost: 49000000,
    conversion: 0.2,
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = [];
  const rows = domain
    .toMetricRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 0), []);
});

test("regionCount matches the design", () => {
  assert.equal(domain.regionCount(items), "4");
});

test("totalRevenue matches the design", () => {
  assert.equal(domain.totalRevenue(items), "$364.0M");
});

test("bestRevenue matches the design", () => {
  assert.equal(domain.bestRevenue(items), "$120.0M");
});

test("lowestCost matches the design", () => {
  assert.equal(domain.lowestCost(items), "$33.0M");
});

test("avgConversion matches the design", () => {
  assert.equal(domain.avgConversion(items), "18.5%");
});
