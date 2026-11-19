// The RPS map's manual combat rules, pure and in integers so every client
// agrees: aiming (an integer arctangent over the sine table), the swing's
// frontal cone, the three-step combo and its timing in camera ticks (0.03 s),
// and how a held guard meets a hit: a timed parry, a block, or nothing when
// the hit comes from behind or the guard has no mana left.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import { type Point, cosine, distanceSquared, isqrt, offset, sine } from "./rules";

const FULL_TURN = 3600;

/** The swing's reach and half-width: enemies within 175 and 55 degrees either side of the aim. */
export const SWING_RANGE = 175;
export const SWING_HALF_ANGLE = 550;
/** Damage lands 5 ticks (0.15 s) into the swing, as the weapon sweeps through; the hero can swing again 13 ticks (0.39 s) in. */
export const IMPACT_TICKS = 5;
export const RECOVER_TICKS = 13;
/** A swing within 30 ticks (0.9 s) of the last one's recovery continues the combo. */
export const COMBO_WINDOW_TICKS = 30;
export const COMBO_STEPS = 3;
/** The finisher knocks hit enemies back this far. */
export const FINISHER_KNOCKBACK = 85;
/**
 * A left click waits this many ticks (0.06 s) before it swings: a click on the
 * spell bar also reaches the world as a mouse press (seen in Warcraft), and
 * the bar's click event, which may come just before or after, cancels it.
 */
export const CLICK_SETTLE_TICKS = 2;
/** Hit and struck units freeze for 2 ticks (0.06 s) on impact. */
export const HIT_STOP_TICKS = 2;

/** A guard covers 65 degrees either side of the hero's facing: a 130-degree front. */
export const GUARD_HALF_ANGLE = 650;
/** A hit within 8 ticks (0.24 s) of raising the guard is parried. */
export const PARRY_TICKS = 8;
/** The guard freezes in its pose 4 ticks (0.12 s) after it is raised. */
export const GUARD_POSE_TICKS = 4;
/** A blocked hit costs this much mana; with less, the guard breaks and the hit lands in full. */
export const BLOCK_MANA = 10;
/** A parry knocks the attacker back this far. */
export const PARRY_KNOCKBACK = 90;
/** Guarding slows the hero to 3/5 of his speed. */
export const GUARD_SPEED_NUMERATOR = 3;
export const GUARD_SPEED_DENOMINATOR = 5;

/** The angle from the origin to (dx, dy), in tenths of a degree from east, counterclockwise, 0..3599. */
export function atan2Tenths(dy: number, dx: number): number {
  const x = Math.abs(dx), y = Math.abs(dy);
  if (x === 0 && y === 0) return 0;
  // The largest first-quadrant angle whose tangent is at most y / x: sin(a) x <= cos(a) y.
  let low = 0, high = 900;
  while (low < high) {
    const middle = floorDiv(low + high + 1, 2);
    if (sine(middle) * x <= cosine(middle) * y) low = middle;
    else high = middle - 1;
  }
  if (dx >= 0) return dy >= 0 ? low : floorMod(FULL_TURN - low, FULL_TURN);
  return dy >= 0 ? 1800 - low : 1800 + low;
}

/** The angle between two directions, in tenths of a degree, 0..1800. */
export function angleGap(a: number, b: number): number {
  return Math.abs(floorMod(b - a + 1800, FULL_TURN) - 1800);
}

/** Whether `point` is within `range` of `origin` and `halfAngle` either side of `facing`. */
export function inCone(origin: Point, facing: number, point: Point, range: number, halfAngle: number): boolean {
  if (distanceSquared(origin, point) > range * range) return false;
  return angleGap(facing, atan2Tenths(point.y - origin.y, point.x - origin.x)) <= halfAngle;
}

/** The next swing's combo step, 1 to 3: the step after the last while within the combo window of its recovery, else 1. */
export function nextComboStep(lastStep: number, lastRecoverTick: number, now: number): number {
  if (lastStep <= 0 || now - lastRecoverTick > COMBO_WINDOW_TICKS) return 1;
  return floorMod(lastStep, COMBO_STEPS) + 1;
}

/** A combo step's damage: 35 for the first two swings, 65 for the finisher. */
export function swingDamage(step: number): number {
  return step === COMBO_STEPS ? 65 : 35;
}

export type GuardOutcome = "none" | "parry" | "block" | "broken";

/**
 * How a raised guard meets a hit. A hit from outside the guard's 130-degree
 * front lands ("none"); inside it, a hit within PARRY_TICKS of raising the
 * guard is parried, and a later one blocked if the hero has the mana for it,
 * otherwise the guard breaks.
 */
export function guardOutcome(heldTicks: number, facing: number, toAttacker: number, mana: number): GuardOutcome {
  if (angleGap(facing, toAttacker) > GUARD_HALF_ANGLE) return "none";
  if (heldTicks <= PARRY_TICKS) return "parry";
  return mana >= BLOCK_MANA ? "block" : "broken";
}

