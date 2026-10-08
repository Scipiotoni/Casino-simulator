/**
 * The road to the sequel. Interstate 15 runs south-east out of town to the bay, where its
 * bridge carries on over the water to Jackpot Island: Casino Simulator 2. Crossing saves
 * the game and opens the island; coming back across the bridge lands you at its end.
 */

/** Casino Simulator 2. `?island=<url>` overrides it (for local testing). */
export const ISLAND_URL = pageUrl('island') ?? 'https://scipiotoni.github.io/Casino-simulator-2/';

function pageUrl(param: string): string | null {
  try {
    const v = new URLSearchParams(location.search).get(param);
    return v && /^https?:\/\//i.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Did the player just drive back over the bridge from the island (?from=island)? Clears the flag. */
export function arrivedFromIsland(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('from') !== 'island') return false;
    q.delete('from');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    return true;
  } catch {
    return false;
  }
}

/** Save (when playing), fade out and drive on to Jackpot Island. */
export function goToIsland(save: () => void): void {
  save();
  const url = new URL(ISLAND_URL, location.href);
  url.searchParams.set('from', 'mainland');
  const fade = document.createElement('div');
  fade.className = 'sequel-fade';
  fade.innerHTML = `<div class="t1">INTERSTATE 15</div><div class="t2">To Jackpot Island · Casino Simulator 2</div><a class="go" href="${url.toString().replace(/"/g, '&quot;')}" target="_blank" rel="noopener">Continue to the island ▸</a>`;
  document.body.appendChild(fade);
  requestAnimationFrame(() => fade.classList.add('on'));
  window.setTimeout(() => {
    try {
      location.assign(url.toString());
    } catch {
      // Blocked: the link stays on screen.
    }
  }, 1400);
}
