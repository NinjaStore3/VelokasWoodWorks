// A4 PDF of a quote (the "doc" from buildQuoteDoc / the archive). Never
// includes internal costs: the doc doesn't carry them.
import { addDays, formatDate, formatMoney, formatNumber } from './calc.js';
import { PAGE, createDoc, drawBandLogo, drawSmallBandLogo, painter, wrap } from './pdf-common.js';

const { width: W, height: H, margin: M } = PAGE;
const CONTENT = W - 2 * M;
const BOTTOM = 64; // keep clear for the footer
const COL = {
  desc: M + 12,
  qty: M + CONTENT - 196, // right edges from here on
  unit: M + CONTENT - 104,
  total: M + CONTENT - 12,
};

function contactLines(settings) {
  return [
    [settings.phone && `Τηλ. ${settings.phone}`, settings.email].filter(Boolean).join('   ·   '),
    [settings.address, settings.vatId && `ΑΦΜ ${settings.vatId}`].filter(Boolean).join('   ·   '),
  ].filter(Boolean);
}

function qtyLabel(line) {
  const qty = formatNumber(line.qty);
  return line.unit ? `${qty} ${line.unit}` : qty;
}

export async function quotePdf(doc, settings) {
  const businessName = settings.businessName || 'Velokas Woodworks';
  const title = doc.number ? `Προσφορά ${doc.number}` : 'Προσφορά';
  const brand = await createDoc(`${title} · ${businessName}`);
  const { pdf, fonts, color } = brand;
  pdf.setAuthor(businessName);
  pdf.setSubject(doc.customer.name ? `Προσφορά προς ${doc.customer.name}` : 'Προσφορά κουζίνας');

  const date = new Date(doc.date);
  const pages = [];
  let page;
  let p;
  let y;

  // ---------- Page furniture ----------
  function firstHeader() {
    const band = 104;
    p.box(0, H, W, band, { fill: 'walnut' });
    p.box(0, H - band, W, 4, { fill: 'amber' });
    drawBandLogo(page, p, brand, { x: M - 4, centerY: H - 52, markHeight: 72, wordHeight: 28, lines: contactLines(settings) });

    p.right(doc.number ? 'ΠΡΟΣΦΟΡΑ ΑΡ.' : 'ΠΡΟΣΦΟΡΑ', W - M, H - 39, { font: fonts.bold, size: 8.5, tone: 'amber' });
    if (doc.number) p.right(doc.number, W - M, H - 62, { font: fonts.display, size: 21, tone: 'white' });
    p.right(formatDate(date), W - M, H - 79, { size: 9, tone: 'tan' });
    return H - band - 26;
  }

  function nextHeader() {
    const band = 54;
    p.box(0, H, W, band, { fill: 'walnut' });
    p.box(0, H - band, W, 3, { fill: 'amber' });
    drawSmallBandLogo(page, brand, { x: M - 2, centerY: H - 27 });
    p.right(`${title} · συνέχεια`, W - M, H - 30, { size: 9, tone: 'tan' });
    return H - band - 26;
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    p = painter(page, fonts, color);
    pages.push(page);
    y = pages.length === 1 ? firstHeader() : nextHeader();
  }

  // Starts a new page if the next block doesn't fit.
  function ensure(space, onNewPage) {
    if (y - space >= BOTTOM) return;
    newPage();
    onNewPage?.();
  }

  // ---------- Customer and dates ----------
  function infoPanel() {
    const { name, phone, address } = doc.customer;
    const left = [];
    if (name) left.push([name, fonts.bold, 12.5, 'text']);
    if (phone) left.push([phone, fonts.regular, 9.5, 'muted']);
    for (const line of wrap(address, fonts.regular, 9.5, CONTENT / 2 - 20)) {
      if (line) left.push([line, fonts.regular, 9.5, 'muted']);
    }

    const right = [['Ημερομηνία', formatDate(date)]];
    if (doc.validityDays > 0) right.push(['Ισχύει έως', formatDate(addDays(date, doc.validityDays))]);

    const rows = Math.max(left.length || 1, right.length);
    const height = 30 + rows * 15;
    p.box(M, y, CONTENT, height, { fill: 'fill', stroke: 'line', radius: 10 });

    p.text(left.length ? 'ΠΡΟΣ' : 'ΠΕΛΑΤΗΣ', M + 16, y - 18, { font: fonts.bold, size: 7.5, tone: 'faint' });
    if (left.length) {
      left.forEach(([value, font, size, tone], index) => p.text(value, M + 16, y - 34 - index * 15, { font, size, tone }));
    } else {
      p.text('—', M + 16, y - 34, { tone: 'faint' });
    }

    const x = M + CONTENT / 2 + 20;
    p.text('ΣΤΟΙΧΕΙΑ', x, y - 18, { font: fonts.bold, size: 7.5, tone: 'faint' });
    right.forEach(([label, value], index) => {
      p.text(label, x, y - 34 - index * 15, { size: 9.5, tone: 'muted' });
      p.right(value, M + CONTENT - 16, y - 34 - index * 15, { font: fonts.bold, size: 9.5 });
    });
    y -= height + 20;
  }

  // ---------- Items ----------
  function tableHeader() {
    p.box(M, y, CONTENT, 24, { fill: 'head', radius: 7 });
    const options = { font: fonts.bold, size: 7.5, tone: 'muted' };
    p.text('ΠΕΡΙΓΡΑΦΗ', COL.desc, y - 15, options);
    p.right('ΠΟΣΟΤΗΤΑ', COL.qty, y - 15, options);
    p.right('ΤΙΜΗ', COL.unit, y - 15, options);
    p.right('ΣΥΝΟΛΟ', COL.total, y - 15, options);
    y -= 28;
  }

  function itemRow(line, index) {
    const descWidth = COL.qty - 70 - COL.desc;
    const nameLines = wrap(line.name, fonts.bold, 10.5, descWidth);
    const detailLines = line.detail ? wrap(line.detail, fonts.regular, 8.5, descWidth) : [];
    const height = 12 + nameLines.length * 13 + detailLines.length * 11;
    ensure(height + 2, tableHeader);

    if (index % 2 === 1) p.box(M, y + 3, CONTENT, height, { fill: 'fill', radius: 6 });
    let lineY = y - 10;
    for (const text of nameLines) {
      p.text(text, COL.desc, lineY, { font: fonts.bold, size: 10.5 });
      lineY -= 13;
    }
    for (const text of detailLines) {
      p.text(text, COL.desc, lineY + 1, { size: 8.5, tone: 'muted' });
      lineY -= 11;
    }
    p.right(qtyLabel(line), COL.qty, y - 10, { size: 10, tone: 'muted' });
    p.right(formatMoney(line.unitCents), COL.unit, y - 10, { size: 10, tone: 'muted' });
    p.right(formatMoney(line.totalCents), COL.total, y - 10, { font: fonts.bold, size: 10.5 });
    y -= height;
  }

  // ---------- Totals ----------
  // Short notes sit to the left of the totals; returns whether they were drawn.
  function totals() {
    const rows = [];
    if (doc.discountCents > 0) {
      rows.push(['Υποσύνολο', formatMoney(doc.subtotalCents)]);
      rows.push([doc.discountLabel ? `Έκπτωση ${doc.discountLabel}` : 'Έκπτωση', `−${formatMoney(doc.discountCents)}`]);
    }
    const vat = doc.vatRate > 0;
    if (vat) {
      rows.push(['Σύνολο χωρίς ΦΠΑ', formatMoney(doc.netCents)]);
      rows.push([`ΦΠΑ ${formatNumber(doc.vatRate)}%`, formatMoney(doc.vatCents)]);
    }
    const width = 260;
    const boxHeight = 42;
    const height = 10 + rows.length * 17 + 16 + boxHeight + (doc.depositCents > 0 ? 17 : 0);
    const noteLines = doc.notes ? wrap(doc.notes, fonts.regular, 9.5, CONTENT - width - 28) : [];
    const notesBeside = noteLines.length > 0 && 15 + noteLines.length * 13 <= height;
    ensure(height + 4);

    const top = y;
    if (notesBeside) {
      p.text('ΣΗΜΕΙΩΣΕΙΣ', M, top - 12, { font: fonts.bold, size: 7.5, tone: 'faint' });
      noteLines.forEach((line, index) => p.text(line, M, top - 27 - index * 13, { size: 9.5 }));
    }

    const x = M + CONTENT - width;
    y -= 10;
    p.line(x, y + 4, M + CONTENT, y + 4);
    for (const [label, value] of rows) {
      y -= 17;
      p.text(label, x + 4, y, { size: 10, tone: 'muted' });
      p.right(value, M + CONTENT - 12, y, { font: fonts.bold, size: 10.5 });
    }
    y -= 16;
    p.box(x, y, width, boxHeight, { fill: 'walnut', radius: 10 });
    p.text(vat ? 'ΣΥΝΟΛΟ ΜΕ ΦΠΑ' : 'ΣΥΝΟΛΟ', x + 14, y - 24, { font: fonts.bold, size: 8.5, tone: 'tan' });
    p.right(formatMoney(vat ? doc.grossCents : doc.netCents), M + CONTENT - 14, y - 28, {
      font: fonts.display,
      size: 20,
      tone: 'amber',
    });
    y -= boxHeight;
    if (doc.depositCents > 0) {
      y -= 17;
      p.right(`Προκαταβολή ${formatNumber(doc.depositPercent)}%: ${formatMoney(doc.depositCents)}`, M + CONTENT - 12, y, {
        size: 9.5,
        tone: 'muted',
      });
    }
    y -= 22;
    return notesBeside;
  }

  // ---------- Notes, terms, signatures ----------
  function paragraph(label, body, tone) {
    const lines = wrap(body, fonts.regular, 9.5, CONTENT);
    ensure(26 + Math.min(lines.length, 3) * 13);
    p.text(label, M, y, { font: fonts.bold, size: 7.5, tone: 'faint' });
    y -= 15;
    for (const line of lines) {
      ensure(13);
      p.text(line, M, y, { size: 9.5, tone });
      y -= 13;
    }
    y -= 10;
  }

  function signatures() {
    ensure(52); // room to sign above the lines, plus their captions
    // With space to spare they sit low on the page, like on a printed form.
    y = Math.min(y - 38, BOTTOM + 60);
    const width = CONTENT / 2 - 30;
    const columns = [
      [M, `Για την ${businessName}`],
      [M + CONTENT - width, 'Αποδοχή πελάτη'],
    ];
    for (const [x, label] of columns) {
      p.line(x, y, x + width, y, { tone: 'faint', thickness: 0.7 });
      p.text(label, x, y - 13, { size: 8.5, tone: 'muted' });
    }
  }

  // ---------- Build ----------
  newPage();
  infoPanel();
  tableHeader();
  doc.lines.forEach(itemRow);
  const notesDone = totals();
  if (doc.notes && !notesDone) paragraph('ΣΗΜΕΙΩΣΕΙΣ', doc.notes, 'text');
  if (settings.terms) paragraph('ΟΡΟΙ', settings.terms, 'muted');
  signatures();

  pages.forEach((current, index) => {
    const footer = painter(current, fonts, color);
    footer.line(M, 40, M + CONTENT, 40);
    footer.text([businessName, settings.phone, settings.email].filter(Boolean).join('  ·  '), M, 26, { size: 7.5, tone: 'faint' });
    footer.right(`Σελίδα ${index + 1} από ${pages.length}`, M + CONTENT, 26, { size: 7.5, tone: 'faint' });
  });

  return pdf.save();
}