/** What a blocked hit still deals: a fifth. */
export function blockedDamage(damage: number): number {
  return damage / 5;
}

/** Whether a mouse press on `mouseTick` was a click on the spell bar, whose own click came on `barTick`. */
export function isSpellBarClick(mouseTick: number, barTick: number): boolean {
  return Math.abs(mouseTick - barTick) <= CLICK_SETTLE_TICKS;
}

/** The hero picks an enemy within 700 on his own when he has no living target in range. */
export const AUTO_TARGET_RANGE = 700;

/**
 * How well an enemy suits the automatic target, lower being better: its
 * distance plus 2 units for every degree it stands off the camera's view, so
 * the enemy ahead wins over one as near behind.
 */
export function targetScore(hero: Point, enemy: Point, cameraYaw: number): number {
  const off = angleGap(cameraYaw, atan2Tenths(enemy.y - hero.y, enemy.x - hero.x));
  return isqrt(distanceSquared(hero, enemy)) + floorDiv(off * 2, 10);
}

/** The best automatic target among `enemies` within AUTO_TARGET_RANGE, by index (ties to the first), or undefined. */
export function autoTarget(hero: Point, enemies: readonly Point[], cameraYaw: number): number | undefined {
  let best: number | undefined, bestScore = 0;
  enemies.forEach((enemy, index) => {
    if (distanceSquared(hero, enemy) > AUTO_TARGET_RANGE * AUTO_TARGET_RANGE) return;
    const score = targetScore(hero, enemy, cameraYaw);
    if (best === undefined || score < bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/**
 * Which way a swing (or a shot) goes: at the targeted enemy when there is one,
 * the hero turning to face him; otherwise the hero's own front.
 */
export function attackFacing(heroFacing: number, hero: Point, target: Point | undefined): number {
  if (target === undefined || (target.x === hero.x && target.y === hero.y)) return heroFacing;
  return atan2Tenths(target.y - hero.y, target.x - hero.x);
}

/** The target's ring on the ground: twice its collision plus 70 across, at least 110. */
export function ringSize(collision: number): number {
  return Math.max(110, 2 * Math.floor(collision) + 70);
}

/** Where a ring `size` across centered on `center` puts its lower-left corner, which is where Warcraft places an image. */
export function ringCorner(center: Point, size: number): Point {
  const half = floorDiv(size, 2);
  return { x: center.x - half, y: center.y - half };
}

/** How far a melee hero reaches for a target he steps in toward. */
export const MELEE_REACH = 300;

/** A swing recovers this many ticks (0.42 s) after its damage lands; the finisher 10 more (0.3 s). */
export const RECOVER_AFTER_IMPACT = 14;
export const FINISHER_RECOVERY = 10;
/** Only a press in the last 8 ticks (0.24 s) of a swing's recovery is buffered; earlier presses, spam, are dropped. */
export const BUFFER_TICKS = 8;

/** A combo step started on `start` whose damage lands `impactTicks` in: the ticks it lands and recovers on. */
export function swingTicks(start: number, impactTicks: number, step: number = 1): { readonly impact: number; readonly recover: number } {
  const recover = start + impactTicks + RECOVER_AFTER_IMPACT + (step === COMBO_STEPS ? FINISHER_RECOVERY : 0);
  return { impact: start + impactTicks, recover };
}

/** Whether a press on `tick` is buffered for the swing recovering on `recover`: only near its end. */
export function bufferable(tick: number, recover: number): boolean {
  return recover - tick <= BUFFER_TICKS;
}

/** A step-in carries a melee hero at most 130 toward his target, stopping 130 short of its center. */
export const STEP_IN_MAX = 130;
export const STEP_IN_STOP = 130;

/**
 * Reach correction: where a melee hero steps before swinging at a target just
 * out of reach (past 150 but within MELEE_REACH, and within 20 degrees of the
 * aim), so the swing doesn't hit air; undefined when no step is needed.
 */
export function stepIn(hero: Point, target: Point | undefined, facing: number): Point | undefined {
  if (target === undefined) return undefined;
  const distance = isqrt(distanceSquared(hero, target));
  if (distance <= SWING_RANGE - 25 || distance > MELEE_REACH) return undefined;
  const toTarget = atan2Tenths(target.y - hero.y, target.x - hero.x);
  if (angleGap(facing, toTarget) > 200) return undefined;
  const step = Math.min(distance - STEP_IN_STOP, STEP_IN_MAX);
  return step <= 0 ? undefined : offset(hero.x, hero.y, toTarget, step, 0);
}

/** A broken guard staggers the hero for 20 ticks (0.6 s): no swing, guard or move. */
export const STAGGER_TICKS = 20;
/** A block jolts a frozen guard pose back into motion for 3 ticks. */
export const RECOIL_TICKS = 3;
/** A parry's counter-slash hits the attacker for this much. */
export const PARRY_COUNTER_DAMAGE = 40;

/** Whether a hero staggered until `staggerUntil` can act on `tick`. */
export function canAct(tick: number, staggerUntil: number): boolean {
  return tick >= staggerUntil;
}
