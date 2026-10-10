// Mock API — generated from the example responses you gave. In-memory, resets on reload.
const seed = [
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

let db = structuredClone(seed);
let nextId = Math.max(0, ...db.map((x) => Number(x.id) || 0)) + 1;

const routes = [
  { method: "GET", pattern: /^\/api\/invoices$/, handle: () => [200, db] },
  {
    method: "POST",
    pattern: /^\/api\/invoices$/,
    handle: (body) => {
      const item = { ...body, id: nextId++ };
      db.push(item);
      return [201, item];
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/invoices\/([^/]+)$/,
    handle: (body, key) => {
      const i = db.findIndex((x) => String(x.id) === key);
      if (i < 0) return [404, { error: "not found" }];
      db[i] = { ...db[i], ...body, id: db[i].id };
      return [200, db[i]];
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/invoices\/([^/]+)$/,
    handle: (_body, key) => {
      const before = db.length;
      db = db.filter((x) => String(x.id) !== key);
      return db.length < before ? [204, null] : [404, { error: "not found" }];
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
