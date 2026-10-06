// The "PDF is ready" sheet: send (share sheet), download, or open to print.
// Generating takes a moment, and phones only allow sharing straight from a tap,
// so the file is handed over from this sheet rather than right after building.
import { $ } from './dom.js';

let current = null;

function release() {
  if (current) URL.revokeObjectURL(current.url);
  current = null;
}

export function pdfFileName(prefix, number) {
  const stamp = number || new Date().toISOString().slice(0, 10);
  return `${prefix}-${stamp}.pdf`;
}

export function showPdf(bytes, filename) {
  release();
  const file = new File([bytes], filename, { type: 'application/pdf' });
  current = { file, url: URL.createObjectURL(file) };

  // Phones send it straight to Viber, email…; elsewhere downloading is the main action.
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  $('#pdfShareBtn').hidden = !canShare;
  $('#pdfDownloadBtn').classList.toggle('btn-cta', !canShare);
  $('#pdfDownloadBtn').classList.toggle('btn-soft', canShare);
  $('#pdfFileName').textContent = `${filename} · ${Math.max(1, Math.round(bytes.length / 1024))} KB`;
  $('#pdfSheet').showModal();
}

export function setupPdfSheet() {
  const sheet = $('#pdfSheet');

  $('#pdfShareBtn').addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.share({ files: [current.file], title: current.file.name });
      sheet.close();
    } catch (error) {
      if (error?.name !== 'AbortError') console.error(error);
    }
  });

  $('#pdfDownloadBtn').addEventListener('click', () => {
    if (!current) return;
    const link = document.createElement('a');
    link.href = current.url;
    link.download = current.file.name;
    document.body.append(link);
    link.click();
    link.remove();
    sheet.close();
  });

  $('#pdfOpenBtn').addEventListener('click', () => {
    if (current) window.open(current.url, '_blank', 'noopener');
  });
}
