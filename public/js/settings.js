import { api } from './api.js';
import { SECTIONS, SECTION_KEYS, UNITS, formatInput, parseAmount, parseQty, sectionOf } from './calc.js';
import { $, h, toast } from './dom.js';
import { PICKER_ICONS, icon, tileTint } from './icons.js';
import { loginCard, session, unconfiguredNotice } from './session.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LISTS = {
  materials: {
    title: 'Υλικά',
    eyebrow: 'Τιμή ανά μέτρο, τ.μ. ή τεμάχιο',
    accent: 'amber',
    icon: 'layers',
    unit: '€/μ.',
    units: ['m', 'm2', 'pcs'], // the first is the default for new items
    sectioned: true, // each belongs to a kind of job
    sectionTitle: 'materialsTitle',
    desc: 'Οι επιλογές που διαλέγεις στην κοστολόγηση. Διάλεξε αν η τιμή είναι ανά μέτρο, τετραγωνικό ή τεμάχιο. Με τον διακόπτη κρύβεις κάτι χωρίς να το σβήσεις.',
    addLabel: 'Προσθήκη υλικού',
    hasIcon: false,
    newIcon: '',
    tintOffset: 0,
  },
  extras: {
    title: 'Extras',
    eyebrow: 'Τιμή ανά τεμάχιο ή μέτρο',
    accent: 'teal',
    icon: 'sparkles',
    unit: '€/τεμ.',
    units: ['pcs', 'm'],
    sectioned: true,
    sectionTitle: 'extrasTitle',
    desc: 'Αξεσουάρ με πλήθος, ή με μέτρα όπως ο φωτισμός LED. Πάτα το εικονίδιο για να το αλλάξεις.',
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
      unit: item.unit,
      section: sectionOf(item),
      active: item.active !== false,
    }));
  return {
    version: config.version,
    settings: {
      businessName: config.settings.businessName,
      subtitle: config.settings.subtitle,
      vatRate: formatInput(config.settings.vatRate),
      phone: config.settings.phone ?? '',
      email: config.settings.email ?? '',
      address: config.settings.address ?? '',
      vatId: config.settings.vatId ?? '',
      terms: config.settings.terms ?? '',
      validityDays: String(config.settings.validityDays ?? 30),
      depositPercent: formatInput(config.settings.depositPercent ?? 0),
    },
    materials: items(config.materials),
    extras: items(config.extras),
    costs: items(config.costs),
  };
}

