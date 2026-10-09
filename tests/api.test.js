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

test('public config serves the seeded prices and Panos\'s price list', async () => {
  const response = await call('GET', '/api/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const config = await response.json();
  assert.equal(config.settings.businessName, 'Velokas Woodworks');
  assert.equal(config.settings.vatRate, 24);
  assert.deepEqual(
    config.materials.map((m) => [m.section, m.name, m.price, m.unit]),
    [
      ['kitchen', 'Μελαμίνη', 260, 'm'],
      ['kitchen', 'PET', 330, 'm'],
      ['kitchen', 'Thermofoil', 410, 'm'],
      ['wardrobe', 'Ανοιγόμενη', 320, 'm'],
      ['wardrobe', 'Συρόμενη', 390, 'm'],
      ['door', 'Ανοιγόμενη', 400, 'pcs'],
      ['door', 'Συρόμενη', 600, 'pcs'],
    ],
  );
  const extras = (section) => config.extras.filter((e) => e.section === section).map((e) => [e.name, e.price, e.unit]);
  assert.deepEqual(extras('kitchen').map(([, price]) => price), [195, 80, 40, 22, 40, 50, 100, 80, 18, 5]);
  assert.deepEqual(extras('kitchen').at(-2), ['LED φωτισμός', 18, 'm']);
  assert.deepEqual(extras('wardrobe'), [
    ['Συρτάρι κανονικό', 35, 'pcs'],
    ['Συρτάρι soft close', 45, 'pcs'],
    ['Παντελονοθήκη', 60, 'pcs'],
    ['LED φωτισμός', 18, 'm'],
    ['Πόμολα', 30, 'pcs'],
  ]);
  assert.equal(config.costs.length, 6);
  assert.equal('section' in config.costs[0], false, 'cost lines belong to no job');
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

  current.materials.splice(1, 0, { name: 'Λάκα', price: 450.5, unit: 'm2', section: 'kitchen', active: true });
  current.extras[0].price = 205;
  current.extras[7].active = false; // hide "Κάδος"
  current.settings.vatRate = 13;

  const saved = await call('PUT', '/api/admin/config', { cookie, body: current });
  assert.equal(saved.status, 200);
  const savedConfig = await saved.json();
  assert.equal(savedConfig.version, current.version + 1);
  assert.equal(savedConfig.extras.length, 15, 'admins still see hidden items');

  const publicConfig = await (await call('GET', '/api/config')).json();
  assert.deepEqual(publicConfig.materials.slice(0, 3).map((m) => m.name), ['Μελαμίνη', 'Λάκα', 'PET']);
  assert.equal(publicConfig.materials[1].price, 450.5);
  assert.equal(publicConfig.materials[1].unit, 'm2');
  assert.deepEqual(
    publicConfig.materials.map((m) => m.section),
    ['kitchen', 'kitchen', 'kitchen', 'kitchen', 'wardrobe', 'wardrobe', 'door', 'door'],
    'saving keeps every item in its job',
  );
  assert.equal(publicConfig.extras.find((e) => e.name === 'Παντελονοθήκη').section, 'wardrobe');
  assert.equal(publicConfig.extras[0].price, 205);
  assert.equal(publicConfig.extras.length, 14, 'hidden extras are not public');
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

test('business details are saved and reach the PDF', async () => {
  const { cookie } = await login();
  const current = await (await call('GET', '/api/admin/config', { cookie })).json();
  assert.equal(current.settings.validityDays, 30, 'seeded default');
  Object.assign(current.settings, {
    phone: '210 1234567',
    email: 'info@velokas.gr',
    address: 'Αθήνα',
    vatId: '123456789',
    terms: 'Προκαταβολή 40%.\nΤοποθέτηση σε 5 εβδομάδες.',
    validityDays: 15,
    depositPercent: 40,
  });
  assert.equal((await call('PUT', '/api/admin/config', { cookie, body: current })).status, 200);
  const { settings } = await (await call('GET', '/api/config')).json();
  assert.equal(settings.email, 'info@velokas.gr');
  assert.equal(settings.terms, 'Προκαταβολή 40%.\nΤοποθέτηση σε 5 εβδομάδες.');
  assert.equal(settings.validityDays, 15);
  assert.equal(settings.depositPercent, 40);
});

function quoteBody(overrides = {}) {
  const customer = { name: 'Μαρία Παπαδάκη', phone: '6900000000', address: 'Χαλάνδρι' };
  return {
    customer,
    doc: {
      v: 1,
      date: '2026-10-06T10:00:00.000Z',
      validityDays: 30,
      customer,
      lines: [
        { kind: 'base', name: 'Βασική κουζίνα', detail: 'Μελαμίνη', qty: 4.6, unit: 'μ.', unitCents: 32000, totalCents: 1 },
        { kind: 'extra', name: 'Κάδος', detail: '', qty: 2, unit: 'τεμ.', unitCents: 8000, totalCents: 16000 },
      ],
      discountLabel: '10%',
      discountCents: 16320,
      vatRate: 24,
      depositPercent: 40,
      notes: 'Λευκό ματ.',
      grossCents: 1, // ignored: totals are worked out again
    },
    draft: { meters: '4,6', extras: { 8: { qty: '2', price: null } } },
    costCents: 50000,
    ...overrides,
  };
}

test('quotes are numbered per year and their totals recomputed', async () => {
  assert.equal((await call('GET', '/api/admin/quotes')).status, 401);
  assert.equal((await call('POST', '/api/admin/quotes', { body: quoteBody() })).status, 401);
  const { cookie } = await login();

  const created = await call('POST', '/api/admin/quotes', { cookie, body: quoteBody() });
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.equal(first.number, '2026-001');
  assert.equal(first.status, 'draft');
  assert.equal(first.doc.number, '2026-001');
  assert.equal(first.doc.lines[0].totalCents, 147200);
  assert.equal(first.doc.subtotalCents, 163200);
  assert.equal(first.netCents, 146880);
  assert.equal(first.doc.vatCents, 35251);
  assert.equal(first.grossCents, 182131);
  assert.equal(first.doc.depositCents, 72852);
  assert.equal(first.costCents, 50000);
  assert.deepEqual(first.draft, quoteBody().draft);

  const second = await (await call('POST', '/api/admin/quotes', { cookie, body: quoteBody({ status: 'sent' }) })).json();
  assert.equal(second.number, '2026-002');
  assert.equal(second.status, 'sent');

  // Half past midnight on 1 January in Athens is still 31 December in UTC.
  const newYear = quoteBody();
  newYear.doc.date = '2026-12-31T22:30:00.000Z';
  const third = await (await call('POST', '/api/admin/quotes', { cookie, body: newYear })).json();
  assert.equal(third.number, '2027-001');

  const { quotes } = await (await call('GET', '/api/admin/quotes', { cookie })).json();
  assert.deepEqual(quotes.map((q) => q.number), ['2027-001', '2026-002', '2026-001']);
  assert.equal('doc' in quotes[0], false, 'the list only has summaries');
  assert.deepEqual(quotes[2].customer, quoteBody().customer);
});

test('a quote can be edited, moved along and deleted', async () => {
  const { cookie } = await login();
  const created = await (await call('POST', '/api/admin/quotes', { cookie, body: quoteBody({ status: 'sent' }) })).json();
  const path = `/api/admin/quotes/${created.id}`;

  const edit = quoteBody({ customer: { name: 'Μαρία Π.', phone: '', address: '' } });
  edit.doc.lines.pop();
  const updated = await call('PUT', path, { cookie, body: edit });
  assert.equal(updated.status, 200);
  const saved = await updated.json();
  assert.equal(saved.number, created.number, 'the number never changes');
  assert.equal(saved.status, 'sent', 'no status means unchanged');
  assert.equal(saved.customer.name, 'Μαρία Π.');
  assert.equal(saved.doc.lines.length, 1);

  const patched = await call('PATCH', path, { cookie, body: { status: 'accepted' } });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).status, 'accepted');
  assert.equal((await call('PATCH', path, { cookie, body: { status: 'won' } })).status, 400);
  assert.equal((await (await call('GET', path, { cookie })).json()).status, 'accepted');

  assert.equal((await call('DELETE', path, { cookie })).status, 200);
  for (const [method, body] of [['GET'], ['PUT', edit], ['PATCH', { status: 'sent' }], ['DELETE']]) {
    assert.equal((await call(method, path, { cookie, body })).status, 404, `${method} after delete`);
  }
  assert.equal((await call('GET', '/api/admin/quotes/abc', { cookie })).status, 404);
  assert.equal((await call('POST', path, { cookie, body: edit })).status, 405);
});

test('bad quotes are rejected with every reason', async () => {
  const { cookie } = await login();
  const body = quoteBody({ status: 'won' });
  body.doc.lines[0].qty = -1;
  delete body.draft;
  const response = await call('POST', '/api/admin/quotes', { cookie, body });
  assert.equal(response.status, 400);
  const { errors } = await response.json();
  assert.equal(errors.length, 3);
});

// Keep last: it locks out logins from this IP for 15 minutes.
test('password guessing is throttled', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await login('guess')).response.status);
  assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
  assert.equal((await login()).response.status, 429, 'even the right password waits');
});
