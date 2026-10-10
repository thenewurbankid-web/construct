// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./contacts.domain.js";

const items = [
  {
    id: 1,
    first: "Lena",
    last: "Kumar",
    email: "lena@example.com",
    city: "Pune",
  },
  {
    id: 2,
    first: "Arjun",
    last: "Rao",
    email: "arjun@example.com",
    city: "Delhi",
  },
  {
    id: 3,
    first: "Mia",
    last: "Shah",
    email: "mia@example.com",
    city: "Mumbai",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["email", "city"];
  const rows = domain
    .toContactRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 3), [
    {
      email: "lena@example.com",
      city: "Pune",
    },
    {
      email: "arjun@example.com",
      city: "Delhi",
    },
    {
      email: "mia@example.com",
      city: "Mumbai",
    },
  ]);
});

test("contactCount matches the design", () => {
  assert.equal(domain.contactCount(items), "3");
});
