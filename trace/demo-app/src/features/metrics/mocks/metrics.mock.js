// Mock API — generated from the example responses you gave. In-memory, resets on reload.
const seed = [
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

let db = structuredClone(seed);
let nextId = Math.max(0, ...db.map((x) => Number(x.id) || 0)) + 1;

const routes = [{ method: "GET", pattern: /^\/api\/metrics$/, handle: () => [200, db] }];

export function installMockApi({ delay = 200 } = {}) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    const method = (init.method ?? "GET").toUpperCase();
    for (const r of routes) {
      const m = r.method === method && url.pathname.match(r.pattern);
      if (!m) continue;
      await new Promise((res) => setTimeout(res, delay));
      const body = init.body ? JSON.parse(init.body) : undefined;
      const [status, data] = r.handle(body, m[1] && decodeURIComponent(m[1]));
      console.info("[mock]", method, url.pathname, status);
      return new Response(status === 204 ? null : JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
}
