// Mock API — generated from the example responses you gave. In-memory, resets on reload.
const seed = [
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

let db = structuredClone(seed);
let nextId = Math.max(0, ...db.map((x) => Number(x.id) || 0)) + 1;

const routes = [
  { method: "GET", pattern: /^\/api\/deals$/, handle: () => [200, db] },
  {
    method: "POST",
    pattern: /^\/api\/deals$/,
    handle: (body) => {
      const item = { ...body, id: nextId++ };
      db.push(item);
      return [201, item];
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/deals\/([^/]+)$/,
    handle: (body, key) => {
      const i = db.findIndex((x) => String(x.id) === key);
      if (i < 0) return [404, { error: "not found" }];
      db[i] = { ...db[i], ...body, id: db[i].id };
      return [200, db[i]];
    },
  },
];

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
