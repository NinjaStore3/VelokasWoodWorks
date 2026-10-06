// End-to-end API tests: runs the real Worker with `wrangler dev` on a random
// port, against a throwaway local D1 database with the migrations applied.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const PASSWORD = 'api-test-password';
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };

let server;
let stateDir;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/config`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('wrangler dev did not start in time');
}

before(async () => {
  stateDir = mkdtempSync(join(tmpdir(), 'velokas-api-'));
  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir],
    { env, encoding: 'utf8' },
  );
  assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);

  server = spawn(
    process.execPath,
    [
      WRANGLER, 'dev',
      '--port', String(PORT),
      '--ip', '127.0.0.1',
      '--persist-to', stateDir,
      '--var', `ADMIN_PASSWORD:${PASSWORD}`,
      '--show-interactive-dev-session=false',
      '--log-level', 'error',
    ],
    { env, stdio: 'ignore', detached: true },
  );
  await waitForServer();
});

after(() => {
  if (server) {
    try {
      process.kill(-server.pid); // the whole group: wrangler + workerd
    } catch {
      /* already gone */
    }
  }
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

function call(method, path, { body, cookie, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(password = PASSWORD) {
  const response = await call('POST', '/api/admin/login', { body: { password } });
  const setCookie = response.headers.getSetCookie()[0] ?? '';
  return { response, setCookie, cookie: setCookie.split(';')[0] };
}

test('public config serves the seeded prices from the mockup', async () => {
  const response = await call('GET', '/api/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const config = await response.json();
  assert.equal(config.settings.businessName, 'Velokas Woodworks');
  assert.equal(config.settings.vatRate, 24);
  assert.deepEqual(config.materials.map((m) => [m.name, m.price]), [['Μελαμίνη', 320]]);
  assert.deepEqual(
    config.extras.map((e) => e.price),
    [195, 80, 40, 22, 40, 50, 100, 80],
  );
  assert.equal(config.costs.length, 6);
});

test('static files are served with security headers', async () => {
  const response = await fetch(`${BASE}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal((await fetch(`${BASE}/_headers`)).status, 404);
});

test('admin endpoints need a session', async () => {
  assert.equal((await call('GET', '/api/admin/config')).status, 401);
  const session = await (await call('GET', '/api/admin/session')).json();
  assert.deepEqual(session, { configured: true, authenticated: false });
});

test('login rejects a wrong password and cross-site requests', async () => {
  const wrong = await login('nope');
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.setCookie, '');

  const crossSite = await call('POST', '/api/admin/login', {
    body: { password: PASSWORD },
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);

  const form = await call('POST', '/api/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(form.status, 415);
});

test('login sets a locked-down session cookie', async () => {
  const { response, setCookie, cookie } = await login();
  assert.equal(response.status, 200);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api\/admin/);
  const session = await (await call('GET', '/api/admin/session', { cookie })).json();
  assert.equal(session.authenticated, true);
});

test('saving settings updates what the calculator sees', async () => {
  const { cookie } = await login();
  const current = await (await call('GET', '/api/admin/config', { cookie })).json();

  current.materials.push({ name: 'Λάκα', price: 450.5, active: true });
  current.extras[0].price = 205;
  current.extras[7].active = false; // hide "Κάδος"
  current.settings.vatRate = 13;

  const saved = await call('PUT', '/api/admin/config', { cookie, body: current });
  assert.equal(saved.status, 200);
  const savedConfig = await saved.json();
  assert.equal(savedConfig.version, current.version + 1);
  assert.equal(savedConfig.extras.length, 8, 'admins still see hidden items');

  const publicConfig = await (await call('GET', '/api/config')).json();
  assert.deepEqual(publicConfig.materials.map((m) => m.name), ['Μελαμίνη', 'Λάκα']);
  assert.equal(publicConfig.materials[1].price, 450.5);
  assert.equal(publicConfig.extras[0].price, 205);
  assert.equal(publicConfig.extras.length, 7, 'hidden extras are not public');
  assert.equal(publicConfig.settings.vatRate, 13);
  assert.equal(publicConfig.extras[0].id, current.extras[0].id, 'existing items keep their ids');

  // Saving again with the old version must not overwrite the newer settings.
  const stale = await call('PUT', '/api/admin/config', { cookie, body: current });
  assert.equal(stale.status, 409);
});

test('invalid settings are rejected with readable errors', async () => {
  const { cookie } = await login();
  const current = await (await call('GET', '/api/admin/config', { cookie })).json();
  current.materials = current.materials.map((m) => ({ ...m, active: false }));
  current.extras[0].name = '';

  const response = await call('PUT', '/api/admin/config', { cookie, body: current });
  assert.equal(response.status, 400);
  const { errors } = await response.json();
  assert.ok(errors.some((e) => e.includes('ενεργό υλικό')));
  assert.ok(errors.some((e) => e.includes('όνομα')));
});

test('logout ends the session', async () => {
  const { cookie } = await login();
  const response = await call('POST', '/api/admin/logout', { cookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal((await call('GET', '/api/admin/config', { cookie })).status, 401);
});

test('unknown routes and methods', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  const response = await call('DELETE', '/api/config');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

// Keep last: it locks out logins from this IP for 15 minutes.
test('password guessing is throttled', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await login('guess')).response.status);
  assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
  assert.equal((await login()).response.status, 429, 'even the right password waits');
});
