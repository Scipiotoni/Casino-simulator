import '@fontsource/bungee/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/monoton/latin-400.css';
import './styles/main.css';
import { Game, type SaveData, type Settings } from './game/game';
import { Hud } from './ui/hud';
import { TitleScreen } from './ui/title';
import { audio } from './core/audio';
import { loadJSON, removeKey, saveJSON } from './core/storage';
import { formatMoney } from './core/math';

const SAVE_KEY = 'jackpot-tycoon:save:v1';
const SETTINGS_KEY = 'jackpot-tycoon:settings:v1';

const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  musicOn: true,
  quality: 'high',
  showFps: false,
};

interface HotApi {
  data?: unknown;
  ready?: (fn: (data: unknown) => void) => void;
  snapshot?: (fn: () => unknown) => void;
}

function hotApi(): HotApi | undefined {
  return (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
}

function guessQuality(): Settings['quality'] {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (coarse && small) return 'medium';
  return 'high';
}

async function loadFonts(): Promise<void> {
  const fonts = ['40px Bungee', '40px Pacifico', '40px Monoton', '800 20px Nunito', '400 20px Nunito'];
  const timeout = new Promise<void>((r) => window.setTimeout(r, 2500));
  try {
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), timeout]);
  } catch {
    /* fall back to system fonts */
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function start(hotData: unknown): Promise<void> {
  const app = document.getElementById('app')!;
  app.innerHTML = '<div class="boot">JACKPOT TYCOON<small>Shuffling the cards…</small></div>';
  await loadFonts();
  if (!webglAvailable()) {
    app.innerHTML = '<div class="boot">JACKPOT TYCOON<small>This game needs WebGL. Try a recent Chrome, Edge, Firefox or Safari.</small></div>';
    return;
  }
  const stored = loadJSON<Partial<Settings>>(SETTINGS_KEY);
  const settings: Settings = { ...DEFAULT_SETTINGS, quality: guessQuality(), ...stored };
  app.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'stage';
  app.appendChild(stage);
  const game = new Game(stage, settings);
  const hud = new Hud(app, game);
  const readSave = () => loadJSON<SaveData>(SAVE_KEY);
  const title = new TitleScreen(hud.root, game, readSave);

  let lastSave: SaveData | null = null;
  game.onSave = (d) => {
    lastSave = d;
    saveJSON(SAVE_KEY, d);
  };
  hotApi()?.snapshot?.(() => (game.state === 'playing' ? game.serialize() : lastSave));

  const applyAudio = () => {
    audio.applySettings({ master: settings.master, sfx: settings.sfx, music: settings.music });
    audio.setMusic(settings.musicOn);
  };
  applyAudio();
  const unlock = () => {
    audio.unlock();
    applyAudio();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const enterGame = () => {
    hud.root.classList.remove('hud-hidden');
    title.hide();
    hud.renderGoals();
  };
  const showTitle = () => {
    hud.modals.closeAll();
    hud.shop.close();
    hud.root.classList.add('hud-hidden');
    game.loadDemo();
    title.show();
  };

  title.onStart = (opts) => {
    game.newGame(opts);
    enterGame();
    hud.banner(`Welcome to ${opts.name}!`, 'Tap Build to buy your first slot machine.', 'level');
    window.setTimeout(() => game.notify('Tip: guests arrive once you have a machine. Walk past machines to collect their cash.', 'info'), 4200);
  };
  title.onContinue = () => {
    const s = readSave();
    if (!s) return;
    try {
      game.load(s);
      enterGame();
      game.notify(`Welcome back! ${s.name} is open for business.`, 'good');
    } catch (err) {
      console.error(err);
      game.notify('That save could not be loaded. Starting fresh.', 'bad');
      showTitle();
    }
  };
  title.onHelp = () => hud.modals.openHelp();
  hud.modals.onMainMenu = showTitle;
  hud.modals.onNewCasino = () => {
    removeKey(SAVE_KEY);
    showTitle();
  };
  hud.modals.onSettingsChanged = () => {
    applyAudio();
    saveJSON(SETTINGS_KEY, settings);
  };

  const save = () => game.saveNow();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);

  // Global shortcuts for panels
  window.addEventListener('keydown', (e) => {
    if (game.state !== 'playing' || hud.modals.isOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyB') hud.shop.toggle();
    else if (e.code === 'KeyP') hud.setSpeed(0);
    else if (e.code === 'Tab') {
      e.preventDefault();
      hud.shop.toggle();
    }
  });

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      game.frame(now);
      hud.update(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Resume straight into the game after a live update in the artifact viewer.
  const hot = hotData as SaveData | null | undefined;
  if (hot && typeof hot === 'object' && (hot as SaveData).v === 1) {
    game.load(hot);
    hud.root.classList.remove('hud-hidden');
    title.el.hidden = true;
  } else {
    showTitle();
  }
  (window as unknown as { __game?: Game }).__game = game;
  void formatMoney;
}

const hot = hotApi();
if (hot?.ready) hot.ready((data) => void start(data));
else void start(hot?.data ?? null);
