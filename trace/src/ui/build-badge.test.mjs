import test from "node:test";
import assert from "node:assert/strict";
import { relativeTime, badgeText, shouldOfferReload, dotState, mountBuildBadge } from "./build-badge.mjs";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (s) => NOW - s * 1000;

test("relativeTime: just now, minutes, hours, yesterday, days", () => {
  assert.equal(relativeTime(ago(0), NOW), "just now");
  assert.equal(relativeTime(ago(44), NOW), "just now");
  assert.equal(relativeTime(ago(50), NOW), "1 min ago");
  assert.equal(relativeTime(ago(3 * 60), NOW), "3 min ago");
  assert.equal(relativeTime(ago(59 * 60 + 59), NOW), "59 min ago");
  assert.equal(relativeTime(ago(3600), NOW), "1 h ago");
  assert.equal(relativeTime(ago(2 * 3600 + 5), NOW), "2 h ago");
  assert.equal(relativeTime(ago(23 * 3600 + 59 * 60), NOW), "23 h ago");
  assert.equal(relativeTime(ago(24 * 3600), NOW), "yesterday");
  assert.equal(relativeTime(ago(47 * 3600), NOW), "yesterday");
  assert.equal(relativeTime(ago(5 * 86400 + 60), NOW), "5 days ago");
  assert.equal(relativeTime(ago(-30), NOW), "just now"); // a clock a little ahead never shows a negative time
});

test("badgeText: version, short hash, release (omitted when null), deployed time", () => {
  const info = { version: "1.0.0+3f9c2a1", hash: "3f9c2a1" + "0".repeat(33), release: "R0", builtAt: new Date(ago(12 * 60)).toISOString() };
  assert.equal(badgeText(info, NOW).text, "v1.0.0 · 3f9c2a1 · R0 · deployed 12 min ago");
  assert.equal(badgeText({ ...info, release: null }, NOW).text, "v1.0.0 · 3f9c2a1 · deployed 12 min ago");
  assert.match(badgeText(info, NOW).title, /Deployed .*\n?hash 3f9c2a1/s);
});

test("badgeText: a dev checkout says dev build and shows no time", () => {
  const t = badgeText({ version: "1.0.0+abcdef0", hash: "abcdef0" + "1".repeat(33), release: null, builtAt: null, dev: true }, NOW);
  assert.equal(t.text, "v1.0.0 · abcdef0 · dev build");
  assert.equal(t.short, "abcdef0 · dev build");
  assert.doesNotMatch(t.text, /ago/);
});

test("shouldOfferReload only when both hashes are known and differ", () => {
  assert.equal(shouldOfferReload("a", "a"), false);
  assert.equal(shouldOfferReload("a", "b"), true);
  assert.equal(shouldOfferReload(null, "b"), false);
  assert.equal(shouldOfferReload("a", undefined), false);
});

// a just-enough element for the mount code: no DOM library needed
function fakeDoc() {
  const mk = (tag) => ({ tag, children: [], attrs: {}, classList: { add() {} }, setAttribute(k, v) { this.attrs[k] = v; }, listeners: {}, hidden: false, textContent: "", append(...c) { this.children.push(...c); }, addEventListener(e, f) { this.listeners[e] = f; }, appendChild(c) { this.children.push(c); } });
  const doc = { head: mk("head"), createElement: mk, getElementById: () => null };
  const el = mk("span");
  el.ownerDocument = doc;
  return el;
}

test("mountBuildBadge renders, refreshes the text without refetching, and offers a reload when the hash changes", async () => {
  let clock = NOW, calls = 0, hash = "a".repeat(40), reloads = 0;
  const timers = [];
  const el = fakeDoc();
  const badge = mountBuildBadge(el, {
    now: () => clock,
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ version: "1.0.0+aaaaaaa", hash, release: null, builtAt: new Date(NOW - 60_000).toISOString() }) }; },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    reload: () => { reloads++; },
  });
  await badge.refresh();
  const { link, full, button: btn } = badge;
  assert.equal(full.textContent, "v1.0.0 · aaaaaaa · deployed 1 min ago");
  assert.equal(badge.short.textContent, "aaaaaaa · 1 min ago");
  assert.equal(link.href, "/about");
  assert.equal(btn.hidden, true);
  assert.deepEqual(timers.map((t) => t.ms), [30_000, 60_000]);

  clock += 10 * 60_000; // 10 minutes pass: the 30 s timer repaints, no request is made
  const before = calls;
  timers[0].fn();
  assert.equal(full.textContent, "v1.0.0 · aaaaaaa · deployed 11 min ago");
  assert.equal(calls, before);

  hash = "b".repeat(40); // the server now runs another build
  await badge.refresh();
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, "New build available: reload");
  assert.match(full.textContent, /bbbbbbb/);
  btn.listeners.click();
  assert.equal(reloads, 1);

  hash = "a".repeat(40); // rolled back to the build the page was loaded with
  await badge.refresh();
  assert.equal(btn.hidden, true);
});

