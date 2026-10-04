/**
 * How far the world is drawn in detail. Near is lighter on slow devices; Far shows full
 * buildings, trees and street furniture further out (and pushes the haze back).
 */
export type ViewDist = 'near' | 'normal' | 'far';

export const VIEW_DISTANCES: { id: ViewDist; label: string; scale: number }[] = [
  { id: 'near', label: 'Near', scale: 0.7 },
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'far', label: 'Far', scale: 1.6 },
];

/** The current view distance as a multiplier of the normal one. */
export const VIEW = { scale: 1 };

export function viewScale(id: ViewDist | undefined): number {
  return VIEW_DISTANCES.find((v) => v.id === id)?.scale ?? 1;
}
