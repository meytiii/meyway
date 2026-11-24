import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { DECOY_UPSTREAM_URL } from '../env.js';

const DECOY_FAVICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAAP0lEQVRYhe3PsQ0AIAwDwST7r8wM8QFQgRJ3nla21b33A3h6Wn24yR4AAAAAAAAAAAAAAAAAwA6g6r38gJ8BwAOmbT1bW9y3+gAAAABJRU5ErkJggg==',
  'base64'
);

const DECOY_ROBOTS = `User-agent: *
Allow: /
`;

const DECOY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alex Rivera &mdash; Systems &amp; Infrastructure</title>
<meta name="description" content="Technical notes on distributed systems, container orchestration, and edge infrastructure.">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<style>
:root {
  --bg: #0e1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f8fa;
    --surface: #ffffff;
    --border: #d0d7de;
    --text: #1f2328;
    --muted: #656d76;
    --accent: #0969da;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  padding: 40px 20px;
}
.container {
  max-width: 680px;
  margin: 0 auto;
}
header {
  margin-bottom: 48px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 24px;
}
h1 {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}
.bio {
  color: var(--muted);
  font-size: 0.95rem;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-family: var(--font-mono);
  color: var(--muted);
  margin-top: 12px;
}
.dot {
  width: 8px;
  height: 8px;
  background: #2ea043;
  border-radius: 50%;
}
section {
  margin-bottom: 36px;
}
h2 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 16px;
}
.post-list {
  list-style: none;
}
.post-item {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.post-title {
  color: var(--text);
  text-decoration: none;
  font-weight: 500;
  font-size: 1rem;
}
.post-title:hover {
  color: var(--accent);
}
.post-meta {
  font-size: 0.8rem;
  color: var(--muted);
  font-family: var(--font-mono);
}
.post-desc {
  font-size: 0.9rem;
  color: var(--muted);
}
footer {
  margin-top: 60px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 0.8rem;
  color: var(--muted);
  font-family: var(--font-mono);
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Alex Rivera</h1>
    <p class="bio">Systems Engineer &middot; Cloud Architecture, Edge Routing &amp; Distributed Telemetry.</p>
    <div class="status-pill">
      <span class="dot"></span>
      <span>All edge regions operational</span>
    </div>
  </header>

  <section>
    <h2>Engineering Notes</h2>
    <ul class="post-list">
      <li class="post-item">
        <a class="post-title" href="#notes-edge">Zero-Downtime Traffic Migration on Container Edges</a>
        <span class="post-meta">2026-11-12 &middot; 8 min read</span>
        <p class="post-desc">Strategies for atomic configuration swapping and graceful draining across reverse gateway fleets.</p>
      </li>
      <li class="post-item">
        <a class="post-title" href="#notes-http2">Optimizing HTTP/2 Connection Pooling and Keep-Alive</a>
        <span class="post-meta">2026-10-28 &middot; 6 min read</span>
        <p class="post-desc">Mitigating head-of-line blocking and analyzing round-trip latency on single-port edge topologies.</p>
      </li>
      <li class="post-item">
        <a class="post-title" href="#notes-stateless">Stateless Storage Patterns for Ephemeral Node Runtimes</a>
        <span class="post-meta">2026-09-14 &middot; 5 min read</span>
        <p class="post-desc">Balancing local volatile caching with resilient persistence layers on modern cloud platforms.</p>
      </li>
    </ul>
  </section>

  <footer>
    <p>&copy; 2026 Alex Rivera &middot; Powered by static micro-edge</p>
  </footer>
</div>
</body>
</html>`;

const DECOY_404_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 Not Found</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<style>
:root {
  --bg: #0e1117;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f8fa;
    --text: #1f2328;
    --muted: #656d76;
    --accent: #0969da;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}
.box {
  max-width: 420px;
  text-align: center;
}
h1 {
  font-size: 3rem;
  font-family: var(--font-mono);
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--muted);
}
p {
  color: var(--muted);
  font-size: 0.95rem;
  margin-bottom: 24px;
}
a {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--accent);
  color: #ffffff;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
}
a:hover {
  opacity: 0.9;
}
</style>
</head>
<body>
<div class="box">
  <h1>404</h1>
  <p>The document or resource you requested could not be located on this server.</p>
  <a href="/">Return to Index</a>
</div>
</body>
</html>`;

export function serveDecoy404(req, res) {
  if (DECOY_UPSTREAM_URL) {
    return proxyDecoyUpstream(req, res, '/404');
  }
  const body = Buffer.from(DECOY_404_HTML, 'utf8');
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(body);
}

export function serveDecoy(req, res, urlPath) {
  if (DECOY_UPSTREAM_URL) {
    return proxyDecoyUpstream(req, res, urlPath);
  }

  if (urlPath === '/' || urlPath === '/index.html') {
    const body = Buffer.from(DECOY_HTML, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(body);
    return true;
  }

  if (urlPath === '/favicon.ico') {
    res.writeHead(200, {
      'Content-Type': 'image/x-icon',
      'Content-Length': DECOY_FAVICON.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(DECOY_FAVICON);
    return true;
  }

  if (urlPath === '/robots.txt') {
    const body = Buffer.from(DECOY_ROBOTS, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(body);
    return true;
  }

  if (urlPath === '/status') {
    const body = Buffer.from('OK\n', 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return true;
  }

  serveDecoy404(req, res);
  return true;
}

function proxyDecoyUpstream(req, res, targetPath) {
  try {
    const targetUrl = new URL(targetPath || req.url, DECOY_UPSTREAM_URL);
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const headers = { ...req.headers, host: targetUrl.host };
    delete headers['accept-encoding'];

    const proxyReq = client.request(
      targetUrl,
      {
        method: req.method,
        headers,
        timeout: 10000,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      fallbackStaticDecoy(req, res, targetPath);
    });

    proxyReq.on('error', () => {
      fallbackStaticDecoy(req, res, targetPath);
    });

    req.pipe(proxyReq);
  } catch {
    fallbackStaticDecoy(req, res, targetPath);
  }
}

function fallbackStaticDecoy(req, res, urlPath) {
  if (res.headersSent) return;
  if (urlPath === '/' || urlPath === '/index.html') {
    const body = Buffer.from(DECOY_HTML, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  } else {
    const body = Buffer.from(DECOY_404_HTML, 'utf8');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  }
}
