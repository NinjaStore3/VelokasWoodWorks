import { HttpError, json, readJson } from './http.js';

const COOKIE_NAME = 'vw_admin';
const COOKIE_PATH = '/api/admin';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // stay signed in on the phone for a month
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const encoder = new TextEncoder();

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

async function sha256Hex(text) {
  const bytes = new Uint8Array(await sha256(text));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Hashing first makes both inputs the same length, as timingSafeEqual requires.
async function passwordMatches(candidate, expected) {
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Short fingerprint of the current password; truncated so it can't be used to
// confirm a password guess, but enough to notice that the password changed.
async function passwordTag(env) {
  return (await sha256Hex(`vw-session:${env.ADMIN_PASSWORD}`)).slice(0, 8);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sessionCookie(value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export function adminConfigured(env) {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length > 0;
}

async function findSession(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const expiresAt = await env.DB.prepare(
    'SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND password_tag = ?',
  )
    .bind(await sha256Hex(token), await passwordTag(env))
    .first('expires_at');
  return expiresAt !== null && expiresAt > Date.now();
}

export async function requireAdmin(request, env) {
  if (!readCookie(request, COOKIE_NAME)) throw new HttpError(401, 'Χρειάζεται σύνδεση διαχειριστή.');
  if (!(await findSession(request, env))) throw new HttpError(401, 'Η σύνδεση έληξε. Συνδέσου ξανά.');
}

export async function sessionStatus(request, env) {
  return json({
    configured: adminConfigured(env),
    authenticated: adminConfigured(env) && (await findSession(request, env)),
  });
}

export async function login(request, env) {
  if (!adminConfigured(env)) {
    throw new HttpError(503, 'Δεν έχει οριστεί κωδικός διαχειριστή (ADMIN_PASSWORD).');
  }

  const db = env.DB;
  const ip = clientIp(request);
  const now = Date.now();

  // Housekeeping, then refuse early if this IP keeps guessing.
  await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(now - ATTEMPT_WINDOW_MS),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
  ]);
  const failures = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?').bind(ip).first('n');
  if (failures >= MAX_FAILED_ATTEMPTS) {
    throw new HttpError(429, 'Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.');
  }

  const body = await readJson(request);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!(await passwordMatches(password, env.ADMIN_PASSWORD))) {
    await db.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, now).run();
    throw new HttpError(401, 'Λάθος κωδικός.');
  }

  const token = randomToken();
  await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
    db.prepare('INSERT INTO admin_sessions (token_hash, password_tag, expires_at) VALUES (?, ?, ?)').bind(
      await sha256Hex(token),
      await passwordTag(env),
      now + SESSION_TTL_SECONDS * 1000,
    ),
  ]);
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS) } });
}

export async function logout(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (token) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
}
