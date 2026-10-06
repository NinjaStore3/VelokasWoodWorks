// Tiny DOM helpers: element builder, toast, sheets, safe localStorage.

const PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'type']);

// h('button', { class: 'btn', onclick }, 'Label', icon('x'))
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

let toastTimer;
export function toast(message, { tone, actionLabel, onAction, duration } = {}) {
  const el = $('#toast');
  const action = $('.toast-action', el);
  const hide = () => {
    el.hidden = true;
  };

  $('.toast-text', el).textContent = message;
  el.classList.toggle('is-error', tone === 'error');
  action.hidden = !actionLabel;
  action.textContent = actionLabel ?? '';
  action.onclick = actionLabel
    ? () => {
        hide();
        onAction?.();
      }
    : null;

  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth; // restart the entrance animation
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, duration ?? (actionLabel ? 6000 : 3000));
}

// Bottom sheets are <dialog>s: close on backdrop tap or any [data-close].
export function setupSheet(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}

// localStorage can be missing or throw (private mode, blocked storage).
export const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: nothing to do */
    }
  },
};
