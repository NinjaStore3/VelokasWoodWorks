// A4 cut plan for the panel saw or the timber merchant: the settings, the
// parts with their banding, and every sheet drawn to scale.
import { formatDate, formatMoney, formatNumber, formatPercent } from './calc.js';
import { bandLabel, fitLabel, partSize, sizeLabel } from './cutplan.js';
import { PAGE, createDoc, painter } from './pdf-common.js';

const { width: W, height: H, margin: M } = PAGE;
const CONTENT = W - 2 * M;
const BOTTOM = 56;

// The app's tile colours (coral, amber, teal, …) mixed with white, so the
// pieces match the numbered rows on screen.
const TINTS = [
  [236, 91, 69],
  [238, 155, 29],
  [18, 165, 148],
  [47, 143, 224],
  [124, 92, 255],
  [226, 76, 124],
  [31, 157, 91],
  [238, 122, 42],
  [84, 104, 255],
  [116, 168, 18],
];
const tint = (index, amount) => TINTS[index % TINTS.length].map((c) => (c * amount + 255 * (1 - amount)) / 255);

const COL = {
  index: M + 10,
  name: M + 36,
  length: M + 290, // right edges from here on
  width: M + 350,
  qty: M + 398,
  band: M + 412, // left edge
};

export async function cutsPdf(plan, settings) {
  const businessName = settings.businessName || 'Velokas Woodworks';
  const { pdf, fonts, logo, color, rgb, degrees } = await createDoc(`Λίστα κοπής · ${businessName}`);
  pdf.setAuthor(businessName);
  pdf.setSubject('Λίστα και σχέδιο κοπής');

  const today = new Date();
  const pages = [];
  let page;
  let p;
  let y;

  function header() {
    const first = pages.length === 1;
    const band = first ? 84 : 54;
    p.box(0, H, W, band, { fill: 'walnut' });
    p.box(0, H - band, W, first ? 4 : 3, { fill: 'amber' });
    if (first) {
      page.drawImage(logo, { x: M, y: H - 64, width: 44, height: 44 });
      p.text(businessName, M + 56, H - 38, { font: fonts.bold, size: 16, tone: 'white' });
      p.text('Λίστα και σχέδιο κοπής', M + 56, H - 55, { size: 9, tone: 'tan' });
      p.right('ΛΙΣΤΑ ΚΟΠΗΣ', W - M, H - 36, { font: fonts.bold, size: 8.5, tone: 'amber' });
      p.right(formatDate(today), W - M, H - 54, { size: 9, tone: 'tan' });
    } else {
      p.text(businessName, M, H - 33, { font: fonts.bold, size: 12, tone: 'white' });
      p.right('Λίστα κοπής · συνέχεια', W - M, H - 33, { size: 9, tone: 'tan' });
    }
    return H - band - 24;
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    p = painter(page, fonts, color);
    pages.push(page);
    y = header();
  }

  function ensure(space, onNewPage) {
    if (y - space >= BOTTOM) return;
    newPage();
    onNewPage?.();
  }

  // ---------- Summary ----------
  function summary() {
    const { result } = plan;
    const mm = (value) => `${formatNumber(value)} mm`;
    const left = [
      ['Φύλλο', `${formatNumber(plan.sheet.length)} × ${formatNumber(plan.sheet.width)} mm`],
      ['Λάμα', mm(plan.kerf)],
      ['Ξάκρισμα', `${mm(plan.trim)} ανά πλευρά`],
      ['Νερά ξύλου', plan.grain ? 'Ναι, χωρίς περιστροφή' : 'Όχι'],
    ];
    const right = [
      ['Φύλλα', String(result.sheetCount)],
      ['Αξιοποίηση', formatPercent(result.utilization)],
      ['Κομμάτια', String(plan.pieceCount)],
      ['Ταινία', `${formatNumber(plan.banding.totalMeters)} μ.`],
    ];
    if (plan.totalCents > 0) right.push(['Κόστος υλικού', formatMoney(plan.totalCents)]);

    const rows = Math.max(left.length, right.length);
    const height = 22 + rows * 15;
    p.box(M, y, CONTENT, height, { fill: 'fill', stroke: 'line', radius: 10 });
    const column = (items, x, xRight) =>
      items.forEach(([label, value], index) => {
        p.text(label, x, y - 24 - index * 15, { size: 9.5, tone: 'muted' });
        p.right(value, xRight, y - 24 - index * 15, { font: fonts.bold, size: 9.5 });
      });
    column(left, M + 16, M + CONTENT / 2 - 18);
    column(right, M + CONTENT / 2 + 18, M + CONTENT - 16);
    p.line(M + CONTENT / 2, y - 14, M + CONTENT / 2, y - height + 14);
    y -= height + 22;
  }

  // ---------- Parts table ----------
  function tableHeader() {
    p.box(M, y, CONTENT, 22, { fill: 'head', radius: 7 });
    const options = { font: fonts.bold, size: 7.5, tone: 'muted' };
    p.text('#', COL.index, y - 14, options);
    p.text('ΚΟΜΜΑΤΙ', COL.name, y - 14, options);
    p.right('ΜΗΚΟΣ', COL.length, y - 14, options);
    p.right('ΠΛΑΤΟΣ', COL.width, y - 14, options);
    p.right('ΤΕΜ.', COL.qty, y - 14, options);
    p.text('ΤΑΙΝΙΑ', COL.band, y - 14, options);
    y -= 26;
  }

  function partRow(part, row, tooBig) {
    const height = 20;
    ensure(height, tableHeader);
    if (row % 2 === 1) p.box(M, y + 2, CONTENT, height, { fill: 'fill', radius: 5 });
    page.drawRectangle({ x: COL.index - 2, y: y - 13, width: 15, height: 13, color: rgb(...tint(part.index, 1)) });
    p.center(String(part.index + 1), COL.index + 5.5, y - 10, { font: fonts.bold, size: 7.5, tone: 'white' });
    let name = part.name;
    while (name.length > 1 && fonts.bold.widthOfTextAtSize(name, 9.5) > COL.length - 70 - COL.name) name = `${name.slice(0, -2)}…`;
    p.text(name, COL.name, y - 11, { font: fonts.bold, size: 9.5, tone: tooBig ? 'danger' : 'text' });
    p.right(formatNumber(part.length), COL.length, y - 11, { size: 9.5 });
    p.right(formatNumber(part.width), COL.width, y - 11, { size: 9.5 });
    p.right(String(part.qty), COL.qty, y - 11, { font: fonts.bold, size: 9.5 });
    p.text(bandLabel(part), COL.band, y - 11, { size: 8.5, tone: 'muted' });
    y -= height;
  }

  function parts() {
    tableHeader();
    const tooBig = new Set(plan.result.unplaced.map((part) => part.partId));
    plan.valid.forEach((part, row) => partRow(part, row, tooBig.has(part.id)));
    y -= 8;
    if (tooBig.size) {
      ensure(16);
      p.text(`Δεν χωράνε στο φύλλο: ${plan.result.unplaced.map((part) => part.name).join(', ')}`, M, y - 8, {
        font: fonts.bold,
        size: 9,
        tone: 'danger',
      });
      y -= 20;
    }
    y -= 12;
  }

  // ---------- Sheets ----------
  function drawSheet(packed, index) {
    const { sheet, trim } = plan;
    const maxHeight = 300; // two sheets fit on a page
    const scale = Math.min(CONTENT / sheet.length, maxHeight / sheet.width);
    const width = sheet.length * scale;
    const height = sheet.width * scale;
    ensure(height + 26);

    p.text(`Φύλλο ${index + 1} από ${plan.result.sheetCount}`, M, y - 10, { font: fonts.bold, size: 10.5 });
    p.right(`${packed.placements.length} κομμάτια · αξιοποίηση ${formatPercent(packed.utilization)}`, M + CONTENT, y - 10, {
      size: 9,
      tone: 'muted',
    });
    y -= 18;

    const left = M + (CONTENT - width) / 2;
    const top = y;
    // y in the cut plan runs down from the sheet's top-left corner.
    const rect = (x, yDown, w, h) => ({ x: left + x * scale, y: top - (yDown + h) * scale, width: w * scale, height: h * scale });

    page.drawRectangle({ ...rect(0, 0, sheet.length, sheet.width), color: rgb(0.957, 0.918, 0.863), borderColor: color('tan'), borderWidth: 0.8 });
    if (trim > 0) {
      page.drawRectangle({
        ...rect(trim, trim, sheet.length - 2 * trim, sheet.width - 2 * trim),
        borderColor: color('tan'),
        borderWidth: 0.5,
        borderDashArray: [3, 3],
      });
    }

    const byId = new Map(plan.valid.map((part) => [part.id, part]));
    const measure = (text, size) => fonts.bold.widthOfTextAtSize(text, size);
    for (const piece of packed.placements) {
      const part = byId.get(piece.partId);
      const box = rect(piece.x, piece.y, piece.length, piece.width);
      page.drawRectangle({ ...box, color: rgb(...tint(part.index, 0.5)), borderColor: color('walnut'), borderWidth: 0.6 });

      const size = partSize(piece);
      const dims = sizeLabel(size.length, size.width);
      const label = fitLabel([[part.name, dims], [dims], [String(part.index + 1)]], box.width, box.height, [8, 6.5, 5], measure);
      if (!label) continue;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const lineHeight = label.size * 1.15;
      label.lines.forEach((line, i) => {
        const down = (i - (label.lines.length - 1) / 2) * lineHeight + label.size * 0.35;
        const along = measure(line, label.size) / 2;
        page.drawText(line, {
          x: label.vertical ? cx + down : cx - along,
          y: label.vertical ? cy - along : cy - down,
          size: label.size,
          font: fonts.bold,
          color: color('text'),
          rotate: label.vertical ? degrees(90) : undefined,
        });
      });
    }
    y -= height + 22;
  }

  // ---------- Build ----------
  newPage();
  summary();
  parts();
  plan.result.sheets.forEach(drawSheet);

  pages.forEach((current, index) => {
    const footer = painter(current, fonts, color);
    footer.line(M, 38, M + CONTENT, 38);
    footer.text(`${businessName} · ${formatDate(today)}`, M, 25, { size: 7.5, tone: 'faint' });
    footer.right(`Σελίδα ${index + 1} από ${pages.length}`, M + CONTENT, 25, { size: 7.5, tone: 'faint' });
  });

  return pdf.save();
}
