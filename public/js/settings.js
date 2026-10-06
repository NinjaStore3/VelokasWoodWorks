import { api } from './api.js';
import { formatInput, parseAmount } from './calc.js';
import { $, h, toast } from './dom.js';
import { PICKER_ICONS, icon, tileTint } from './icons.js';

const LISTS = {
  materials: {
    title: 'Υλικά',
    eyebrow: 'Τιμή ανά μέτρο',
    accent: 'amber',
    icon: 'layers',
    unit: '€/μ.',
    desc: 'Οι επιλογές της λίστας «Υλικό». Με τον διακόπτη κρύβεις κάτι χωρίς να το σβήσεις.',
    addLabel: 'Προσθήκη υλικού',
    hasIcon: false,
    newIcon: '',
    tintOffset: 0,
  },
  extras: {
    title: 'Extras',
    eyebrow: 'Τιμή ανά τεμάχιο',
    accent: 'teal',
    icon: 'sparkles',
    unit: '€/τεμ.',
    desc: 'Αξεσουάρ με πλήθος. Πάτα το εικονίδιο για να το αλλάξεις.',
    addLabel: 'Προσθήκη extra',
    hasIcon: true,
    newIcon: 'sparkles',
    tintOffset: 0,
  },
  costs: {
    title: 'Εσωτερικά κόστη',
    eyebrow: 'Μόνο για σένα',
    accent: 'violet',
    icon: 'piggy-bank',
    unit: '€',
    desc: 'Οι γραμμές της εσωτερικής κοστολόγησης. Η τιμή είναι προεπιλογή, συνήθως 0.',
    addLabel: 'Προσθήκη γραμμής κόστους',
    hasIcon: true,
    newIcon: 'tag',
    tintOffset: 4,
  },
};

// Admin config -> what the calculator sees (active items only).
export function publicConfig(config) {
  const visible = (items) => items.filter((item) => item.active).map(({ active, ...item }) => item);
  return { ...config, materials: visible(config.materials), extras: visible(config.extras), costs: visible(config.costs) };
}

let keySeq = 0;

// Server config -> editable draft (prices as the strings shown in inputs).
function toDraft(config) {
  const items = (list) =>
    list.map((item) => ({
      key: ++keySeq,
      id: item.id,
      name: item.name,
      price: formatInput(item.price),
      icon: item.icon || '',
      active: item.active !== false,
    }));
  return {
    version: config.version,
    settings: {
      businessName: config.settings.businessName,
      subtitle: config.settings.subtitle,
      vatRate: formatInput(config.settings.vatRate),
    },
    materials: items(config.materials),
    extras: items(config.extras),
    costs: items(config.costs),
  };
}

// Draft -> request body for PUT /api/admin/config.
function toPayload(draft) {
  const items = (list) =>
    list.map((item) => ({
      id: item.id ?? undefined,
      name: item.name.trim(),
      price: parseAmount(item.price),
      icon: item.icon || undefined,
      active: item.active,
    }));
  return {
    version: draft.version,
    settings: {
      businessName: draft.settings.businessName.trim(),
      subtitle: draft.settings.subtitle.trim(),
      vatRate: parseAmount(draft.settings.vatRate),
    },
    materials: items(draft.materials),
    extras: items(draft.extras),
    costs: items(draft.costs),
  };
}

function cardHead(iconName, title, eyebrow) {
  return h(
    'header',
    { class: 'card-head' },
    h('span', { class: 'badge-icon' }, icon(iconName)),
    h('div', { class: 'card-titles' }, h('p', { class: 'eyebrow' }, eyebrow), h('h2', {}, title)),
  );
}

