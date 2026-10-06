import { storage } from './dom.js';

export class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Δεν υπάρχει σύνδεση στο internet.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error || `Σφάλμα ${response.status}`, data?.errors || []);
  }
  return data;
}

const CONFIG_CACHE_KEY = 'vw:config';

// Falls back to the last config seen on this phone when the network is flaky
// (e.g. measuring a kitchen in a basement).
export async function loadConfig() {
  try {
    const config = await api('GET', '/api/config');
    storage.set(CONFIG_CACHE_KEY, config);
    return { config, stale: false };
  } catch (error) {
    const cached = storage.get(CONFIG_CACHE_KEY);
    if (cached && (error.status === 0 || error.status >= 500)) return { config: cached, stale: true };
    throw error;
  }
}

export function rememberConfig(config) {
  storage.set(CONFIG_CACHE_KEY, config);
}
