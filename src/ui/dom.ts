type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  style?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  hidden?: boolean;
  role?: string;
  'aria-label'?: string;
  'aria-pressed'?: string;
  'aria-selected'?: string;
  tabIndex?: number;
  onClick?: (e: MouseEvent) => void;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
  dataset?: Record<string, string>;
  src?: string;
  alt?: string;
  loading?: string;
  'aria-live'?: string;
  'aria-checked'?: string;
}

const HANDLED = new Set([
  'class', 'id', 'text', 'html', 'title', 'style', 'type', 'value', 'placeholder', 'maxLength', 'disabled', 'hidden', 'role',
  'aria-label', 'aria-pressed', 'aria-selected', 'tabIndex', 'onClick', 'onInput', 'onChange', 'dataset',
]);

/** Tiny hyperscript helper for building UI without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.title) el.title = props.title;
  if (props.style) el.setAttribute('style', props.style);
  if (props.type) el.setAttribute('type', props.type);
  if (props.value !== undefined) (el as HTMLInputElement).value = props.value;
  if (props.placeholder) (el as HTMLInputElement).placeholder = props.placeholder;
  if (props.maxLength) (el as HTMLInputElement).maxLength = props.maxLength;
  if (props.disabled) (el as HTMLButtonElement).disabled = true;
  if (props.hidden) el.hidden = true;
  if (props.role) el.setAttribute('role', props.role);
  if (props['aria-label']) el.setAttribute('aria-label', props['aria-label']);
  if (props['aria-pressed']) el.setAttribute('aria-pressed', props['aria-pressed']);
  if (props['aria-selected']) el.setAttribute('aria-selected', props['aria-selected']);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  if (props.onClick) el.addEventListener('click', props.onClick as EventListener);
  if (props.onInput) el.addEventListener('input', props.onInput);
  if (props.onChange) el.addEventListener('change', props.onChange);
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  // Any other plain attribute (src, alt, loading, aria-*) is passed straight through.
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (HANDLED.has(k) || v === undefined || v === null || typeof v === 'function' || typeof v === 'object') continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const PATHS: Record<string, string> = {
  build: '<path d="M4 20h16"/><path d="M6 20V10l6-5 6 5v10"/><path d="M10 20v-5h4v5"/><path d="M12 5V2"/>',
  shop: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  floor: '<rect x="3" y="4" width="13" height="6" rx="1.5"/><path d="M16 7h3v5h-8v3"/><rect x="9.5" y="15" width="3" height="6" rx="1"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c3 .3 5.5 2.6 5.5 5.8"/>',
  casino: '<path d="M12 2.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.1l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  you: '<circle cx="12" cy="7.5" r="3.8"/><path d="M4.5 21c0-4.2 3.4-7.5 7.5-7.5s7.5 3.3 7.5 7.5"/>',
  stats: '<path d="M4 20V11"/><path d="M10 20V5"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  ff: '<path d="M4 5l8 7-8 7z"/><path d="M12 5l8 7-8 7z"/>',
  fff: '<path d="M2 6l6 6-6 6z"/><path d="M9 6l6 6-6 6z"/><path d="M16 6l6 6-6 6z"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  move: '<path d="M12 3v18"/><path d="M3 12h18"/><path d="M12 3l-3 3"/><path d="M12 3l3 3"/><path d="M12 21l-3-3"/><path d="M12 21l3-3"/><path d="M3 12l3-3"/><path d="M3 12l3 3"/><path d="M21 12l-3-3"/><path d="M21 12l-3 3"/>',
  upgrade: '<path d="M12 20V5"/><path d="M5 12l7-7 7 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  sell: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9.2c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3.2 6.2 1.6 6.2 4.8 0 1.3-1.3 2.3-3.2 2.3-1.4 0-2.6-.6-3.2-1.6"/><path d="M12 6v12"/>',
  paint: '<path d="M18.5 3.5l2 2L10 16l-3 1 1-3z"/><path d="M4 20c1.5 0 3-.7 3-2.5"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.5v.1"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="15" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="9" cy="15" r="1.1"/>',
  expand: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  wave: '<path d="M7 13V7a1.5 1.5 0 0 1 3 0v4"/><path d="M10 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M13 11V6a1.5 1.5 0 0 1 3 0v6"/><path d="M16 12V9a1.5 1.5 0 0 1 3 0v4c0 4-3 7-7 7-3 0-5-2-6-4l-2-4a1.5 1.5 0 0 1 2.6-1.5L7 13"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
  hotel: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2"/><path d="M13 7h2"/><path d="M9 11h2"/><path d="M13 11h2"/><path d="M10 21v-4h4v4"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/><path d="M8 11h6"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 22): string {
  const p = PATHS[name] ?? PATHS.help;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

export function stars(rating: number): string {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    const fill = rating >= i - 0.25 ? 'full' : rating >= i - 0.75 ? 'half' : 'empty';
    out += `<span class="star ${fill}">★</span>`;
  }
  return out;
}

export function swatch(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
