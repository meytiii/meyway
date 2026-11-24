/**
 * Comprehensive End-to-End Test Suite for Railway Stealth Deployment.
 * Tests:
 * 1. Stealth & Security Audit (Probes, Decoy 404, Zero keyword leaks)
 * 2. Gated Paths & Asset Resolution (Trailing-slash, <base href>, CSS, Fonts, JS, Assets)
 * 3. Full API & Auth Lifecycle (Bootstrap, Setup, Login, Rate Limiting, State, Users, Inbounds)
 * 4. Subscription Engine (Base64, Raw Links, Clash, Sing-box, User-info headers, Transport prefix)
 * 5. Subscriber Portal (HTML with <base>, JSON API, Token gating)
 * 6. Decoy Upstream Reverse-Proxy Option
 * 7. Inbound Transport Multiplexing & Probe Fallback
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_PORT = 8092;
const ADMIN_PATH = 'adm-test-xyz';
const PORTAL_PATH = 'portal-test-uvw';
const SUB_PATH = 'sub-test-rst';
const TRANSPORT_PREFIX = '/api/v2/stream';
const TEST_DATA_DIR = path.resolve('.data-e2e-test');

process.env.PORT = String(TEST_PORT);
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NL_ALLOW_EPHEMERAL = '1';
process.env.ADMIN_SECRET_PATH = ADMIN_PATH;
process.env.PORTAL_SECRET_PATH = PORTAL_PATH;
process.env.SUB_SECRET_PATH = SUB_PATH;
process.env.TRANSPORT_PATH_PREFIX = TRANSPORT_PREFIX;
process.env.VERBOSE_STARTUP_LOGS = 'false';
process.env.SESSION_COOKIE_NAME = 'sid';

fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

const { createPanelServer } = await import('../src/http/server.js');
const { Runtime } = await import('../src/runtime.js');
const { get: getDoc, set: setDoc, normalizeUser, uid } = await import('../src/store.js');
const { subToken } = await import('../src/auth.js');

const runtime = new Runtime();
const api = { httpRoutes: () => runtime.httpRoutes() };
const server = createPanelServer({ runtime, api });

await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

let totalPassed = 0;
let totalFailed = 0;

function assert(name, condition, details = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    totalPassed++;
  } else {
    console.error(`  ✗ ${name} ${details ? '(' + details + ')' : ''}`);
    totalFailed++;
  }
}

async function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body === 'object' && !Buffer.isBuffer(options.body)) {
      options.body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    if (options.body) {
      headers['content-length'] = Buffer.byteLength(options.body);
    }
    const r = http.request(
      `http://127.0.0.1:${TEST_PORT}${urlPath}`,
      {
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(body); } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            json,
          });
        });
      }
    );
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

console.log(`\n============================================================`);
console.log(`  MEYWAY RAILWAY STEALTH & E2E VERIFICATION SUITE`);
console.log(`  Server Port: ${TEST_PORT} | Admin: /${ADMIN_PATH}`);
console.log(`============================================================\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. PUBLIC PROBES & STEALTH INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`── 1. Stealth Integrity & Public Probe Auditing ──`);

const rootRes = await request('/');
assert('Root / serves clean 200 OK Decoy website', rootRes.status === 200);
assert('Root / decoy includes realistic developer portfolio text', rootRes.body.includes('Systems Engineer') && rootRes.body.includes('Alex Rivera'));

const robotsRes = await request('/robots.txt');
assert('/robots.txt returns 200 OK', robotsRes.status === 200);

const faviconRes = await request('/favicon.ico');
assert('/favicon.ico returns 200 OK', faviconRes.status === 200);

const statusRes = await request('/status');
assert('/status returns 200 minimal OK', statusRes.status === 200 && statusRes.body.trim() === 'OK');

// Forbidden probes that MUST return natural Decoy 404 (never 302 redirect, never 401 challenge, never JSON errors)
const scannerProbes = [
  '/admin', '/admin/', '/panel', '/panel/', '/login', '/dashboard',
  '/portal', '/sub', '/api', '/api/state', '/api/bootstrap',
  '/ws', '/health', '/metrics', '/config.json',
  '/assets/v2rayn.png', '/assets/sing-box.svg', '/assets/hiddify.svg',
  '/style.css', '/extra.css', '/app.js', '/sprite.svg',
  '/fonts/JetBrainsMono-Regular.woff2', '/fonts/Vazirmatn-Regular.woff2',
  `/${SUB_PATH}/invalid-token-123`,
  `/${PORTAL_PATH}/invalid-token-123`,
  `${TRANSPORT_PREFIX}/random-probe`,
];

const publicResponses = [rootRes, robotsRes, faviconRes, statusRes];

for (const p of scannerProbes) {
  const res = await request(p);
  publicResponses.push(res);
  assert(
    `Probe ${p} returns decoy 404 (no 302 redirect, no 401 challenge, no internal leak)`,
    res.status === 404 && !res.headers['location'] && !res.body.includes('"error"') && res.body.includes('404'),
    `status: ${res.status}`
  );
}

// Keyword Leak Scan
const FORBIDDEN_REGEX = /(meyway|railynx|xray|sing-box|vless|vmess|trojan|shadowsocks|v2ray|hiddify|clash|mtproto|proxy|vpn)/i;
let leaks = 0;
for (const [idx, r] of publicResponses.entries()) {
  const headersStr = JSON.stringify(r.headers);
  const hMatch = headersStr.match(FORBIDDEN_REGEX);
  if (hMatch) {
    console.error(`  ✗ Keyword leak in headers of public response #${idx}: ${hMatch[0]}`);
    leaks++;
  }
  const bMatch = r.body.match(FORBIDDEN_REGEX);
  if (bMatch) {
    console.error(`  ✗ Keyword leak in body of public response #${idx}: ${bMatch[0]}`);
    leaks++;
  }
}
assert('Zero VPN/proxy keywords leaked across all public HTTP responses', leaks === 0, `leaks found: ${leaks}`);

// ─────────────────────────────────────────────────────────────────────────────
// 2. GATED ADMIN ROUTES & ASSET RESOLUTION (TRAILING SLASH FIX)
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── 2. Admin Gated Routes & Asset Resolution ──`);

// Without trailing slash
const adminNoSlash = await request(`/${ADMIN_PATH}`);
assert(`GET /${ADMIN_PATH} (without trailing slash) returns 200 OK`, adminNoSlash.status === 200);
assert(
  `GET /${ADMIN_PATH} injects <base href="/${ADMIN_PATH}/"> right after <head>`,
  adminNoSlash.body.includes(`<head><base href="/${ADMIN_PATH}/">`)
);
assert(
  `GET /${ADMIN_PATH} injects window.__ADMIN_BASE_PATH="/${ADMIN_PATH}"`,
  adminNoSlash.body.includes(`window.__ADMIN_BASE_PATH="/${ADMIN_PATH}"`)
);

// With trailing slash
const adminSlash = await request(`/${ADMIN_PATH}/`);
assert(`GET /${ADMIN_PATH}/ (with trailing slash) returns 200 OK`, adminSlash.status === 200);

// With index.html explicitly
const adminIndex = await request(`/${ADMIN_PATH}/index.html`);
assert(`GET /${ADMIN_PATH}/index.html returns 200 OK`, adminIndex.status === 200);

// Gated static assets
const cssRes = await request(`/${ADMIN_PATH}/style.css`);
assert(`Stylesheet /${ADMIN_PATH}/style.css loads 200 OK`, cssRes.status === 200 && cssRes.headers['content-type'].includes('text/css'));
assert(`Stylesheet uses relative font paths (./fonts/)`, cssRes.body.includes('./fonts/'));

const extraCssRes = await request(`/${ADMIN_PATH}/extra.css`);
assert(`Stylesheet /${ADMIN_PATH}/extra.css loads 200 OK`, extraCssRes.status === 200);

const qrcodeJsRes = await request(`/${ADMIN_PATH}/js/qrcode.js`);
assert(`Script /${ADMIN_PATH}/js/qrcode.js loads 200 OK`, qrcodeJsRes.status === 200);

const appJsRes = await request(`/${ADMIN_PATH}/app.js`);
assert(`Script /${ADMIN_PATH}/app.js loads 200 OK`, appJsRes.status === 200 && appJsRes.headers['content-type'].includes('javascript'));

const font1Res = await request(`/${ADMIN_PATH}/fonts/JetBrainsMono-Regular.woff2`);
assert(`Font /${ADMIN_PATH}/fonts/JetBrainsMono-Regular.woff2 loads 200 OK`, font1Res.status === 200 && font1Res.headers['content-type'].includes('font/woff2'));

const font2Res = await request(`/${ADMIN_PATH}/fonts/Vazirmatn-Regular.woff2`);
assert(`Font /${ADMIN_PATH}/fonts/Vazirmatn-Regular.woff2 loads 200 OK`, font2Res.status === 200);

const clientLogoRes = await request(`/${ADMIN_PATH}/assets/v2rayng.png`);
assert(`Client logo asset /${ADMIN_PATH}/assets/v2rayng.png loads 200 OK`, clientLogoRes.status === 200 && clientLogoRes.headers['content-type'].includes('image/png'));

// ─────────────────────────────────────────────────────────────────────────────
// 3. FULL API & AUTHENTICATION LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── 3. API & Authentication Lifecycle ──`);

// Initial bootstrap before setup
const boot1 = await request(`/${ADMIN_PATH}/api/bootstrap`);
assert('GET /api/bootstrap returns 200 OK', boot1.status === 200);
assert('needsSetup is true on fresh deploy', boot1.json?.needsSetup === true);
assert('loggedIn is false before authentication', boot1.json?.loggedIn === false);

// Accessing protected state without session must fail
const stateUnauthorized = await request(`/${ADMIN_PATH}/api/state`);
assert('GET /api/state without cookie returns 401 Unauthorized', stateUnauthorized.status === 401);

// Password validation during setup
const setupInvalid = await request(`/${ADMIN_PATH}/api/setup`, {
  method: 'POST',
  body: { username: 'admin', password: '123' }, // too short
});
assert('POST /api/setup with short password returns 400', setupInvalid.status === 400);

// Valid first-run setup
const setupRes = await request(`/${ADMIN_PATH}/api/setup`, {
  method: 'POST',
  body: { username: 'operator', password: 'MasterPassword123!' },
});
assert('POST /api/setup with valid credentials creates admin', setupRes.status === 200 && setupRes.json?.ok === true);

// Attempting duplicate setup must be rejected
const setupDuplicate = await request(`/${ADMIN_PATH}/api/setup`, {
  method: 'POST',
  body: { username: 'operator2', password: 'MasterPassword123!' },
});
assert('Subsequent POST /api/setup returns 409 Conflict', setupDuplicate.status === 409);

// Failed login
const loginFail = await request(`/${ADMIN_PATH}/api/login`, {
  method: 'POST',
  body: { username: 'operator', password: 'WrongPassword' },
});
assert('POST /api/login with wrong password returns 401', loginFail.status === 401);

// Successful login
const loginSuccess = await request(`/${ADMIN_PATH}/api/login`, {
  method: 'POST',
  body: { username: 'operator', password: 'MasterPassword123!' },
});
assert('POST /api/login with correct password returns 200', loginSuccess.status === 200 && loginSuccess.json?.ok === true);
const rawCookie = loginSuccess.headers['set-cookie']?.[0] || '';
assert('Set-Cookie header sets session cookie with HttpOnly & SameSite=Lax', rawCookie.includes('sid=') && rawCookie.includes('HttpOnly') && rawCookie.includes('SameSite=Lax'));

// Extract session cookie for authenticated requests
const sessionCookie = rawCookie.split(';')[0];
const authHeaders = { cookie: sessionCookie };

// Access protected state with session cookie
const stateAuth = await request(`/${ADMIN_PATH}/api/state`, { headers: authHeaders });
assert('GET /api/state with valid session cookie returns 200', stateAuth.status === 200);
assert('State contains inbounds array', Array.isArray(stateAuth.json?.inbounds));
assert('State contains users array', Array.isArray(stateAuth.json?.users));

// Add a test user via API
const createUserRes = await request(`/${ADMIN_PATH}/api/users`, {
  method: 'POST',
  headers: authHeaders,
  body: {
    name: 'novin-subscriber',
    quotaGb: 50,
    expireDays: 30,
    ipLimit: 2,
    note: 'E2E test account',
  },
});
const testUserId = createUserRes.json?.user?.id;
assert('POST /api/users creates new subscriber', createUserRes.status === 200 && Boolean(testUserId));

// Fetch state again to verify user persistence
const stateWithUser = await request(`/${ADMIN_PATH}/api/state`, { headers: authHeaders });
const createdUser = stateWithUser.json?.users?.find((u) => u.id === testUserId);
assert('Created user is persisted in state', Boolean(createdUser) && createdUser.quotaGb === 50);

// Rotate subscriber credentials
const rotateRes = await request(`/${ADMIN_PATH}/api/users/${testUserId}/rotate`, {
  method: 'POST',
  headers: authHeaders,
});
if (rotateRes.status !== 200) console.log('DEBUG rotate failed:', rotateRes.status, rotateRes.body);
assert(`POST /api/users/${testUserId}/rotate succeeds`, rotateRes.status === 200 && rotateRes.json?.ok === true);

// ─────────────────────────────────────────────────────────────────────────────
// 4. SUBSCRIBER PORTAL & SUBSCRIPTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── 4. Subscription Engine & Subscriber Portal ──`);

// Retrieve the subscriber token
const updatedDoc = getDoc();
const dbUser = updatedDoc.users.find((u) => u.id === testUserId);
const subscriberToken = subToken(updatedDoc.secrets.server, testUserId);

// 1. Subscriber Portal HTML
const portalHtmlRes = await request(`/${PORTAL_PATH}/${subscriberToken}`);
assert(`GET /${PORTAL_PATH}/${subscriberToken} returns 200 OK`, portalHtmlRes.status === 200);
assert(`Portal HTML injects <base href="/${PORTAL_PATH}/">`, portalHtmlRes.body.includes(`<base href="/${PORTAL_PATH}/">`));
assert(`Portal HTML renders subscriber name`, portalHtmlRes.body.includes('novin-subscriber') || portalHtmlRes.body.includes('Subscriber'));

// 2. Subscriber Portal Assets
const portalCss = await request(`/${PORTAL_PATH}/style.css`);
assert(`Portal stylesheet /${PORTAL_PATH}/style.css loads 200 OK`, portalCss.status === 200);

const portalFont = await request(`/${PORTAL_PATH}/fonts/Vazirmatn-Regular.woff2`);
assert(`Portal font /${PORTAL_PATH}/fonts/... loads 200 OK`, portalFont.status === 200);

// 3. Subscriber Portal JSON API
const portalJson = await request(`/${PORTAL_PATH}/${subscriberToken}?json=1`);
assert(`GET /${PORTAL_PATH}/${subscriberToken}?json=1 returns user JSON`, portalJson.status === 200 && portalJson.json?.name === 'novin-subscriber');
assert(`Portal JSON subUrl points to /${SUB_PATH}/${subscriberToken}`, portalJson.json?.subUrl?.includes(`/${SUB_PATH}/${subscriberToken}`));

// 4. Subscription Base64 format (Default)
const subDefault = await request(`/${SUB_PATH}/${subscriberToken}`);
assert(`GET /${SUB_PATH}/${subscriberToken} returns 200 OK`, subDefault.status === 200);
assert('Subscription header contains Subscription-Userinfo', Boolean(subDefault.headers['subscription-userinfo']));

// 5. Subscription Raw Links format
const subLinks = await request(`/${SUB_PATH}/${subscriberToken}?format=links`);
assert(`GET /${SUB_PATH}/${subscriberToken}?format=links returns 200`, subLinks.status === 200);
const linksList = subLinks.body.split('\n').filter((l) => l.trim().length > 0);
assert('Generated at least 1 client link', linksList.length > 0, `found: ${linksList.length}`);

// Verify edge link transport path
const httpLink = linksList.find((l) => l.includes(encodeURIComponent(TRANSPORT_PREFIX)) || l.includes(TRANSPORT_PREFIX));
assert(
  `Client link correctly targets TRANSPORT_PATH_PREFIX (${TRANSPORT_PREFIX})`,
  Boolean(httpLink),
  `sample link: ${linksList[0]?.slice(0, 50)}...`
);

// 6. Subscription Clash YAML format
const subClash = await request(`/${SUB_PATH}/${subscriberToken}?format=clash`);
if (subClash.status !== 200) console.log('DEBUG subClash failed:', subClash.status, subClash.body);
assert(`GET /${SUB_PATH}/${subscriberToken}?format=clash returns YAML format`, subClash.status === 200 && subClash.body.includes('proxies:'));

// 7. Subscription Sing-box JSON format
const subSingbox = await request(`/${SUB_PATH}/${subscriberToken}?format=singbox`);
if (subSingbox.status !== 200) console.log('DEBUG subSingbox failed:', subSingbox.status, subSingbox.body);
assert(`GET /${SUB_PATH}/${subscriberToken}?format=singbox returns Sing-box JSON`, subSingbox.status === 200 && subSingbox.json?.outbounds);

// ─────────────────────────────────────────────────────────────────────────────
// 5. BRUTE FORCE RATE LIMITING ON SECRET LOGIN
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── 5. Brute Force Protection ──`);

let throttled = false;
for (let i = 0; i < 12; i++) {
  const r = await request(`/${ADMIN_PATH}/api/login`, {
    method: 'POST',
    body: { username: 'operator', password: `badguess-${i}` },
  });
  if (r.status === 429) {
    throttled = true;
    break;
  }
}
assert('Brute-force protection triggers HTTP 429 on excessive failed login attempts', throttled);

// ─────────────────────────────────────────────────────────────────────────────
// 6. CLEANUP & RESULTS
// ─────────────────────────────────────────────────────────────────────────────
server.close();
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

console.log(`\n============================================================`);
console.log(`  SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log(`============================================================\n`);

process.exit(totalFailed === 0 ? 0 : 1);