export function createSettings({ onSaved }) {
  const root = $('#settingsRoot');
  const dock = $('#saveDock');
  const saveBtn = $('#saveBtn');
  const iconSheet = $('#iconSheet');
  const iconGrid = $('#iconGrid');

  let visible = false;
  let view = 'idle';
  let baseline = null;
  let baselineJson = '';
  let draft = null;
  let saving = false;
  let errorBox = null;
  const listEls = {};

  const hasChanges = () => draft !== null && JSON.stringify(toPayload(draft)) !== baselineJson;
  const isDirty = () => view === 'editor' && hasChanges();

  function updateDock() {
    dock.hidden = !(visible && isDirty());
  }

  function setView(name, nodes) {
    view = name;
    root.replaceChildren(...nodes);
    updateDock();
  }

  function setBaseline(config) {
    baseline = config;
    draft = toDraft(config);
    baselineJson = JSON.stringify(toPayload(draft));
  }

  function changed(input) {
    input?.removeAttribute('aria-invalid');
    updateDock();
  }

  // ---------- Views ----------
  function renderLoading() {
    setView('loading', [h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })]);
  }

  function renderError(error) {
    setView('error', [
      h(
        'div',
        { class: 'notice is-error' },
        icon('circle-alert'),
        h(
          'div',
          {},
          h('strong', {}, 'Δεν φόρτωσαν οι ρυθμίσεις'),
          error.message,
          h('button', { type: 'button', class: 'btn btn-soft', onclick: refresh }, icon('refresh-cw'), 'Δοκίμασε ξανά'),
        ),
      ),
    ]);
  }

  function renderUnconfigured() {
    setView('unconfigured', [
      h(
        'div',
        { class: 'notice is-warn' },
        icon('key-round'),
        h(
          'div',
          {},
          h('strong', {}, 'Δεν έχει οριστεί κωδικός διαχειριστή'),
          'Πρόσθεσε ένα secret με όνομα ',
          h('code', {}, 'ADMIN_PASSWORD'),
          ' στο Worker στο Cloudflare (Settings → Variables and Secrets) ή τρέξε ',
          h('code', {}, 'npx wrangler secret put ADMIN_PASSWORD'),
          '.',
        ),
      ),
    ]);
  }

  function renderLogin(message = '') {
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
        await api('POST', '/api/admin/login', { password: password.value });
        if (hasChanges()) {
          // Session expired mid-edit: keep the unsaved changes.
          renderEditor();
          toast('Συνδέθηκες ξανά. Οι αλλαγές σου είναι εδώ, πάτα Αποθήκευση.');
        } else {
          await openEditor();
        }
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        password.select();
      }
    }

    setView('login', [
      h(
        'section',
        { class: 'card login-card', 'data-accent': 'rose' },
        h('span', { class: 'badge-icon' }, icon('lock')),
        h('h2', {}, 'Περιοχή διαχειριστή'),
        h('p', {}, 'Εδώ ορίζονται οι τιμές, τα υλικά και τα extras της κοστολόγησης.'),
        h(
          'form',
          { onsubmit: onSubmit },
          h('input', { type: 'text', class: 'sr-only', autocomplete: 'username', value: 'admin', tabindex: '-1', 'aria-hidden': 'true' }),
          password,
          submit,
          error,
        ),
      ),
    ]);
  }

  function renderEditor() {
    errorBox = h('ul', { class: 'save-errors', role: 'alert', hidden: true });
    setView('editor', [
      h(
        'div',
        { class: 'admin-bar' },
        h('span', { class: 'who' }, icon('circle-check'), 'Συνδεδεμένος'),
        h('button', { type: 'button', class: 'btn btn-soft', onclick: logout }, icon('log-out'), 'Έξοδος'),
      ),
      errorBox,
      generalCard(),
      ...Object.keys(LISTS).map(listCard),
    ]);
  }

  function generalCard() {
    const s = draft.settings;
    const text = (field, attrs) =>
      h('input', {
        value: s[field],
        'data-field': field,
        ...attrs,
        oninput: (event) => {
          s[field] = event.target.value;
          changed(event.target);
        },
      });
    const vat = h('input', {
      value: s.vatRate,
      inputmode: 'decimal',
      'data-field': 'vatRate',
      oninput: (event) => {
        s.vatRate = event.target.value;
        changed(event.target);
      },
    });

    return h(
      'section',
      { class: 'card', 'data-accent': 'sky' },
      cardHead('sliders-horizontal', 'Γενικά', 'Επιχείρηση'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Επωνυμία'), text('businessName', { maxlength: '80', autocomplete: 'organization' })),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Υπότιτλος κοστολόγησης'), text('subtitle', { maxlength: '160' })),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label' }, 'ΦΠΑ'),
        h('span', { class: 'input-wrap' }, vat, h('span', { class: 'suffix' }, '%')),
        h('span', { class: 'hint' }, 'Χρησιμοποιείται για το «Σύνολο με ΦΠΑ». Βάλε 0 για να μην εμφανίζεται.'),
      ),
    );
  }

  function listCard(key) {
    const meta = LISTS[key];
    listEls[key] = h('div', { class: 'admin-list' });
    renderList(key);
    return h(
      'section',
      { class: 'card', 'data-accent': meta.accent },
      cardHead(meta.icon, meta.title, meta.eyebrow),
      h('p', { class: 'card-desc' }, meta.desc),
      listEls[key],
      h('button', { type: 'button', class: 'add-btn', onclick: () => addItem(key) }, icon('plus'), meta.addLabel),
    );
  }

  function renderList(key) {
    listEls[key].replaceChildren(...draft[key].map((item, index) => itemRow(key, item, index)));
  }

  function itemRow(key, item, index) {
    const meta = LISTS[key];
    const count = draft[key].length;

    const name = h('input', {
      value: item.name,
      maxlength: '60',
      placeholder: 'Όνομα',
      'aria-label': 'Όνομα',
      'data-field': 'name',
      oninput: (event) => {
        item.name = event.target.value;
        changed(event.target);
      },
    });
    const price = h('input', {
      value: item.price,
      inputmode: 'decimal',
      placeholder: '0',
      'aria-label': `Τιμή σε ${meta.unit}`,
      'data-field': 'price',
      oninput: (event) => {
        item.price = event.target.value;
        changed(event.target);
      },
    });
    const toggle = h('input', {
      type: 'checkbox',
      checked: item.active,
      'aria-label': 'Εμφανίζεται στην κοστολόγηση',
      onchange: (event) => {
        item.active = event.target.checked;
        row.classList.toggle('is-off', !item.active);
        changed();
      },
    });

    const row = h(
      'div',
      {
        class: `admin-item${meta.hasIcon ? '' : ' no-icon'}${item.active ? '' : ' is-off'}`,
        style: { '--tint': tileTint(index + meta.tintOffset) },
      },
      meta.hasIcon &&
        h('button', { type: 'button', class: 'tile-btn', 'aria-label': 'Αλλαγή εικονιδίου', onclick: () => pickIcon(item, row) }, icon(item.icon)),
      name,
      h(
        'button',
        { type: 'button', class: 'icon-btn danger', 'aria-label': 'Διαγραφή', onclick: () => removeItem(key, item) },
        icon('trash-2'),
      ),
      h(
        'div',
        { class: 'item-tools' },
        h('label', { class: 'price-field input-wrap' }, price, h('span', { class: 'suffix' }, meta.unit)),
        h('label', { class: 'switch', title: 'Εμφανίζεται στην κοστολόγηση' }, toggle, h('span', { class: 'track' })),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': 'Μετακίνηση πάνω', disabled: index === 0, onclick: () => move(key, index, -1) },
          icon('arrow-up'),
        ),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': 'Μετακίνηση κάτω', disabled: index === count - 1, onclick: () => move(key, index, 1) },
          icon('arrow-down'),
        ),
      ),
    );
    return row;
  }

  // ---------- List actions ----------
  function addItem(key) {
    const meta = LISTS[key];
    draft[key].push({ key: ++keySeq, id: null, name: '', price: '', icon: meta.newIcon, active: true });
    renderList(key);
    changed();
    const row = listEls[key].lastElementChild;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('[data-field="name"]', row).focus({ preventScroll: true });
  }

  function removeItem(key, item) {
    const items = draft[key];
    const index = items.indexOf(item);
    if (index < 0) return;
    items.splice(index, 1);
    renderList(key);
    changed();
    const owner = draft;
    toast(`Αφαιρέθηκε: ${item.name.trim() || 'χωρίς όνομα'}`, {
      actionLabel: 'Αναίρεση',
      onAction: () => {
        if (draft !== owner || view !== 'editor') return;
        draft[key].splice(index, 0, item);
        renderList(key);
        changed();
      },
    });
  }

  function move(key, index, delta) {
    const items = draft[key];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    renderList(key);
    changed();
    // Keep focus on the same arrow so repeated taps keep moving the item.
    const row = listEls[key].children[target];
    const arrow = row.querySelectorAll('.item-tools .icon-btn')[delta < 0 ? 0 : 1];
    (arrow.disabled ? $('[data-field="name"]', row) : arrow).focus();
  }

  function pickIcon(item, row) {
    const tint = row.style.getPropertyValue('--tint');
    iconGrid.replaceChildren(
      ...PICKER_ICONS.map(([name, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'icon-choice',
            'aria-pressed': String(item.icon === name),
            style: { '--tint': tint },
            onclick: () => {
              item.icon = name;
              $('.tile-btn', row).replaceChildren(icon(name));
              iconSheet.close();
              changed();
            },
          },
          h('span', { class: 'tile' }, icon(name)),
          label,
        ),
      ),
    );
    iconSheet.showModal();
    $('[aria-pressed="true"]', iconGrid)?.focus();
  }

  // ---------- Save / discard / logout ----------
  function showErrors(messages, { reload = false } = {}) {
    errorBox.replaceChildren(
      ...messages.map((message) => h('li', {}, message)),
      reload && h('li', {}, h('button', { type: 'button', class: 'btn btn-soft', onclick: openEditor }, icon('refresh-cw'), 'Φόρτωσε τις τελευταίες')),
    );
    errorBox.hidden = messages.length === 0;
    if (messages.length) errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function validateDraft() {
    const problems = [];
    let firstInvalid = null;
    const flag = (input, message) => {
      input.setAttribute('aria-invalid', 'true');
      firstInvalid ??= input;
      problems.push(message);
    };

    const s = draft.settings;
    if (!s.businessName.trim()) flag($('[data-field="businessName"]', root), 'Η επωνυμία είναι υποχρεωτική.');
    const vat = parseAmount(s.vatRate);
    if (vat === null || vat > 100) flag($('[data-field="vatRate"]', root), 'Ο ΦΠΑ πρέπει να είναι από 0 έως 100%.');

    for (const [key, meta] of Object.entries(LISTS)) {
      draft[key].forEach((item, index) => {
        const row = listEls[key].children[index];
        const label = item.name.trim() || `#${index + 1}`;
        if (!item.name.trim()) flag($('[data-field="name"]', row), `${meta.title} #${index + 1}: λείπει το όνομα.`);
        if (parseAmount(item.price) === null) flag($('[data-field="price"]', row), `${meta.title}: μη έγκυρη τιμή στο «${label}».`);
      });
    }
    if (!draft.materials.some((m) => m.active)) problems.push('Χρειάζεται τουλάχιστον ένα ενεργό υλικό.');
    return { problems, firstInvalid };
  }

  function setSaving(on) {
    saving = on;
    saveBtn.disabled = on;
    saveBtn.replaceChildren(...(on ? [icon('loader-circle', 'spin'), 'Αποθήκευση…'] : [icon('save'), 'Αποθήκευση']));
  }

  async function save() {
    if (saving || !isDirty()) return;
    const { problems, firstInvalid } = validateDraft();
    if (problems.length) {
      showErrors(problems);
      firstInvalid?.focus({ preventScroll: true });
      return;
    }

    setSaving(true);
    try {
      const saved = await api('PUT', '/api/admin/config', toPayload(draft));
      setBaseline(saved);
      renderEditor();
      toast('Οι αλλαγές αποθηκεύτηκαν.');
      onSaved(publicConfig(saved));
    } catch (error) {
      if (error.status === 401) renderLogin(error.message);
      else if (error.status === 409) showErrors([error.message], { reload: true });
      else showErrors(error.errors.length ? error.errors : [error.message]);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!baseline) return;
    setBaseline(baseline);
    renderEditor();
    toast('Οι αλλαγές αναιρέθηκαν.');
  }

  async function logout() {
    if (hasChanges() && !window.confirm('Έχεις αλλαγές που δεν αποθηκεύτηκαν. Έξοδος χωρίς αποθήκευση;')) return;
    try {
      await api('POST', '/api/admin/logout');
    } catch {
      /* the cookie expires anyway */
    }
    draft = null;
    baseline = null;
    renderLogin();
  }

  // ---------- Loading ----------
  async function openEditor() {
    try {
      setBaseline(await api('GET', '/api/admin/config'));
      renderEditor();
    } catch (error) {
      if (error.status === 401) renderLogin(error.message);
      else renderError(error);
    }
  }

  async function refresh() {
    renderLoading();
    try {
      const session = await api('GET', '/api/admin/session');
      if (!session.configured) renderUnconfigured();
      else if (!session.authenticated) renderLogin();
      else await openEditor();
    } catch (error) {
      renderError(error);
    }
  }

  // Back on the tab with nothing unsaved: pick up changes made on another device.
  async function refreshQuietly() {
    try {
      const latest = await api('GET', '/api/admin/config');
      if (view === 'editor' && !hasChanges() && latest.version !== baseline.version) {
        setBaseline(latest);
        renderEditor();
      }
    } catch (error) {
      if (error.status === 401 && view === 'editor' && !hasChanges()) renderLogin();
    }
  }

  saveBtn.addEventListener('click', save);
  $('#discardBtn').addEventListener('click', discard);
  window.addEventListener('beforeunload', (event) => {
    if (hasChanges()) event.preventDefault();
  });

  return {
    show() {
      visible = true;
      updateDock();
      if (view === 'editor') {
        if (!hasChanges()) refreshQuietly();
      } else if (view !== 'login' || !hasChanges()) {
        refresh();
      }
    },
    hide() {
      visible = false;
      updateDock();
    },
  };
}
