// Works offline once opened (service worker) and installs like an app: an
// "Εγκατάσταση" button appears where the browser supports it (Chrome, Edge).
import { $, toast } from './dom.js';

export function setupPwa() {
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker:', error));
    });
  }

  const button = $('#installBtn');
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    const prompt = deferred;
    if (!prompt) return;
    deferred = null;
    button.hidden = true;
    await prompt.prompt();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.hidden = true;
    toast('Η εφαρμογή εγκαταστάθηκε. Θα τη βρεις με τις άλλες εφαρμογές σου.');
  });

  window.addEventListener('offline', () =>
    toast('Χωρίς internet. Η κοστολόγηση και οι κοπές δουλεύουν κανονικά.', { duration: 5000 }),
  );
}
