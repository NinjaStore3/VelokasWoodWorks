// Προσφορές tab: the saved-quote archive. Search, filter by status, follow a
// quote from draft to closed deal, reopen or copy it, PDF, call, delete.
import { api } from './api.js';
import { formatMoney, formatNumber, formatPercent } from './calc.js';
import { $, h, toast } from './dom.js';
import { icon } from './icons.js';
import { pdfFileName, showPdf } from './pdf-share.js';
import { loginCard, session, unconfiguredNotice } from './session.js';

export const STATUSES = {
  draft: { label: 'Πρόχειρη', plural: 'Πρόχειρες', icon: 'pencil' },
  sent: { label: 'Στάλθηκε', plural: 'Στάλθηκαν', icon: 'send' },
  accepted: { label: 'Κλείστηκε', plural: 'Κλείστηκαν', icon: 'badge-check' },
  rejected: { label: 'Δεν προχώρησε', plural: 'Δεν προχώρησαν', icon: 'circle-x' },
};
const PAGE_SIZE = 40;
const shortDate = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });

// Lower case without accents, so "παπαδακη" finds "Παπαδάκη".
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ');
}

export function matches(quote, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const { name, phone, address } = quote.customer;
  const haystack = fold([quote.number, name, address, phone, String(phone ?? '').replace(/\D/g, '')].join(' '));
  return words.every((word) => haystack.includes(word));
}

// This year's numbers for the tiles at the top.
export function yearStats(quotes, year) {
  const mine = quotes.filter((q) => q.number.startsWith(`${year}-`));
  const accepted = mine.filter((q) => q.status === 'accepted');
  const sent = mine.filter((q) => q.status !== 'draft');
  return {
    count: mine.length,
    wonCents: accepted.reduce((sum, q) => sum + q.netCents, 0),
    winRate: sent.length ? accepted.length / sent.length : null,
  };
}

// Whole euros, and "125k €" for big totals, so they fit a third of a phone.
export function compactMoney(cents) {
  const euros = Math.round(cents / 100);
  return euros >= 100_000 ? `${formatNumber(Math.round(euros / 1000))}k €` : formatMoney(euros * 100);
}

function statusBadge(status) {
  const meta = STATUSES[status] ?? STATUSES.draft;
  return h('span', { class: 'status-badge', 'data-status': status }, icon(meta.icon), meta.label);
}

function telHref(phone) {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 5 ? `tel:${digits}` : null;
}

