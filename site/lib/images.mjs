// Image handling: find <img> in rendered HTML / markdown, download at build time,
// rewrite to local content-hash paths so the site never hotlinks.
import { createHash } from 'node:crypto';

const IMG_TAG = /<img\b[^>]*>/gi;

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : null;
}

/** Remote (http/https) image URLs in rendered HTML, de-duplicated, in order. */
export function extractImageUrls(html) {
  const urls = [];
  for (const tag of String(html).match(IMG_TAG) || []) {
    const src = attr(tag, 'data-canonical-src') || attr(tag, 'src');
    if (src && /^https?:\/\//i.test(src) && !urls.includes(src)) urls.push(src);
  }
  return urls;
}

/** First image URL in markdown source (for hero images). */
export function firstMarkdownImage(md) {
  const m = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(String(md));
  return m ? m[1] : null;
}

const CT_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

export function localImageName(url, bytes, contentType = '') {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  let ext = /\.(png|jpe?g|gif|webp|svg)(?:$|\?)/i.exec(new URL(url).pathname + new URL(url).search)?.[1];
  ext = ext ? '.' + ext.toLowerCase() : CT_EXT[contentType.split(';')[0].trim()] || '.png';
  return hash + ext;
}

/**
 * Rewrite <img> tags whose URL is in `map` (url -> local path). Drops GitHub's
 * inline max-width style / data-* attrs, adds lazy loading, and points an
 * enclosing "open image" link at the local file too.
 */
export function rewriteImages(html, map, { prefix = '' } = {}) {
  let out = String(html).replace(IMG_TAG, (tag) => {
    const src = attr(tag, 'data-canonical-src') || attr(tag, 'src');
    const local = src && map[src];
    const alt = attr(tag, 'alt') || '';
    if (!local) return tag; // download failed or not http(s): leave as-is
    return `<img src="${prefix}${local}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" decoding="async">`;
  });
  // <a ... href="<remote url>"><img src="local"></a>  ->  href = local file
  out = out.replace(/<a\b([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>(\s*<img\b)/gi, (m, pre, href, post, img) =>
    map[href] ? `<a${pre}href="${prefix}${map[href]}"${post}>${img}` : m,
  );
  return out;
}
