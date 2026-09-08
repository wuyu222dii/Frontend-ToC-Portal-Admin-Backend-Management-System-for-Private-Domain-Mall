export const QX_ICON_NAMES = [
  'home',
  'home-fill',
  'category',
  'category-fill',
  'cart',
  'cart-fill',
  'profile',
  'profile-fill',
  'search',
  'back',
  'close',
  'chevron',
  'heart',
  'heart-fill',
  'plus',
  'minus',
  'check',
  'empty',
  'warning',
  'clock',
  'reload',
  'trash',
  'location',
  'order',
  'phone',
  'shield',
  'edit',
  'user',
] as const;

export type QxIconName = (typeof QX_ICON_NAMES)[number];

const strokeSvg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const fillSvg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">${body}</svg>`;

export const QX_ICON_SVG: Record<QxIconName, string> = {
  home: strokeSvg('<path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5.2v-6.2H9.2V21H5a1 1 0 0 1-1-1z"/>'),
  'home-fill': fillSvg('<path d="M12 3.2 3.6 10.3A1 1 0 0 0 3.3 11V20a1.7 1.7 0 0 0 1.7 1.7h5.1v-6.4h3.8v6.4h5.1A1.7 1.7 0 0 0 20.7 20v-9a1 1 0 0 0-.3-.7z"/>'),
  category: strokeSvg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>'),
  'category-fill': fillSvg('<rect x="3.5" y="3.5" width="7.2" height="7.2" rx="1.4"/><rect x="13.3" y="3.5" width="7.2" height="7.2" rx="1.4"/><rect x="3.5" y="13.3" width="7.2" height="7.2" rx="1.4"/><rect x="13.3" y="13.3" width="7.2" height="7.2" rx="1.4"/>'),
  cart: strokeSvg('<path d="M4 5h2l1.2 2.2L9 16h8.4l2.2-8.2H7.4"/><circle cx="10" cy="19.2" r="1.3"/><circle cx="16.5" cy="19.2" r="1.3"/>'),
  'cart-fill': fillSvg('<path d="M3.4 4.2h2.3l.4.8 1.4 2.6h12.7a1 1 0 0 1 1 .7l2 7.4a1 1 0 0 1-1 1.3H8.7L7.4 20.3H5.6l1.8-4.7H4.2l-.8-1.5 1.2-2.2L3.4 6.2zm6.4 16.6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m6.6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>'),
  profile: strokeSvg('<circle cx="12" cy="8" r="3.4"/><path d="M5.2 19.4a6.8 6.8 0 0 1 13.6 0"/>'),
  'profile-fill': fillSvg('<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0 1 1 0 0 1-1 1.2H5.6a1 1 0 0 1-1-1.2"/>'),
  search: strokeSvg('<circle cx="11" cy="11" r="6.2"/><path d="m16 16 4 4"/>'),
  back: strokeSvg('<path d="M15 5 8 12l7 7"/>'),
  close: strokeSvg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: strokeSvg('<path d="m9 6 6 6-6 6"/>'),
  heart: strokeSvg('<path d="M12 19.4s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 7.4a4 4 0 0 1 7.2 2.9c0 4.7-7.2 9.1-7.2 9.1z"/>'),
  'heart-fill': fillSvg('<path d="M12 20.3S3.8 15.4 3.8 10.1A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.2 3.5c0 5.3-8.2 10.2-8.2 10.2z"/>'),
  plus: strokeSvg('<path d="M12 6v12M6 12h12"/>'),
  minus: strokeSvg('<path d="M6 12h12"/>'),
  check: strokeSvg('<path d="m5.5 12.5 4.2 4.2 8.8-9.4"/>'),
  empty: strokeSvg('<path d="M7 8h10l1.4 11.2H5.6z"/><path d="M9 8V6.4A3 3 0 0 1 12 3.4 3 3 0 0 1 15 6.4V8"/>'),
  warning: strokeSvg('<path d="M12 4.4 3.6 19.2h16.8z"/><path d="M12 10v4.4M12 16.8h.01"/>'),
  clock: strokeSvg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.4l2.8 1.8"/>'),
  reload: strokeSvg('<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1"/><path d="M19.2 4.8V9h-4.2"/>'),
  trash: strokeSvg('<path d="M5 7h14M9.4 7V5.4A1.4 1.4 0 0 1 10.8 4h2.4a1.4 1.4 0 0 1 1.4 1.4V7m-.8 12.6H9.2A1.6 1.6 0 0 1 7.6 18V7h8.8v11a1.6 1.6 0 0 1-1.6 1.6z"/>'),
  location: strokeSvg('<path d="M12 21s6.4-5.2 6.4-10A6.4 6.4 0 0 0 5.6 11c0 4.8 6.4 10 6.4 10z"/><circle cx="12" cy="11" r="2.1"/>'),
  order: strokeSvg('<path d="M7 4.6h10l1.6 3.2v11.6a1 1 0 0 1-1 1H6.4a1 1 0 0 1-1-1V7.8z"/><path d="M7 7.8h10M9 12h6M9 15.4h4"/>'),
  phone: strokeSvg('<rect x="7" y="3.5" width="10" height="17" rx="2"/><path d="M11 17.8h2"/>'),
  shield: strokeSvg('<path d="M12 3.6 19 6.2v6.2c0 4.4-3.1 7.4-7 8.6-3.9-1.2-7-4.2-7-8.6V6.2z"/><path d="m9.2 12 2 2 3.8-4"/>'),
  edit: strokeSvg('<path d="M4.6 16.6 16.3 4.9a1.8 1.8 0 0 1 2.5 0l.3.3a1.8 1.8 0 0 1 0 2.5L7.4 19.4H4.6z"/><path d="m14.6 6.6 2.8 2.8"/>'),
  user: strokeSvg('<circle cx="12" cy="8" r="3.4"/><path d="M5.2 19.4a6.8 6.8 0 0 1 13.6 0"/>'),
};

export function qxIconDataUri(name: QxIconName): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(QX_ICON_SVG[name])}")`;
}
