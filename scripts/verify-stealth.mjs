/**
 * Local Railway Stealth Verification Suite
 * Tests:
 * 1. Public Probe Test (asserts 200 for decoy/healthcheck, 404 for all probes without 302/401 leaks)
 * 2. Keyword Leak Scan (asserts zero matches for forbidden strings in public headers and bodies)
 * 3. Functional Test (panel under ADMIN_SECRET_PATH, portal under PORTAL_SECRET_PATH, subscription under SUB_SECRET_PATH pointing to TRANSPORT_PATH_PREFIX)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_PORT = 8089;
const ADMIN_PATH = 'adm-secret-88x';
const PORTAL_PATH = 'portal-secret-99y';
const SUB_PATH = 'sub-secret-77z';
const TRANSPORT_PREFIX = '/api/v2/stream';
const TEST_DATA_DIR = path.resolve('.data-test');

process.env.PORT = String(TEST_PORT);
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NL_ALLOW_EPHEMERAL = '1';
process.env.ADMIN_SECRET_PATH = ADMIN_PATH;
process.env.PORTAL_SECRET_PATH = PORTAL_PATH;
process.env.SUB_SECRET_PATH = SUB_PATH;
process.env.TRANSPORT_PATH_PREFIX = TRANSPORT_PREFIX;
process.env.VERBOSE_STARTUP_LOGS = 'false';
process.env.SESSION_COOKIE_NAME = 'sid';

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

// Dynamic imports to pick up process.env
const { createPanelServer } = await import('../src/http/server.js');
const { Runtime } = await import('../src/runtime.js');
const { get: getDoc, set: setDoc, uid, hex, normalizeUser } = await import('../src/store.js');
const { subToken } = await import('../src/auth.js');

const runtime = new Runtime();
const api = { httpRoutes: () => runtime.httpRoutes() };
const server = createPanelServer({ runtime, api });

await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
console.log(`[test] test server running on http://127.0.0.1:${TEST_PORT}`);

// Seed a test user for portal and subscription tests
const doc = getDoc();
let testUser = (doc.users || [])[0];
if (!testUser) {
  testUser = normalizeUser({
    id: 'user1',
    name: 'testsubscriber',
    enabled: true,
  });
  setDoc((d) => { d.users = [testUser]; });
}
const userSubToken = subToken(doc.secrets.server, testUser.id);

async function req(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      `http://127.0.0.1:${TEST_PORT}${pathname}`,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      }
    );
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

let failed = 0;
function assert(desc, condition, details = '') {
  if (condition) {
    console.log(`  ✓ ${desc}`);
  } else {
    console.error(`  ✗ ${desc} ${details ? '(' + details + ')' : ''}`);
    failed++;
  }
}

console.log('\n── 1. Public Probe Test ──');

// 1. Decoy root and healthcheck
const rootRes = await req('/');
assert('GET / returns 200 OK', rootRes.status === 200, `status: ${rootRes.status}`);
assert('GET / serves Decoy HTML', rootRes.body.includes('Alex Rivera') && rootRes.body.includes('Systems Engineer'));

const robotsRes = await req('/robots.txt');
assert('GET /robots.txt returns 200 OK', robotsRes.status === 200);

const faviconRes = await req('/favicon.ico');
assert('GET /favicon.ico returns 200 OK', faviconRes.status === 200);

const statusRes = await req('/status');
assert('GET /status returns 200 OK', statusRes.status === 200 && statusRes.body.includes('OK'));

// Check railway.json healthcheck
const railwayJson = JSON.parse(fs.readFileSync('railway.json', 'utf8'));
const hcPath = railwayJson.deploy?.healthcheckPath || '/';
const hcRes = await req(hcPath);
assert(`railway.json healthcheck (${hcPath}) returns 200 OK`, hcRes.status === 200);

// Probes that MUST return 404 (never 302, 401, or 500)
const probes = [
  '/admin',
  '/panel',
  '/portal',
  '/login',
  '/api',
  '/api/state',
  '/api/bootstrap',
  '/sub/test',
  '/u/test',
  '/ws',
  '/health',
  '/assets/v2rayn.png',
  '/assets/sing-box.svg',
  '/style.css',
  '/app.js',
  '/sprite.svg',
  `/${SUB_PATH}/invalid-token-123`,
  `/${PORTAL_PATH}/invalid-token-123`,
  `${TRANSPORT_PREFIX}/invalid-stream`,
];

const publicResponses = [rootRes, robotsRes, faviconRes, statusRes];

for (const p of probes) {
  const res = await req(p);
  publicResponses.push(res);
  assert(
    `Probe ${p} returns decoy 404 (no 302/401/JSON leak)`,
    res.status === 404 && !res.headers['location'] && !res.body.includes('"error"'),
    `status: ${res.status}, body: ${res.body.slice(0, 40)}`
  );
}

console.log('\n── 2. Keyword Leak Scan ──');
const FORBIDDEN_REGEX = /(meyway|railynx|xray|sing-box|vless|vmess|trojan|shadowsocks|v2ray|hiddify|clash|mtproto|proxy|vpn)/i;

let leakCount = 0;
for (const [idx, r] of publicResponses.entries()) {
  const headerStr = JSON.stringify(r.headers);
  const bodyStr = r.body;

  const headerMatch = headerStr.match(FORBIDDEN_REGEX);
  if (headerMatch) {
    console.error(`  ✗ Keyword leak in headers for probe #${idx}: ${headerMatch[0]}`);
    leakCount++;
  }

  const bodyMatch = bodyStr.match(FORBIDDEN_REGEX);
  if (bodyMatch) {
    console.error(`  ✗ Keyword leak in body for probe #${idx}: ${bodyMatch[0]}`);
    leakCount++;
  }
}
assert('Zero keyword leaks in all public HTTP headers and bodies', leakCount === 0, `leaks: ${leakCount}`);

console.log('\n── 3. Functional Test ──');

// Admin panel loads under secret path
const adminRes = await req(`/${ADMIN_PATH}`);
assert(`Admin panel loads under /${ADMIN_PATH}`, adminRes.status === 200 && adminRes.body.includes('Control Console'));
assert('Admin panel injects window.__ADMIN_BASE_PATH', adminRes.body.includes(`window.__ADMIN_BASE_PATH="/${ADMIN_PATH}"`));

const adminAppRes = await req(`/${ADMIN_PATH}/app.js`);
assert(`Admin assets load under /${ADMIN_PATH}/app.js`, adminAppRes.status === 200);

const adminApiRes = await req(`/${ADMIN_PATH}/api/bootstrap`);
assert(`Admin API loads under /${ADMIN_PATH}/api/bootstrap`, adminApiRes.status === 200 && adminApiRes.body.includes('needsSetup'));

// Portal loads under secret path with valid token
const portalRes = await req(`/${PORTAL_PATH}/${userSubToken}`);
assert(`Portal loads under /${PORTAL_PATH}/${userSubToken}`, portalRes.status === 200 && portalRes.body.includes('Subscriber'));

const portalJsonRes = await req(`/${PORTAL_PATH}/${userSubToken}?json=1`);
const portalData = JSON.parse(portalJsonRes.body);
assert(`Portal JSON returns valid user data`, portalJsonRes.status === 200 && portalData.name === testUser.name);
assert(`Portal JSON points subscription URL to /${SUB_PATH}`, portalData.subUrl.includes(`/${SUB_PATH}/${userSubToken}`));

// Subscription loads under secret path
const subRes = await req(`/${SUB_PATH}/${userSubToken}`);
assert(`Subscription loads under /${SUB_PATH}/${userSubToken}`, subRes.status === 200 && subRes.body.length > 0);

// Subscription links format and transport path check
const subLinksRes = await req(`/${SUB_PATH}/${userSubToken}?format=links`);
assert('Raw links subscription returns 200', subLinksRes.status === 200);
const links = subLinksRes.body.split('\n').filter((l) => l.startsWith('vless://') || l.startsWith('vmess://') || l.startsWith('trojan://'));
assert('Subscription generates links', links.length > 0, `found: ${links.length}`);

// Check that edge-routed links point to TRANSPORT_PREFIX and port 443
const httpLink = links.find((l) => l.includes(encodeURIComponent(TRANSPORT_PREFIX)) || l.includes(TRANSPORT_PREFIX));
assert(
  `Subscription link uses TRANSPORT_PATH_PREFIX (${TRANSPORT_PREFIX})`,
  Boolean(httpLink),
  `links: ${links.slice(0, 2).join(' ')}`
);

// Run preflight check
console.log('\n── 4. Preflight Script Test ──');
const preflight = spawnSync('node', ['scripts/preflight.js'], {
  env: { ...process.env, DATA_DIR: TEST_DATA_DIR, NL_ALLOW_EPHEMERAL: '1' },
  encoding: 'utf8',
});
assert('scripts/preflight.js passes', preflight.status === 0, preflight.stderr || preflight.stdout);

server.close();
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

console.log(`\nVerification finished: ${failed === 0 ? 'ALL PASSED' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
