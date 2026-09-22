// #436 -- the ONE guarded HTTP fetch for everything that reads a URL a person typed (story fetch #384, real API calls
// #400, and the clone address check). Deterministic, no LLM, no `ui/` imports; the only dependency is `ipaddr.js` (MIT).
//
// What it enforces, in this order, on the first request and on EVERY redirect hop:
//   1. https only, the default port only, no user name/password, a host that is on the caller's allow-list
//      (a non-empty allow-list is required: there is no "any host" mode and no switch to turn the guard off);
//   2. the host is resolved and EVERY address it answers with must be a public one (a mixed public+private answer is
//      refused whole, not filtered), judged with ipaddr.js; an IPv6 address embedding an IPv4 one (mapped, NAT64,
//      6to4, compatible) is judged by the IPv4 it embeds;
//   3. the connection is made to the address that was just checked: the check IS the socket's `lookup` hook, so a
//      resolver that answers differently a moment later (DNS rebinding) never gets a second chance;
//   4. no connection is reused (`agent: false`, `Connection: close`) so a pooled socket can never outlive a check;
//   5. a size cap and ONE overall deadline (a slow drip is cut off exactly like a big body), no compression asked for
//      (nothing to bomb), no cookies/credentials/auth header sent or forwarded (the request carries only Accept and
//      User-Agent), redirects capped, and the body is returned as bytes -- never parsed or executed here.
// Environment proxies (HTTPS_PROXY ...) are NOT honoured: a guarded fetch always dials the checked address itself.
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export const DEFAULT_MAX_BYTES = 1_000_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
const USER_AGENT = 'construct-safe-fetch/1';
const REDIRECTS = [301, 302, 303, 307, 308];
const fail = (code, message) => ({ ok: false, code, message });

// ---- "is this a public address" ---------------------------------------------------------------------------------

/** The four IPv4 bytes an IPv6 address embeds (mapped, compatible, NAT64, 6to4), else null. */
function embeddedV4(v6) {
  const g = v6.parts;
  const bytes = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0) && !(g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1))) return bytes(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return bytes(g[6], g[7]); // NAT64 (well-known prefix)
  if (g[0] === 0x2002) return bytes(g[1], g[2]); // 6to4
  return null;
}

/**
 * Is `addr` (an IP literal) an address on the public internet? Loopback, private, link-local, CGNAT, multicast,
 * unspecified, documentation, benchmarking and reserved ranges are not. Anything that is not an IP literal is not.
 * @param {string} addr
 */
