// The role-playing strategy map's pure rules: camera easing, WASD and stance
// positions, tab-target cycling, outpost capture and income. Everything that
// reaches an order or another client is integer math (floorDiv only), so every
// client and both runtimes compute the same points. Angles are tenths of a
// degree; sines come from a whole-degree table scaled by TRIG_SCALE and
// interpolated linearly, because Warcraft's Sin/Cos and Lua's math library
// differ between platforms. Only the local camera's terrain lift uses floats.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";

/** Periods of the map's timers, in milliseconds. */
export const CAMERA_PERIOD_MS = 30;
export const OCCLUSION_PERIOD_MS = 100;
export const STANCE_PERIOD_MS = 500;
export const CAPTURE_PERIOD_MS = 1000;
export const INCOME_PERIOD_MS = 5000;

/** The camera: distance, angle of attack (tenths of a degree), field of view, Z offset, far Z. It holds still in combat. */
export const EXPLORE_DISTANCE = 950;
export const EXPLORE_ATTACK = -240;
export const FIELD_OF_VIEW = 80;
export const BASE_Z_OFFSET = 120;
export const FAR_Z = 6000;
/** How long the squad counts as in combat after the last hit, in milliseconds. */
export const COMBAT_HOLD_MS = 4000;
/** The camera's yaw eases 6% of the way to the hero's facing each camera tick: most of a turn in a second. */
export const FOLLOW_EASE_PERCENT = 6;
/** The hero starts facing north. */
export const START_YAW = 900;

export const MOVE_STEP = 250;
export const TARGET_RANGE = 900;
export const OCCLUSION_RADIUS = 350;

export const VANGUARD_AHEAD = 180;
export const VANGUARD_BEHIND = 150;
/** Melee units stand this far apart along the front line. */
export const LINE_SPACING = 100;
/** Ranged units flank the hero this far to each side, per pair. */
export const FLANK_SPACING = 120;
export const GUARD_LIMIT = 200;
/** In combat, a squad unit is left to fight unless it strays this far from the hero. */
export const LEASH = 700;
export const GUARD_RADIUS = 140;

export const CAPTURE_RADIUS = 350;
/** An outpost beside a gold mine stands this far from the mine, toward the map's center. */
export const OUTPOST_FROM_MINE = 320;
/** A gold mine this close to a player's start location is their home mine, not an outpost. */
export const HOME_RANGE = 1500;
export const INCOME_PER_OUTPOST = 20;
export const FOOD_CAP = 15;

export const TRIG_SCALE = 10000;
const FULL_TURN = 3600;
/** sin of 0..90 whole degrees, times TRIG_SCALE, rounded. */
const SINE_DEGREES = [
  0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256,
  3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293,
  6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572,
  8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816,
  9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000,
];

/** sin of 0..900 tenths of a degree, interpolated between whole degrees. */
function quarterSine(tenths: number): number {
  const degree = floorDiv(tenths, 10);
  const low = SINE_DEGREES[degree] ?? TRIG_SCALE;
  const high = SINE_DEGREES[degree + 1] ?? TRIG_SCALE;
  return low + floorDiv((high - low) * (tenths - degree * 10), 10);
}

/** sin(angle) times TRIG_SCALE, for an angle in tenths of a degree. */
export function sine(angle: number): number {
  const turn = floorMod(angle, FULL_TURN);
  if (turn <= 900) return quarterSine(turn);
  if (turn <= 1800) return quarterSine(1800 - turn);
  if (turn <= 2700) return -quarterSine(turn - 1800);
  return -quarterSine(FULL_TURN - turn);
}

export function cosine(angle: number): number {
  return sine(angle + 900);
}

/** One step of value toward goal, `percent` of the gap rounded toward zero; a gap too small to step closes at once. */
/** `from` moved `weight` percent of the way to `to`. */
export function mix(from: number, to: number, weight: number): number {
  return from + floorDiv((to - from) * weight, 100);
}

/** A 0 to 100 progress eased at both ends (smoothstep): slow out, fast through the middle, slow in. */
export function smoothstep(linear: number): number {
  const clamped = Math.min(Math.max(linear, 0), 100);
  return floorDiv(clamped * clamped * (300 - 2 * clamped), 10000);
}

export function ease(value: number, goal: number, percent: number): number {
  const gap = goal - value;
  const step = gap >= 0 ? floorDiv(gap * percent, 100) : -floorDiv(-gap * percent, 100);
  return step === 0 ? goal : value + step;
}

export interface Yaw {
  readonly current: number;
  readonly target: number;
}

