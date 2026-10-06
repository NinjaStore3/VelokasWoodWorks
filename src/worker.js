import { login, logout, requireAdmin, sessionStatus } from './auth.js';
import { readConfig, writeConfig } from './config.js';
import { HttpError, assertSameOrigin, json, readJson } from './http.js';
import { ValidationError, validateConfig } from './validate.js';

const routes = {
  '/api/config': {
    GET: async (request, env) => json(await readConfig(env.DB)),
  },
  '/api/admin/session': {
    GET: (request, env) => sessionStatus(request, env),
  },
  '/api/admin/login': {
    POST: (request, env) => login(request, env),
  },
  '/api/admin/logout': {
    POST: (request, env) => logout(request, env),
  },
  '/api/admin/config': {
    GET: async (request, env) => {
      await requireAdmin(request, env);
      return json(await readConfig(env.DB, { includeInactive: true }));
    },
    PUT: async (request, env) => {
      await requireAdmin(request, env);
      const config = validateConfig(await readJson(request));
      await writeConfig(env.DB, config);
      return json(await readConfig(env.DB, { includeInactive: true }));
    },
  },
};

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  const route = routes[pathname];
  if (!route) throw new HttpError(404, 'Not found.');

  const handler = route[request.method];
  if (!handler) {
    throw new HttpError(405, 'Method not allowed.', { allow: Object.keys(route).join(', ') });
  }
  if (request.method !== 'GET') assertSameOrigin(request);
  return handler(request, env);
}

function errorResponse(error) {
  if (error instanceof ValidationError) {
    return json({ error: error.message, errors: error.errors }, { status: 400 });
  }
  if (error instanceof HttpError) {
    const headers = error.extra.allow ? { Allow: error.extra.allow } : {};
    return json({ error: error.message }, { status: error.status, headers });
  }
  if (/no such table/i.test(String(error?.message))) {
    return json(
      { error: 'Η βάση δεδομένων δεν έχει στηθεί ακόμα. Τρέξε: npm run db:migrate:remote' },
      { status: 503 },
    );
  }
  console.error(error);
  return json({ error: 'Κάτι πήγε στραβά. Δοκίμασε ξανά.' }, { status: 500 });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    // Static files are normally served before the Worker runs (see
    // run_worker_first in wrangler.jsonc); this is just a fallback.
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (!env.DB) {
      // Happens if the deploy token had no D1 permission, so Wrangler skipped
      // creating/binding the database.
      return json({ error: 'Λείπει η σύνδεση με τη βάση δεδομένων (D1 binding "DB").' }, { status: 503 });
    }

    try {
      return await handleApi(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
