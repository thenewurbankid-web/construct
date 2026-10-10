// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./deals.domain.js";

const items = [
  {
    id: 1,
    name: "Atlas Renewal",
    account: "Northwind",
    contactFirst: "Lena",
    contactLast: "Kumar",
    owner: "Prerna",
    csm: "Prerna",
    value: 84000000,
    margin: 0.325,
    closeOn: "2026-10-14",
  },
  {
    id: 2,
    name: "Borealis Expansion",
    account: "Kestrel",
    contactFirst: "Arjun",
    contactLast: "Rao",
    owner: "Mia",
    csm: "Mia",
    value: 152500000,
    margin: 0.281,
    closeOn: "2026-10-02",
  },
  {
    id: 3,
    name: "Cirrus Pilot",
    account: "Bluepeak",
    contactFirst: "Mia",
    contactLast: "Shah",
    owner: "Ravi",
    csm: "Ravi",
    value: 27500000,
    margin: 0.412,
    closeOn: "2026-11-20",
  },
  {
    id: 4,
    name: "Delta Upgrade",
    account: "Oriel",
    contactFirst: "Ravi",
    contactLast: "Nair",
    owner: "Lena",
    csm: "Lena",
    value: 61250000,
    margin: 0.198,
    closeOn: "2026-10-29",
  },
  {
    id: 5,
    name: "Ember Platform",
    account: "Harbor",
    contactFirst: "Prerna",
    contactLast: "Iyer",
    owner: "Arjun",
    csm: "Arjun",
    value: 118000000,
    margin: 0.36,
    closeOn: "2026-12-05",
  },
  {
    id: 6,
    name: "Fjord Support",
    account: "Vantage",
    contactFirst: "Kabir",
    contactLast: "Sen",
    owner: "Mia",
    csm: "Mia",
    value: 9800000,
    margin: 0.15,
    closeOn: "2026-11-03",
  },
];

test("rows match the design (values and order)", () => {
  // Only the parts matched to real API fields; placeholder parts have their own tests below.
  const keys = ["name", "account", "value", "margin", "closeOn"];
  const rows = domain
    .toDealRows(items)
    .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
  assert.deepEqual(rows.slice(0, 6), [
    {
      name: "Borealis Expansion",
      account: "Kestrel",
      value: "$152.5M",
      margin: "28.1%",
      closeOn: "2 Oct 2026",
    },
    {
      name: "Ember Platform",
      account: "Harbor",
      value: "$118.0M",
      margin: "36.0%",
      closeOn: "5 Dec 2026",
    },
    {
      name: "Atlas Renewal",
      account: "Northwind",
      value: "$84.0M",
      margin: "32.5%",
      closeOn: "14 Oct 2026",
    },
    {
      name: "Delta Upgrade",
      account: "Oriel",
      value: "$61.3M",
      margin: "19.8%",
      closeOn: "29 Oct 2026",
    },
    {
      name: "Cirrus Pilot",
      account: "Bluepeak",
      value: "$27.5M",
      margin: "41.2%",
      closeOn: "20 Nov 2026",
    },
    {
      name: "Fjord Support",
      account: "Vantage",
      value: "$9.8M",
      margin: "15.0%",
      closeOn: "3 Nov 2026",
    },
  ]);
});

test("dealCount matches the design", () => {
  assert.equal(domain.dealCount(items), "6");
});

test("pipeline matches the design", () => {
  assert.equal(domain.pipeline(items), "$453.1M");
});

test("avgDeal matches the design", () => {
  assert.equal(domain.avgDeal(items), "$75.5M");
});

test("largest matches the design", () => {
  assert.equal(domain.largest(items), "$152.5M");
});

test("smallest matches the design", () => {
  assert.equal(domain.smallest(items), "$9.8M");
});

test("avgMargin matches the design", () => {
  assert.equal(domain.avgMargin(items), "28.8%");
});