/**
 * One camera tick of yaw. While the hero runs forward (W held), the target is
 * the hero's facing (tenths of a degree), taken the short way round from the
 * current yaw, so the camera swings in behind him as he turns; otherwise the
 * target stays put. The current yaw eases 6% toward it. Both come back by a
 * full turn together once the current yaw leaves -360..360 degrees.
 */
export function followYaw(yaw: Yaw, facing: number, following: boolean): Yaw {
  const target = following ? yaw.current + floorMod(facing - yaw.current + 1800, FULL_TURN) - 1800 : yaw.target;
  const current = ease(yaw.current, target, FOLLOW_EASE_PERCENT);
  const wrap = current >= FULL_TURN ? -FULL_TURN : current <= -FULL_TURN ? FULL_TURN : 0;
  return { current: current + wrap, target: target + wrap };
}

export interface Zoom {
  readonly distance: number;
  /** Tenths of a degree. */
  readonly attack: number;
}

/** A camera to try: its distance, angle of attack (tenths of a degree), field of view and base Z offset. */
export interface CameraPreset extends Zoom {
  readonly name: string;
  readonly fieldOfView: number;
  readonly zOffset: number;
}

/**
 * The cameras the keys 6 to 0 and - switch between, farthest-but-one first:
 * the exploration camera, then closer ones that put the player in the fight
 * (the first, on 7, halfway between exploration and close action), then a
 * high tactical view. It holds still in combat.
 */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { name: "Exploration", distance: EXPLORE_DISTANCE, attack: EXPLORE_ATTACK, fieldOfView: FIELD_OF_VIEW, zOffset: BASE_Z_OFFSET },
  { name: "Wide action", distance: 800, attack: -210, fieldOfView: 78, zOffset: 120 },
  { name: "Close action", distance: 650, attack: -180, fieldOfView: 75, zOffset: 120 },
  { name: "Shoulder", distance: 420, attack: -100, fieldOfView: 70, zOffset: 150 },
  { name: "Ground level", distance: 280, attack: -40, fieldOfView: 70, zOffset: 140 },
  { name: "Tactical", distance: 1300, attack: -380, fieldOfView: 80, zOffset: 120 },
];

/** The preset each player starts with: Close action, key 8. */
export const DEFAULT_CAMERA = 2;

/** How a preset reads to the player. */
export function describeCamera(preset: CameraPreset): string {
  return `Camera: ${preset.name} (distance ${preset.distance}, angle ${floorDiv(preset.attack, 10)}, field of view ${preset.fieldOfView}).`;
}

/** The combat timer after one tick of `elapsed` milliseconds, or reset when the squad dealt or took damage. */
export function combatAfter(remaining: number, elapsed: number, hit: boolean): number {
  return hit ? COMBAT_HOLD_MS : Math.max(0, remaining - elapsed);
}