test("mountBuildBadge keeps the last text when the server is unreachable", async () => {
  const el = fakeDoc();
  let fail = false;
  const badge = mountBuildBadge(el, {
    now: () => NOW,
    fetchImpl: async () => { if (fail) throw new Error("down"); return { ok: true, json: async () => ({ version: "1.0.0+aaaaaaa", hash: "a".repeat(40), builtAt: new Date(NOW).toISOString() }) }; },
    setInterval: () => 0, clearInterval: () => {},
  });
  await badge.refresh();
  const shown = badge.full.textContent;
  fail = true;
  await badge.refresh();
  assert.equal(badge.full.textContent, shown);
});

const OKINFO = { version: "1.0.0+aaaaaaa", hash: "a".repeat(40), release: "R0.1", builtAt: new Date(NOW).toISOString() };

test("dotState: pending, ok, dev and new build, with an accessible label and a tooltip each", () => {
  assert.equal(dotState(null, null).kind, "pending");
  const ok = dotState(OKINFO, OKINFO.hash);
  assert.equal(ok.kind, "ok");
  assert.match(ok.label, /^Trace R0\.1, up to date/);
  assert.match(ok.title, /newest build/);
  assert.equal(dotState({ ...OKINFO, release: null }, OKINFO.hash).label.startsWith("Trace v1.0.0,"), true, "no release id: the version");
  const dev = dotState({ ...OKINFO, dev: true, builtAt: null }, OKINFO.hash);
  assert.equal(dev.kind, "dev");
  assert.match(dev.title, /development checkout/);
  const nw = dotState({ ...OKINFO, hash: "b".repeat(40), release: "R1" }, OKINFO.hash);
  assert.equal(nw.kind, "new");
  assert.equal(nw.label, "New build available: reload");
  assert.match(nw.title, /New build available \(R1\)/);
  assert.equal(dotState({ ...OKINFO, hash: "b".repeat(40) }, null).kind, "ok", "no loaded hash yet: never announces a new build");
  assert.equal(dotState({ ...OKINFO, hash: "b".repeat(40) }, OKINFO.hash).kind, "new");
});

test("the dot is a link to /about that turns into a reload button when the hash changes, and back", async () => {
  let hash = "a".repeat(40), reloads = 0;
  const el = fakeDoc(), dot = fakeDoc();
  const badge = mountBuildBadge(el, {
    dot, now: () => NOW, fetchImpl: async () => ({ ok: true, json: async () => ({ ...OKINFO, hash }) }),
    setInterval: () => 0, clearInterval: () => {}, reload: () => { reloads++; },
  });
  const { dotLink: a, dotButton: b } = badge;
  assert.deepEqual(dot.children, [a, b]);
  assert.equal(a.href, "/about");
  assert.equal(a.attrs["data-kind"], "pending");
  assert.equal(a.hidden, false);
  assert.equal(b.hidden, true);
  await badge.refresh();
  assert.equal(a.attrs["aria-label"], "Trace R0.1, up to date: open About");
  assert.equal(a.attrs["data-kind"], "ok");
  hash = "b".repeat(40);
  await badge.refresh();
  assert.equal(a.hidden, true);
  assert.equal(b.hidden, false);
  assert.equal(b.attrs["aria-label"], "New build available: reload");
  b.listeners.click();
  assert.equal(reloads, 1);
  hash = "a".repeat(40);
  await badge.refresh();
  assert.equal(a.hidden, false);
  assert.equal(b.hidden, true);
});

test("keyboard focus follows the dot when it swaps between the link and the button", async () => {
  let hash = "a".repeat(40);
  const el = fakeDoc(), dot = fakeDoc();
  const doc = el.ownerDocument, focused = [];
  const badge = mountBuildBadge(el, { dot, now: () => NOW, fetchImpl: async () => ({ ok: true, json: async () => ({ ...OKINFO, hash }) }), setInterval: () => 0, clearInterval: () => {} });
  badge.dotLink.focus = () => { focused.push("link"); doc.activeElement = badge.dotLink; };
  badge.dotButton.focus = () => { focused.push("button"); doc.activeElement = badge.dotButton; };
  await badge.refresh();
  doc.activeElement = badge.dotLink; // the user tabbed onto the link
  hash = "b".repeat(40);
  await badge.refresh();
  assert.deepEqual(focused, ["button"]);
  hash = "a".repeat(40);
  await badge.refresh();
  assert.deepEqual(focused, ["button", "link"]);
  doc.activeElement = null; // focus is elsewhere: nothing is stolen
  hash = "b".repeat(40);
  await badge.refresh();
  assert.deepEqual(focused, ["button", "link"]);
});

test("without a dot option nothing about the dot exists", () => {
  const badge = mountBuildBadge(fakeDoc(), { now: () => NOW, fetchImpl: async () => ({ ok: false }), setInterval: () => 0, clearInterval: () => {} });
  assert.equal(badge.dotLink, null);
  assert.equal(badge.dotButton, null);
});
