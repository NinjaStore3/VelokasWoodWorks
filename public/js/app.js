import { loadConfig, rememberConfig } from './api.js';
import { createCalculator } from './calculator.js';
import { $, setupSheet } from './dom.js';
import { createSettings } from './settings.js';

const TITLES = {
  calc: 'Κοστολόγηση Κουζίνας',
  settings: 'Ρυθμίσεις',
};
const SETTINGS_SUBTITLE = 'Τιμές, υλικά και extras που χρησιμοποιεί η κοστολόγηση.';

let branding = { businessName: 'Velokas Woodworks', subtitle: '' };

const calculator = createCalculator();
const settings = createSettings({
  onSaved(config) {
    rememberConfig(config);
    applyBranding(config.settings);
    calculator.setConfig(config);
  },
});

document.querySelectorAll('dialog.sheet').forEach(setupSheet);

const currentTab = () => (location.hash === '#settings' ? 'settings' : 'calc');

function showTab(name) {
  for (const tab of ['calc', 'settings']) {
    const link = $(`#tab-${tab}`);
    if (tab === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    $(`#view-${tab}`).hidden = tab !== name;
  }
  $('#totalDock').hidden = name !== 'calc';
  $('#pageTitle').textContent = TITLES[name];
  $('#pageSubtitle').textContent = name === 'calc' ? branding.subtitle : SETTINGS_SUBTITLE;
  if (name === 'settings') settings.show();
  else settings.hide();
}

function applyBranding(next) {
  branding = next;
  for (const el of document.querySelectorAll('[data-bind="businessName"]')) el.textContent = next.businessName;
  document.title = `${TITLES.calc} · ${next.businessName}`;
  if (currentTab() === 'calc') $('#pageSubtitle').textContent = next.subtitle;
}

window.addEventListener('hashchange', () => {
  showTab(currentTab());
  window.scrollTo({ top: 0 });
});

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

showTab(currentTab());
boot();
