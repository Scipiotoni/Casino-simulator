import { describe, expect, it } from 'vitest';
import { MIN_COLS, STREET_ROWS, WILDS, cityX, cityZ, inWilds, onRoadNetwork, openGround, setWildsObstacles } from '../src/world/city';
import { sunDirection } from '../src/world/sky';

describe('a bigger city with open desert around it', () => {
  it('has four streets and at least five blocks', () => {
    expect(STREET_ROWS).toBe(4);
    expect(MIN_COLS).toBeGreaterThanOrEqual(20);
  });

  it('lets you walk past the city edge into the desert, up to the mountains', () => {
    const [x0, x1] = cityX(MIN_COLS);
    const [z0, z1] = cityZ();
    const mz = (z0 + z1) / 2;
    expect(onRoadNetwork(x0 - 20, mz, MIN_COLS)).toBe(false);
    expect(openGround(x0 - 20, mz, MIN_COLS)).toBe(true);
    expect(openGround(x1 + WILDS - 5, mz, MIN_COLS)).toBe(true);
    expect(openGround(x1 + WILDS + 5, mz, MIN_COLS)).toBe(false);
    expect(inWilds((x0 + x1) / 2, z0 - 100, MIN_COLS)).toBe(true);
    // Inside the city it's the streets only (no walking through buildings).
    expect(inWilds((x0 + x1) / 2, mz, MIN_COLS)).toBe(false);
  });

  it('keeps you out of rocks and landmarks', () => {
    const [x0] = cityX(MIN_COLS);
    setWildsObstacles((x, z) => Math.hypot(x - (x0 - 50), z) < 2);
    expect(openGround(x0 - 50, 0, MIN_COLS)).toBe(false);
    expect(openGround(x0 - 55, 0, MIN_COLS)).toBe(true);
    setWildsObstacles(null);
    expect(openGround(x0 - 50, 0, MIN_COLS)).toBe(true);
  });
});

describe('the sun follows the clock', () => {
  it('rises in the east around 6:00, is high at noon and sets in the west around 20:00', () => {
    const dawn = sunDirection(6 * 60 + 5);
    const noon = sunDirection(13 * 60);
    const dusk = sunDirection(19 * 60 + 55);
    const night = sunDirection(1 * 60);
    expect(dawn.x).toBeGreaterThan(0.9);
    expect(Math.abs(dawn.y)).toBeLessThan(0.05);
    expect(noon.y).toBeGreaterThan(0.75);
    expect(dusk.x).toBeLessThan(-0.9);
    expect(night.y).toBeLessThan(-0.5);
  });
});
