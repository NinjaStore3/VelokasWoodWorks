// Admin session shared by the Προσφορές and Ρυθμίσεις tabs and the calculator.
import { api } from './api.js';
import { h } from './dom.js';
import { icon } from './icons.js';

let state = { known: false, configured: true, authenticated: false };
const listeners = new Set();
let pending = null; // one request at a time, however many tabs ask

function update(next) {
  state = { ...state, ...next, known: true };
  for (const listener of listeners) listener(state);
}

export const session = {
  get: () => state,
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  refresh() {
    pending ??= api('GET', '/api/admin/session')
      .then((next) => {
        update(next);
        return state;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  },
  async login(password) {
    await api('POST', '/api/admin/login', { password });
    update({ authenticated: true });
  },
  async logout() {
    try {
      await api('POST', '/api/admin/logout');
    } finally {
      update({ authenticated: false });
    }
  },
  // Call when an admin request comes back 401.
  expired() {
    update({ authenticated: false });
  },
};

export function loginCard({ title, text, message = '', onSuccess }) {
  const password = h('input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'Κωδικός διαχειριστή',
    'aria-label': 'Κωδικός διαχειριστή',
    enterkeyhint: 'go',
  });
  const error = h('p', { class: 'form-error', role: 'alert' }, message);
  const submit = h('button', { type: 'submit', class: 'btn btn-cta btn-block' }, icon('lock'), 'Σύνδεση');

  async function onSubmit(event) {
    event.preventDefault();
    if (!password.value) {
      error.textContent = 'Γράψε τον κωδικό.';
      password.focus();
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      await session.login(password.value);
      await onSuccess?.();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
      password.select();
    }
  }

  return h(
    'section',
    { class: 'card login-card', 'data-accent': 'amber' },
    h('div', { class: 'login-brand' }, h('img', { src: '/img/logo.webp', alt: 'Velokas Woodworks', width: '720', height: '620' })),
    h('h2', {}, title),
    h('p', {}, text),
    h(
      'form',
      { onsubmit: onSubmit },
      h('input', { type: 'text', class: 'sr-only', autocomplete: 'username', value: 'admin', tabindex: '-1', 'aria-hidden': 'true' }),
      password,
      submit,
      error,
    ),
  );
}

export function unconfiguredNotice() {
  return h(
    'div',
    { class: 'notice is-warn' },
    icon('key-round'),
    h(
      'div',
      {},
      h('strong', {}, 'Δεν έχει οριστεί κωδικός διαχειριστή'),
      'Πρόσθεσε το secret ',
      h('code', {}, 'ADMIN_PASSWORD'),
      ' στο GitHub (Settings → Secrets and variables → Actions) και ξανατρέξε το deploy, ή στο Worker στο Cloudflare.',
    ),
  );
}
