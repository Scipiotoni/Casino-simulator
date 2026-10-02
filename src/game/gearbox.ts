/**
 * A simple five-speed gearbox. Each gear reaches a share of the car's top speed; low gears
 * pull hard but run out of revs quickly, high gears are long and lazy. The engine pulls best
 * in the middle of the rev range, weakly when lugging, and hits the rev limiter at the top.
 */

/** Share of the car's top speed each gear reaches at the rev limiter. */
export const GEAR_RATIOS = [0.3, 0.48, 0.65, 0.83, 1];
/** How hard each gear pulls compared with the car's base acceleration. */
export const GEAR_FORCE = [1.55, 1.25, 1.02, 0.86, 0.72];
export const GEARS = GEAR_RATIOS.length;

/** Speed (m/s) where gear `g` (1-based) hits the limiter. */
export function gearTop(top: number, g: number): number {
  return top * GEAR_RATIOS[Math.max(1, Math.min(GEARS, g)) - 1];
}

/** Engine revs as a share of the limiter (0 = idle-ish, 1 = redline). */
export function rpmOf(speed: number, top: number, g: number): number {
  return Math.max(0.12, Math.abs(speed) / Math.max(0.1, gearTop(top, g)));
}

/** Pull at a given rev level: weak low down, strongest around 70%, nothing at the limiter. */
export function torque(rpm: number): number {
  if (rpm >= 1) return 0;
  if (rpm < 0.7) return 0.45 + 0.6 * Math.sin((Math.max(0, rpm) / 0.7) * (Math.PI / 2));
  return 1.05 - (rpm - 0.7) * 0.6;
}

/** Forward force multiplier in gear `g` at this speed (× the car's acceleration). */
export function drive(speed: number, top: number, g: number): number {
  return GEAR_FORCE[Math.max(1, Math.min(GEARS, g)) - 1] * torque(rpmOf(speed, top, g));
}

/** The gear an automatic box picks: up near the limiter, down when the revs sag. */
export function autoGear(g: number, speed: number, top: number): number {
  let gear = Math.max(1, Math.min(GEARS, g));
  if (gear < GEARS && rpmOf(speed, top, gear) > 0.93) gear++;
  else if (gear > 1 && Math.abs(speed) < gearTop(top, gear - 1) * 0.55) gear--;
  return gear;
}
