'use strict';

/**
 * LSS Desktop – static file server with /api proxy.
 *
 * Serves apps/web/dist over HTTP on a random free port.
 * Any request path starting with /api is proxied to LSS_API_URL
 * (default http://127.0.0.1:8000), streaming bodies + headers.
 * Unknown paths fall back to index.html (SPA routing).
 * Path-jailed to distDir; no symlink escapes.
 *
 * Module exports: { createServer }
 * createServer(distDir, apiUrl) → Promise<{ server, port }>
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const MIME = {
  '.html' : 'text/html; charset=utf-8',
  '.js'   : 'application/javascript; charset=utf-8',
  '.mjs'  : 'application/javascript; charset=utf-8',
  '.css'  : 'text/css; charset=utf-8',
  '.json' : 'application/json; charset=utf-8',
  '.svg'  : 'image/svg+xml; charset=utf-8',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.ico'  : 'image/x-icon',
  '.woff' : 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf'  : 'font/ttf',
  '.otf'  : 'font/otf',
  '.webp' : 'image/webp',
  '.txt'  : 'text/plain; charset=utf-8',
  '.xml'  : 'application/xml; charset=utf-8',
};

/**
 * Resolve a request path to an absolute file path inside distDir.
 * Returns null if the resolved path escapes the jail.
 */
function resolveSafe(distDir, reqPath) {
  // Strip query string
  const pathname = reqPath.split('?')[0].split('#')[0];
  // Decode and normalise
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (_) { decoded = pathname; }
  const normalised = path.normalize(decoded);
  const abs = path.join(distDir, normalised);
  // Jail check – must still start with distDir
  if (!abs.startsWith(distDir + path.sep) && abs !== distDir) return null;
  return abs;
}

/**
 * Proxy an /api request to apiUrl, streaming bodies and forwarding headers.
 * On ECONNREFUSED / ECONNRESET returns 502 with a JSON error body.
 */
function proxyApi(req, res, apiUrl) {
  const target = new url.URL(req.url, apiUrl);
  const options = {
    hostname: target.hostname,
    port    : target.port || (target.protocol === 'https:' ? 443 : 80),
    path    : target.pathname + (target.search || ''),
    method  : req.method,
    headers : Object.assign({}, req.headers, { host: target.host }),
  };

  const proto = target.protocol === 'https:' ? require('https') : http;
  const proxyReq = proto.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    const down = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND';
    const status = down ? 502 : 500;
    const body = JSON.stringify({
      error: down ? 'api_unavailable' : 'proxy_error',
      message: down
        ? 'The LSS API is not running. Start it with: php artisan serve'
        : err.message,
    });
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(body);
  });

  req.pipe(proxyReq, { end: true });
}

/**
 * Serve a static file from distDir. Falls back to index.html for SPA routes.
 */
function serveStatic(req, res, distDir) {
  const abs = resolveSafe(distDir, req.url);
  if (!abs) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // Try exact path, then with /index.html appended for directories
  const candidates = [abs, path.join(abs, 'index.html')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext  = path.extname(candidate).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(candidate).pipe(res);
      return;
    }
  }

  // SPA fallback: serve index.html for any unknown path
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(index).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

/**
 * createServer(distDir, apiUrl) → Promise<{ server, port }>
 *
 * distDir  – absolute path to apps/web/dist
 * apiUrl   – base URL for API proxy (e.g. 'http://127.0.0.1:8000')
 */
function createServer(distDir, apiUrl) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      proxyApi(req, res, apiUrl);
    } else {
      serveStatic(req, res, distDir);
    }
  });

  return new Promise((resolve, reject) => {
    // Port 0 → OS picks a free port
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on('error', reject);
  });
}

module.exports = { createServer };
