/**
 * MEYWAY · Railway Edition — entry point.
 */
import { ensureDirs, PORT, PANEL_PORTS, PORT_CONFLICT, MUX_PORT, DATA_DIR, BIN, APP, IS_RAILWAY, RAILWAY, VERBOSE_STARTUP_LOGS } from './env.js';
import { auditEnvironment, requirementBanner } from './guard.js';
import { load, get } from './store.js';
import { Runtime } from './runtime.js';
import { createPanelServer } from './http/server.js';

/* ── boot guard: variables + volume are mandatory ─────────────────────── */
const guard = auditEnvironment({ dataDir: process.env.DATA_DIR || process.env.NL_DATA_DIR || '', volumeMount: RAILWAY.volumePath });
if (guard.warn.length) {
  for (const item of guard.warn) {
    console.warn(`[guard] ${item.en} — ${item.fix}`);
  }
}
if (!guard.ok) {
  console.error(requirementBanner(guard));
  process.exit(1);
}

ensureDirs();
load();

const runtime = new Runtime();
const api = { httpRoutes: () => runtime.httpRoutes() };
/** One HTTP listener per candidate port (a Node server can only bind once). */
const servers = [];

const boundPanelPorts = [];

function banner() {
  if (!VERBOSE_STARTUP_LOGS) {
    console.log(`[server] service listening on :${boundPanelPorts.join(', ') || PORT}`);
    return;
  }
  const facts = runtime.facts();
  const lines = [
    `[server] service ready · port ${boundPanelPorts.join(', ') || PORT}`,
    `[server] public domain : ${facts.publicHost || '(none)'}`,
  ];
  console.log(lines.join('\n'));
}

// Listen on every candidate panel port; the first success is enough to boot.
let booted = false;
function onListening(port) {
  if (booted) return;
  booted = true;
  runtime.usePanelPort(port);
  banner();
  runtime.boot().catch((err) => console.error('[boot]', err));
}

if (!PANEL_PORTS.length) {
  console.error('[server] no usable panel port');
}

for (const port of PANEL_PORTS) {
  const srv = createPanelServer({ runtime, api });
  srv.on('error', (err) => { if (VERBOSE_STARTUP_LOGS) console.error(`[server] :${port} — ${err.message}`); });
  srv.listen(port, '0.0.0.0', () => {
    boundPanelPorts.push(port);
    onListening(port);
  });
  servers.push(srv);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down…`);
  for (const srv of servers) { try { srv.close(); } catch { /* ignore */ } }
  try { await runtime.shutdown(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
