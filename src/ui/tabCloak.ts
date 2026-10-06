/**
 * Hide tab: the browser tab looks like an empty document (its title and icon); the game
 * underneath carries on as normal. Switching it off puts the game's own title and icon back.
 */

export const CLOAK_TITLE = 'Untitled document - Google Docs';

/** A blue page with a folded corner and a few lines of text, drawn here (no outside image). */
const CLOAK_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 64'>" +
      "<path d='M4 0h28l16 16v44a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z' fill='#4285f4'/>" +
      "<path d='M32 0l16 16H36a4 4 0 0 1-4-4z' fill='#a1c2fa'/>" +
      "<rect x='11' y='29' width='26' height='3.5' fill='#fff'/>" +
      "<rect x='11' y='37' width='26' height='3.5' fill='#fff'/>" +
      "<rect x='11' y='45' width='26' height='3.5' fill='#fff'/>" +
      "<rect x='11' y='53' width='17' height='3.5' fill='#fff'/>" +
      '</svg>',
  );

let original: { title: string; icon: string } | null = null;

function iconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

/** Disguise the tab (or put it back). */
export function setTabCloak(on: boolean): void {
  if (typeof document === 'undefined') return;
  const link = iconLink();
  if (!original) original = { title: document.title, icon: link.href };
  if (on) {
    document.title = CLOAK_TITLE;
    link.type = 'image/svg+xml';
    link.href = CLOAK_ICON;
  } else {
    document.title = original.title;
    link.href = original.icon;
  }
}
