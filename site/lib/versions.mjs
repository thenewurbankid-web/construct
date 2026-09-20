// Documentation versions: which releases exist, where each is served, and the switcher/banner markup.
// Pure functions, no I/O. Policy: docs/VERSIONING.md ("Versioned documentation").
import { esc } from './text.mjs';

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Ensure a base path starts and ends with a slash: "construct/0.8" -> "/construct/0.8/". */
export const normalizeBase = (p) => {
  const inner = String(p || '').replace(/^\/+|\/+$/g, '');
  return inner ? `/${inner}/` : '/';
};

/**
 * Newest release tag per minor (vX.Y.Z only, no pre-releases), newest minor first.
 * Returns [{ tag, id: 'X.Y', major, minor, patch }].
 */
export function releaseVersions(tags) {
  const perMinor = new Map();
  for (const tag of tags) {
    const m = TAG.exec(String(tag).trim());
    if (!m) continue;
    const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const id = `${major}.${minor}`;
    const prev = perMinor.get(id);
    if (!prev || patch > prev.patch) perMinor.set(id, { tag: `v${major}.${minor}.${patch}`, id, major, minor, patch });
  }
  return [...perMinor.values()].sort((a, b) => b.major - a.major || b.minor - a.minor);
}

/**
 * The build plan for one deploy.
 *   builds:   what to build, in order: { ref, dir ('' = site root), id, label, latest }
 *   versions: the switcher list: { id, label, base, latest }, newest first, "next" last
 * With no release tags, main is built as both the root and /next/, both shown as "next".
 */
export function planBuilds(tags, { siteBase = '/', nextRef = 'main' } = {}) {
  const site = normalizeBase(siteBase);
  const rel = releaseVersions(tags);
  if (rel.length === 0) {
    return {
      builds: [
        { ref: nextRef, dir: '', id: 'next', label: 'next', latest: true },
        { ref: nextRef, dir: 'next', id: 'next', label: 'next', latest: true },
      ],
      versions: [{ id: 'next', label: 'next', base: site, latest: true }],
    };
  }
  const builds = [{ ref: rel[0].tag, dir: '', id: rel[0].id, label: `v${rel[0].id}`, latest: true }];
  for (const r of rel) builds.push({ ref: r.tag, dir: r.id, id: r.id, label: `v${r.id}`, latest: r === rel[0] });
  builds.push({ ref: nextRef, dir: 'next', id: 'next', label: 'next', latest: false });
  const versions = [
    ...rel.map((r, i) => ({ id: r.id, label: `v${r.id}`, base: i === 0 ? site : `${site}${r.id}/`, latest: i === 0 })),
    { id: 'next', label: 'next', base: `${site}next/`, latest: false },
  ];
  return { builds, versions };
}

/** Find the entry for the build being rendered: by its served path, else by id. */
export function currentVersion(versions, { basePath, version }) {
  return versions.find((v) => v.base === basePath) || versions.find((v) => v.id === version) || null;
}

/**
 * Header switcher: a native disclosure (details/summary) of plain links, so it works without JavaScript,
 * is keyboard-usable, and its list overlays the page instead of pushing it (no layout shift).
 * Renders nothing when there is only one version.
 */
export function versionSwitcher({ versions, current, pagePath = '' }) {
  if (!versions || versions.length < 2 || !current) return '';
  const items = versions
    .map((v) => {
      const here = v.id === current.id && v.base === current.base;
      const tag = v.latest ? ' <span class="ver-tag">latest</span>' : v.id === 'next' ? ' <span class="ver-tag">unreleased</span>' : '';
      return `<li><a href="${esc(v.base + pagePath)}"${here ? ' aria-current="true"' : ''}>${esc(v.label)}${tag}</a></li>`;
    })
    .join('');
  return `<details class="ver-switch"><summary aria-label="Documentation version: ${esc(current.label)}. Change version"><span class="ver-label">Version</span> <strong>${esc(current.label)}</strong></summary><ul aria-label="Documentation versions">${items}</ul></details>`;
}

/** Banner on non-latest pages. Empty for the latest version. */
export function versionBanner({ versions, current }) {
  if (!versions || !current || current.latest) return '';
  const latest = versions.find((v) => v.latest);
  if (!latest) return '';
  const what = current.id === 'next' ? 'the unreleased docs (next)' : `docs for ${esc(current.label)}`;
  return `<div class="ver-banner" role="note"><p>You are reading ${what}. <a href="${esc(latest.base)}">See latest (${esc(latest.label)})</a></p></div>`;
}
