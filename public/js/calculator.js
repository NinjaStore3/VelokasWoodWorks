import { api } from './api.js';
import {
  buildQuoteDoc,
  buildShareText,
  computeQuote,
  emptyDraft,
  formatDate,
  formatInput,
  formatMoney,
  formatNumber,
  formatPercent,
  materialUnit,
  parseAmount,
  parseQty,
  toCents,
} from './calc.js';
import { $, h, storage, toast } from './dom.js';
import { icon, tileTint } from './icons.js';
import { pdfFileName, showPdf } from './pdf-share.js';
import { session } from './session.js';

const DRAFT_KEY = 'vw:draft:v1';
const COST_TINT_OFFSET = 4;

// Fills in fields added in later versions, so older saved drafts still load.
function normaliseDraft(input) {
  const draft = { ...emptyDraft(), ...(input && typeof input === 'object' ? input : {}) };
  if (!draft.extras || typeof draft.extras !== 'object') draft.extras = {};
  if (!draft.costs || typeof draft.costs !== 'object') draft.costs = {};
  draft.customer = { ...emptyDraft().customer, ...(draft.customer && typeof draft.customer === 'object' ? draft.customer : {}) };
  if (draft.discountMode !== 'amount') draft.discountMode = 'percent';
  return draft;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (label) $('span', button).textContent = label;
}

function setInvalid(input, invalid) {
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function stat(label, value, className = '') {
  return h(
    'div',
    { class: 'stat' },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: `stat-value ${className}` }, value),
  );
}

function profitStats(quote) {
  const hasCosts = quote.costCents > 0;
  const tone = !hasCosts ? '' : quote.profitCents >= 0 ? 'is-positive' : 'is-negative';
  return [
    stat('Κόστος', formatMoney(quote.costCents)),
    stat('Κέρδος', hasCosts ? formatMoney(quote.profitCents) : '—', tone),
    stat('Περιθώριο', hasCosts && quote.margin !== null ? formatPercent(quote.margin) : '—', tone),
  ];
}

function breakdownLine(iconName, color, name, detail, cents) {
  return h(
    'li',
    {},
    h('span', { class: 'tile', style: { '--tint': color } }, icon(iconName)),
    h('span', {}, h('span', { class: 'line-name' }, name), detail && h('span', { class: 'line-detail' }, detail)),
    h('span', { class: 'line-amount' }, formatMoney(cents)),
  );
}

function totalRow(label, cents, grand = false) {
  return h('div', { class: grand ? 'grand' : '' }, h('span', {}, label), h('span', { class: 'num' }, formatMoney(cents)));
}

