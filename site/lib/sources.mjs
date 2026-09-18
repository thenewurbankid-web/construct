// Data sources with one shared interface, so collect.mjs is pure and testable:
//   getIssue(n), subIssues(n), comments(n), demoIssues(), render(markdown), fetchImage(url)
import fs from 'node:fs';

const API = 'https://api.github.com';

export function githubSource({ repo, token, fetchImpl = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'construct-pages-build' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function json(path, init = {}) {
    const res = await fetchImpl(API + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.json();
  }
  async function paged(path) {
    const all = [];
    for (let page = 1; page < 20; page++) {
      const rows = await json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      all.push(...rows);
      if (rows.length < 100) break;
    }
    return all;
  }

  return {
    label: `github:${repo}`,
    getIssue: (n) => json(`/repos/${repo}/issues/${n}`),
    // Real sub-issues; a 404 (feature unavailable) is treated as "none linked".
    subIssues: (n) => paged(`/repos/${repo}/issues/${n}/sub_issues`).catch(() => []),
    comments: (n) => paged(`/repos/${repo}/issues/${n}/comments`),
    async demoIssues() {
      const rows = await paged(`/repos/${repo}/issues?state=all`);
      return rows.filter((i) => !i.pull_request && /^\s*\[Demo/i.test(i.title));
    },
    async render(markdown) {
      const res = await fetchImpl(`${API}/markdown`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: markdown, mode: 'gfm', context: repo }),
      });
      if (!res.ok) throw new Error(`GitHub markdown ${res.status}`);
      return res.text();
    },
    async fetchImage(url) {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'construct-pages-build' } });
      if (!res.ok) throw new Error(`image ${res.status} ${url}`);
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
    },
  };
}

/**
 * Offline source for tests: fixtures = { issues: {n: issue}, sub_issues: {n: [issue]},
 * comments: {n: [comment]}, html: {n: renderedHtml}, images: {url: base64} }.
 * `render` returns fixtures.html keyed by the exact markdown text if present,
 * otherwise a minimal paragraph/heading conversion.
 */
export function offlineSource(fixtures) {
  const f = typeof fixtures === 'string' ? JSON.parse(fs.readFileSync(fixtures, 'utf8')) : fixtures;
  const issues = f.issues || {};
  return {
    label: 'offline',
    getIssue: async (n) => issues[n] || Promise.reject(new Error(`no fixture issue ${n}`)),
    subIssues: async (n) => (f.sub_issues || {})[n] || [],
    comments: async (n) => (f.comments || {})[n] || [],
    demoIssues: async () => Object.values(issues).filter((i) => /^\s*\[Demo/i.test(i.title)),
    async render(markdown) {
      if (f.html && f.html[markdown]) return f.html[markdown];
      return markdown
        .split(/\n\s*\n/)
        .map((p) => {
          const h = /^(#{1,6})\s+(.*)$/.exec(p.trim());
          const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          const img = /^!\[([^\]]*)\]\((\S+)\)$/.exec(p.trim());
          if (img) return `<p><img src="${img[2]}" alt="${img[1]}"></p>`;
          return h ? `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>` : `<p>${esc(p.trim())}</p>`;
        })
        .join('\n');
    },
    async fetchImage(url) {
      const b64 = (f.images || {})[url];
      if (!b64) throw new Error(`no fixture image ${url}`);
      return { bytes: Buffer.from(b64, 'base64'), contentType: 'image/png' };
    },
  };
}