export function createQuotes({ getSettings, onOpen, onDeleted }) {
  const root = $('#quotesRoot');
  const sheet = $('#quoteSheet');
  const sheetTitle = $('#quoteSheetTitle');
  const sheetMeta = $('#quoteSheetMeta');
  const sheetContent = $('#quoteSheetContent');

  let visible = false;
  let view = 'idle';
  let quotes = [];
  let filter = 'all';
  let query = '';
  let limit = PAGE_SIZE;
  let openId = null; // quote shown in the sheet
  let loadToken = 0;

  let listEl = null;
  let statsEl = null;
  let chipsEl = null;

  function setView(name, nodes) {
    view = name;
    root.replaceChildren(...nodes);
  }

  function failed(error, title, retry) {
    return h(
      'div',
      { class: 'notice is-error' },
      icon(error.status === 0 ? 'wifi-off' : 'circle-alert'),
      h(
        'div',
        {},
        h('strong', {}, title),
        error.message,
        retry && h('button', { type: 'button', class: 'btn btn-soft', onclick: retry }, icon('refresh-cw'), 'Δοκίμασε ξανά'),
      ),
    );
  }

  // 401 from any request: back to the login card.
  function handleError(error, title) {
    if (error.status === 401) {
      session.expired();
      if (visible) renderLogin(error.message);
      return;
    }
    toast(error.message || title, { tone: 'error' });
  }

  // ---------- Views ----------
  function renderLoading() {
    setView('loading', [h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })]);
  }

  function renderLogin(message = '') {
    setView('login', [
      loginCard({
        title: 'Αρχείο προσφορών',
        text: 'Συνδέσου για να αποθηκεύεις προσφορές, να βλέπεις ποιες κλείστηκαν και να ξαναβγάζεις PDF.',
        message,
        onSuccess: () => load(),
      }),
    ]);
  }

  function renderList() {
    statsEl = h('div');
    chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Φίλτρο κατάστασης' });
    listEl = h('div', { class: 'quote-list', 'aria-live': 'polite' });
    const search = h('input', {
      type: 'search',
      value: query,
      placeholder: 'Πελάτης, τηλέφωνο ή αριθμός',
      'aria-label': 'Αναζήτηση προσφορών',
      enterkeyhint: 'search',
      autocomplete: 'off',
    });
    search.addEventListener('input', () => {
      query = search.value;
      limit = PAGE_SIZE;
      update();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') search.blur();
    });

    setView('list', [
      statsEl,
      h('div', { class: 'search-wrap' }, icon('search'), search),
      chipsEl,
      listEl,
    ]);
    update();
  }

  function update() {
    if (view !== 'list') return;
    renderStats();
    renderChips();
    renderCards();
  }

  function renderStats() {
    const year = new Date().getFullYear();
    const stats = yearStats(quotes, year);
    const tile = (iconName, tint, value, label) =>
      h('div', { class: 'stat-tile', style: { '--tint': tint } }, icon(iconName), h('strong', {}, value), h('span', {}, label));
    statsEl.replaceChildren(
      h(
        'div',
        { class: 'stat-tiles' },
        tile('file-text', 'var(--sky)', String(stats.count), `Προσφορές ${year}`),
        tile('trophy', 'var(--green)', compactMoney(stats.wonCents), 'Κλείστηκαν'),
        tile('badge-percent', 'var(--violet)', stats.winRate === null ? '—' : formatPercent(stats.winRate), 'Επιτυχία'),
      ),
    );
  }

  function renderChips() {
    const count = (status) => quotes.filter((q) => q.status === status).length;
    const chip = (value, label, n) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(filter === value),
          onclick: () => {
            filter = value;
            limit = PAGE_SIZE;
            update();
          },
        },
        `${label} · ${n}`,
      );
    chipsEl.replaceChildren(
      chip('all', 'Όλες', quotes.length),
      ...Object.entries(STATUSES).map(([status, meta]) => chip(status, meta.plural, count(status))),
    );
  }

  function quoteCard(quote) {
    const { name, phone, address } = quote.customer;
    const sub = [address, phone].filter(Boolean).join(' · ');
    return h(
      'button',
      { type: 'button', class: 'quote-card', 'data-status': quote.status, onclick: () => openSheet(quote) },
      h('span', { class: 'q-meta' }, `${quote.number} · ${shortDate.format(new Date(quote.createdAt))}`),
      h('span', { class: 'q-amount' }, formatMoney(quote.netCents)),
      h('span', { class: 'q-name' }, name || 'Χωρίς όνομα πελάτη'),
      h('span', { class: 'q-sub' }, sub || (quote.grossCents !== quote.netCents ? `με ΦΠΑ ${formatMoney(quote.grossCents)}` : ' ')),
      statusBadge(quote.status),
    );
  }

  function renderCards() {
    if (!quotes.length) {
      listEl.replaceChildren(
        h(
          'div',
          { class: 'empty-state' },
          h('span', { class: 'badge-icon', style: { '--a1': 'var(--sky)' } }, icon('folder-open')),
          h('strong', {}, 'Καμία προσφορά ακόμα'),
          'Φτιάξε μια κοστολόγηση και πάτα «Αποθήκευση» ή «PDF». Θα τη βρίσκεις εδώ.',
          h('a', { class: 'btn btn-cta', href: '#calc' }, icon('calculator'), 'Νέα κοστολόγηση'),
        ),
      );
      return;
    }
    const shown = quotes.filter((q) => (filter === 'all' || q.status === filter) && matches(q, query));
    if (!shown.length) {
      listEl.replaceChildren(
        h('div', { class: 'empty-state' }, h('span', { class: 'badge-icon' }, icon('search')), h('strong', {}, 'Δεν βρέθηκε προσφορά'), 'Δοκίμασε άλλη αναζήτηση ή φίλτρο.'),
      );
      return;
    }
    const cards = shown.slice(0, limit).map(quoteCard);
    if (shown.length > limit) {
      cards.push(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-soft btn-block',
            onclick: () => {
              limit += PAGE_SIZE;
              renderCards();
            },
          },
          `Δείξε περισσότερες (${shown.length - limit})`,
        ),
      );
    }
    listEl.replaceChildren(...cards);
  }

  // ---------- Detail sheet ----------
  function openSheet(summary) {
    openId = summary.id;
    sheetTitle.textContent = `Προσφορά ${summary.number}`;
    sheetMeta.textContent = [longDate.format(new Date(summary.createdAt)), summary.customer.name].filter(Boolean).join(' · ');
    sheetContent.replaceChildren(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    if (!sheet.open) sheet.showModal();
    api('GET', `/api/admin/quotes/${summary.id}`)
      .then((full) => {
        if (openId === full.id && sheet.open) renderSheet(full);
      })
      .catch((error) => {
        if (openId !== summary.id) return;
        if (error.status === 404) {
          sheet.close();
          forget(summary.id);
          toast('Η προσφορά δεν υπάρχει πια.', { tone: 'error' });
        } else if (error.status === 401) {
          sheet.close();
          handleError(error);
        } else {
          sheetContent.replaceChildren(failed(error, 'Δεν άνοιξε η προσφορά', () => openSheet(summary)));
        }
      });
  }

  function statusPicker(full) {
    const buttons = Object.entries(STATUSES).map(([status, meta]) =>
      h(
        'button',
        {
          type: 'button',
          'data-status': status,
          'aria-pressed': String(full.status === status),
          onclick: () => changeStatus(full, status, buttons),
        },
        icon(meta.icon),
        meta.label,
      ),
    );
    return h('div', { class: 'status-picker', role: 'group', 'aria-label': 'Κατάσταση προσφοράς' }, buttons);
  }

  async function changeStatus(full, status, buttons) {
    const previous = full.status;
    if (status === previous) return;
    const press = (value) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === value)));
    press(status);
    full.status = status;
    try {
      const summary = await api('PATCH', `/api/admin/quotes/${full.id}`, { status });
      upsert(summary);
      if (status === 'accepted') toast(`Μπράβο! Η ${full.number} κλείστηκε.`);
    } catch (error) {
      full.status = previous;
      press(previous);
      if (error.status === 404) {
        sheet.close();
        forget(full.id);
      }
      handleError(error, 'Δεν άλλαξε η κατάσταση.');
    }
  }

  function renderSheet(full) {
    const { doc } = full;
    const vat = doc.vatRate > 0;
    const phoneLink = telHref(full.customer.phone);
    const { name, phone, address } = full.customer;

    const parts = [
      h(
        'div',
        { class: 'result-hero' },
        h('span', { class: 'result-label' }, 'Σύνολο χωρίς ΦΠΑ'),
        h('span', { class: 'result-amount' }, formatMoney(full.netCents)),
        vat && h('span', { class: 'result-vat' }, `Με ΦΠΑ ${formatNumber(doc.vatRate)}%:`, h('strong', {}, formatMoney(full.grossCents))),
      ),
      statusPicker(full),
    ];

    if (name || phone || address) {
      parts.push(
        h(
          'div',
          { class: 'contact-card' },
          h('span', { class: 'tile', style: { '--tint': 'var(--sky)' } }, icon('user-round')),
          h(
            'div',
            {},
            h('strong', {}, name || 'Χωρίς όνομα'),
            phone && h('span', {}, phone),
            address && h('span', {}, address),
          ),
        ),
      );
    }

    const lineRows = doc.lines.map((line) =>
      h(
        'div',
        {},
        h('span', {}, line.name, h('small', {}, line.unit ? ` · ${formatNumber(line.qty)} ${line.unit}` : '')),
        h('span', { class: 'num' }, formatMoney(line.totalCents)),
      ),
    );
    const sumRows = [];
    if (doc.discountCents > 0) {
      sumRows.push(h('div', {}, h('span', {}, `Έκπτωση${doc.discountLabel ? ` ${doc.discountLabel}` : ''}`), h('span', { class: 'num' }, `−${formatMoney(doc.discountCents)}`)));
    }
    if (doc.depositCents > 0) {
      sumRows.push(h('div', {}, h('span', {}, `Προκαταβολή ${formatNumber(doc.depositPercent)}%`), h('span', { class: 'num' }, formatMoney(doc.depositCents))));
    }
    parts.push(h('div', { class: 'totals quote-lines' }, lineRows, sumRows));

    if (full.costCents > 0) {
      const profit = full.netCents - full.costCents;
      parts.push(
        h(
          'p',
          { class: 'internal-line' },
          icon('eye-off'),
          `Κόστος ${formatMoney(full.costCents)} · κέρδος `,
          h('strong', { class: profit >= 0 ? 'is-positive' : 'is-negative' }, formatMoney(profit)),
          full.netCents > 0 ? ` (${formatPercent(profit / full.netCents)})` : '',
        ),
      );
    }
    if (doc.notes) parts.push(h('p', { class: 'quote-notes' }, doc.notes));

    const pdfButton = h('button', { type: 'button', class: 'btn btn-cta wide', onclick: () => makePdf(full, pdfButton) }, icon('file-down'), 'PDF');
    parts.push(
      h(
        'div',
        { class: 'quote-actions' },
        pdfButton,
        h('button', { type: 'button', class: 'btn btn-soft', onclick: () => open(full, false) }, icon('pencil'), 'Άνοιγμα'),
        h('button', { type: 'button', class: 'btn btn-soft', onclick: () => open(full, true) }, icon('copy-plus'), 'Αντίγραφο'),
        phoneLink && h('a', { class: 'btn btn-soft', href: phoneLink }, icon('phone'), 'Κλήση'),
        h(
          'button',
          { type: 'button', class: `btn btn-ghost is-danger${phoneLink ? '' : ' wide'}`, onclick: () => remove(full) },
          icon('trash-2'),
          'Διαγραφή',
        ),
      ),
    );
    sheetMeta.textContent = [longDate.format(new Date(full.createdAt)), name].filter(Boolean).join(' · ');
    sheetContent.replaceChildren(...parts);
  }

  async function makePdf(full, button) {
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      const { quotePdf } = await import('./pdf-quote.js');
      const bytes = await quotePdf(full.doc, getSettings() ?? {});
      sheet.close();
      showPdf(bytes, pdfFileName('Prosfora', full.number));
    } catch (error) {
      console.error(error);
      toast('Δεν φτιάχτηκε το PDF. Δοκίμασε ξανά.', { tone: 'error' });
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  function open(full, copy) {
    sheet.close();
    onOpen(full, { copy });
  }

  async function remove(full) {
    if (!window.confirm(`Να διαγραφεί η προσφορά ${full.number}; Δεν γίνεται αναίρεση.`)) return;
    try {
      await api('DELETE', `/api/admin/quotes/${full.id}`);
      sheet.close();
      forget(full.id);
      toast(`Η προσφορά ${full.number} διαγράφηκε.`);
    } catch (error) {
      if (error.status === 404) {
        sheet.close();
        forget(full.id);
        return;
      }
      handleError(error, 'Δεν διαγράφηκε.');
    }
  }

  // ---------- Data ----------
  function upsert(summary) {
    const index = quotes.findIndex((q) => q.id === summary.id);
    const { doc, draft, ...plain } = summary;
    if (index === -1) quotes.unshift(plain);
    else quotes[index] = { ...quotes[index], ...plain };
    update();
  }

  function forget(id) {
    quotes = quotes.filter((q) => q.id !== id);
    onDeleted?.(id);
    update();
  }

  async function load({ quiet = false } = {}) {
    const token = ++loadToken;
    if (!quiet) renderLoading();
    try {
      const data = await api('GET', '/api/admin/quotes');
      if (token !== loadToken) return;
      quotes = data.quotes;
      if (view === 'list') update();
      else renderList();
    } catch (error) {
      if (token !== loadToken) return;
      if (error.status === 401) {
        session.expired();
        renderLogin(quiet ? '' : error.message);
      } else if (quiet && view === 'list') {
        if (error.status !== 0) toast(error.message, { tone: 'error' });
      } else {
        setView('error', [failed(error, 'Δεν φόρτωσαν οι προσφορές', () => load())]);
      }
    }
  }

  async function refresh() {
    renderLoading();
    try {
      const state = await session.refresh();
      if (!state.configured) setView('unconfigured', [unconfiguredNotice()]);
      else if (!state.authenticated) renderLogin();
      else await load();
    } catch (error) {
      setView('error', [failed(error, 'Δεν φόρτωσαν οι προσφορές', refresh)]);
    }
  }

  // Logged out (here, in Settings, or the session expired): hide the archive.
  session.onChange((state) => {
    if (state.authenticated) return;
    quotes = [];
    if (sheet.open) sheet.close();
    if (view === 'list' || view === 'loading') {
      if (visible) renderLogin();
      else view = 'idle';
    }
  });

  return {
    show() {
      visible = true;
      const state = session.get();
      if (!state.known || view === 'error') refresh();
      else if (!state.configured) setView('unconfigured', [unconfiguredNotice()]);
      else if (!state.authenticated) {
        if (view !== 'login') renderLogin();
      } else load({ quiet: view === 'list' });
    },
    hide() {
      visible = false;
    },
    // A quote was saved from the calculator.
    saved(quote) {
      upsert(quote);
    },
  };
}