export function createCalculator({ onQuoteSaved } = {}) {
  const form = $('#calcForm');
  const notice = $('#calcNotice');
  const materialSelect = $('#material');
  const metersInput = $('#meters');
  const ppmInput = $('#pricePerMeter');
  const resetPpm = $('#resetPpm');
  const baseSum = $('#baseSum');
  const baseFormula = $('#baseFormula');
  const extrasList = $('#extrasList');
  const extrasSum = $('#extrasSum');
  const costsList = $('#costsList');
  const profitStrip = $('#profitStrip');
  const dockNet = $('#dockNet');
  const dockGross = $('#dockGross');
  const sheet = $('#resultSheet');
  const resultContent = $('#resultContent');
  const discountInput = $('#discount');
  const discountSuffix = $('#discountSuffix');
  const discountSum = $('#discountSum');
  const modeButtons = [...document.querySelectorAll('.segmented [data-mode]')];
  const customerInputs = { name: $('#customerName'), phone: $('#customerPhone'), address: $('#customerAddress') };
  const notesInput = $('#quoteNotes');
  const pdfBtn = $('#pdfBtn');
  const saveQuoteBtn = $('#saveQuoteBtn');
  const textBtn = $('#textBtn');

  let config = null;
  let draft = normaliseDraft(storage.get(DRAFT_KEY));
  let quote = null;
  let extraRefs = new Map();
  let costRefs = new Map();
  let saveTimer;
  let statusNotices = [];
  let changedSinceSave = null; // message when a reopened quote no longer adds up the same

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage.set(DRAFT_KEY, draft), 250);
  };
  const hasContent = () => quote && quote.subtotalCents > 0;

  const currentMaterial = () =>
    config.materials.find((m) => m.id === draft.materialId) ?? config.materials[0] ?? null;

  // Forget draft entries for items that were removed in Settings.
  function reconcileDraft() {
    const ids = (items) => new Set(items.map((item) => String(item.id)));
    const extraIds = ids(config.extras);
    const costIds = ids(config.costs);
    for (const id of Object.keys(draft.extras)) if (!extraIds.has(id)) delete draft.extras[id];
    for (const id of Object.keys(draft.costs)) if (!costIds.has(id)) delete draft.costs[id];
    if (!config.materials.some((m) => m.id === draft.materialId)) {
      draft.materialId = null;
      if (!draft.quoteRef) draft.pricePerMeter = null;
    }
  }

  // ---------- Rendering ----------
  function render() {
    const material = currentMaterial();
    materialSelect.replaceChildren(
      ...config.materials.map((m) =>
        h('option', { value: String(m.id) }, `${m.name} — ${formatMoney(toCents(m.price))}/${materialUnit(m).short}`),
      ),
    );
    materialSelect.disabled = !material;
    if (material) materialSelect.value = String(material.id);
    metersInput.value = draft.meters;
    showUnit(material);
    ppmInput.value = draft.pricePerMeter ?? (material ? formatInput(material.price) : '');
    discountInput.value = draft.discount ?? '';
    syncDiscountMode();
    for (const [field, input] of Object.entries(customerInputs)) input.value = draft.customer[field] ?? '';
    notesInput.value = draft.notes ?? '';
    renderNotice();
    saveQuoteBtn.querySelector('span').textContent = draft.quoteRef ? 'Ενημέρωση' : 'Αποθήκευση';

    renderExtras();
    renderCosts();
    if (Object.values(draft.costs).some((value) => String(value).trim() !== '')) $('#costCard').open = true;
    update();
  }

  function renderExtras() {
    extraRefs = new Map();
    const rows = config.extras.map((extra, index) => {
      const entry = (draft.extras[extra.id] ??= { qty: '0', price: null });
      const priceInput = h('input', {
        inputmode: 'decimal',
        value: entry.price ?? formatInput(extra.price),
        'aria-label': `${extra.name}: τιμή ανά τεμάχιο`,
        enterkeyhint: 'done',
      });
      const qtyInput = h('input', {
        inputmode: 'numeric',
        value: entry.qty,
        'aria-label': `${extra.name}: πλήθος`,
        enterkeyhint: 'done',
      });
      const minus = h('button', { type: 'button', 'aria-label': `Ένα λιγότερο: ${extra.name}` }, icon('minus'));
      const plus = h('button', { type: 'button', class: 'plus', 'aria-label': `Ένα ακόμα: ${extra.name}` }, icon('plus'));
      const total = h('span', { class: 'extra-total' });
      const chip = h('label', { class: 'price-chip input-wrap' }, priceInput, h('span', { class: 'suffix' }, '€/τεμ.'));
      const row = h(
        'div',
        { class: 'extra', style: { '--tint': tileTint(index) } },
        h('div', { class: 'extra-top' }, h('span', { class: 'tile' }, icon(extra.icon)), h('span', { class: 'extra-name' }, extra.name), total),
        h('div', { class: 'extra-bottom' }, chip, h('div', { class: 'stepper' }, minus, qtyInput, plus)),
      );

      const setQty = (qty) => {
        entry.qty = String(Math.max(0, Math.min(9999, qty)));
        qtyInput.value = entry.qty;
        update();
      };
      minus.addEventListener('click', () => setQty((parseQty(entry.qty) ?? 0) - 1));
      plus.addEventListener('click', () => setQty((parseQty(entry.qty) ?? 0) + 1));
      qtyInput.addEventListener('input', () => {
        entry.qty = qtyInput.value;
        update();
      });
      qtyInput.addEventListener('blur', () => {
        if (entry.qty.trim() === '' || parseQty(entry.qty) === null) setQty(0);
      });
      priceInput.addEventListener('input', () => {
        entry.price = priceInput.value;
        update();
      });

      extraRefs.set(extra.id, { extra, entry, row, total, chip, minus, qtyInput, priceInput });
      return row;
    });

    const otherInput = h('input', {
      inputmode: 'decimal',
      value: draft.other,
      placeholder: '0',
      'aria-label': 'Άλλο extra: ποσό σε ευρώ',
      enterkeyhint: 'done',
    });
    otherInput.addEventListener('input', () => {
      draft.other = otherInput.value;
      update();
    });
    const otherLabel = h('input', {
      class: 'other-label',
      value: draft.otherLabel ?? '',
      maxlength: '80',
      placeholder: 'Περιγραφή, π.χ. φωτισμός LED',
      'aria-label': 'Άλλο extra: περιγραφή',
      enterkeyhint: 'next',
    });
    otherLabel.addEventListener('input', () => {
      draft.otherLabel = otherLabel.value;
      scheduleSave();
    });
    const otherTotal = h('span', { class: 'extra-total' });
    const otherRow = h(
      'div',
      { class: 'extra', style: { '--tint': 'var(--violet)' } },
      h('div', { class: 'extra-top' }, h('span', { class: 'tile' }, icon('sparkles')), h('span', { class: 'extra-name' }, 'Άλλο extra'), otherTotal),
      h(
        'div',
        { class: 'extra-bottom' },
        otherLabel,
        h('label', { class: 'amount-input input-wrap' }, otherInput, h('span', { class: 'suffix' }, '€')),
      ),
    );
    extraRefs.set('other', { row: otherRow, total: otherTotal, input: otherInput });

    extrasList.replaceChildren(...rows, otherRow);
  }

  function renderCosts() {
    costRefs = new Map();
    if (!config.costs.length) {
      costsList.replaceChildren(h('p', { class: 'card-desc' }, 'Πρόσθεσε γραμμές κόστους από τις Ρυθμίσεις.'));
      return;
    }
    costsList.replaceChildren(
      ...config.costs.map((cost, index) => {
        const input = h('input', {
          inputmode: 'decimal',
          value: draft.costs[cost.id] ?? (cost.price ? formatInput(cost.price) : ''),
          placeholder: '0',
          'aria-label': `${cost.name}: ποσό σε ευρώ`,
          enterkeyhint: 'done',
        });
        input.addEventListener('input', () => {
          draft.costs[cost.id] = input.value;
          update();
        });
        costRefs.set(cost.id, input);
        return h(
          'div',
          { class: 'cost', style: { '--tint': tileTint(index + COST_TINT_OFFSET) } },
          h('span', { class: 'tile' }, icon(cost.icon)),
          h('span', { class: 'cost-name' }, cost.name),
          h('label', { class: 'amount-input input-wrap' }, input, h('span', { class: 'suffix' }, '€')),
        );
      }),
    );
  }

  // Recomputes everything after any input. Only touches text and classes, so
  // focus and the on-screen keyboard stay put while typing.
  function update() {
    if (!config) return;
    quote = computeQuote(config, draft);
    const material = quote.material;

    baseSum.textContent = formatMoney(quote.baseCents);
    setInvalid(metersInput, parseAmount(draft.meters) === null);
    setInvalid(ppmInput, draft.pricePerMeter != null && parseAmount(draft.pricePerMeter) === null);
    const customPpm = material && draft.pricePerMeter != null && parseAmount(draft.pricePerMeter) !== material.price;
    resetPpm.hidden = !customPpm;
    if (customPpm) $('span', resetPpm).textContent = `Επαναφορά στα ${formatMoney(toCents(material.price))}/${quote.unit.short}`;
    baseFormula.replaceChildren(
      ...(quote.meters > 0
        ? [
            h('span', {}, `${formatNumber(quote.meters)} ${quote.unit.short} × ${formatMoney(quote.pricePerMeterCents)}`),
            h('strong', {}, formatMoney(quote.baseCents)),
          ]
        : [h('span', {}, `Γράψε τα ${quote.unit.quantity.toLowerCase()} για να βγει η τιμή της βασικής κουζίνας.`)]),
    );

    for (const line of quote.extras) {
      const ref = extraRefs.get(line.id);
      if (!ref) continue;
      ref.row.classList.toggle('is-on', line.qty > 0);
      ref.total.textContent = line.qty > 0 ? formatMoney(line.totalCents) : '';
      ref.minus.disabled = line.qty === 0;
      setInvalid(ref.qtyInput, parseQty(ref.entry.qty) === null);
      const price = ref.entry.price == null ? ref.extra.price : parseAmount(ref.entry.price);
      setInvalid(ref.priceInput, price === null);
      ref.chip.classList.toggle('is-custom', price !== ref.extra.price);
    }
    const other = extraRefs.get('other');
    other.row.classList.toggle('is-on', quote.otherCents > 0);
    other.total.textContent = quote.otherCents > 0 ? formatMoney(quote.otherCents) : '';
    setInvalid(other.input, parseAmount(draft.other) === null);
    extrasSum.textContent = formatMoney(quote.extrasCents);

    setInvalid(discountInput, parseAmount(draft.discount ?? '') === null || (draft.discountMode === 'percent' && quote.discountValue > 100));
    discountSum.hidden = quote.discountCents === 0;
    discountSum.textContent = `−${formatMoney(quote.discountCents)}`;

    for (const [id, input] of costRefs) setInvalid(input, parseAmount(draft.costs[id] ?? '') === null);
    profitStrip.replaceChildren(...profitStats(quote));

    const net = formatMoney(quote.netCents);
    if (dockNet.textContent !== net) {
      dockNet.textContent = net;
      bump(dockNet);
    }
    dockGross.textContent =
      quote.vatRate > 0 ? `με ΦΠΑ ${formatNumber(quote.vatRate)}%: ${formatMoney(quote.grossCents)}` : '';

    if (sheet.open) renderResult();
    scheduleSave();
  }

  // Step 1 speaks in the chosen material's unit: metres or square metres.
  function showUnit(material) {
    const unit = materialUnit(material);
    $('#qtyLabel').textContent = unit.quantity;
    $('#qtyUnit').textContent = unit.short;
    $('#ppmLabel').textContent = unit.price;
    metersInput.placeholder = unit.example;
  }

  function syncDiscountMode() {
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === draft.discountMode));
    discountSuffix.textContent = draft.discountMode === 'amount' ? '€' : '%';
  }

  function renderNotice() {
    const banner = draft.quoteRef
      ? h(
          'div',
          { class: 'notice is-edit' },
          icon('pencil'),
          h(
            'div',
            {},
            h('strong', {}, `Προσφορά ${draft.quoteRef.number}`),
            draft.customer.name ? `${draft.customer.name}. ` : '',
            'Οι αλλαγές αποθηκεύονται στην ίδια προσφορά.',
            changedSinceSave && h('p', { class: 'form-error' }, changedSinceSave),
            h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn btn-soft', onclick: () => clearForm() }, icon('plus'), 'Νέα προσφορά')),
          ),
        )
      : null;
    notice.replaceChildren(...[banner, ...statusNotices].filter(Boolean));
  }

  function currentDoc() {
    return buildQuoteDoc(quote, draft, { validityDays: config.settings.validityDays ?? 0 });
  }

  // The draft as stored with a saved quote: today's catalogue prices are written
  // in, so reopening it later gives the same numbers even if Settings change.
  function frozenDraft() {
    const copy = structuredClone(draft);
    delete copy.quoteRef;
    const material = currentMaterial();
    if (copy.pricePerMeter == null && material) copy.pricePerMeter = formatInput(material.price);
    for (const extra of config.extras) {
      const entry = copy.extras[extra.id];
      if (entry && (parseQty(entry.qty) ?? 0) > 0 && entry.price == null) entry.price = formatInput(extra.price);
    }
    for (const cost of config.costs) {
      if (copy.costs[cost.id] == null && cost.price) copy.costs[cost.id] = formatInput(cost.price);
    }
    return copy;
  }

  function renderResult() {
    const q = quote;
    $('#resultTitle').textContent = draft.quoteRef ? `Προσφορά ${draft.quoteRef.number}` : 'Προσφορά';
    $('#resultDate').textContent = [formatDate(new Date()), draft.customer.name.trim()].filter(Boolean).join(' · ');
    const vat = q.vatRate > 0;

    const parts = [
      h(
        'div',
        { class: 'result-hero' },
        h('span', { class: 'result-label' }, 'Τελική τιμή · χωρίς ΦΠΑ'),
        h('span', { class: 'result-amount' }, formatMoney(q.netCents)),
        vat && h('span', { class: 'result-vat' }, `Με ΦΠΑ ${formatNumber(q.vatRate)}%:`, h('strong', {}, formatMoney(q.grossCents))),
      ),
    ];

    if (q.subtotalCents === 0) {
      parts.push(h('p', { class: 'empty-hint' }, icon('info'), 'Συμπλήρωσε μέτρα ή extras για να βγει τιμή.'));
    } else {
      const segments = [
        ['Βασική κουζίνα', q.baseCents, 'var(--amber)'],
        ['Extras', q.pickedCents, 'var(--teal)'],
        ['Άλλο extra', q.otherCents, 'var(--violet)'],
      ].filter(([, cents]) => cents > 0);
      const share = (cents) => formatPercent(cents / q.subtotalCents);
      parts.push(
        h(
          'div',
          { class: 'composition' },
          h(
            'div',
            {
              class: 'composition-bar',
              role: 'img',
              'aria-label': segments.map(([label, cents]) => `${label} ${share(cents)}`).join(', '),
            },
            segments.map(([, cents, color]) => h('span', { style: { 'flex-grow': String(cents), background: color } })),
          ),
          h(
            'div',
            { class: 'legend' },
            segments.map(([label, cents, color]) => h('span', {}, h('i', { style: { background: color } }), `${label} · ${share(cents)}`)),
          ),
        ),
      );

      const lines = [];
      if (q.baseCents > 0) {
        const detail = `${q.material ? `${q.material.name} · ` : ''}${formatNumber(q.meters)} ${q.unit.short} × ${formatMoney(q.pricePerMeterCents)}`;
        lines.push(breakdownLine('ruler', 'var(--amber)', 'Βασική κουζίνα', detail, q.baseCents));
      }
      q.extras.forEach((extra, index) => {
        if (extra.qty > 0) {
          lines.push(breakdownLine(extra.icon, tileTint(index), extra.name, `${extra.qty} × ${formatMoney(extra.unitCents)}`, extra.totalCents));
        }
      });
      if (q.otherCents > 0) {
        lines.push(breakdownLine('sparkles', 'var(--violet)', draft.otherLabel?.trim() || 'Άλλο extra', '', q.otherCents));
      }
      parts.push(h('ul', { class: 'breakdown' }, lines));

      const discountLabel = q.discountMode === 'percent' ? `Έκπτωση ${formatNumber(q.discountValue)}%` : 'Έκπτωση';
      parts.push(
        h(
          'div',
          { class: 'totals' },
          q.discountCents > 0 && totalRow('Υποσύνολο', q.subtotalCents),
          q.discountCents > 0 && totalRow(discountLabel, -q.discountCents),
          totalRow('Σύνολο χωρίς ΦΠΑ', q.netCents, !vat),
          vat && totalRow(`ΦΠΑ ${formatNumber(q.vatRate)}%`, q.vatCents),
          vat && totalRow('Σύνολο με ΦΠΑ', q.grossCents, true),
          q.depositCents > 0 && totalRow(`Προκαταβολή ${formatNumber(q.depositPercent)}%`, q.depositCents),
        ),
      );

      if (q.costCents > 0) {
        const width = q.margin === null ? 0 : Math.min(1, Math.abs(q.margin));
        parts.push(
          h(
            'section',
            { class: 'internal' },
            h('p', { class: 'internal-head' }, icon('eye-off'), 'Μόνο για σένα · δεν μπαίνει στην αποστολή'),
            h('div', { class: 'profit-strip' }, profitStats(q)),
            h(
              'div',
              { class: `margin-bar${q.profitCents < 0 ? ' is-negative' : ''}` },
              h('span', { style: { width: `${(width * 100).toFixed(1)}%` } }),
            ),
          ),
        );
      }
    }
    resultContent.replaceChildren(...parts);
  }

  // ---------- Events ----------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    document.activeElement?.blur();
  });

  // Select the whole number on focus so typing replaces it.
  form.addEventListener('focusin', (event) => {
    if (event.target.matches('input[inputmode="decimal"], input[inputmode="numeric"]')) {
      setTimeout(() => event.target.select(), 0);
    }
  });

  materialSelect.addEventListener('change', () => {
    draft.materialId = Number(materialSelect.value);
    draft.pricePerMeter = null;
    ppmInput.value = formatInput(currentMaterial().price);
    showUnit(currentMaterial());
    update();
  });
  metersInput.addEventListener('input', () => {
    draft.meters = metersInput.value;
    update();
  });
  ppmInput.addEventListener('input', () => {
    draft.pricePerMeter = ppmInput.value;
    update();
  });
  resetPpm.addEventListener('click', () => {
    draft.pricePerMeter = null;
    ppmInput.value = formatInput(currentMaterial().price);
    update();
    ppmInput.focus();
  });

  // Starts a new quote (the current one stays in the archive if it was saved).
  function clearForm() {
    const previous = structuredClone(draft);
    const previousNote = changedSinceSave;
    draft = emptyDraft();
    changedSinceSave = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Νέα, άδεια προσφορά.', {
      actionLabel: 'Αναίρεση',
      onAction: () => {
        draft = previous;
        changedSinceSave = previousNote;
        render();
      },
    });
  }
  $('#clearBtn').addEventListener('click', clearForm);

  discountInput.addEventListener('input', () => {
    draft.discount = discountInput.value;
    update();
  });
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      draft.discountMode = button.dataset.mode;
      syncDiscountMode();
      update();
    });
  }
  for (const [field, input] of Object.entries(customerInputs)) {
    input.addEventListener('input', () => {
      draft.customer[field] = input.value;
      scheduleSave();
    });
  }
  notesInput.addEventListener('input', () => {
    draft.notes = notesInput.value;
    scheduleSave();
  });

  $('#openResult').addEventListener('click', () => {
    if (!config) return;
    document.activeElement?.blur();
    renderResult();
    sheet.showModal();
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Αντιγράφηκε. Κάνε επικόλληση σε μήνυμα ή email.');
    } catch {
      toast('Η αντιγραφή δεν επιτράπηκε από τον browser.', { tone: 'error' });
    }
  }

  textBtn.addEventListener('click', async () => {
    if (!hasContent()) return toast('Συμπλήρωσε μέτρα ή extras πρώτα.');
    const text = buildShareText(currentDoc(), { businessName: config.settings.businessName });
    if (typeof navigator.share !== 'function') return copyText(text);
    try {
      await navigator.share({ title: 'Προσφορά κουζίνας', text });
    } catch (error) {
      if (error?.name !== 'AbortError') copyText(text);
    }
  });

  // Saves to the archive (new quote, or the one being edited). Needs a login.
  async function saveQuote({ silent = false } = {}) {
    if (!session.get().authenticated) {
      toast('Συνδέσου για να αποθηκεύεις προσφορές.', {
        actionLabel: 'Σύνδεση',
        onAction: () => {
          sheet.close();
          location.hash = '#quotes';
        },
      });
      return null;
    }
    const doc = currentDoc();
    const body = { customer: doc.customer, doc, draft: frozenDraft(), costCents: quote.costCents };
    try {
      const saved = draft.quoteRef
        ? await api('PUT', `/api/admin/quotes/${draft.quoteRef.id}`, body)
        : await api('POST', '/api/admin/quotes', { ...body, status: 'draft' });
      draft.quoteRef = { id: saved.id, number: saved.number };
      changedSinceSave = null;
      scheduleSave();
      renderNotice();
      saveQuoteBtn.querySelector('span').textContent = 'Ενημέρωση';
      if (sheet.open) renderResult();
      if (!silent) toast(`Αποθηκεύτηκε: Προσφορά ${saved.number}`);
      onQuoteSaved?.(saved);
      return saved;
    } catch (error) {
      if (error.status === 404 && draft.quoteRef) {
        // Deleted on another device: save it again as a new quote.
        draft.quoteRef = null;
        return saveQuote({ silent });
      }
      if (error.status === 401) session.expired();
      toast(error.status === 401 ? 'Η σύνδεση έληξε. Συνδέσου ξανά από τις Προσφορές.' : error.message, { tone: 'error' });
      return null;
    }
  }

  saveQuoteBtn.addEventListener('click', async () => {
    if (!hasContent()) return toast('Συμπλήρωσε μέτρα ή extras πρώτα.');
    setBusy(saveQuoteBtn, true);
    await saveQuote();
    setBusy(saveQuoteBtn, false);
  });

  pdfBtn.addEventListener('click', async () => {
    if (!hasContent()) return toast('Συμπλήρωσε μέτρα ή extras πρώτα.');
    setBusy(pdfBtn, true);
    try {
      let doc = currentDoc();
      if (session.get().authenticated) {
        const saved = await saveQuote({ silent: true });
        if (saved) doc = saved.doc;
      }
      const { quotePdf } = await import('./pdf-quote.js');
      const bytes = await quotePdf(doc, config.settings);
      showPdf(bytes, pdfFileName('Prosfora', doc.number));
    } catch (error) {
      console.error(error);
      toast('Δεν φτιάχτηκε το PDF. Δοκίμασε ξανά.', { tone: 'error' });
    } finally {
      setBusy(pdfBtn, false);
    }
  });

  // ---------- Public API ----------
  return {
    setLoading() {
      form.hidden = true;
      notice.replaceChildren(h('div', { class: 'stack' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    },

    setConfig(next, { stale = false } = {}) {
      config = next;
      reconcileDraft();

      form.hidden = false;
      statusNotices = [
        ...(stale
          ? [
              h(
                'div',
                { class: 'notice is-warn' },
                icon('triangle-alert'),
                h('div', {}, h('strong', {}, 'Χωρίς σύνδεση'), 'Δείχνω τις τιμές από την τελευταία φορά που άνοιξε η εφαρμογή.'),
              ),
            ]
          : []),
        ...(config.materials.length
          ? []
          : [
              h(
                'div',
                { class: 'notice is-warn' },
                icon('info'),
                h('div', {}, h('strong', {}, 'Δεν υπάρχουν υλικά'), 'Πρόσθεσε τουλάχιστον ένα υλικό από τις Ρυθμίσεις.'),
              ),
            ]),
      ];
      render();
    },

    // Opens a saved quote for editing, or as a new copy of it. Whatever was
    // on the form can be brought back from the toast.
    loadQuote(saved, { copy = false } = {}) {
      const previous = structuredClone(draft);
      const previousNote = changedSinceSave;
      const replacesWork = hasContent() && previous.quoteRef?.id !== saved.id;

      draft = normaliseDraft(saved.draft);
      draft.quoteRef = copy ? null : { id: saved.id, number: saved.number };
      reconcileDraft();
      quote = computeQuote(config, draft);
      changedSinceSave =
        !copy && quote.netCents !== saved.netCents
          ? `Τα σύνολα διαφέρουν από την αποθηκευμένη προσφορά (${formatMoney(saved.netCents)}), γιατί κάτι άλλαξε στις Ρυθμίσεις.`
          : null;
      render();
      scheduleSave();

      const restore = () => {
        draft = previous;
        changedSinceSave = previousNote;
        render();
        scheduleSave();
      };
      toast(
        copy ? `Νέα προσφορά, αντίγραφο της ${saved.number}.` : `Άνοιξε η προσφορά ${saved.number}.`,
        replacesWork ? { actionLabel: 'Αναίρεση', onAction: restore } : {},
      );
    },

    // The quote being edited was deleted from the archive: keep the form, as a
    // new unsaved quote.
    forgetQuote(id) {
      if (draft.quoteRef?.id !== id) return;
      draft.quoteRef = null;
      changedSinceSave = null;
      saveQuoteBtn.querySelector('span').textContent = 'Αποθήκευση';
      renderNotice();
      scheduleSave();
    },

    settings: () => config?.settings,

    setUnavailable(error, retry) {
      form.hidden = true;
      notice.replaceChildren(
        h(
          'div',
          { class: 'notice is-error' },
          icon('circle-alert'),
          h(
            'div',
            {},
            h('strong', {}, 'Δεν φόρτωσαν οι τιμές'),
            error.message,
            h('button', { type: 'button', class: 'btn btn-soft', onclick: retry }, icon('refresh-cw'), 'Δοκίμασε ξανά'),
          ),
        ),
      );
    },
  };
}
