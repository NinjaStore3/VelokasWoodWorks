// Κοπές tab: a cut list for sheet material (melamine, MDF, plywood). Lays the
// parts out on as few sheets as it can, draws every sheet, and adds up edge
// banding and material cost. The list stays on this device (localStorage).
import { formatMoney, formatNumber, formatPercent, parseAmount, parseQty } from './calc.js';
import { EXAMPLE_PARTS, bandCounts, bandLabel, fitLabel, partSize, planCuts, sizeLabel } from './cutplan.js';
import { $, h, storage, toast } from './dom.js';
import { icon, tileTint } from './icons.js';
import { pdfFileName, showPdf } from './pdf-share.js';

const STORE_KEY = 'vw:cuts:v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_PARTS = 150;

function defaults() {
  return {
    sheetLength: '2800',
    sheetWidth: '2070',
    kerf: '4',
    trim: '10',
    grain: false,
    sheetPrice: '',
    bandPrice: '',
    parts: [],
    nextId: 1,
  };
}

const SIDES = [
  ['top', 'πάνω μακριά πλευρά'],
  ['bottom', 'κάτω μακριά πλευρά'],
  ['left', 'αριστερή κοντή πλευρά'],
  ['right', 'δεξιά κοντή πλευρά'],
];

function cleanPart(raw, id) {
  const text = (value, fallback = '') => (typeof value === 'string' ? value : value == null ? fallback : String(value));
  const edges = raw.edges && typeof raw.edges === 'object' ? raw.edges : {};
  return {
    id,
    name: text(raw.name).slice(0, 60),
    length: text(raw.length),
    width: text(raw.width),
    qty: text(raw.qty, '1'),
    edges: Object.fromEntries(SIDES.map(([side]) => [side, edges[side] === true])),
  };
}

function loadState() {
  const saved = storage.get(STORE_KEY);
  const state = { ...defaults(), ...(saved && typeof saved === 'object' ? saved : {}) };
  for (const key of ['sheetLength', 'sheetWidth', 'kerf', 'trim', 'sheetPrice', 'bandPrice']) {
    if (typeof state[key] !== 'string') state[key] = String(state[key] ?? '');
  }
  state.grain = state.grain === true;
  const parts = Array.isArray(state.parts) ? state.parts : [];
  state.parts = parts
    .filter((part) => part && typeof part === 'object')
    .slice(0, MAX_PARTS)
    .map((part, index) => cleanPart(part, index + 1));
  state.nextId = state.parts.length + 1;
  return state;
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

function setInvalid(input, invalid) {
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function cardHead(iconName, title, eyebrow, extra) {
  return h(
    'header',
    { class: 'card-head' },
    h('span', { class: 'badge-icon' }, icon(iconName)),
    h('div', { class: 'card-titles' }, h('p', { class: 'eyebrow' }, eyebrow), h('h2', {}, title)),
    extra,
  );
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));
}

