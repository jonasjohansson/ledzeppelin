import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createGzip } from 'node:zlib';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
export function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
// Text types worth gzipping (woff2/png/ico are already compressed — never gzip those).
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.glsl', '.md', '.svg', '.webmanifest']);
// Long-cache the content-stable binaries; revalidate code/markup with an ETag.
const IMMUTABLE = new Set(['.woff2', '.png', '.ico', '.svg']);

export async function serveStatic(root, req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel === '/' ? 'index.html' : rel);
  try {
    let s = await stat(filePath);
    if (s.isDirectory()) { filePath = join(filePath, 'index.html'); s = await stat(filePath); }
    const ext = extname(filePath).toLowerCase();
    const etag = `W/"${s.size}-${Math.round(s.mtimeMs)}"`;
    const cache = IMMUTABLE.has(ext) ? 'public, max-age=31536000, immutable' : 'no-cache';
    // Conditional GET: unchanged asset → 304 (skips the whole transfer over the LAN).
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': cache });
      res.end();
      return true;
    }
    const headers = { 'content-type': contentType(filePath), etag, 'cache-control': cache };
    const gzip = COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = createReadStream(filePath).on('error', () => res.destroy());
    if (gzip) {
      headers['content-encoding'] = 'gzip';
      headers.vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      body.pipe(createGzip()).on('error', () => res.destroy()).pipe(res);
    } else {
      headers['content-length'] = s.size;
      res.writeHead(200, headers);
      body.pipe(res);
    }
    return true;
  } catch { return false; }
}
