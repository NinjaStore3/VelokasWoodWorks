// Icons come from /icons.svg, a sprite of Lucide icons (ISC licence) built by
// scripts/build-icons.mjs. Add a name here, then run `npm run icons`.

// Icons the admin can pick for extras and cost lines: [name, Greek label].
export const PICKER_ICONS = [
  ['square-round-corner', 'Γωνία'],
  ['rotate-cw-square', 'Περιστροφή'],
  ['bottle-wine', 'Μπουκάλι'],
  ['wine', 'Ποτήρι'],
  ['soup', 'Πιάτο'],
  ['utensils', 'Κουτάλια'],
  ['chef-hat', 'Κουζίνα'],
  ['cooking-pot', 'Κατσαρόλα'],
  ['panel-bottom', 'Συρτάρι'],
  ['archive', 'Βαθύ συρτάρι'],
  ['rows-3', 'Συρταριέρα'],
  ['shelving-unit', 'Ράφια'],
  ['columns-3', 'Ντουλάπι'],
  ['door-closed', 'Πόρτα'],
  ['door-open', 'Ανοιχτή πόρτα'],
  ['recycle', 'Κάδος'],
  ['trash', 'Απορρίμματα'],
  ['refrigerator', 'Ψυγείο'],
  ['microwave', 'Φούρνος'],
  ['faucet', 'Βρύση'],
  ['lightbulb', 'Φωτισμός'],
  ['grip-horizontal', 'Πόμολο'],
  ['shirt', 'Ντουλάπα'],
  ['lamp-ceiling', 'Φωτιστικό'],
  ['plug-zap', 'Ρεύμα'],
  ['boxes', 'Κομμάτια'],
  ['package', 'Πακέτο'],
  ['cog', 'Μηχανισμός'],
  ['wrench', 'Κλειδί'],
  ['drill', 'Δράπανο'],
  ['hammer', 'Σφυρί'],
  ['axe', 'Ξύλο'],
  ['ruler', 'Μέτρο'],
  ['layers', 'Πάγκος'],
  ['brick-wall', 'Τοίχος'],
  ['paint-roller', 'Βάψιμο'],
  ['paintbrush', 'Πινέλο'],
  ['hard-hat', 'Εργασία'],
  ['users', 'Συνεργείο'],
  ['truck', 'Μεταφορά'],
  ['fuel', 'Καύσιμα'],
  ['hand-coins', 'Πληρωμή'],
  ['sparkles', 'Extra'],
  ['gem', 'Premium'],
  ['star', 'Αστέρι'],
  ['tag', 'Ετικέτα'],
];

// Icons used by the interface itself.
export const UI_ICONS = [
  'arrow-down', 'arrow-up', 'badge-check', 'badge-percent', 'building-2', 'calculator', 'calendar', 'check',
  'chevron-down', 'circle-alert', 'circle-check', 'circle-x', 'clock', 'copy', 'copy-plus', 'download',
  'external-link', 'eye-off', 'file-down', 'file-text', 'folder-open', 'hourglass', 'info', 'key-round',
  'layers-2', 'layout-grid', 'list-plus', 'loader-circle', 'lock', 'log-out', 'mail', 'map-pin', 'minus', 'notebook-pen',
  'pencil', 'percent', 'phone', 'piggy-bank', 'plus', 'printer', 'receipt-euro', 'rectangle-horizontal',
  'refresh-cw', 'rotate-ccw', 'rotate-cw', 'ruler-dimension-line', 'save', 'scissors', 'search', 'send',
  'settings', 'share-2', 'sliders-horizontal', 'trash-2', 'trending-down', 'trending-up', 'triangle-alert',
  'trophy', 'undo-2', 'user-round', 'wallet', 'wifi-off', 'x',
];

const KNOWN = new Set([...PICKER_ICONS.map(([name]) => name), ...UI_ICONS]);
const FALLBACK = 'sparkles';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className ? `icon ${className}` : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/icons.svg#${KNOWN.has(name) ? name : FALLBACK}`);
  svg.append(use);
  return svg;
}

// Each extra / cost line gets its own colour, cycling through the palette.
const TINTS = ['--coral', '--amber', '--teal', '--sky', '--violet', '--rose', '--green', '--orange', '--indigo', '--lime'];

export function tileTint(index) {
  return `var(${TINTS[index % TINTS.length]})`;
}