// Draft -> request body for PUT /api/admin/config.
function toPayload(draft) {
  const items = (list, { priced = false } = {}) =>
    list.map((item) => ({
      id: item.id ?? undefined,
      name: item.name.trim(),
      price: parseAmount(item.price),
      icon: item.icon || undefined,
      unit: priced ? item.unit : undefined,
      section: priced ? item.section : undefined,
      active: item.active,
    }));
  return {
    version: draft.version,
    settings: {
      businessName: draft.settings.businessName.trim(),
      subtitle: draft.settings.subtitle.trim(),
      vatRate: parseAmount(draft.settings.vatRate),
      phone: draft.settings.phone.trim(),
      email: draft.settings.email.trim(),
      address: draft.settings.address.trim(),
      vatId: draft.settings.vatId.trim(),
      terms: draft.settings.terms.trim(),
      validityDays: parseQty(draft.settings.validityDays),
      depositPercent: parseAmount(draft.settings.depositPercent),
    },
    materials: items(draft.materials, { priced: true }),
    extras: items(draft.extras, { priced: true }),
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
  const cardEls = {};
  let section = 'kitchen'; // whose price list is on screen: kitchen, wardrobe or door
  let tabsEl = null;

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
    setView('unconfigured', [unconfiguredNotice()]);
  }

  function renderLogin(message = '') {
    setView('login', [
      loginCard({
        title: 'Περιοχή διαχειριστή',
        text: 'Εδώ ορίζονται οι τιμές, τα υλικά και τα extras της κοστολόγησης.',
        message,
        onSuccess: async () => {
          if (hasChanges()) {
            // Session expired mid-edit: keep the unsaved changes.
            renderEditor();
            toast('Συνδέθηκες ξανά. Οι αλλαγές σου είναι εδώ, πάτα Αποθήκευση.');
          } else {
            await openEditor();
          }
        },
      }),
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
      businessCard(),
      priceListTabs(),
      ...Object.keys(LISTS).map(listCard),
    ]);
  }

  // Kitchen, wardrobe or door: which price list the cards below show.
  function priceListTabs() {
    tabsEl = h(
      'div',
      { class: 'segmented job-tabs', role: 'group', 'aria-label': 'Τιμοκατάλογος για' },
      SECTION_KEYS.map((key) =>
        h(
          'button',
          { type: 'button', 'aria-pressed': String(section === key), onclick: () => showSection(key) },
          icon(SECTIONS[key].icon),
          SECTIONS[key].label,
        ),
      ),
    );
    return h('div', { class: 'price-tabs' }, h('p', { class: 'eyebrow' }, 'Τιμοκατάλογος για'), tabsEl);
  }

  function showSection(key) {
    if (section === key) return;
    section = key;
    tabsEl.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(SECTION_KEYS[index] === key)));
    for (const [listKey, meta] of Object.entries(LISTS)) {
      if (meta.sectioned) cardEls[listKey].replaceWith(listCard(listKey));
    }
  }

  // The items of a list that are on screen: for materials and extras, the
  // current job's only.
  function visibleItems(key) {
    return LISTS[key].sectioned ? draft[key].filter((item) => item.section === section) : draft[key];
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

  // Contact details and terms printed on PDF quotes.
  function businessCard() {
    const s = draft.settings;
    const bind = (field) => (event) => {
      s[field] = event.target.value;
      changed(event.target);
    };
    const input = (field, attrs = {}) => h('input', { value: s[field], 'data-field': field, ...attrs, oninput: bind(field) });
    const field = (label, control, hint) =>
      h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint && h('span', { class: 'hint' }, hint));
    const withSuffix = (control, suffix) => h('span', { class: 'input-wrap' }, control, h('span', { class: 'suffix' }, suffix));

    return h(
      'section',
      { class: 'card', 'data-accent': 'rose' },
      cardHead('file-text', 'Στοιχεία για τα PDF', 'Προσφορές'),
      h('p', { class: 'card-desc' }, 'Εμφανίζονται στην κεφαλίδα και στο τέλος κάθε PDF προσφοράς.'),
      h(
        'div',
        { class: 'field-row' },
        field('Τηλέφωνο', input('phone', { type: 'tel', inputmode: 'tel', maxlength: '40', autocomplete: 'tel', placeholder: '210 1234567' })),
        field('ΑΦΜ', input('vatId', { inputmode: 'numeric', maxlength: '20', placeholder: '9 ψηφία' })),
      ),
      field('Email', input('email', { type: 'email', inputmode: 'email', maxlength: '120', autocomplete: 'email', placeholder: 'info@velokas.gr' })),
      field('Διεύθυνση', input('address', { maxlength: '160', autocomplete: 'street-address', placeholder: 'Οδός, αριθμός, πόλη' })),
      h(
        'div',
        { class: 'field-row' },
        field('Ισχύς προσφοράς', withSuffix(input('validityDays', { inputmode: 'numeric', maxlength: '3' }), 'ημ.')),
        field('Προκαταβολή', withSuffix(input('depositPercent', { inputmode: 'decimal', maxlength: '6' }), '%')),
      ),
      field(
        'Όροι προσφοράς',
        h('textarea', { rows: '4', maxlength: '2000', 'data-field': 'terms', oninput: bind('terms'), placeholder: 'Η τιμή περιλαμβάνει μεταφορά και τοποθέτηση.\nΠροκαταβολή με την ανάθεση, το υπόλοιπο με την παράδοση.' }, s.terms),
        'Τρόπος πληρωμής, χρόνος παράδοσης, τι περιλαμβάνει η τιμή.',
      ),
    );
  }

  function listCard(key) {
    const meta = LISTS[key];
    listEls[key] = h('div', { class: 'admin-list' });
    renderList(key);
    const title = meta.sectioned ? SECTIONS[section][meta.sectionTitle] : meta.title;
    cardEls[key] = h(
      'section',
      { class: 'card', 'data-accent': meta.accent },
      cardHead(meta.icon, title, meta.eyebrow),
      h('p', { class: 'card-desc' }, meta.desc),
      listEls[key],
      h('button', { type: 'button', class: 'add-btn', onclick: () => addItem(key) }, icon('plus'), meta.addLabel),
    );
    return cardEls[key];
  }

  function renderList(key) {
    const items = visibleItems(key);
    listEls[key].replaceChildren(...items.map((item, index) => itemRow(key, item, index, items.length)));
  }

  function itemRow(key, item, index, count) {
    const meta = LISTS[key];
    if (meta.units && !meta.units.includes(item.unit)) item.unit = meta.units[0];

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
    const priceUnit = () => (meta.units ? `€/${UNITS[item.unit].short}` : meta.unit);
    const priceSuffix = h('span', { class: 'suffix' }, priceUnit());
    const price = h('input', {
      value: item.price,
      inputmode: 'decimal',
      placeholder: '0',
      'aria-label': `Τιμή σε ${priceUnit()}`,
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
        'data-key': item.key,
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
      meta.units && unitPicker(),
      h(
        'div',
        { class: 'item-tools' },
        h('label', { class: 'price-field input-wrap' }, price, priceSuffix),
        h('label', { class: 'switch', title: 'Εμφανίζεται στην κοστολόγηση' }, toggle, h('span', { class: 'track' })),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': 'Μετακίνηση πάνω', disabled: index === 0, onclick: () => move(key, item, -1) },
          icon('arrow-up'),
        ),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': 'Μετακίνηση κάτω', disabled: index === count - 1, onclick: () => move(key, item, 1) },
          icon('arrow-down'),
        ),
      ),
    );
    // How it's priced: per metre, per square metre or per piece.
    function unitPicker() {
      const buttons = meta.units.map((unit) => [unit, UNITS[unit].per]).map(([unit, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(item.unit === unit),
            onclick: (event) => {
              if (item.unit === unit) return;
              item.unit = unit;
              for (const b of buttons) b.setAttribute('aria-pressed', String(b === event.currentTarget));
              priceSuffix.textContent = priceUnit();
              price.setAttribute('aria-label', `Τιμή σε ${priceUnit()}`);
              changed();
            },
          },
          label,
        ),
      );
      return h('div', { class: `segmented unit-picker units-${meta.units.length}`, role: 'group', 'aria-label': 'Η τιμή είναι' }, buttons);
    }

    return row;
  }

  // ---------- List actions ----------
  function addItem(key) {
    const meta = LISTS[key];
    draft[key].push({
      key: ++keySeq,
      id: null,
      name: '',
      price: '',
      icon: meta.newIcon,
      unit: meta.units?.[0],
      section: meta.sectioned ? section : 'kitchen',
      active: true,
    });
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

  // Swaps an item with its neighbour on screen (the same job's items).
  function move(key, item, delta) {
    const shown = visibleItems(key);
    const neighbour = shown[shown.indexOf(item) + delta];
    if (!neighbour) return;
    const items = draft[key];
    const a = items.indexOf(item);
    const b = items.indexOf(neighbour);
    [items[a], items[b]] = [items[b], items[a]];
    renderList(key);
    changed();
    // Keep focus on the same arrow so repeated taps keep moving the item.
    const row = listEls[key].querySelector(`[data-key="${item.key}"]`);
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
    if (s.email.trim() && !EMAIL_RE.test(s.email.trim())) flag($('[data-field="email"]', root), 'Το email δεν φαίνεται σωστό.');
    const days = parseQty(s.validityDays);
    if (days === null || days > 365) flag($('[data-field="validityDays"]', root), 'Η ισχύς πρέπει να είναι από 0 έως 365 ημέρες.');
    const deposit = parseAmount(s.depositPercent);
    if (deposit === null || deposit > 100) flag($('[data-field="depositPercent"]', root), 'Η προκαταβολή πρέπει να είναι από 0 έως 100%.');

    // A problem in another job's price list: show that list first.
    const bad = (item) => !item.name.trim() || parseAmount(item.price) === null;
    const hidden = ['materials', 'extras'].flatMap((key) => draft[key]).find((item) => bad(item) && item.section !== section);
    const visibleBad = ['materials', 'extras'].some((key) => visibleItems(key).some(bad));
    if (hidden && !visibleBad) showSection(hidden.section);

    for (const [key, meta] of Object.entries(LISTS)) {
      const counts = {};
      for (const item of draft[key]) {
        const group = meta.sectioned ? item.section : 'all';
        const number = (counts[group] = (counts[group] ?? 0) + 1);
        const title = meta.sectioned ? SECTIONS[item.section][meta.sectionTitle] : meta.title;
        const row = listEls[key].querySelector(`[data-key="${item.key}"]`);
        const field = (name) => (row ? $(`[data-field="${name}"]`, row) : null);
        const report = (input, message) => (input ? flag(input, message) : problems.push(message));
        const label = item.name.trim() || `#${number}`;
        if (!item.name.trim()) report(field('name'), `${title} #${number}: λείπει το όνομα.`);
        if (parseAmount(item.price) === null) report(field('price'), `${title}: μη έγκυρη τιμή στο «${label}».`);
      }
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
      if (error.status === 401) {
        session.expired();
        renderLogin(error.message);
      } else if (error.status === 409) showErrors([error.message], { reload: true });
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
      await session.logout();
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
      if (error.status === 401) {
        session.expired();
        renderLogin(error.message);
      } else renderError(error);
    }
  }

  async function refresh() {
    renderLoading();
    try {
      const state = await session.refresh();
      if (!state.configured) renderUnconfigured();
      else if (!state.authenticated) renderLogin();
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
      if (error.status === 401) {
        session.expired();
        if (view === 'editor' && !hasChanges()) renderLogin();
      }
    }
  }

  // Logged out from another tab of the app (logging in is picked up by show()).
  session.onChange((state) => {
    if (!state.authenticated && view === 'editor' && !hasChanges()) renderLogin();
  });

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
