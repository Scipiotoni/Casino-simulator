# Jackpot Tycoon

A 3D casino tycoon you play from a top-down camera that follows your manager around the floor. Buy slot machines, tables and decorations, drop them wherever you like, keep your guests happy and grow a tiny slot parlor into the flashiest casino on the Strip.

![Gameplay: a busy casino floor with slot rows, roulette, blackjack, a bar, a fountain and a golden statue](docs/screenshot-casino.jpg)

It runs in any modern browser on desktop or phone. Everything you see and hear is generated in code: every 3D model, texture, carpet pattern, sound effect and the lounge music loop. The project has no art or audio files.

## Features

**Build it your way**
- 31 items across four categories: machines (Lucky 7s, Fruit Frenzy, Diamond Deluxe, the linked **Mega Jackpot**, claw crane, pachinko), tables (blackjack, roulette, big wheel, craps, hold'em poker), services (cocktail bar, snack bar, ATM, lounge bench, show stage) and decor (plants, palms, velvet ropes, neon signs, giant dice, gold pillars, a fountain, an aquarium, a money tree, a giant diamond, and a solid-gold statue of *you*).
- Place anything anywhere with a live ghost preview. It turns red if the spot is taken, would block the entrance, or would wall guests off from a seat.
- Click any placed item to **upgrade** it (5 levels: higher bets, bigger cash box, fewer breakdowns), **move** it, **rotate** it, **recolor** it or **sell** it. Slot machines, the bars and the claw crane take your own **sign text**. Changed your mind? Selling within 15 seconds of buying is a full refund.
- Paint the floor tile by tile, or the whole casino in one click, with 12 carpet styles from Royal Crimson and Vegas Retro to marble, gold tiles and a glowing neon grid.
- Rename your casino and restyle the neon roadside sign (4 lettering styles and 8 colors), the walls and the neon trim. Expand the building five times, from 14×12 up to 46×36 tiles.

**Customize characters**
- A full character creator with 12 hairstyles, 14 hats (including a crown, a halo and devil horns), 12 outfits (sequins, tux, Hawaiian, trench coat…), eyewear, facial hair, neckwear, props, body shapes and skin tones, plus 8 one-click presets and a randomizer.
- You can restyle your staff too. They keep their uniforms.

**A living casino**
- Every guest has a wallet, a bank balance, a mood, thirst, hunger and energy. They pick games they like, bet by their budget, cheer big wins, get grumpy on losing streaks, buy drinks, rest on benches, hit the ATM, watch the show and drop litter. Three cocktails in, they get **tipsy**: they sway, hiccup and bet bigger. They also tell you what's missing ("Slots are fine, but where are the table games?").
- Real game rules with a house edge. The slot reels land on the actual result, the roulette ball drops into the winning pocket, blackjack is dealt card by card, dice tumble across the craps table and the big wheel clicks past its pegs.
- **VIP high rollers** sparkle gold: greet them for a tip. **Cheaters** get a red "?" once they're caught winning too often: bust them to recover the loot. Machines **break down** and smoke until you fix them.
- Hire janitors, technicians, cashiers and security. Their wages are paid at the end of each day.
- Random events: happy hour, tour buses, VIP parties, power surges and jackpot buzz.
- A star rating built from guest happiness, decor, game variety, cleanliness and working machines. More stars bring more guests and more VIPs.
- 27 goals, casino levels that unlock new items, a daily report and a stats panel.
- **Manager's spin:** walk up to any free slot machine and play it yourself, with one free spin every in-game day.

**Juice**
- Bloom-lit neon, chasing marquee bulbs, confetti, coin showers, floating money, emoji thought bubbles, camera shake on jackpots, and brighter neon after dark.
- Synthesized sound effects and an optional lounge-jazz music loop.
- **Photo mode** (`H` or the camera button) hides the HUD so you can admire your casino.
- Autosaves to your browser, with Continue on the title screen.

![Character creator](docs/screenshot-creator.jpg)

## Controls

| | Desktop | Touch |
|---|---|---|
| Walk | WASD / arrow keys (Shift to run) | Drag on the left side of the screen |
| Build menu | Build button or `B` | Build button |
| Place / aim | Click the floor (`R` rotates, `Esc` or right-click cancels) | Tap to aim, tap the ghost or ✓ to place; drag to pan |
| Interact | `Space` or `F` (hold to repair) | Action button |
| Camera | `Q` / `E` rotate, mouse wheel zooms | Pinch to zoom, on-screen rotate/zoom buttons |
| Select | Click a machine, guest or staff member | Tap |
| Emotes | `1`–`4` (wave, dance, cheer, clap) | |
| Pause | `P` or the speed buttons | Speed buttons |
| Photo mode | `H` | Camera button |

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build           # typecheck + production build into dist/
npm test                # unit tests (grid, pathfinding, rotation math, game odds)
npm run preview         # serve the production build
npm run build:artifact  # single-file HTML build in dist-artifact/
```

## Deploying

The build is a static site with relative paths, so `dist/` can be hosted anywhere.

This repo includes `.github/workflows/pages.yml`, which builds and deploys to **GitHub Pages** on every push to `main`. To turn it on, open **Settings → Pages** and set **Source** to **GitHub Actions**. `.github/workflows/ci.yml` typechecks, tests and builds every push and pull request.

## How it works

- **Rendering:** [Three.js](https://threejs.org) with ACES tone mapping, an Unreal bloom pass for the neon, a studio environment map for gold and chrome, and one shadow-casting sun that only re-renders its shadow map when the layout changes. Static parts of each machine are merged into one mesh per material, and characters are merged into about seven vertex-colored parts, so a full casino stays around a few hundred draw calls.
- **Characters** (`src/entities/characterModel.ts`) are built from primitives, merged per bone and animated procedurally: walk, run, sit, pull the lever, deal, sweep, repair, cheer, dance and more, with swappable facial expressions and blinking.
- **Simulation:** a tile grid with A* pathfinding and string-pulled paths, a customer state machine driven by needs and mood, staff task claiming, and machines that resolve every round up front so their animation lands on the real outcome (`src/items/games.ts`).
- **Placement validation** flood-fills from the entrance to guarantee every guest can still reach a seat (`src/items/itemManager.ts`).
- **Audio** (`src/core/audio.ts`) is pure Web Audio: tones and filtered noise shaped by envelopes, plus a small sequencer for the lounge music.

```
src/
  core/      audio, input, math, random, storage, events
  render/    renderer + bloom, materials, procedural textures, particles
  world/     grid, pathfinding, floor painter, building shell, camera, litter
  entities/  character appearance + model, customers, staff, player
  items/     catalog, game rules, 3D models, placed-item runtime, manager
  game/      main game loop, build/placement controller, goals
  ui/        HUD, shop, panels, character creator, title screen, mini-game
tests/       vitest unit tests
```
