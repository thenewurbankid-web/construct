// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./invoices.domain.js";

const items = [
  {
    id: 1,
    number: "INV-1041",
    vendor: "Northwind Freight",
    amount: 18400000,
    outstanding: 18400000,
    dueDate: "2026-08-21",
    requester: "Prerna",
    assignee: "Prerna",
  },
  {
    id: 2,
    number: "INV-1042",
    vendor: "Kestrel Packaging",
    amount: 48200000,
    outstanding: 48200000,
    dueDate: "2026-08-02",
    requester: "Lena",
    assignee: "Lena",
  },
  {
    id: 3,
    number: "INV-1043",
    vendor: "Bluepeak IT",
    amount: 9700000,
    outstanding: 4000000,
    dueDate: "2026-09-05",
    requester: "Arjun",
    assignee: "Arjun",
  },
  {
    id: 4,
    number: "INV-1044",
    vendor: "Oriel Chemicals",
    amount: 31600000,
    outstanding: 31600000,
    dueDate: "2026-08-09",
    requester: "Mia",
    assignee: "Mia",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["number", "vendor", "amount", "dueDate"];
  const rows = domain
    .toInvoiceRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 4), [
    {
      number: "INV-1042",
      vendor: "Kestrel Packaging",
      amount: "$48.2M",
      dueDate: "2 Aug 2026",
    },
    {
      number: "INV-1044",
      vendor: "Oriel Chemicals",
      amount: "$31.6M",
      dueDate: "9 Aug 2026",
    },
    {
      number: "INV-1041",
      vendor: "Northwind Freight",
      amount: "$18.4M",
      dueDate: "21 Aug 2026",
    },
    {
      number: "INV-1043",
      vendor: "Bluepeak IT",
      amount: "$9.7M",
      dueDate: "5 Sep 2026",
    },
  ]);
});

test("invoiceCount matches the design", () => {
  assert.equal(domain.invoiceCount(items), "4");
});

test("totalBilled matches the design", () => {
  assert.equal(domain.totalBilled(items), "$107.9M");
});
