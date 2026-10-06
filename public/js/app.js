import { loadConfig, rememberConfig } from './api.js';
import { createCalculator } from './calculator.js';
import { createCuts } from './cuts.js';
import { $, setupSheet, toast } from './dom.js';
import { setupPdfSheet } from './pdf-share.js';
import { createQuotes } from './quotes.js';
import { session } from './session.js';
import { createSettings } from './settings.js';

const TABS = {
  calc: { title: 'Κοστολόγηση Κουζίνας' }, // subtitle comes from Settings
  quotes: { title: 'Προσφορές', subtitle: 'Το αρχείο σου: ποιες στάλθηκαν, ποιες κλείστηκαν, PDF ξανά με ένα πάτημα.' },
  cuts: { title: 'Κοπές', subtitle: 'Λίστα κοπής: πόσα φύλλα χρειάζεσαι, πώς κόβονται, πόση ταινία.' },
  settings: { title: 'Ρυθμίσεις', subtitle: 'Τιμές, υλικά, extras και τα στοιχεία που μπαίνουν στα PDF.' },
};

let branding = { businessName: 'Velokas Woodworks', subtitle: '' };
let tab = null;
const scrollPositions = {};

const calculator = createCalculator({
  onQuoteSaved: (quote) => quotes.saved(quote),
});
const quotes = createQuotes({
  getSettings: () => calculator.settings(),
  onOpen(saved, { copy }) {
    if (!calculator.settings()) {
      toast('Περίμενε λίγο να φορτώσουν οι τιμές.');
      return;
    }
    calculator.loadQuote(saved, { copy });
    scrollPositions.calc = 0;
    location.hash = '#calc';
  },
  onDeleted: (id) => calculator.forgetQuote(id),
});
const cuts = createCuts({ getSettings: () => calculator.settings() });
const settings = createSettings({
  onSaved(config) {
    rememberConfig(config);
    applyBranding(config.settings);
    calculator.setConfig(config);
  },
});
const views = { quotes, cuts, settings };

const currentTab = () => {
  const name = location.hash.slice(1);
  return Object.hasOwn(TABS, name) ? name : 'calc';
};

function updateHeader() {
  const { title, subtitle } = TABS[tab];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = tab === 'calc' ? branding.subtitle : subtitle;
  document.title = `${title} · ${branding.businessName}`;
}

function showTab(name) {
  const previous = tab;
  if (previous) scrollPositions[previous] = window.scrollY;
  tab = name;
  for (const key of Object.keys(TABS)) {
    const link = $(`#tab-${key}`);
    if (key === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    $(`#view-${key}`).hidden = key !== name;
  }
  $('#totalDock').hidden = name !== 'calc';
  for (const [key, view] of Object.entries(views)) {
    if (key === name) view.show();
    else view.hide();
  }
  updateHeader();
  if (previous && previous !== name) window.scrollTo({ top: scrollPositions[name] ?? 0 });
}

function applyBranding(next) {
  branding = next;
  for (const el of document.querySelectorAll('[data-bind="businessName"]')) el.textContent = next.businessName;
  updateHeader();
}

async function boot() {
  calculator.setLoading();
  try {
    const { config, stale } = await loadConfig();
    applyBranding(config.settings);
    calculator.setConfig(config, { stale });
  } catch (error) {
    calculator.setUnavailable(error, boot);
  }
}

document.querySelectorAll('dialog.sheet').forEach(setupSheet);
setupPdfSheet();

window.addEventListener('hashchange', () => showTab(currentTab()));
// Tapping the tab you're on scrolls back to the top.
for (const link of document.querySelectorAll('.tabbar-item')) {
  link.addEventListener('click', () => {
    if (link.getAttribute('aria-current') === 'page') window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

showTab(currentTab());
boot();
// Whether quotes can be saved from the calculator (needs the admin login).
session.refresh().catch(() => {});
