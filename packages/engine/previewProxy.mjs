// Live preview v2 (#443), slice 3 — the injecting loopback proxy. Design note:
// docs/design/live-preview-v2.md §3 ("Decision 1 — delivery").
//
// The Cockpit never points the preview iframe at the dev server directly. It points it at THIS
// proxy, on its own 127.0.0.1 port, which sits in front of the dev server and:
//
//   - forwards every request unchanged;
//   - for an HTML response, injects one <script> as the FIRST child of <head> (before any app or
//     framework script) carrying the fiber bridge (packages/engine/previewFiber.mjs) and its nonce;
//   - forwards WebSocket upgrades verbatim, so the app's OWN hot-reload (Vite's /@vite/client,
//     Next's /_next/webpack-hmr) keeps working through the proxy;
//   - strips `content-security-policy` and `x-frame-options` on these proxied dev responses only,
//     so a dev server that sets `frame-ancestors` or a script-src nonce does not block the iframe
//     or the injected script.
//
// Why this keeps the app cross-origin from the Cockpit (never proxied under the Cockpit's own
// origin): §3 of the design note. A same-origin preview could read the Cockpit's session cookie,
// localStorage and call its API as the signed-in user; a separate loopback port confines the
// previewed app to postMessage. Nothing here changes that: the proxy is its own origin, not a
// path under the Cockpit's.
import http from 'node:http';
import { previewFiberBridgeScript } from './previewFiber.mjs';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
// Stripped only on responses THIS proxy serves (a local dev server's own headers), never on
// anything else: a frame-ancestors CSP or X-Frame-Options would otherwise block the iframe and the
// injected script even though both are same-machine, user-started dev tooling.
const FRAME_BLOCKING_HEADERS = new Set(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options']);
// Dev HTML pages are small; a page bigger than this is proxied unmodified (never buffered/blocked)
// rather than risk holding an unbounded response in memory.
const MAX_INJECTABLE_HTML_BYTES = 5 * 1024 * 1024;

function copyResponseHeaders(from, { stripFrameBlocking }) {
  const out = {};
  for (const [key, value] of Object.entries(from)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (stripFrameBlocking && FRAME_BLOCKING_HEADERS.has(lower)) continue;
    out[key] = value;
  }
  return out;
}

function isHtmlResponse(headers) {
  const type = String(headers['content-type'] || '');
  return /text\/html/i.test(type);
}

/**
 * Insert `scriptTag` as the first child of `<head ...>`; falls back to just inside `<html>`, then prepends.
 *
 * @param {string} html The document to inject into.
 * @param {string} scriptTag The `<script>...</script>` markup to insert.
 * @returns {string} `html` with `scriptTag` inserted.
 */
export function injectIntoHtml(html, scriptTag) {
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + scriptTag + html.slice(at);
  }
  const htmlOpen = /<html[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + scriptTag + html.slice(at);
  }
  return scriptTag + html;
}

/**
 * Build (unstarted) the loopback proxy that injects the fiber bridge into the dev server's HTML.
 *
 * @param {object} options
 * @param {number} options.targetPort the dev server's port
 * @param {string} [options.targetHost] default 127.0.0.1
 * @param {string} options.nonce per-session nonce embedded in the bridge and required on every inbound postMessage
 * @param {string} options.parentOrigin the Cockpit origin the bridge posts to
 * @param {boolean} [options.pick] whether Pick mode starts on
 * @param {(text: string) => void} [options.onLog] optional line sink, mirrors devServer's `say`
 * @returns {import('node:http').Server} an unstarted server; caller calls `.listen(port, '127.0.0.1')`
 */
export function createPreviewProxy({ targetPort, targetHost = '127.0.0.1', nonce, parentOrigin, pick = false, onLog }) {
  if (!targetPort) throw new Error('createPreviewProxy: `targetPort` is required');
  if (!nonce || !parentOrigin) throw new Error('createPreviewProxy: `nonce` and `parentOrigin` are required');
  const scriptBody = previewFiberBridgeScript({ nonce, parentOrigin, pick });
  const scriptTag = `<script>${scriptBody}</script>`;
  const log = (text) => { try { onLog?.(text); } catch { /* logging never breaks the proxy */ } };

  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: targetHost, port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, host: `${targetHost}:${targetPort}` } },
      (upRes) => {
        const chunks = [];
        const html = isHtmlResponse(upRes.headers);
        if (html) {
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            const buf = Buffer.concat(chunks);
            const headers = copyResponseHeaders(upRes.headers, { stripFrameBlocking: true });
            if (buf.length > MAX_INJECTABLE_HTML_BYTES) {
              res.writeHead(upRes.statusCode || 200, headers);
              res.end(buf);
              return;
            }
            const body = injectIntoHtml(buf.toString('utf8'), scriptTag);
            delete headers['content-length'];
            headers['content-length'] = Buffer.byteLength(body);
            res.writeHead(upRes.statusCode || 200, headers);
            res.end(body);
          });
          return;
        }
        res.writeHead(upRes.statusCode || 200, copyResponseHeaders(upRes.headers, { stripFrameBlocking: true }));
        upRes.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      log(`preview proxy: upstream request failed: ${e.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad gateway: the dev server did not respond.');
    });
    req.pipe(upstream);
  });

  // WebSocket / any other Upgrade (Vite's `/@vite/client`, Next's `/_next/webpack-hmr`) forwarded
  // byte-for-byte: the proxy does not understand the WS framing, it only relays the raw sockets.
  server.on('upgrade', (req, clientSocket, head) => {
    const upstream = http.request({ host: targetHost, port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, host: `${targetHost}:${targetPort}` } });
    upstream.on('error', (e) => { log(`preview proxy: upgrade to dev server failed: ${e.message}`); clientSocket.destroy(); });
    upstream.on('upgrade', (upRes, upstreamSocket, upHead) => {
      const statusLine = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
      // 'connection' is dropped by HOP_BY_HOP for ordinary responses, but on a 101 it IS the
      // 'Upgrade' the client is waiting for — keep it (and 'upgrade' itself) verbatim here.
      const headerLines = Object.entries(upRes.headers)
        .filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()) || ['connection', 'upgrade'].includes(k.toLowerCase()))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n');
      clientSocket.write(`${statusLine}${headerLines}\r\n\r\n`);
      // `head`/`upHead` are bytes Node already read past the HTTP headers on each side before the
      // 'upgrade' event fired; they must be forwarded, not just left in a buffer nobody drains.
      if (head && head.length) upstreamSocket.write(head);
      if (upHead && upHead.length) clientSocket.write(upHead);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstreamSocket.destroy());
    });
    upstream.end();
  });

  return server;
}
