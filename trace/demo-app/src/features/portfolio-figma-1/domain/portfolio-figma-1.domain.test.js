// Generated from the design + mock API. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as domain from "./portfolio-figma-1.domain.js";

const items = [
  {
    beroe_l2_id: "3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01",
    display_name: "Grains & Cereals",
    spend: {
      value: 91600000,
      pct_of_total: 0.327,
    },
    maturity_score: 58,
    savings_potential: 3200000,
    risk_score: 72,
    spend_trend: {
      prev_value: 88500000,
      curr_value: 91600000,
      delta_pct: 0.035,
    },
    deep_link: "/category-health/categories/3c1e7d20-5f0a-4b6c-8d11-0a9e2f7b4c01/summary",
  },
  {
    beroe_l2_id: "7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02",
    display_name: "Packaging",
    spend: {
      value: 62800000,
      pct_of_total: 0.224,
    },
    maturity_score: 36,
    savings_potential: 7100000,
    risk_score: 69,
    spend_trend: {
      prev_value: 64900000,
      curr_value: 62800000,
      delta_pct: -0.032,
    },
    deep_link: "/category-health/categories/7a52b8e4-1d3f-4c90-a6b2-5e8d0c1f9a02/summary",
  },
  {
    beroe_l2_id: "9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03",
    display_name: "IT Services",
    spend: {
      value: 45200000,
      pct_of_total: 0.161,
    },
    maturity_score: 42,
    savings_potential: 4200000,
    risk_score: 67,
    spend_trend: {
      prev_value: 44000000,
      curr_value: 45200000,
      delta_pct: 0.027,
    },
    deep_link: "/category-health/categories/9d04c6f1-2b7e-4a35-b8c0-3f6a1e5d7b03/summary",
  },
  {
    beroe_l2_id: "b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04",
    display_name: "Logistics",
    spend: {
      value: 38400000,
      pct_of_total: 0.137,
    },
    maturity_score: 40,
    savings_potential: 5600000,
    risk_score: 72,
    spend_trend: {
      prev_value: 33300000,
      curr_value: 38400000,
      delta_pct: 0.153,
    },
    deep_link: "/category-health/categories/b8e19a03-6c4d-4f27-9e50-1d2c7a8f3b04/summary",
  },
  {
    beroe_l2_id: "e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05",
    display_name: "Professional Services",
    spend: {
      value: 27300000,
      pct_of_total: 0.097,
    },
    maturity_score: 46,
    savings_potential: 2900000,
    risk_score: 59,
    spend_trend: {
      prev_value: 27300000,
      curr_value: 27300000,
      delta_pct: 0,
    },
    deep_link: "/category-health/categories/e2f7d5b6-8a01-4c39-b74e-6a0d9c3e1f05/summary",
  },
  {
    beroe_l2_id: "0f6b3a97-4e2c-4d81-a5f3-7c9e1b8d2a06",
    display_name: "MRO",
    spend: {
      value: 14900000,
      pct_of_total: 0.053,
    },
    maturity_score: 44,
    savings_potential: 1400000,
    risk_score: 84,
    spend_trend: {
      prev_value: 9800000,
      curr_value: 14900000,
      delta_pct: 0.52,
    },
    deep_link: "/category-health/categories/0f6b3a97-4e2c-4d81-a5f3-7c9e1b8d2a06/summary",
  },
];
const data = {
  meta: {
    user_id: "u-1042",
    org_id: "org-7",
    snapshot_date: "2026-07-31T10:00:00Z",
  },
  narrative: {
    cross_l2_summary: "Grains is carrying your portfolio. Logistics and Packaging are not.",
  },
  portfolio_at_a_glance: {
    spend_you_manage: 280200000,
    largest_category: {
      display_name: "Grains & Cereals",
      share_of_portfolio: 0.327,
    },
    savings_potential: {
      value: 24500000,
      pct_of_spend: 0.087,
      qualified_accepted_pct: 0.38,
    },
    resilience_initiatives: {
      total: 21,
      by_impact: {
        high: 7,
        medium: 13,
        low: 1,
      },
    },
    waiting_on_decision: {
      savings_count: 26,
      resilience_count: 6,
      note: "counts only, no monetary value",
    },
  },
};

test(
  "rows match the design (values and order)",
  { todo: "row order is not resolved yet — see the open items" },
  () => {
    // Only the parts matched to real API fields; placeholder parts have their own tests below.
    const keys = ["name", "share", "savings"];
    const rows = domain
      .toPortfolioFigma1Rows(items)
      .map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
    assert.deepEqual(rows.slice(0, 6), [
      {
        name: "Logistics",
        share: "13.7%",
        savings: "$5.6M",
      },
      {
        name: "Packaging",
        share: "22.4%",
        savings: "$7.1M",
      },
      {
        name: "IT Services",
        share: "16.1%",
        savings: "$4.2M",
      },
      {
        name: "Professional Services",
        share: "9.7%",
        savings: "$2.9M",
      },
      {
        name: "MRO",
        share: "5.3%",
        savings: "$1.4M",
      },
      {
        name: "Grains & Cereals",
        share: "32.7%",
        savings: "$3.2M",
      },
    ]);
  },
);

test("spendYouManage matches the design", () => {
  assert.equal(domain.spendYouManage(data), "$280.2M");
});

test("refreshedAt matches the design", () => {
  assert.equal(domain.refreshedAt(data), "31 Jul 2026");
});

test("headline matches the design", () => {
  assert.equal(
    domain.headline(data),
    "Grains is carrying your portfolio. Logistics and Packaging are not.",
  );
});

test("largestName matches the design", () => {
  assert.equal(domain.largestName(data), "Grains & Cereals");
});

test("largestShare matches the design", () => {
  assert.equal(domain.largestShare(data), "33%");
});

test("savingsCard matches the design", () => {
  assert.equal(domain.savingsCard(data), "$24.5M");
});

test("acceptedPct matches the design", () => {
  assert.equal(domain.acceptedPct(data), "38%");
});

test("resilienceTotal matches the design", () => {
  assert.equal(domain.resilienceTotal(data), "21");
});

test("impactHigh matches the design", () => {
  assert.equal(domain.impactHigh(data), "7");
});

test("impactMedium matches the design", () => {
  assert.equal(domain.impactMedium(data), "13");
});

test("impactLow matches the design", () => {
  assert.equal(domain.impactLow(data), "1");
});

test("savingsCount matches the design", () => {
  assert.equal(domain.savingsCount(data), "26");
});