export function isPublicAddress(addr) {
  if (typeof addr !== 'string') return false;
  const bare = addr.split('%')[0].replace(/^\[|\]$/g, '');
  const family = net.isIP(bare);
  if (family === 0) return false;
  let parsed;
  try { parsed = ipaddr.parse(bare); } catch { return false; }
  if (family === 4) return parsed.range() === 'unicast';
  const v6 = /** @type {any} */ (parsed);
  const inner = embeddedV4(v6);
  if (inner) return new ipaddr.IPv4(inner).range() === 'unicast';
  if ((v6.parts[0] & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  return v6.range() === 'unicast';
}

// ---- the guarded lookup ------------------------------------------------------------------------------------------

const defaultResolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Resolve `host` and require every answer to be public. -> { ok:true, addresses } | { ok:false, code, message } */
async function resolvePublic(host, resolver) {
  let answers;
  try { answers = await resolver(host); } catch (e) { return fail('DNS_FAILED', `Could not look up ${host}: ${String(e?.message || e).slice(0, 120)}`); }
  const list = (Array.isArray(answers) ? answers : [answers]).map((a) => (typeof a === 'string' ? { address: a } : a)).filter((a) => a && typeof a.address === 'string');
  if (list.length === 0) return fail('DNS_FAILED', `${host} did not resolve to any address.`);
  if (list.some((a) => !isPublicAddress(a.address))) return fail('NOT_PUBLIC', `${host} resolves to a non-public address, so it was not contacted.`);
  return { ok: true, addresses: list.map((a) => ({ address: a.address, family: net.isIP(a.address.split('%')[0]) })) };
}

// ---- URL policy ----------------------------------------------------------------------------------------------------

function checkUrl(u, allowSchemes, allowHosts) {
  if (!allowSchemes.includes(u.protocol)) return fail('BAD_SCHEME', `Only ${allowSchemes.join(', ')} addresses may be fetched.`);
  if (u.username || u.password) return fail('BAD_URL', 'An address with a user name or password is not fetched.');
  if (u.port !== '') return fail('BAD_URL', 'An address that names a port is not fetched.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allowHosts.includes(host)) return fail('HOST_NOT_ALLOWED', `Fetching from ${host || 'that host'} is not allowed. Allowed hosts: ${allowHosts.join(', ')}.`);
  return { ok: true, host };
}

/**
 * @param {string} url
 * @param {{allowHosts:string[], allowSchemes?:string[], maxBytes?:number, timeoutMs?:number, maxRedirects?:number,
 *   allowContentTypes?:string[], accept?:string, resolver?:(host:string)=>Promise<any>, _request?:Function}} opts
 *   `resolver` is the injectable DNS seam (tests); `_request` is a TEST-ONLY transport seam (it still receives the
 *   guarded `lookup`; production never passes it).
 * @returns {Promise<any>} { ok:true, status, headers, body:Buffer, url, redirects } | { ok:false, code, message }
 */
export async function safeFetch(url, opts = /** @type {any} */ ({})) {
  const {
    allowHosts, allowSchemes = ['https:'], maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS, allowContentTypes, accept = '*/*', resolver = defaultResolver, _request = https.request,
  } = opts;
  if (!Array.isArray(allowHosts) || allowHosts.length === 0 || !allowHosts.every((h) => typeof h === 'string' && h)) {
    return fail('NO_ALLOWLIST', 'A guarded fetch needs a list of allowed hosts.');
  }
  if (!allowSchemes.every((s) => s === 'https:')) return fail('BAD_SCHEME', 'Only https: may be allowed.'); // no way to widen to http
  const hosts = allowHosts.map((h) => h.toLowerCase());
  const deadline = Date.now() + timeoutMs;
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (current.length > 2000 || /[\0-\x1f\x7f\s]/.test(current)) return fail('BAD_URL', 'That is not a usable address.');
    let u;
    try { u = new URL(current); } catch { return fail('BAD_URL', 'That is not a valid address.'); }
    const policy = checkUrl(u, allowSchemes, hosts);
    if (!policy.ok) return policy;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail('TIMEOUT', 'The fetch took too long.');
    if (net.isIP(policy.host) && !isPublicAddress(policy.host)) return fail('NOT_PUBLIC', `${policy.host} is not a public address, so it was not contacted.`);
    const res = await once(u, policy.host, { resolver, _request, remaining, maxBytes, accept });
    if (!res.ok) return res;
    if (REDIRECTS.includes(res.status)) {
      const loc = res.headers.location;
      if (!loc || typeof loc !== 'string') return fail('BAD_REDIRECT', 'The server redirected without saying where.');
      if (hop === maxRedirects) return fail('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects.`);
      try { current = new URL(loc, u).href; } catch { return fail('BAD_REDIRECT', 'The redirect address is not valid.'); }
      continue; // re-validated (scheme, allow-list, DNS) at the top of the next hop
    }
    if (allowContentTypes) {
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!allowContentTypes.map((t) => t.toLowerCase()).includes(type)) return fail('BAD_CONTENT_TYPE', `The server answered with ${type || 'no content type'}, which is not accepted here.`);
    }
    return { ok: true, status: res.status, headers: res.headers, body: res.body, url: u.href, redirects: hop };
  }
  return fail('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects.`);
}

/** One request, one connection, one resolution. */
function once(u, host, { resolver, _request, remaining, maxBytes, accept }) {
  return new Promise((resolve) => {
    let settled = false;
    let guardFailure = null; // set by the lookup hook so the caller sees NOT_PUBLIC, not a socket error
    let req;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!r.ok) { try { req?.destroy(); } catch { /* already gone */ } }
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail('TIMEOUT', 'The fetch took too long.')), remaining);
    // The socket's own DNS step. Whatever it returns is what gets connected to.
    const lookup = (hostname, options, cb) => {
      const callback = typeof options === 'function' ? options : cb;
      const wantAll = typeof options === 'object' && options && options.all;
      resolvePublic(hostname, resolver).then((r) => {
        if (!r.ok) { guardFailure = r; return callback(Object.assign(new Error(r.message), { code: r.code })); }
        const first = r.addresses[0];
        return wantAll ? callback(null, [first]) : callback(null, first.address, first.family);
      });
    };
    try {
      req = _request({
        protocol: 'https:', hostname: host, port: 443, path: `${u.pathname}${u.search}`, method: 'GET', agent: false, lookup,
        servername: net.isIP(host) ? undefined : host,
        headers: { host: u.host, accept, 'user-agent': USER_AGENT, 'accept-encoding': 'identity', connection: 'close' },
      }, (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) { finish(fail('TOO_LARGE', `The response is larger than ${maxBytes} bytes.`)); return res.destroy(); }
        if (REDIRECTS.includes(res.statusCode)) { res.resume(); return finish({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) { finish(fail('TOO_LARGE', `The response is larger than ${maxBytes} bytes.`)); return res.destroy(); }
          chunks.push(c);
        });
        res.on('end', () => finish({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', () => finish(fail('NETWORK', 'The connection broke while reading.')));
        res.on('aborted', () => finish(fail('NETWORK', 'The connection broke while reading.')));
      });
      req.on('error', (e) => finish(guardFailure || fail('NETWORK', `Could not connect: ${String(e?.code || e?.message || e).slice(0, 80)}`)));
      req.end();
    } catch (e) {
      finish(fail('NETWORK', `Could not connect: ${String(e?.message || e).slice(0, 80)}`));
    }
  });
}
