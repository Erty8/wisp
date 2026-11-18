// The RPS map's kill cam: when a hero's fight ends, his camera glides onto the
// last enemy to fall, close and low, while the units around it play in slow
// motion, then glides back. Pure and in integers: whether a death ends the
// fight, and the camera's view on each tick of the shot.
import { floorDiv } from "wisp/src/sim/intMath";
import { type Point, distanceSquared, mix, smoothstep } from "./rules";

export { mix } from "./rules";

/** A death within 900 of the hero counts, and ends his fight when no other enemy is left within 900. */
export const KILL_CAM_RANGE = 900;
/** The shot lasts 90 camera ticks (2.7 s): 12 (0.36 s) gliding in, 12 gliding back. */
export const KILL_CAM_TICKS = 90;
export const KILL_CAM_BLEND = 12;
/** Units within 600 of the fallen enemy play at a quarter speed while the shot lasts. */
export const SLOW_MOTION_RADIUS = 600;
export const SLOW_MOTION_SCALE = 0.25;

/** The close view at the shot's height: 380 away, 15 degrees down, a 60-degree lens, 70 above the ground. */
export const KILL_CAM_CLOSE = { distance: 380, attack: -150, fieldOfView: 60, zOffset: 70 } as const;
/** The camera turns 15 degrees round the fallen enemy as it glides in, and back as it leaves. */
export const KILL_CAM_ORBIT = 150;

/**
 * Whether a death at `dying` ends the hero's fight: it fell within
 * KILL_CAM_RANGE of him and no enemy still standing (`others`) is that near.
 */
export function endsFight(hero: Point, dying: Point, others: readonly Point[]): boolean {
  const range = KILL_CAM_RANGE * KILL_CAM_RANGE;
  if (distanceSquared(hero, dying) > range) return false;
  return others.every((other) => distanceSquared(hero, other) > range);
}

/**
 * How far into the close view the shot is on `elapsed`, 0 to 100: it eases in
 * over KILL_CAM_BLEND ticks, holds, and eases out over the last KILL_CAM_BLEND,
 * slow at both ends of each glide (smoothstep).
 */
export function killCamWeight(elapsed: number): number {
  const ramp = Math.min(elapsed, KILL_CAM_TICKS - elapsed, KILL_CAM_BLEND);
  if (ramp <= 0) return 0;
  return smoothstep(floorDiv(ramp * 100, KILL_CAM_BLEND));
}

export interface View {
  readonly distance: number;
  readonly attack: number;
  readonly fieldOfView: number;
  readonly zOffset: number;
}

export interface KillCamShot extends View {
  /** Where the camera looks, as an offset from the hero. */
  readonly focus: Point;
  readonly yaw: number;
}

/**
 * The kill cam on tick `elapsed` of the shot: from the player's own camera
 * (`base`, `yaw`, looking at the hero) to the close view of the fallen enemy
 * and back, turning KILL_CAM_ORBIT round it on the way.
 */
export function killCamShot(base: View, yaw: number, hero: Point, fallen: Point, elapsed: number): KillCamShot {
  const weight = killCamWeight(elapsed);
  return {
    focus: { x: floorDiv((fallen.x - hero.x) * weight, 100), y: floorDiv((fallen.y - hero.y) * weight, 100) },
    yaw: yaw + floorDiv(KILL_CAM_ORBIT * weight, 100),
    distance: mix(base.distance, KILL_CAM_CLOSE.distance, weight),
    attack: mix(base.attack, KILL_CAM_CLOSE.attack, weight),
    fieldOfView: mix(base.fieldOfView, KILL_CAM_CLOSE.fieldOfView, weight),
    zOffset: mix(base.zOffset, KILL_CAM_CLOSE.zOffset, weight),
  };
}