export function createCuts({ getSettings }) {
  const root = $('#cutsRoot');
  const dock = $('#cutsDock');
  const dockSheets = $('#cutsDockSheets');
  const dockSub = $('#cutsDockSub');

  let state = loadState();
  let plan = null;
  let visible = false;
  let built = false;
  let saveTimer;
  let planTimer;

  let partsEl;
  let partsFooter;
  let partsSum;
  let resultsEl;
  let setupSummary;
  let refs = new Map(); // part id -> its inputs and note

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage.set(STORE_KEY, state), 250);
  };

  // Typing re-plans after a short pause; buttons re-plan straight away.
  function changed({ now = false } = {}) {
    save();
    clearTimeout(planTimer);
    if (now) replan();
    else planTimer = setTimeout(replan, 180);
  }

  // ---------- Sheet, saw and prices ----------
  function setupCard() {
    const field = (key, label, suffix, { id = `cut-${key}`, placeholder = '' } = {}) => {
      const input = h('input', { id, inputmode: 'decimal', value: state[key], placeholder, enterkeyhint: 'done' });
      setInvalid(input, parseAmount(input.value) === null);
      input.addEventListener('input', () => {
        state[key] = input.value;
        setInvalid(input, parseAmount(input.value) === null);
        updateSetupSummary();
        changed();
      });
      return h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input-wrap' }, input, h('span', { class: 'suffix' }, suffix)));
    };

    const grain = h('input', { type: 'checkbox', checked: state.grain, 'aria-describedby': 'grainHint' });
    grain.addEventListener('change', () => {
      state.grain = grain.checked;
      updateSetupSummary();
      changed({ now: true });
    });

    setupSummary = h('span', { class: 'setup-summary' });
    updateSetupSummary();
    return h(
      'details',
      { class: 'card card-collapsible', 'data-accent': 'amber', open: state.parts.length === 0 },
      h(
        'summary',
        { class: 'card-head' },
        h('span', { class: 'badge-icon' }, icon('rectangle-horizontal')),
        h('div', { class: 'card-titles' }, h('p', { class: 'eyebrow' }, 'Φύλλο & πριόνι'), h('h2', {}, 'Ρυθμίσεις κοπής'), setupSummary),
        icon('chevron-down', 'card-chev'),
      ),
      h('div', { class: 'field-row' }, field('sheetLength', 'Μήκος φύλλου', 'mm'), field('sheetWidth', 'Πλάτος φύλλου', 'mm')),
      h('div', { class: 'field-row' }, field('kerf', 'Λάμα (πάχος κοπής)', 'mm'), field('trim', 'Ξάκρισμα ανά πλευρά', 'mm')),
      h(
        'label',
        { class: 'switch-row' },
        h(
          'span',
          {},
          h('strong', {}, 'Νερά ξύλου'),
          h('span', { id: 'grainHint' }, 'Τα κομμάτια δεν γυρίζουν: το μήκος τους πάει με το μήκος του φύλλου.'),
        ),
        h('span', { class: 'switch' }, grain, h('span', { class: 'track' })),
      ),
      h(
        'div',
        { class: 'field-row' },
        field('sheetPrice', 'Τιμή φύλλου', '€', { placeholder: '0' }),
        field('bandPrice', 'Τιμή ταινίας', '€/μ.', { placeholder: '0' }),
      ),
    );
  }

  function updateSetupSummary() {
    if (!setupSummary) return;
    const value = (key) => formatNumber(parseAmount(state[key]) ?? 0);
    setupSummary.textContent = [
      `${value('sheetLength')}×${value('sheetWidth')} mm`,
      `λάμα ${value('kerf')}`,
      `ξάκρισμα ${value('trim')}`,
      state.grain ? 'με νερά' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ---------- Parts ----------
  function partsCard() {
    partsEl = h('div', { class: 'part-list' });
    partsFooter = h('div', { class: 'parts-footer' });
    partsSum = h('output', { class: 'card-sum', 'aria-label': 'Σύνολο κομματιών' });
    const add = h('button', { type: 'button', class: 'add-btn' }, icon('plus'), 'Προσθήκη κομματιού');
    add.addEventListener('click', () => addPart());
    return h(
      'section',
      { class: 'card', 'data-accent': 'teal' },
      cardHead('scissors', 'Κομμάτια', 'Λίστα κοπής', partsSum),
      h('form', { class: 'part-form', novalidate: true, onsubmit: (event) => event.preventDefault() }, partsEl),
      add,
      partsFooter,
    );
  }

  function renderParts() {
    refs = new Map();
    partsEl.replaceChildren(...state.parts.map(partRow));
    renderPartsFooter();
  }

  function renderPartsFooter() {
    if (state.parts.length === 0) {
      partsFooter.replaceChildren(
        h(
          'div',
          { class: 'empty-state' },
          h('span', { class: 'badge-icon' }, icon('layout-grid')),
          h('strong', {}, 'Γράψε τα κομμάτια που θες να κόψεις'),
          'Μήκος × πλάτος σε χιλιοστά και πόσα τεμάχια. Το σχέδιο κοπής βγαίνει αμέσως από κάτω.',
          h('button', { type: 'button', class: 'btn btn-soft', onclick: loadExample }, icon('sparkles'), 'Δείξε ένα παράδειγμα'),
        ),
      );
    } else {
      partsFooter.replaceChildren(
        h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: clearParts }, icon('rotate-ccw'), 'Καθαρισμός λίστας'),
      );
    }
  }

  function partRow(part, index) {
    const label = () => part.name.trim() || `Κομμάτι ${index + 1}`;
    const name = h('input', {
      value: part.name,
      maxlength: '60',
      placeholder: `Κομμάτι ${index + 1}`,
      'aria-label': `Κομμάτι ${index + 1}: όνομα`,
      enterkeyhint: 'next',
    });
    const length = h('input', { inputmode: 'decimal', value: part.length, placeholder: 'Μήκος', 'aria-label': `${label()}: μήκος σε mm`, enterkeyhint: 'next' });
    const width = h('input', { inputmode: 'decimal', value: part.width, placeholder: 'Πλάτος', 'aria-label': `${label()}: πλάτος σε mm`, enterkeyhint: 'done' });
    const qty = h('input', { inputmode: 'numeric', value: part.qty, 'aria-label': `${label()}: τεμάχια`, enterkeyhint: 'done' });
    const minus = h('button', { type: 'button', 'aria-label': `Ένα λιγότερο: ${label()}` }, icon('minus'));
    const plus = h('button', { type: 'button', class: 'plus', 'aria-label': `Ένα ακόμα: ${label()}` }, icon('plus'));
    const remove = h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Διαγραφή: ${label()}` }, icon('trash-2'));
    const note = h('p', { class: 'part-note', hidden: true });

    // A little board: tap a side to band it. Top and bottom are the long sides.
    const caption = h('span', { class: 'edge-caption' });
    const picker = h('div', { class: 'edge-picker', role: 'group', 'aria-label': `${label()}: ταινία στις πλευρές` });
    const showEdges = () => {
      for (const [side] of SIDES) picker.classList.toggle(`is-${side}`, part.edges[side]);
      const text = bandLabel(bandCounts(part.edges));
      caption.replaceChildren(h('strong', {}, 'Ταινία'), ...(text === '—' ? ['καμία'] : text.split(' + ')).map((line) => h('span', {}, line)));
    };
    picker.append(
      ...SIDES.map(([side]) => h('span', { class: `edge-bar ${side}`, 'aria-hidden': 'true' })),
      ...SIDES.map(([side, name]) => {
        const button = h('button', { type: 'button', class: `edge-hit ${side}`, 'aria-pressed': String(part.edges[side]), 'aria-label': `Ταινία: ${name}` });
        button.addEventListener('click', () => {
          part.edges[side] = !part.edges[side];
          button.setAttribute('aria-pressed', String(part.edges[side]));
          showEdges();
          changed({ now: true });
        });
        return button;
      }),
    );
    showEdges();

    const setQty = (value) => {
      part.qty = String(Math.max(0, Math.min(9999, value)));
      qty.value = part.qty;
      changed({ now: true });
    };
    minus.addEventListener('click', () => setQty((parseQty(part.qty) ?? 1) - 1));
    plus.addEventListener('click', () => setQty((parseQty(part.qty) ?? 0) + 1));
    qty.addEventListener('blur', () => {
      if (part.qty.trim() === '' || parseQty(part.qty) === null) setQty(1);
    });
    name.addEventListener('input', () => {
      part.name = name.value;
      changed();
    });
    for (const [input, key] of [
      [length, 'length'],
      [width, 'width'],
      [qty, 'qty'],
    ]) {
      input.addEventListener('input', () => {
        part[key] = input.value;
        validatePart(part);
        changed();
      });
    }
    remove.addEventListener('click', () => removePart(part));

    const row = h(
      'div',
      { class: 'part', style: { '--tint': tileTint(index) } },
      h('div', { class: 'part-top' }, h('span', { class: 'part-index' }, String(index + 1)), name, remove),
      h(
        'div',
        { class: 'part-dims' },
        h('label', { class: 'input-wrap' }, length, h('span', { class: 'suffix' }, 'mm')),
        h('span', { class: 'times', 'aria-hidden': 'true' }, '×'),
        h('label', { class: 'input-wrap' }, width, h('span', { class: 'suffix' }, 'mm')),
      ),
      h('div', { class: 'part-bottom' }, picker, caption, h('div', { class: 'stepper' }, minus, qty, plus)),
      note,
    );
    refs.set(part.id, { row, length, width, qty, minus, note, name });
    validatePart(part);
    return row;
  }

  function validatePart(part) {
    const ref = refs.get(part.id);
    if (!ref) return;
    const length = parseAmount(part.length);
    const width = parseAmount(part.width);
    setInvalid(ref.length, length === null || (part.length.trim() !== '' && length === 0));
    setInvalid(ref.width, width === null || (part.width.trim() !== '' && width === 0));
    setInvalid(ref.qty, parseQty(part.qty) === null);
    ref.minus.disabled = (parseQty(part.qty) ?? 0) === 0;
  }

  function addPart(values = {}, { focus = true } = {}) {
    if (state.parts.length >= MAX_PARTS) {
      toast(`Μέχρι ${MAX_PARTS} κομμάτια σε μία λίστα.`, { tone: 'error' });
      return;
    }
    const part = cleanPart({ qty: '1', edges: { top: true }, ...values }, state.nextId++);
    state.parts.push(part);
    partsEl.append(partRow(part, state.parts.length - 1));
    renderPartsFooter();
    changed({ now: true });
    if (focus) refs.get(part.id).length.focus();
  }

  function removePart(part) {
    const index = state.parts.indexOf(part);
    if (index === -1) return;
    const before = state.parts.slice();
    state.parts.splice(index, 1);
    renderParts();
    changed({ now: true });
    toast(`Διαγράφηκε: ${part.name.trim() || `Κομμάτι ${index + 1}`}`, {
      actionLabel: 'Αναίρεση',
      onAction: () => {
        state.parts = before;
        renderParts();
        changed({ now: true });
      },
    });
  }

  function loadExample() {
    state.parts = EXAMPLE_PARTS.map((part, index) => cleanPart(part, index + 1));
    state.nextId = state.parts.length + 1;
    renderParts();
    changed({ now: true });
  }

  function clearParts() {
    const before = state.parts.slice();
    state.parts = [];
    renderParts();
    changed({ now: true });
    toast('Η λίστα καθάρισε.', {
      actionLabel: 'Αναίρεση',
      onAction: () => {
        state.parts = before;
        renderParts();
        changed({ now: true });
      },
    });
  }

  // ---------- Results ----------
  function resultsCard() {
    resultsEl = h('div', { class: 'cut-results', 'aria-live': 'polite' });
    return h('section', { class: 'card', 'data-accent': 'violet', id: 'cutPlan' }, cardHead('layout-grid', 'Σχέδιο κοπής', 'Αποτέλεσμα'), resultsEl);
  }

  function sheetFigure(packed, index) {
    const { sheet, trim } = plan;
    const fontSize = Math.max(sheet.length, sheet.width) / 26;
    const sizes = [fontSize, fontSize * 0.72];
    const measure = (text, size) => text.length * size * 0.6;
    const graphic = svg('svg', {
      class: 'sheet-svg',
      viewBox: `0 0 ${sheet.length} ${sheet.width}`,
      role: 'img',
      'aria-label': `Φύλλο ${index + 1}: ${packed.placements.length} κομμάτια, αξιοποίηση ${formatPercent(packed.utilization)}`,
    });
    graphic.append(svg('rect', { class: 'sheet-bg', x: 0, y: 0, width: sheet.length, height: sheet.width, 'vector-effect': 'non-scaling-stroke' }));
    if (trim > 0) {
      const usable = svg('rect', {
        class: 'sheet-usable',
        x: trim,
        y: trim,
        width: sheet.length - 2 * trim,
        height: sheet.width - 2 * trim,
        'stroke-width': (fontSize / 14).toFixed(1),
        'stroke-dasharray': `${(fontSize / 2).toFixed(1)} ${(fontSize / 2).toFixed(1)}`,
      });
      graphic.append(usable);
    }

    const byId = new Map(plan.valid.map((part) => [part.id, part]));
    for (const piece of packed.placements) {
      const part = byId.get(piece.partId);
      const rect = svg('rect', { class: 'piece', x: piece.x, y: piece.y, width: piece.length, height: piece.width, 'vector-effect': 'non-scaling-stroke' });
      rect.style.setProperty('fill', `color-mix(in srgb, ${tileTint(part.index)} 52%, #fff)`);
      graphic.append(rect);

      const size = partSize(piece);
      const label = fitLabel(
        [[part.name, sizeLabel(size.length, size.width)], [sizeLabel(size.length, size.width)], [String(part.index + 1)]],
        piece.length,
        piece.width,
        sizes,
        measure,
      );
      if (!label) continue;
      const cx = piece.x + piece.length / 2;
      const cy = piece.y + piece.width / 2;
      const text = svg('text', {
        x: cx,
        y: cy,
        'font-size': label.size.toFixed(1),
        'text-anchor': 'middle',
        transform: label.vertical ? `rotate(-90 ${cx} ${cy})` : null,
      });
      label.lines.forEach((line, i) => {
        const dy = i === 0 ? `${(0.35 - (label.lines.length - 1) * 0.575).toFixed(3)}em` : '1.15em';
        text.append(svg('tspan', { x: cx, dy }, line));
      });
      graphic.append(text);
    }

    return h(
      'figure',
      { class: 'sheet-figure' },
      h(
        'figcaption',
        {},
        h('span', {}, `Φύλλο ${index + 1} από ${plan.result.sheetCount}`),
        h('span', {}, `${packed.placements.length} κομμάτια · ${formatPercent(packed.utilization)}`),
      ),
      graphic,
    );
  }

  function renderResults() {
    const { result, banding } = plan;
    if (!plan.sheetOk) {
      resultsEl.replaceChildren(h('p', { class: 'empty-hint' }, icon('info'), 'Γράψε σωστές διαστάσεις φύλλου στις ρυθμίσεις κοπής.'));
      return;
    }
    if (plan.pieceCount === 0) {
      resultsEl.replaceChildren(h('p', { class: 'empty-hint' }, icon('info'), 'Πρόσθεσε κομμάτια με μήκος, πλάτος και τεμάχια.'));
      return;
    }

    const parts = [
      h(
        'div',
        { class: 'cut-summary' },
        stat('Φύλλα', String(result.sheetCount)),
        stat('Αξιοποίηση', result.sheetCount ? formatPercent(result.utilization) : '—'),
        stat('Ταινία', `${formatNumber(banding.totalMeters)} μ.`),
        stat('Κόστος υλικού', plan.totalCents > 0 ? formatMoney(plan.totalCents) : '—'),
      ),
    ];
    if (plan.totalCents > 0) {
      const bits = [];
      if (plan.sheetCents > 0) bits.push(`${result.sheetCount} φύλλα: ${formatMoney(plan.sheetCents)}`);
      if (plan.bandCents > 0) bits.push(`ταινία: ${formatMoney(plan.bandCents)}`);
      parts.push(h('p', { class: 'cut-note' }, bits.join(' · ')));
    }
    if (result.unplaced.length) {
      parts.push(
        h(
          'div',
          { class: 'notice is-error' },
          icon('triangle-alert'),
          h(
            'div',
            {},
            h('strong', {}, 'Δεν χωράνε στο φύλλο'),
            h(
              'ul',
              { class: 'warn-list' },
              result.unplaced.map((part) => h('li', {}, `${part.name}: ${sizeLabel(part.length, part.width)} mm × ${part.qty}`)),
            ),
            plan.grain ? 'Με τα νερά ενεργά τα κομμάτια δεν γυρίζουν.' : '',
          ),
        ),
      );
    }
    parts.push(h('div', { class: 'sheet-list' }, result.sheets.map(sheetFigure)));
    if (result.sheetCount > 0) {
      const pdfButton = h('button', { type: 'button', class: 'btn btn-cta btn-block' }, icon('file-down'), 'PDF για το πριόνι');
      pdfButton.addEventListener('click', () => makePdf(pdfButton));
      parts.push(pdfButton);
    }
    resultsEl.replaceChildren(...parts);
  }

  function markUnplaced() {
    const unplaced = new Set(plan.result.unplaced.map((part) => part.partId));
    for (const part of state.parts) {
      const ref = refs.get(part.id);
      if (!ref) continue;
      const tooBig = unplaced.has(part.id);
      ref.row.classList.toggle('is-error', tooBig);
      ref.note.hidden = !tooBig;
      ref.note.textContent = tooBig ? 'Δεν χωράει στο φύλλο με αυτές τις ρυθμίσεις.' : '';
    }
  }

  function updateDock() {
    const show = visible && plan && plan.pieceCount > 0 && plan.sheetOk;
    dock.hidden = !show;
    if (!show) return;
    dockSheets.textContent = `${plan.result.sheetCount} ${plan.result.sheetCount === 1 ? 'φύλλο' : 'φύλλα'}`;
    // Cost when prices are set, otherwise how well the sheets are used.
    const detail =
      plan.totalCents > 0
        ? `κόστος ${formatMoney(plan.totalCents)}`
        : plan.result.sheetCount
          ? `αξιοποίηση ${formatPercent(plan.result.utilization)}`
          : null;
    dockSub.textContent = [`${plan.pieceCount} τεμ.`, detail].filter(Boolean).join(' · ');
  }

  function replan() {
    clearTimeout(planTimer);
    plan = planCuts(state);
    partsSum.textContent = plan.pieceCount ? `${plan.pieceCount} τεμ.` : '';
    renderResults();
    markUnplaced();
    updateDock();
  }

  async function makePdf(button) {
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      const { cutsPdf } = await import('./pdf-cuts.js');
      const bytes = await cutsPdf(plan, getSettings() ?? {});
      showPdf(bytes, pdfFileName('Kopes', null));
    } catch (error) {
      console.error(error);
      toast('Δεν φτιάχτηκε το PDF. Δοκίμασε ξανά.', { tone: 'error' });
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  function build() {
    built = true;
    root.replaceChildren(setupCard(), partsCard(), resultsCard());
    renderParts();
    replan();
  }

  $('#cutsDockBtn').addEventListener('click', () => {
    document.activeElement?.blur();
    $('#cutPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  return {
    show() {
      visible = true;
      if (!built) build();
      else updateDock();
    },
    hide() {
      visible = false;
      dock.hidden = true;
    },
  };
}
