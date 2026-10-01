# Jackpot Tycoon

A 3D casino tycoon you play from a top-down (or third-person) camera that follows your manager. Buy slot machines, tables and decorations, drop them wherever you like, keep your guests happy and grow a tiny slot parlor into a tower on the Strip. Then walk out the front door and gamble at the rival casino next door, or at your friends' casinos further down the street.

![Gameplay: a busy casino floor with slot rows, roulette, blackjack, a bar, a fountain and a golden statue](docs/screenshot-casino.jpg)

**Play it: https://scipiotoni.github.io/Casino-simulator/** (multiplayer: everyone who opens the link shares one street).

It runs in any modern browser on desktop or phone. Everything you see and hear is generated in code: every 3D model, texture, carpet pattern, sound effect and the lounge music loop. The project has no art or audio files.

## Features

**Build it your way**
- 36 shop items across four categories: machines (Lucky 7s, Fruit Frenzy, Diamond Deluxe, the linked **Mega Jackpot**, video poker, keno, claw crane, pachinko), tables (blackjack, baccarat, roulette, Big Six wheel, craps, sic bo, hold'em and Three Card Poker), services (cocktail bar, snack bar, ATM, lounge bench, show stage) and decor (plants, palms, velvet ropes, neon signs, giant dice, gold pillars, a fountain, an aquarium, a money tree, a giant diamond, and a solid-gold statue of *you*).
- Place anything anywhere with a live ghost preview. It turns red if the spot is taken, would block the entrance, or would wall guests off from a seat.
- Click any placed item to **upgrade** it (5 levels: higher bets, bigger cash box, fewer breakdowns), **move** it, **rotate** it, **recolor** it or **sell** it. Slot machines, the bars and the claw crane take your own **sign text**. Changed your mind? Selling within 15 seconds of buying is a full refund.
- **Build walls** (Build → Walls, or the Casino panel): drag a straight line across the floor to put up ceiling-high walls with skirting boards, a chair rail, crown moulding and pillars at the corners and make rooms, hallways and private corners in your casino, hotel or house. 15 wall styles (plaster, red brick, walnut panels, stone, casino velvet, subway tile, marble, glass partitions, black and ice neon, solid gold, garden hedge). Walls join up at corners, guests and staff walk around them, and a wall is refused if it would shut guests out of a seat or the elevator. Knock them down for half the price back. Like the building's outer walls they cut away depending on where the camera is: walls between the camera and you drop down, and from the top-down camera every wall facing the camera folds down while the ones running along your view stay up. In first person every wall stands to the ceiling, and you see the ceiling (tiles, gold-trimmed light panels and downlights) over your head. In build mode all walls are cut down.
- Paint the floor tile by tile, or the whole casino in one click, with 12 carpet styles from Royal Crimson and Vegas Retro to marble, gold tiles and a glowing neon grid.
- Rename your casino and restyle its sign (4 lettering styles and 8 colors), the walls and the neon trim. Paint the floor from the Casino panel.
- **Grow wide, deep and tall.** Every lot on the street shares the same width limit (22 tiles), but you can keep building deeper and stack as many floors as you can afford. A glass elevator links the floors, and guests and staff ride it. You choose where the elevator goes (the shaft moves on every floor at once), and any machine can be carried to another floor from its card. Upstairs you really are upstairs: the street drops away below the building, the doorway becomes a window and a banner shows which floor you're on.
- **Decorate the yard:** decorations can also go in the two rows of sidewalk in front of your casino, so the street sees your palms, fountains and neon.
- The building is modelled from the outside too: storeys with lit windows, neon trim, a marquee with chasing bulbs over the entrance and a roof billboard with your casino's name. Step inside and the walls cut away.

**Customize characters**
- A full character creator with 12 hairstyles, 14 hats (including a crown, a halo and devil horns), 12 outfits (sequins, tux, Hawaiian, trench coat…), eyewear, facial hair, neckwear, props, body shapes and skin tones, plus 8 one-click presets and a randomizer.
- You can restyle your staff too. They keep their uniforms.

**A living casino**
- Every guest has a wallet, a bank balance, a mood, thirst, hunger and energy. They pick games they like, bet by their budget, cheer big wins, get grumpy on losing streaks, buy drinks, rest on benches, hit the ATM, watch the show and drop litter. Three cocktails in, they get **tipsy**: they sway, hiccup and bet bigger. They also tell you what's missing ("Slots are fine, but where are the table games?").
- **Real money flow.** Every round settles the moment it ends: when a guest loses, their bet lands in your bank; when a guest wins, you pay them out of it. The house edge wins over time (guests get back roughly 56¢ per dollar on average), but a lucky streak on your floor still stings.
- Real game rules. The slot reels land on the actual result, the roulette ball drops into the winning pocket, blackjack is dealt card by card, dice tumble across the craps table and the big wheel clicks past its pegs.
- **VIP high rollers** sparkle gold: greet them for a tip. **Cheaters** (rare) get a red "?" once they're caught winning too often: bust them to recover the loot. Machines **break down** and smoke until you fix them.
- Hire janitors, technicians, security and **door guards**, who stand at the entrance and turn most cheaters away before they get in. Wages are paid at the end of each day.
- Random events: happy hour, tour buses, VIP parties, power surges and jackpot buzz.
- A star rating built from guest happiness, decor, game variety, cleanliness and working machines. More stars bring more guests and more VIPs.
- 41 goals, casino levels that unlock new items, a daily report and a stats panel.

**The city**
- A whole city grid, at least 20 lots wide: four streets (the **Casino Strip**, **Palm Avenue** for houses, **Downtown Boulevard** and **Sunset Drive**) crossed by avenues every four lots, with crosswalks, working traffic lights, street-name signs, lamps, trees, hydrants and **cars** that drive the roads, stop at red lights and honk if you stand in their lane. Lots are further apart and you walk faster outdoors.
- **Your garage:** build a garage next to your house (Home → Garage, or walk up to the spot beside your house and press Space): a Two-Car Garage, then Four-Car and a six-car Collector's Garage. Drive up to the door (it rolls up as you arrive) and press Space to park: the car goes inside (you can see your cars parked in the bays), gets washed and its nitro topped up. Stand at the door and press Space to pick a car and drive it out, or send a car home with a valet from anywhere. **Hide a stolen car** in your garage once the police have lost you, and it's yours to keep.
- **Driving camera:** behind the wheel the camera sits low behind the car and looks down the road to the horizon, and the view widens as you speed up.
- **Customize your guns** at Bullseye Guns (🎨 Customize under any weapon you own), with a turning 3D preview and live stats: 13 skins (Blackout, Mirror Chrome, 24K Gold, Rose Gold, Woodland Camo, Desert Digital, Carbon Fibre, Tiger Stripe, Neon Pink, Neon Ice, Galaxy and Diamond Encrusted), sights (red dot, holographic, 4× scope: tighter aimed shots and more zoom), a suppressor (quiet shots that don't send people running) or a compensator (less kick), extended and drum magazines (more rounds, slower reloads), a red laser sight (tighter hip fire, and a visible beam) and a charm hanging off the gun (dice, poker chip, cherries, gold star, skull). Melee weapons take skins and charms. Your skin and attachments show on the gun in your hands, in first and third person, and **other players see them too** (laser beam included). **Look through your optics:** a scope's lens shows a live magnified picture of the world with its reticle as you raise the gun, and aiming all the way in puts your eye to the scope (the full-screen scope view at its zoom). Red dot and holographic sights line up with your eye when you aim, with their dot or ring in the middle of the screen.
- **Aim and shoot at the same time:** hold the right mouse button to aim down the sights and click (or hold) the left one to fire. A click during the gun's cooldown is remembered and fires as soon as it's ready.
- **Low frame rate tip:** if the game runs under 25 fps for several seconds, a tip offers to lower the graphics (Medium renders at a lower resolution with softer shadows; Low also drops the glow and shadows). Pick one or "Not now"; it won't ask again at the same setting this session. Change it any time in Menu → Settings → Graphics.
- **No invisible wall around town**: walk or drive straight out of the city into the open Mojave desert around it, until the land rises into red-rock mountains that close the valley in. A ring road circles the city with roads out of every street and avenue, and there's plenty to find out there: the "Welcome to Fabulous Jackpot City" sign on the west road, billboards along the ring road, an oasis with palms to the north, a solar farm, a highway east to a scenic overlook with telescopes, wind turbines turning on the southern ridge, a radio mast blinking on the hills and hot-air balloons drifting over the Strip. Cacti, Joshua trees and boulders are scattered everywhere (you walk around them). The city map shows the desert, the ring road and the oasis; zoom the big map out to see it all.
- **A real sky with a day and night cycle** that follows the game clock: the sun rises in the east around 6:00, crosses the sky and sets in the west around 20:00 with orange and pink dusk light, then stars and the moon come out. Clouds drift and take the colour of the light, sunlight and shadows follow the sun, distant mountains fade into the haze, and neon signs glow brighter after dark. Inside your buildings the lights stay on whatever the time.
- **The city is busy.** Passers-by stroll every sidewalk, cross at the crosswalks and walk in and out of casinos, hotels, the gun shop and the apartments, most of all the casinos and hotels. Your casino and hotel are full of guests the moment you walk back in, even after time away.
- Every unused lot holds a **filler building** (apartments, glass towers, diners, shops, motels, brownstones, villas, a chapel, a cinema, a gas station, parks and parking lots). When a player needs the space (a new casino, a hotel building or a house), the filler makes way for it.
- Lots now go up to 68 tiles deep (the next street's buildings start behind them); old saves deeper than that are trimmed, with anything that no longer fits refunded.
- A live **city map** (bottom right, `M` to enlarge) shows every building and **every online player, wherever they are**: a dot with their name out on the street (a box if they're driving, their wanted stars, 💫 if knocked out), or a ring at the door of the building they're in, with where they are. Zoom with the mouse wheel (around the cursor) or the − / + buttons, drag to pan, ◎ to come back to you. The big map lists everyone online: click a name to zoom in and follow them. The map **turns with the camera** so the way you're looking is always up (🧭 switches to north-up; a red N marks north). **Waypoints:** click anywhere on the map (or on a building, for its front door) to mark a waypoint: a dashed route on the map, a golden light beam in the world you can see from across town, and a marker at the top of the screen with the distance and an arrow pointing the way. It clears when you arrive (or click it again). **Fast travel only works between your own buildings:** from your casino, hotel or house (inside, or right outside the door) click another of them on the map to jump there. Everywhere else you walk or drive.
- **The Golden Viper**, a rival AI casino, sits across the road. It grows (wider, deeper, up to four floors) as players lose money there, and its security walks you out if you win too much.
- You can't gamble in your own casino, so go and play somewhere else, with standard casino rules and paytables:
  - **Blackjack**: 6 decks, dealer stands on all 17s, 3:2 blackjack, insurance 2:1, double on any two, split up to four hands (aces once) and late surrender.
  - **Craps**: pass and don't pass (bar 12), free odds at true odds, the field, hardways and the one-roll props (any 7, any craps, yo, aces, boxcars).
  - **Baccarat** (punto banco with the full third-card rules; banker pays 19:20, tie 8:1, pairs 11:1), **Three Card Poker** (ante, play, pair plus, ante bonus), **Casino Hold'em**, single-zero **roulette**, **sic bo**, the 54-stop **Big Six** wheel, **Jacks or Better** video poker (9/6), **keno**, **slots**, pachinko and the claw crane.
  - Your character sits down at the table, the camera leans in, and every card, spin and roll plays out on the real 3D table as well as on the game screen. There's no maximum bet: pick a chip, type any amount or go all in. You bet from your own bank; what you lose goes to the owner.
- Your casino keeps running while you're out, and catches up when you get back.

**Multiplayer**
- Everyone who opens the game (the public site, or the shared Claude artifact) builds a casino on the same street. You see each other walking around live, with name tags, and you can walk into any published casino and play its games. Losses and wins at another player's tables are settled into their bank through a shared ledger, even if they're offline.
- **Blacklist** anyone, any time, for no reason at all: from **Menu → Players & blacklist** (everyone online plus every casino owner on the street) or by clicking a player. Pick 5 min, 15 min, 30 min, 1 h or 4 h, change it, or lift it early. A blacklisted player is walked out of your casino, hotel and house and can't get back in until it runs out.

**Hotel and rebirths**
- From casino level 6, open a **hotel** next door: a second, completely separate tycoon with its own bank, level, goals, staff and floor plan. It starts as an empty tower with $12,000 of its own. Walk in through its doors and build it like the casino, then expand it wider, deeper and taller.
- **Opening checklist.** A tower takes no guests until it has a reception desk, a breakfast buffet, at least one guest room and a housekeeper. The checklist sits at the top of your goals.
- **Rooms, suites and penthouses.** Click a room and choose the bed (single to round velvet), wall colour, floor (carpet to gold mosaic) and extras: lamps, art, TV, minibar and chandelier everywhere, jacuzzi, piano and aquarium in suites, and a private bar, cinema and statue in penthouses. Pick a quick theme (Budget to Ultra luxe) or mix your own. What you spend sets the room's stars and its nightly price, and **Apply to every room on this floor** copies a setup to all matching rooms at once.
- **VIPs want the best.** High rollers book the most luxurious free room (penthouse first, then suites, then the most stars), and only VIPs may book a penthouse. With nothing luxurious free, they leave.
- **More buildings.** From the Hotel panel, add more towers and open-air **Pool Gardens**. Each goes on its own lot beside your casino. Pools, water slides, hot tubs, sun loungers, cabanas and the tiki bar only go in a Pool Garden, and gardens make every tower easier to fill.
- **Services:** breakfast buffet, restaurant, spa, gym, gift shop, vending machines and a laundry (housekeepers clean faster). Guests write reviews after checking out, and the average moves your rating. Watch for tour groups, conventions, weddings, celebrities and the hotel critic.
- Guests have a budget: backpackers, regulars, business travellers and high rollers. They check in at reception, pick the best room they can afford, sleep in it (and pay) for a few nights, have breakfast, take a swim or a drink, and check out. Then the room needs making up: hire housekeepers, or hold Space next to it yourself. While you're at the casino the hotel keeps earning on an estimate from your last visit, and some of its guests come over to gamble.
- **Rebirth** (in the menu) once your casino reaches level 15 and $1,000,000 (the bar rises each time): your casino, hotel, money, level and goals reset, but you keep your character, casino style and luxury items, and everything you earn is worth 25% more for each rebirth. Your rebirth badge shows next to your level, on your name tag and on your casino's sign.

**Your house and bank**
- From casino level 3, buy a **house on Palm Avenue** ($15,000), right behind your casino. Furnish it from its own shop (furniture, fun, decor, garden, security) and hire **bodyguards** and **gate guards**. Your casino keeps running while you're home.
- **Your house is your bank.** Buy a **vault**, pick your own code (typed twice), and type it on the keypad to open it: the dial spins to each digit, the bolts pull back, the wheel turns, steam hisses out and the door swings open on the gold. Three wrong codes lock it for 30 seconds and set off the alarm.
- Inside the open vault, **deposit or withdraw** money to and from **both businesses** (the casino and the hotel). Money in the vault earns interest every day.
- **Upgrade the vault** through five tiers (Steel Safe Room, Bank Vault, Titanium, Diamond, Fort Knox): each holds more, pays more interest, has more bolts and asks for a longer custom code. Cameras, laser grids, alarms, a guard dog, a metal detector and your guards raise the house's **security rating**. A rebirth keeps the house but empties the vault. (No heists yet.)
- **Move the vault** any time: click it and press Move, or use **Move vault** on its keypad or bank screen.

**Guns (street only)**
- **Bullseye Guns** on the Strip sells 11 guns (a pocket pistol, a six-shooter, a pump shotgun, an SMG, an assault rifle, a sniper rifle, a golden hand cannon, a laser blaster, a minigun, a paintball marker and a confetti cannon) and 5 **melee weapons** (all modelled in detail: slides, sights, rails, scopes, magazines, grips): gold knuckles, a baseball bat, a golf club, a sledgehammer and a katana. Melee weapons swing (click) and hit everyone in reach in front of you, with the same damage, knockouts and police rules as guns.
- **Weapon slots 1–5:** put any weapon you own on keys 1–5 (the number buttons under each weapon in the shop; new ones fill the first free key). Press the key to draw it, again to put it away, or click the slots on the weapon bar. Emotes moved to keys 6–9.
- Guns only fire out on the streets and sidewalks; inside any building they stay holstered. Click (or hold, for automatics) to aim at the cursor and shoot; on touch, hold FIRE (with a little auto-aim). `R` reloads, `G` switches guns.
- Shoot tin cans, bottles and balloons along the sidewalks (they come back later), set off car alarms, splat paint or burst confetti. People nearby run for cover. Other players see the gun in your hand and your muzzle flashes.
- **First person** (`V` until you're looking out of your own eyes, or Menu → Camera): the mouse aims fully while `W`/`S` walk and `A`/`D` strafe. The crosshair always stays in the middle of the screen and moving the mouse turns the view (the cursor is hidden). Click once to lock the mouse in for smooth, endless turning; if the page isn't allowed to lock it, moving the mouse still turns you and holding the hidden cursor against the edge of the screen keeps turning. Then the gun is in your hands on screen, a crosshair opens up as you move and fire, right-click aims down the sights (the sniper gets a real scope), shots kick the view up, and hits show a hit marker (gold for headshots, red for a knockout) and a damage number. Bullets fly in 3D: aim high, low or over a car. On touch, drag to look, tap AIM and hold FIRE.
- **Street fights:** guns hurt people out on the street. Every gun has its own damage (headshots double it; the confetti cannon hurts nobody). Knock out a passer-by and the cash in their pockets flies to you. Knock out **another player** and you take 10% of the cash they carry (up to $250,000). They lie on the pavement for a few seconds and wake up with full health and a few seconds of safety. You can get knocked out too: your health shows at the bottom left, the screen flashes red and an arrow points to the shooter. Health comes back by itself, and inside any building you're always safe. **Money in your vault can never be taken** (a knockout or a police fine only ever touches the cash on you), so bank your winnings before you go out. After you're hurt you can't fast-travel for 20 seconds.
- **Police:** hurt or knock out anyone on the street (or shoot cars, or the police) and you get a **wanted level** of up to 5 stars, flashing red and blue at the top of the screen while they can see you. Officers run at you from down the street and shoot when they have a clear line; from two stars, cruisers race in with sirens and flashing light bars and drop off more officers; from four stars, SWAT arrives with rifles. You can fight back, but knocking out an officer only raises the heat. Break line of sight (duck into any building, get far away) and the stars fade; while you hide indoors they wait outside. If they knock you out you're **BUSTED**: fined 5% of the cash on you per star plus a fee (never more than you carry), and the chase is over. Other players see your stars on your name tag, and police show as flashing dots on the city map.

**Chat**
- Press `Enter` (or `T`, or tap 💬) to chat with everyone online: type, `Enter` to send, `Esc` to close. Lines show in the chat box at the bottom left (they fade after a while) and as a speech bubble over the speaker's head.

**Things to do (just for fun)**
- Walk up to furniture and press Space: sit on sofas and armchairs, eat at the dining table, take a nap in bed, lie in the hammock, have a bubble bath or a hot tub, work at the desk, play video games, watch TV or a movie, hit the **punching bag** (it swings, and counts your punches), run on the treadmill, play the drums, guitar, piano or harp, use the jukebox, play pool, ping pong, pinball and the arcade, take photo-booth pictures, cook, grill, wash the dishes, raid the fridge, read, dance under the disco ball, feed the koi, talk to the parrot and more. Space does the action again (punch, strum, take a shot…); walk away to stop.
- **Practice play:** the **home slot machine**, and every machine and table in your own casino, can be played with **pretend chips** (10,000 to start, free refills). No real money is won or lost.

**Cars**
- **Velocity Motors** on Downtown Boulevard (🚗 on the map) sells 9 cars: City Hatch, Riviera Convertible, Strip Coupe, Muscle Car, Stretch Limo, Monster Truck, Neon EV, Viper Supercar and a Golden Hypercar. Pick a colour, then have any car you own brought to the curb next to you (also from Menu → My cars).
- **Steal** any car from the traffic: walk up to it and press Space. That gets you a wanted star.
- **Tuning garage** (🔧 Customize on any car you own): paint (16 colours) and finish (gloss, metallic, pearl, matte, chrome, gold plated), decals (racing stripes, side stripe, flames, race number, checkered) and their colour, 6 rim styles and rim colours, spoilers (lip, ducktail, wing, GT wing), window tint, underglow colour and your own number plate. Performance parts in three stages each: engine (top speed), turbo (acceleration), tires (grip), brakes (red calipers) and **nitro** (hold `Shift` for a blue-flame boost from a tank that refills). Everything shows on a turning 3D preview with live stats, and other players see your custom car.
- Cars are modelled with rounded bodies and real wheel arches, glass cabins, grilles, mirrors, exhausts and number plates.
- Drive with `W`/`S` (gas, brake, reverse) and `A`/`D` (steer), `Shift` for a boost (nitro if fitted), `C` honks, Space gets out. Crash into walls and traffic, and run people over (the police won't like it). A speedometer shows how fast you're going, and other players see the car you're driving.

**Decorations galore**
- Over 100 new decorations: statues, a grand piano, a T-Rex skeleton, a classic car, a jade dragon, neon flamingos, a disco ball, a koi pond and much more for every business; lobby touches for the hotel; garden pieces (flower beds, tiki torches, a gazebo, a fire pit); and house furniture and toys (sofas, beds, a pool table, a home cinema, a gaming setup, a hot tub).

**Luxury shop**
- Spend your profits on very expensive, completely useless things, now big and bright enough to spot from across the street (their icons also show next to your name and on your name tag): a solid-gold crown, a neon halo, a sparkle aura, orbiting lucky dice, a casino pup and a golden pup for your character; searchlights, rainbow neon, nightly fireworks and a gold-plated facade for your casino. Switch them on and off any time. Other players see them too.

**Juice**
- Bloom-lit neon, chasing marquee bulbs, confetti, coin showers, floating money, emoji thought bubbles, camera shake on jackpots, and brighter neon after dark.
- Synthesized sound effects and an optional lounge-jazz music loop.
- **Third-person camera** (`V`): the camera sits behind your manager and turns with them. Press `V` again for **first person**.
- **Photo mode** (`H` or the camera button) hides the HUD so you can admire your casino.
- Autosaves everything (your casino, character, money, level, goals and every purchase, cosmetics included) to your browser, with Continue on the title screen. In the Claude artifact the save is also kept in your own private slot of the page's database, so a reload or another device picks up where you left off; the newer copy wins.
- **Export and import** your casino from the menu: download it as a file or copy it as text, and load a file or pasted text back (yours or a friend's). Imported files are checked and clamped like any other player's casino.

![Character creator](docs/screenshot-creator.jpg)

## Controls

| | Desktop | Touch |
|---|---|---|
| Walk | WASD / arrow keys (Shift to run) | Drag on the left side of the screen |
| Build menu | Build button or `B` | Build button |
| Place / aim | Click the floor (`R` rotates, `Esc` or right-click cancels) | Tap to aim, tap the ghost or ✓ to place; drag to pan |
| Interact | `Space` or `F` (hold to repair) | Action button |
| Camera | `Q` / `E` rotate, mouse wheel zooms, `V` third person (then `A`/`D` turn, `W`/`S` walk) | Pinch to zoom, on-screen camera buttons |
| Floors | Walk into the elevator and press `Space`, or use the floor buttons | Floor buttons |
| Other casinos | Walk out the front door, along the sidewalk or across the road, into their doorway | Same |
| City map | Click to set a waypoint (click it again to clear); click one of your own buildings to fast-travel there from another; `M` enlarges it; wheel or − / + to zoom, drag to pan, ◎ back to you, 🧭 heading-up / north-up, click a player's name to follow them | Tap the map; − / + to zoom, drag to pan |
| Select | Click a machine, guest or staff member | Tap |
| Guns (street only) | Click or hold to shoot at the cursor, `R` reload, `G` switch / holster | Hold FIRE, ⟳ reload, ⇄ switch |
| First person | `V` (top-down → third person → first person); mouse aims, `W`/`S` walk, `A`/`D` strafe, click to shoot, right-click to aim down the sights; click once to capture the mouse for full 360° look (`Esc` frees it) | Camera button; drag to look, AIM and FIRE buttons |
| Walls | Build → Walls, then click and drag a line (right-click cancels a line) | Build → Walls, then drag a line |
| Vault | Walk up to it, `Space`, then type the code (number keys, `Enter`) | Action button, then the keypad |
| Weapons | `1`–`5` draw what's on that slot (again to put it away) | Tap a slot on the weapon bar |
| Chat | `Enter` or `T`, type, `Enter` to send | 💬 button |
| Emotes | `6`–`9` (wave, dance, cheer, clap) | |
| Pause | `P` or the pause / play buttons | Pause / play buttons |
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
npm test                # unit tests (grid, pathfinding, rotation math, game odds, cards, saves)
npm run preview         # serve the production build
npm run build:artifact  # single-file HTML build in dist-artifact/
```

## Deploying

The build is a static site with relative paths, so `dist/` can be hosted anywhere.

**Multiplayer on a static host** (GitHub Pages, `npm run dev`) goes through a free public MQTT broker over secure websockets (`src/net/relay.ts`, `src/net/mqtt.ts`): positions stream live, and each casino and money ledger is a retained message, so casinos stay on the street while their owners are offline. No accounts or servers to run. The trade-offs: public brokers are open to anyone and promise no uptime, so everything published (casino, name, look) is public, and some school or office networks block the broker's port (8084). Append `?mqtt=wss://your-broker/mqtt` to the page URL to use your own broker.

**Inside Claude** the same code uses the artifact runtime's shared database and live presence instead: publish `dist-artifact/jackpot-tycoon.html` as an artifact with the `db`, `room` and `user` capabilities (see `src/net/net.ts` for the exact rules) and share it. That street is separate from the public one. To let friends put their own casino on the street, give them edit access; people who can only view can still walk the street and play at everyone's tables.

This repo includes `.github/workflows/pages.yml`, which builds and deploys to **GitHub Pages** on every push to `main`. To turn it on, open **Settings → Pages** and set **Source** to **GitHub Actions**. `.github/workflows/ci.yml` typechecks, tests and builds every push and pull request.

## How it works

- **Rendering:** [Three.js](https://threejs.org) with ACES tone mapping, an Unreal bloom pass for the neon, a studio environment map for gold and chrome, and one shadow-casting sun that only re-renders its shadow map when the layout changes. Static parts of each machine are merged into one mesh per material, and characters are merged into about seven vertex-colored parts, so a full casino stays around a few hundred draw calls.
- **Characters** (`src/entities/characterModel.ts`) are built from primitives, merged per bone and animated procedurally: walk, run, sit, pull the lever, deal, sweep, repair, cheer, dance and more, with swappable facial expressions and blinking.
- **Simulation:** a tile grid with A* pathfinding and string-pulled paths, a customer state machine driven by needs and mood, staff task claiming, and machines that resolve every round up front so their animation lands on the real outcome (`src/items/games.ts`).
- **Placement validation** flood-fills from the entrance (or the elevator, upstairs) to guarantee every guest can still reach a seat (`src/items/itemManager.ts`).
- **Floors** are separate grids linked by the elevator: walkers plan a trip to the elevator, ride it, then plan the rest of the way (`src/entities/walker.ts`). Only the floor you're on is drawn.
- **The street** (`src/world/street.ts`) gives every lot its own frame (lots alternate north and south of the road, the south side turned around the road's centre line) and a shared global frame for the street itself. The world is drawn in the frame of the casino you're in, and every other lot is a modelled exterior (`src/world/exterior.ts`). Visiting swaps the interior; your own casino fast-forwards when you return.
- **Multiplayer** (`src/net/net.ts`) publishes your floor plan to a shared document store, streams everyone's position as presence, and settles money through per-player running totals, so nothing is lost if an owner is offline.
- **Audio** (`src/core/audio.ts`) is pure Web Audio: tones and filtered noise shaped by envelopes, plus a small sequencer for the lounge music.

```
src/
  core/      audio, input, math, random, storage, events
  render/    renderer + bloom, materials, procedural textures, particles
  world/     grid, pathfinding, floor painter, walls, exteriors, street, outskirts, sky, camera, litter
  entities/  character appearance + model, customers, staff, player
  items/     catalog, game rules, 3D models, placed-item runtime, manager
  game/      main game loop, build/placement controller, goals, saves, rival AI
  net/       multiplayer (shared lots, presence, ledger, blacklist; MQTT relay for static hosting)
  ui/        HUD, shop, panels, character creator, title screen
  ui/games/  blackjack, hold'em, roulette, craps, big wheel, slots, quick games
tests/       vitest unit tests
```
