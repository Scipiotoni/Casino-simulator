// Packs the production build (dist/) into one self-contained HTML fragment:
// inline CSS (fonts as data URIs) and an inline module script. Used to publish
// the game as a single-page artifact that needs no other files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsPath = html.match(/<script[^>]+src="\.\/([^"]+\.js)"/)?.[1];
const cssPath = html.match(/<link[^>]+href="\.\/([^"]+\.css)"/)?.[1];
if (!jsPath || !cssPath) throw new Error('Could not find built JS/CSS in dist/index.html');

let css = readFileSync(join(dist, cssPath), 'utf8');
const cssDir = dirname(join(dist, cssPath));
// Keep only the woff2 source of every @font-face and inline it.
css = css.replace(/src:([^;}]+)/g, (full, srcs) => {
  const woff2 = srcs.match(/url\(([^)]+\.woff2)\)/);
  if (!woff2) return full;
  const file = woff2[1].replace(/^["']|["']$/g, '');
  const data = readFileSync(join(cssDir, file)).toString('base64');
  return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
});

const js = readFileSync(join(dist, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Jackpot Tycoon';

const out = `<title>${title}</title>
<meta name="description" content="Run your own 3D casino: buy machines, place them anywhere, customize everything.">
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
mkdirSync('dist-artifact', { recursive: true });
const file = join('dist-artifact', 'jackpot-tycoon.html');
writeFileSync(file, out);
console.log(`Wrote ${file} (${(out.length / 1024).toFixed(0)} KB)`);
