import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Canvas textures need a DOM: hand the base and the models blank ones.
vi.mock('../src/render/textures', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  return {
    ...real,
    blobShadowTexture: () => new THREE.Texture(),
    makeCanvas: () => ({ canvas: {}, ctx }),
    canvasTexture: () => new THREE.Texture(),
    asphaltTexture: () => new THREE.Texture(),
  };
});

import { MilitaryBase, VAULT_UNLOCK_S, baseSite, type BaseHost } from '../src/world/militaryBase';
import { BUNKER_GUNS, BUNKER_Y, LOCKDOWN_S } from '../src/world/bunker';
import { GUNS, gunDef } from '../src/game/guns';
import { MIN_COLS } from '../src/world/city';

type Host = BaseHost & { pos: { x: number; z: number }; under: boolean; hits: number; owned: string[]; notes: string[] };
function host(): Host {
  const h: Host = {
    pos: { x: 0, z: 0 },
    under: false,
    hits: 0,
    owned: [],
    notes: [],
    player() {
      return { x: h.pos.x, z: h.pos.z, exposed: !h.under, height: 1.7, car: null, under: h.under, ko: false, speed: 0 };
    },
    lineOfSight: () => true,
    walkable: () => true,
    toWorld: (x: number, z: number) => ({ x, z }),
    shot: (hit) => {
      if (hit) h.hits++;
    },
    tracer: () => undefined,
    blast: () => undefined,
    spawnVehicle: () => 1,
    vehicleParked: () => true,
    alarm: () => undefined,
    notify: (t) => {
      h.notes.push(t);
    },
    ownsGun: (id) => h.owned.includes(id),
  };
  return h;
}

describe('the prototype vault', () => {
  it('keeps the Prototype X-1 behind a door that only the commander’s keycard opens', () => {
    const h = host();
    const base = new MilitaryBase(h);
    base.build(MIN_COLS);
    const s = baseSite(MIN_COLS);
    // The vault door (and the wall round it) block the way out of Hangar 3.
    expect(base.blocked(s.cx - 45, s.cz - 40)).toBe(true);
    expect(base.blocked(s.cx - 55, s.cz - 40)).toBe(true);
    expect(base.vault.state).toBe('locked');
    // No card, no entry.
    expect(base.swipeKeycard()).toBe(false);
    // Knock out the commander: he drops the keycard; walk over it to pick it up.
    const cmd = base.soldiers.find((so) => so.kind === 'commander')!;
    expect(cmd).toBeTruthy();
    base.damage(cmd, 9999);
    expect(base.keycard).toBe('dropped');
    h.pos = { x: cmd.x, z: cmd.z };
    base.update(0.05, MIN_COLS, true);
    expect(base.keycard).toBe('player');
    // Swipe it: the time lock starts and the alarm goes off.
    h.pos = { ...base.vaultDoor };
    expect(base.atVault(h.pos.x, h.pos.z)).toBe(true);
    expect(base.swipeKeycard()).toBe(true);
    expect(base.vault.state).toBe('unlocking');
    expect(base.alarm).toBe(true);
    // Walk away and it pauses.
    h.pos = { x: base.vaultDoor.x + 30, z: base.vaultDoor.z };
    for (let i = 0; i < 50; i++) base.update(0.1, MIN_COLS, true);
    expect(base.vault.paused).toBe(true);
    expect(base.vault.left).toBeCloseTo(VAULT_UNLOCK_S, 5);
    // Hold the door for the whole time lock and it opens, then swings out of the way.
    h.pos = { ...base.vaultDoor };
    for (let i = 0; i < VAULT_UNLOCK_S * 10 + 5; i++) base.update(0.1, MIN_COLS, true);
    expect(base.vault.state).toBe('open');
    for (let i = 0; i < 40; i++) base.update(0.1, MIN_COLS, true);
    expect(base.blocked(s.cx - 45, s.cz - 40)).toBe(false);
    // The walls either side still stand.
    expect(base.blocked(s.cx - 55, s.cz - 40)).toBe(true);
  });
});

describe('the secret lab', () => {
  it('has a hidden hatch, rooms you can walk and cases full of guns nobody sells', () => {
    const h = host();
    const base = new MilitaryBase(h);
    base.build(MIN_COLS);
    const b = base.bunker;
    expect(b.atHatch(b.hatch.x, b.hatch.z)).toBe(true);
    expect(b.atLadder(b.ladder.x, b.ladder.z)).toBe(true);
    expect(b.walkable(b.ladder.x, b.ladder.z)).toBe(true);
    // The corridor and the lab, but not the rock between.
    expect(b.walkable(b.hatch.x + 15, b.hatch.z)).toBe(true);
    expect(b.walkable(b.hatch.x + 39, b.hatch.z + 4)).toBe(true);
    expect(b.walkable(b.hatch.x + 15, b.hatch.z + 4)).toBe(false);
    expect(b.walkable(b.hatch.x - 10, b.hatch.z)).toBe(false);
    expect(BUNKER_Y).toBeLessThan(-20);
    // Seven prototypes, none of them for sale.
    expect(BUNKER_GUNS).toHaveLength(7);
    for (const id of BUNKER_GUNS) {
      const d = gunDef(id)!;
      expect(d.secret).toBe(true);
      expect(d.price).toBe(0);
    }
    expect(GUNS.filter((d) => d.secret).map((d) => d.id).sort()).toEqual([...BUNKER_GUNS].sort());
    // Stand at a case and take what's inside: the lab locks down.
    const c = b.caseAt(b.hatch.x + 39, b.hatch.z - 6.5)!;
    expect(c.taken).toBe(false);
    expect(b.take(c.id)).toBe(true);
    expect(b.take(c.id)).toBe(false);
    expect(b.lockdown).toBeCloseTo(LOCKDOWN_S);
    // The turrets open up on you in the lab (and only down here).
    h.under = true;
    h.pos = { x: b.hatch.x + 39, z: b.hatch.z };
    for (let i = 0; i < 60; i++) base.update(0.1, MIN_COLS, true);
    expect(h.hits).toBeGreaterThan(3);
    // The soldiers up top can't see you down here: no surface alarm from trespassing.
    expect(base.alarm).toBe(false);
  });

  it('trips the lockdown when you walk into a live laser', () => {
    const h = host();
    const base = new MilitaryBase(h);
    base.build(MIN_COLS);
    const b = base.bunker;
    h.under = true;
    // Stand in the sweeping gate's path long enough and it catches you.
    h.pos = { x: b.hatch.x + 15, z: b.hatch.z };
    for (let i = 0; i < 80 && b.lockdown <= 0; i++) base.update(0.05, MIN_COLS, true);
    expect(b.lockdown).toBeGreaterThan(0);
  });

  it('remembers what you already own', () => {
    const h = host();
    h.owned = ['gauss'];
    const base = new MilitaryBase(h);
    base.build(MIN_COLS);
    const b = base.bunker;
    // Gauss is the first case, on the north wall.
    expect(b.caseAt(b.hatch.x + 31, b.hatch.z - 6.5)).toEqual({ id: 'gauss', taken: true });
  });
});
