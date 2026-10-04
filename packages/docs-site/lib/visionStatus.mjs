// The Vision page: pure functions from a status snapshot (site/data/vision-status.json) to HTML strings. No I/O.
// Every value from the snapshot goes through esc(); the page reads without JavaScript, the search box is an enhancement.
import { esc } from './text.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const VISION_PATH = 'vision/';

const isoOk = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const utc = (iso) => (isoOk(iso) ? `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'unknown');
const day = (iso) => (isoOk(iso) ? new Date(iso).toISOString().slice(0, 10) : 'unknown');
const num = (n) => (Number.isFinite(n) ? n : 0);
const uniq = (a) => [...new Set(a)];
const useText = (u) => (u && typeof u === 'object' ? `${typeof u.page === 'string' ? u.page : 'a page that is not public'}, piece ${String(u.blockId ?? '').slice(0, 8)}, ${String(u.via ?? '')}` : typeof u === 'string' ? u : '');
const aliasText = (a) => (a && typeof a === 'object' && a.alias && a.storedName ? `${String(a.alias)} \u2192 ${String(a.storedName)}` : typeof a === 'string' ? a : '');

/** Parsed JSON text (or an already parsed value) to a normalized snapshot, or null when it is missing or has an unknown schemaVersion. */
export function parseSnapshot(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !isoOk(data.generatedAt)) return null;
  const runs = (Array.isArray(data.runs) ? data.runs : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      id: String(r.id ?? ''),
      spec: String(r.spec ?? ''),
      model: String(r.model ?? ''),
      startedAt: r.startedAt,
      finishedAt: isoOk(r.finishedAt) ? r.finishedAt : null,
      status: String(r.status ?? 'unknown'),
      counts: { stored: num(r.counts?.stored), reused: num(r.counts?.reused), review: num(r.counts?.review), skipped: num(r.counts?.skipped) },
    }))
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
  const lib = data.library && typeof data.library === 'object' ? data.library : {};
  const components = (Array.isArray(lib.components) ? lib.components : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      name: String(c.name ?? ''),
      level: String(c.level ?? ''),
      latestVersion: String(c.latestVersion ?? ''),
      versions: (Array.isArray(c.versions) ? c.versions : []).filter((v) => v && typeof v === 'object').map((v) => ({ number: String(v.number ?? ''), createdAt: v.createdAt, how: String(v.how ?? '') })),
      updatedAt: c.updatedAt,
      whereUsed: uniq((Array.isArray(c.whereUsed) ? c.whereUsed : []).map(useText).filter(Boolean)),
      aliases: uniq((Array.isArray(c.aliases) ? c.aliases : []).map(aliasText).filter(Boolean)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: data.generatedAt, runs, library: { releasedVersion: lib.releasedVersion ? String(lib.releasedVersion) : '', components } };
}

export function duration(startedAt, finishedAt) {
  if (!finishedAt) return 'running';
  const s = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(s) || s < 0) return 'unknown';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function noSnapshotHtml() {
  return `<section class="vs-empty" aria-labelledby="vs-empty-h"><h2 id="vs-empty-h">No snapshot yet</h2><p>The status data has not been published for this build, so there is nothing to show here yet. It appears here once a snapshot is committed.</p></section>`;
}

function statusBadge(status) {
  const key = /^[a-z-]+$/.test(status) ? status : 'unknown';
  return `<span class="vs-badge vs-badge-${key}">${esc(status)}</span>`;
}

function runsHtml(runs) {
  if (!runs.length) return `<section aria-labelledby="vs-runs-h"><h2 id="vs-runs-h">Runs</h2><p>No runs in this snapshot.</p></section>`;
  const rows = runs
    .map(
      (r) => `<tr><th scope="row"><code>${esc(r.id)}</code></th><td>${esc(r.spec)}</td><td>${esc(r.model)}</td><td><time datetime="${esc(r.startedAt)}">${esc(utc(r.startedAt))}</time></td><td>${esc(duration(r.startedAt, r.finishedAt))}</td><td>${statusBadge(r.status)}</td><td class="vs-n">${r.counts.stored}</td><td class="vs-n">${r.counts.reused}</td><td class="vs-n">${r.counts.review}</td><td class="vs-n">${r.counts.skipped}</td></tr>`,
    )
    .join('');
  return `<section aria-labelledby="vs-runs-h"><h2 id="vs-runs-h">Runs</h2>
<div class="vs-table-wrap" tabindex="0" role="region" aria-labelledby="vs-runs-h"><table class="vs-table"><caption>${plural(runs.length, 'run', 'runs')}, newest first. The four counts are pieces stored as new, reused from the library, sent for review, and skipped.</caption>
<thead><tr><th scope="col">Run</th><th scope="col">Spec</th><th scope="col">Model</th><th scope="col">Started</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col" class="vs-n">Stored</th><th scope="col" class="vs-n">Reused</th><th scope="col" class="vs-n">Review</th><th scope="col" class="vs-n">Skipped</th></tr></thead>
<tbody>${rows}</tbody></table></div></section>`;
}

function componentHtml(c) {
  const haystack = [c.name, c.level, ...c.aliases, ...c.whereUsed].join(' ');
  const used = c.whereUsed.length
    ? `<details class="vs-more"><summary>Used in ${plural(c.whereUsed.length, 'place', 'places')}</summary><ul>${c.whereUsed.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`
    : `<p class="vs-none">Not used anywhere yet.</p>`;
  const versions = c.versions.length
    ? `<details class="vs-more"><summary>${plural(c.versions.length, 'version', 'versions')}</summary><ul>${c.versions.map((v) => `<li><strong>${esc(v.number)}</strong>, ${esc(day(v.createdAt))}${v.how ? `, ${esc(v.how)}` : ''}</li>`).join('')}</ul></details>`
    : '';
  return `<li class="vs-comp" data-search="${esc(haystack)}"><h3>${esc(c.name)}</h3>
<p class="vs-meta"><span class="vs-level">${esc(c.level)}</span> latest <strong>${esc(c.latestVersion)}</strong>, updated <time datetime="${esc(c.updatedAt)}">${esc(day(c.updatedAt))}</time></p>
${c.aliases.length ? `<p class="vs-aliases">Name matches: ${c.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')}</p>` : ''}
${used}${versions}</li>`;
}

function libraryHtml(lib, root) {
  const head = `<h2 id="vs-lib-h">Library</h2>`;
  if (!lib.components.length) return `<section aria-labelledby="vs-lib-h">${head}<p>No components in this snapshot.</p></section>`;
  const released = lib.releasedVersion ? `<p>Released library version: <strong>${esc(lib.releasedVersion)}</strong>.</p>` : '';
  return `<section aria-labelledby="vs-lib-h">${head}${released}
<div class="vs-search" id="vs-search" hidden><label for="vs-q">Search the library</label><input id="vs-q" type="search" placeholder="Name, level, alias or where used" autocomplete="off"><p id="vs-count" role="status" aria-live="polite"></p></div>
<ul class="vs-list" id="vs-list">${lib.components.map(componentHtml).join('')}</ul>
<p id="vs-none" hidden>No component matches that search.</p>
<script src="${esc(root)}assets/js/vision-library.js" defer></script></section>`;
}

/** The page's data section: the as-of stamp, the runs table and the library list. `snapshot` is a parsed snapshot or null. */
export function renderVisionStatus(snapshot, { root = '../' } = {}) {
  if (!snapshot) return noSnapshotHtml();
  const { runs, library, generatedAt } = snapshot;
  const stamp = `<p class="vs-asof">As of <time datetime="${esc(generatedAt)}">${esc(utc(generatedAt))}</time>: ${plural(runs.length, 'run', 'runs')} and ${plural(library.components.length, 'component', 'components')}. This is a snapshot, not a live view.</p>`;
  return `${stamp}${runsHtml(runs)}${libraryHtml(library, root)}`;
}