/** The camera's Z offset: the preset's base plus however far the ground under the eye rises above the hero's. */
export function cameraZOffset(heroZ: number, eyeZ: number, base: number = BASE_Z_OFFSET): number {
  return base + Math.max(0, eyeZ - heroZ);
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The point `ahead` units along `angle` and `left` units to its left of (x, y). */
export function offset(x: number, y: number, angle: number, ahead: number, left: number): Point {
  const cos = cosine(angle);
  const sin = sine(angle);
  return {
    x: x + floorDiv(ahead * cos - left * sin, TRIG_SCALE),
    y: y + floorDiv(ahead * sin + left * cos, TRIG_SCALE),
  };
}

/** Where the camera's eye stands over the ground: behind the hero along the yaw, by the distance's horizontal part. */
export function eyePoint(hero: Point, yaw: number, zoom: Zoom): Point {
  const horizontal = floorDiv(zoom.distance * cosine(zoom.attack), TRIG_SCALE);
  return offset(hero.x, hero.y, yaw, -horizontal, 0);
}

export interface Held {
  readonly forward: boolean;
  readonly left: boolean;
  readonly back: boolean;
  readonly right: boolean;
}

/** The direction W, A, S and D point relative to the yaw, or undefined when they cancel out or none is held. */
export function moveAngle(yaw: number, held: Held): number | undefined {
  const ahead = (held.forward ? 1 : 0) - (held.back ? 1 : 0);
  const side = (held.left ? 1 : 0) - (held.right ? 1 : 0);
  if (ahead === 0 && side === 0) return undefined;
  if (ahead === 0) return yaw + side * 900;
  if (side === 0) return ahead > 0 ? yaw : yaw + 1800;
  return ahead > 0 ? yaw + side * 450 : yaw + 1800 - side * 450;
}

/** Where a WASD move order goes: 250 units from the hero toward the held direction. */
export function movePoint(hero: Point, yaw: number, held: Held): Point | undefined {
  const angle = moveAngle(yaw, held);
  return angle === undefined ? undefined : offset(hero.x, hero.y, angle, MOVE_STEP, 0);
}

/** Integer square root, rounded down. */
export function isqrt(value: number): number {
  if (value <= 0) return 0;
  let root = value;
  let next = floorDiv(root + 1, 2);
  while (next < root) {
    root = next;
    next = floorDiv(root + floorDiv(value, root), 2);
  }
  return root;
}

/**
 * Whether a tree at `tree` hides the hero from the eye: within 350 units of
 * the eye, or of the line of sight between the eye and the hero. Integer math
 * that stays inside 32 bits for points a few thousand units apart.
 */
export function occludes(eye: Point, hero: Point, tree: Point, radius: number = OCCLUSION_RADIUS): boolean {
  const sightX = hero.x - eye.x, sightY = hero.y - eye.y;
  const treeX = tree.x - eye.x, treeY = tree.y - eye.y;
  if (treeX * treeX + treeY * treeY <= radius * radius) return true;
  const along = treeX * sightX + treeY * sightY;
  const lengthSquared = sightX * sightX + sightY * sightY;
  if (along < 0 || along > lengthSquared) return false;
  const across = Math.abs(sightX * treeY - sightY * treeX);
  return across <= radius * isqrt(lengthSquared);
}

export type Stance = "vanguard" | "guard";
export type Role = "melee" | "ranged";

/**
 * Vanguard: melee units stand in a line 180 units ahead of the hero, centered
 * on the yaw; ranged units hold 150 units behind, alternating right and left,
 * 120 units further out per pair. `rank` counts within the role.
 */
export function vanguardSlot(hero: Point, yaw: number, role: Role, rank: number, count: number): Point {
  if (role === "melee") return offset(hero.x, hero.y, yaw, VANGUARD_AHEAD, floorDiv((count - 1 - 2 * rank) * LINE_SPACING, 2));
  const side = floorMod(rank, 2) === 0 ? -1 : 1;
  return offset(hero.x, hero.y, yaw, -VANGUARD_BEHIND, side * (floorDiv(rank, 2) + 1) * FLANK_SPACING);
}

/** Tight Guard: the squad rings the hero 140 units out, evenly spaced from the yaw. */
export function guardSlot(hero: Point, yaw: number, index: number, count: number): Point {
  return offset(hero.x, hero.y, yaw + floorDiv(index * FULL_TURN, Math.max(1, count)), GUARD_RADIUS, 0);
}

export function distanceSquared(a: Point, b: Point): number {
  const x = a.x - b.x, y = a.y - b.y;
  return x * x + y * y;
}

/**
 * Whether a squad unit should be ordered back to its slot: in Vanguard once it
 * strays 96 units from it, in Tight Guard once it is over 200 units from the
 * hero. In combat neither applies: a new order would cancel the unit's attack
 * mid-swing, so it is only pulled back once it is over 700 from the hero.
 */
export function needsRegroup(stance: Stance, unit: Point, slot: Point, hero: Point, inCombat: boolean = false): boolean {
  if (inCombat) return distanceSquared(unit, hero) > LEASH * LEASH;
  return stance === "vanguard" ? distanceSquared(unit, slot) > 96 * 96 : distanceSquared(unit, hero) > GUARD_LIMIT * GUARD_LIMIT;
}

export interface Candidate {
  /** A handle id: the same unit has the same id in every client. */
  readonly id: number;
  readonly distanceSquared: number;
}

/** Tab's next soft target: candidates nearest first (handle id breaks ties), the one after the current, wrapping. */
export function nextTarget(candidates: readonly Candidate[], current: number | undefined): number | undefined {
  const ordered = [...candidates].sort((a, b) => a.distanceSquared !== b.distanceSquared ? a.distanceSquared - b.distanceSquared : a.id - b.id);
  if (ordered.length === 0) return undefined;
  const at = ordered.findIndex(({ id }) => id === current);
  return ordered[at < 0 ? 0 : floorMod(at + 1, ordered.length)]?.id;
}

/**
 * An outpost's owner after one capture check. `present` lists each player
 * with living units in the capture radius. A player who may capture takes it
 * when none of their enemies is present; the owner keeps it while they qualify
 * or nobody does, and among several qualifying players the lowest id wins.
 */
export function captureOwner(
  owner: number,
  present: readonly number[],
  canCapture: (this: void, player: number) => boolean,
  enemies: (this: void, a: number, b: number) => boolean,
): number {
  const qualifies = (player: number) => canCapture(player) && !present.some((other) => other !== player && enemies(player, other));
  const takers = present.filter((player) => qualifies(player));
  if (takers.length === 0 || takers.indexOf(owner) >= 0) return owner;
  return Math.min(...takers);
}

/** Gold an income tick pays a player who owns `outposts` outposts. */
export function income(outposts: number): number {
  return outposts * INCOME_PER_OUTPOST;
}

/** A four-letter rawcode as Warcraft's integer, read big-endian. */
export function fourCC(code: string): number {
  let id = 0;
  for (let letter = 0; letter < 4; letter++) id = id * 256 + code.charCodeAt(letter);
  return id;
}

/** A camera shake lasts 0.15 s. */
export const SHAKE_MS = 150;
/** A siege hit shakes the camera when it lands within this far of the hero. */
export const SHAKE_RANGE = 500;

/**
 * Where an outpost goes beside a gold mine: OUTPOST_FROM_MINE units from the
 * mine toward the map's center, clear of the mine's footprint and on the side
 * players come from; straight south for a mine at the center.
 */
export function outpostBeside(mine: Point, center: Point): Point {
  const dx = center.x - mine.x, dy = center.y - mine.y;
  const length = isqrt(dx * dx + dy * dy);
  if (length === 0) return { x: mine.x, y: mine.y - OUTPOST_FROM_MINE };
  return { x: mine.x + floorDiv(dx * OUTPOST_FROM_MINE, length), y: mine.y + floorDiv(dy * OUTPOST_FROM_MINE, length) };
}

/** Whether a gold mine is some player's home mine: within HOME_RANGE of one of their start locations. */
export function isHomeMine(mine: Point, starts: readonly Point[]): boolean {
  return starts.some((start) => distanceSquared(mine, start) <= HOME_RANGE * HOME_RANGE);
}

/** A hero's skill ranks, by skill: three basic skills with 3 ranks each, then the ultimate's 1. */
export type SkillRanks = readonly [number, number, number, number];
const BASIC_RANKS = 3;
const ULTIMATE_LEVEL = 6;

/**
 * The skill a hero should learn next, as an index into its ranks, or
 * undefined when nothing is learnable: the ultimate once the hero reaches
 * level 6, otherwise the lowest-ranked basic skill, first listed first, whose
 * next rank the hero's level allows (rank n needs hero level 2n - 1).
 */
export function nextSkill(heroLevel: number, ranks: SkillRanks): number | undefined {
  if (canLearn(3, heroLevel, ranks)) return 3;
  let best: number | undefined;
  for (let skill = 0; skill < 3; skill++) {
    if (!canLearn(skill, heroLevel, ranks)) continue;
    if (best === undefined || (ranks[skill] ?? BASIC_RANKS) < (ranks[best] ?? BASIC_RANKS)) best = skill;
  }
  return best;
}

/** Whether the hero's level allows a skill's next rank: rank n of a basic skill at level 2n - 1, the ultimate's one rank at level 6. */
export function canLearn(skill: number, heroLevel: number, ranks: SkillRanks): boolean {
  const rank = ranks[skill] ?? BASIC_RANKS;
  if (skill === 3) return rank === 0 && heroLevel >= ULTIMATE_LEVEL;
  return rank < BASIC_RANKS && heroLevel >= 2 * rank + 1;
}

/** How a skill's rank reads on its slot: "1/3" for a basic skill, "1/1" for the ultimate. */
export function rankText(skill: number, rank: number): string {
  return `${rank}/${skill === 3 ? 1 : BASIC_RANKS}`;
}

/** `value` as a whole percent of `max`, rounded down and kept within 0..100; 0 when max is 0. */
export function percentOf(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, floorDiv(Math.floor(value) * 100, Math.floor(max))));
}

/** A bar's filled width for a percent of its full width, in the same units. */
export function barWidth(percent: number, full: number): number {
  return floorDiv(percent * full, 100);
}

/** Dragging with the right mouse button across the whole screen width turns the camera a full turn. */
export const DRAG_TURN = 3600;

/**
 * The camera's yaw after the pointer moved `dx` whole units across a screen
 * `width` units wide,
 * right mouse button held: dragging right turns the view right (the yaw
 * down), kept within one turn either side of zero. Whole tenths of a degree.
 */
export function dragYaw(yaw: number, dx: number, width: number): number {
  if (width <= 0) return yaw;
  const turned = yaw - floorDiv(dx * DRAG_TURN, width);
  return floorMod(turned, FULL_TURN);
}
