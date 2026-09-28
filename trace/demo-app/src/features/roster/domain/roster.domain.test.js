// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./roster.domain.js";

const items = [
  {
    id: 1,
    project: "Apollo",
    lead: "Lena",
    deputy: "Lena",
    budget: 120000,
    forecast: 120000,
  },
  {
    id: 2,
    project: "Borealis",
    lead: "Arjun",
    deputy: "Arjun",
    budget: 80000,
    forecast: 80000,
  },
  {
    id: 3,
    project: "Cirrus",
    lead: "Mia",
    deputy: "Mia",
    budget: 45000,
    forecast: 45000,
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["project"];
  const rows = domain
    .toRosterRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 3), [
    {
      project: "Apollo",
    },
    {
      project: "Borealis",
    },
    {
      project: "Cirrus",
    },
  ]);
});

test("projectCount matches the design", () => {
  assert.equal(domain.projectCount(items), "3");
});

test("plannedTotal matches the design", () => {
  assert.equal(domain.plannedTotal(items), "$245.0K");
});

test("forecastTotal matches the design", () => {
  assert.equal(domain.forecastTotal(items), "$245.0K");
});
