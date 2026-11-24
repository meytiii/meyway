/**
 * Stealth HTTP Server for Railway Single-Port Deployment.
 *
 * Exposes a clean decoy website at root (or reverse-proxies upstream),
 * gates all admin, portal, and subscription features behind randomized/env-set secret paths,
 * multiplexes edge transport routes, and returns decoy 404 for all probes.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { ROOT } from '../env.js';
import { handleApi } from './api.js';
import { serveDecoy, serveDecoy404 } from './decoy.js';
import { getAdminSecretPath, getPortalSecretPath, getSubSecretPath } from '../store.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const STATIC_CACHE = new Map();

function staticEntry(file, injectScript = '') {
  const stat = fs.statSync(file);
  const cacheKey = `${file}:${injectScript ? 'injected:' + injectScript : 'raw'}`;
  const hit = STATIC_CACHE.get(cacheKey);
  if (hit && hit.mtime === stat.mtimeMs) return hit;

  let raw = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();

  if (injectScript && ext === '.html') {
    let str = raw.toString('utf8');
    if (str.includes('<head>')) {
      str = str.replace('<head>', `<head>${injectScript}`);
    } else if (str.includes('</head>')) {
      str = str.replace('</head>', `${injectScript}</head>`);
    } else {
      str = `${injectScript}${str}`;
    }
    raw = Buffer.from(str, 'utf8');
  }

  const compressible = /^(text\/|application\/(json|javascript|xml))/.test(MIME[ext] || '');
  const entry = {
    mtime: stat.mtimeMs,
    raw,
    gzip: compressible && raw.length > 1024 ? zlib.gzipSync(raw, { level: 6 }) : null,
    type: MIME[ext] || 'application/octet-stream',
    ext,
  };
  STATIC_CACHE.set(cacheKey, entry);
  return entry;
}

function serveGatedStatic(req, res, relPath, injectScript = '') {
  const cleanRel = relPath.replace(/^\/+/, '').split('?')[0];
  if (cleanRel.includes('..')) {
    serveDecoy404(req, res);
    return true;
  }
  const file = path.join(PUBLIC_DIR, cleanRel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    serveDecoy404(req, res);
    return true;
  }

  const entry = staticEntry(file, injectScript);
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = acceptsGzip && entry.gzip ? entry.gzip : entry.raw;
  const headers = {
    'Content-Type': entry.type,
    'Content-Length': body.length,
    'Cache-Control': ['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest'].includes(entry.ext)
      ? 'no-cache'
      : 'public, max-age=604800',
    ETag: `"${entry.mtime.toString(36)}-${entry.raw.length.toString(36)}"`,
    Vary: 'Accept-Encoding',
  };
  if (entry.gzip && acceptsGzip) headers['Content-Encoding'] = 'gzip';
  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

export function createPanelServer({ runtime, api }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Security header hygiene & remove signature headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.removeHeader('X-Powered-By');

    // 1. Healthcheck & Decoy routes at root
    if (url.pathname === '/' || url.pathname === '/favicon.ico' || url.pathname === '/robots.txt' || url.pathname === '/status') {
      serveDecoy(req, res, url.pathname);
      return;
    }

    const adminPath = getAdminSecretPath();
    const portalPath = getPortalSecretPath();
    const subPath = getSubSecretPath();

    const adminPrefix = `/${adminPath}`;
    const portalPrefix = `/${portalPath}`;
    const subPrefix = `/${subPath}`;

    // 2. Secret Gated Admin Panel & APIs
    if (url.pathname === adminPrefix || url.pathname === `${adminPrefix}/` || url.pathname === `${adminPrefix}/index.html`) {
      const injectScript = `<base href="${adminPrefix}/"><script>window.__ADMIN_BASE_PATH="${adminPrefix}";</script>`;
      serveGatedStatic(req, res, 'index.html', injectScript);
      return;
    }

    if (url.pathname.startsWith(`${adminPrefix}/api/`)) {
      const subUrl = new URL(url.toString());
      subUrl.pathname = url.pathname.slice(adminPrefix.length); // e.g. /api/...
      handleApi({ req, res, url: subUrl, runtime, api, basePath: adminPrefix }).catch((err) => {
        console.error('[api]', err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      });
      return;
    }

    if (url.pathname.startsWith(`${adminPrefix}/`)) {
      const rel = url.pathname.slice(adminPrefix.length + 1);
      serveGatedStatic(req, res, rel);
      return;
    }

    // 3. Secret Gated Subscriber Portal
    if (url.pathname === portalPrefix || url.pathname === `${portalPrefix}/`) {
      serveDecoy404(req, res);
      return;
    }

    if (url.pathname.startsWith(`${portalPrefix}/`)) {
      const remainder = url.pathname.slice(portalPrefix.length + 1);
      const parts = remainder.split('/');
      const token = parts[0];

      // Handle asset requests under portal prefix (e.g. /portal-xxx/style.css)
      if (['style.css', 'extra.css', 'js/qrcode.js', 'sprite.svg', 'fonts', 'assets'].some((p) => remainder.startsWith(p))) {
        serveGatedStatic(req, res, remainder);
        return;
      }

      if (token && parts.length === 1) {
        // Forward to API router to validate token and serve portal UI or JSON
        const portalUrl = new URL(url.toString());
        portalUrl.pathname = `/u/${token}`;
        handleApi({
          req,
          res,
          url: portalUrl,
          runtime,
          api,
          portalBasePath: portalPrefix,
          subBasePath: subPrefix,
          onInvalid: () => serveDecoy404(req, res),
        }).catch(() => serveDecoy404(req, res));
        return;
      }
    }

    // 4. Secret Gated Subscriptions
    if (url.pathname.startsWith(`${subPrefix}/`)) {
      const remainder = url.pathname.slice(subPrefix.length + 1);
      const subUrl = new URL(url.toString());
      subUrl.pathname = `/sub/${remainder}`;
      handleApi({
        req,
        res,
        url: subUrl,
        runtime,
        api,
        onInvalid: () => serveDecoy404(req, res),
      }).catch(() => serveDecoy404(req, res));
      return;
    }

    // 5. Camouflaged Inbound Proxy Transports (WS / HTTPUpgrade / gRPC / XHTTP)
    for (const route of api.httpRoutes()) {
      if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
        proxyHttp(req, res, route.port);
        return;
      }
    }

    // 6. Unknown route fallback: Decoy 404 for all probes
    serveDecoy404(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    for (const route of api.httpRoutes()) {
      if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
        proxyUpgrade(req, socket, head, route.port);
        return;
      }
    }
    socket.destroy();
  });

  server.keepAliveTimeout = 65000;
  return server;
}

function proxyHttp(req, res, port) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['accept-encoding'];
  const proxyReq = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers },
    (proxyRes) => {
      // If the backend returns an error on a non-tunnel HTTP probe, fall back to decoy 404
      if (proxyRes.statusCode >= 400) {
        proxyRes.resume();
        return serveDecoy404(req, res);
      }
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) serveDecoy404(req, res);
  });
  req.pipe(proxyReq);
}

function proxyUpgrade(req, socket, head, port) {
  const upstream = net.connect({ host: '127.0.0.1', port }, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
}
