import '@fontsource/bungee/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/monoton/latin-400.css';
import './styles/main.css';
import { Game, type SaveData, type Settings } from './game/game';
import { emptyNet, migrateSave, type NetState } from './game/save';
import { Net } from './net/net';
import { Hud } from './ui/hud';
import { TitleScreen } from './ui/title';
import { audio } from './core/audio';
import { loadJSON, removeKey, saveJSON } from './core/storage';
import { formatMoney } from './core/math';

const SAVE_KEY = 'jackpot-tycoon:save:v1';
const SETTINGS_KEY = 'jackpot-tycoon:settings:v1';
const NET_KEY = 'jackpot-tycoon:net:v1';

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
  game.net = { ...emptyNet(), ...(loadJSON<NetState>(NET_KEY) ?? {}) };
  const net = new Net(game, hud);
  // Your save lives in this browser and, inside the Claude artifact viewer, in your own
  // private slot of the page's database too (browser storage there can come back empty).
  // Whichever copy is newer wins.
  const readSave = (): SaveData | null => {
    const local = migrateSave(loadJSON<unknown>(SAVE_KEY));
    const cloud = net.cloudSave;
    if (!cloud) return local;
    if (!local) return cloud;
    return (cloud.savedAt ?? 0) > (local.savedAt ?? 0) ? cloud : local;
  };
  const title = new TitleScreen(hud.root, game, readSave);
  net.onCloud = () => {
    if (game.state !== 'playing') title.refreshHome();
  };
  void net.start();
  let lastSave: SaveData | null = null;
  let flushNow = false;
  game.onSave = (d) => {
    lastSave = d;
    saveJSON(SAVE_KEY, d);
    saveJSON(NET_KEY, game.net);
    net.pushCloud(d, flushNow);
  };
  hotApi()?.snapshot?.(() => (game.state === 'playing' ? game.serialize() : lastSave));
  game.settings = settings;

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
    if (hud.photo) hud.togglePhoto(false);
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
    window.setTimeout(() => game.notify('Tip: every bet lands straight in your bank, and every guest win comes out of it. The house edge does the rest.', 'info'), 4200);
    window.setTimeout(() => game.notify('Tip: walk out the front door to visit the rival casino down the street.', 'info'), 12000);
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
  title.confirm = (t, text, ok, fn) => hud.modals.confirm(t, text, ok, fn, true);
  hud.modals.onMainMenu = showTitle;
  hud.modals.onNewCasino = () => {
    removeKey(SAVE_KEY);
    net.cloudSave = null;
    showTitle();
  };
  game.events.on('camera', () => saveJSON(SETTINGS_KEY, settings));
  hud.modals.onSettingsChanged = () => {
    applyAudio();
    saveJSON(SETTINGS_KEY, settings);
  };

  const save = () => {
    if (game.state !== 'playing') return;
    flushNow = true;
    game.saveNow();
    flushNow = false;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);

  // Global shortcuts for panels
  window.addEventListener('keydown', (e) => {
    if (game.state !== 'playing' || hud.modals.isOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyH') hud.togglePhoto();
    else if (hud.photo) {
      if (e.code === 'Escape') hud.togglePhoto(false);
    }
    else if (e.code === 'KeyB') hud.shop.toggle();
    else if (e.code === 'KeyP') hud.setSpeed(0);
  });

  let last = performance.now();
  const loop = (now: number) => {
    const uiDt = Math.min(0.5, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      game.frame(now);
      hud.update(uiDt);
      net.update(uiDt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Resume straight into the game after a live update in the artifact viewer.
  const hot = migrateSave(hotData);
  if (hot) {
    game.load(hot);
    hud.root.classList.remove('hud-hidden');
    title.el.hidden = true;
  } else {
    showTitle();
  }
  (window as unknown as { __game?: Game; __net?: Net }).__game = game;
  (window as unknown as { __net?: Net }).__net = net;
  void formatMoney;
}

const hot = hotApi();
if (hot?.ready) hot.ready((data) => void start(data));
else void start(hot?.data ?? null);
