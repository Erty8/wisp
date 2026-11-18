import { assertEquals, test } from "wisp/src/runtime/testing";
import {
  dragYaw, barWidth, nextSkill, percentOf, CAMERA_PRESETS, COMBAT_HOLD_MS, OUTPOST_FROM_MINE, isHomeMine, outpostBeside, GUARD_LIMIT, LEASH, describeCamera, START_YAW, TRIG_SCALE,
  cameraZOffset, captureOwner, combatAfter, cosine, distanceSquared, ease, eyePoint, fourCC, guardSlot, income, isqrt, moveAngle,
  movePoint, needsRegroup, nextTarget, occludes, sine, followYaw, vanguardSlot, canLearn, rankText, DEFAULT_CAMERA,
} from "./rules";

const HERO = { x: 1000, y: -500 };
const NONE = { forward: false, left: false, back: false, right: false };

test("rps rules: the sine table matches sin at whole degrees, is odd and periodic, and cosine leads it by 90 degrees", () => {
  assertEquals(sine(0), 0, "sin 0");
  assertEquals(sine(300), 5000, "sin 30");
  assertEquals(sine(900), TRIG_SCALE, "sin 90");
  assertEquals(sine(1500), 5000, "sin 150");
  assertEquals(sine(2100), -5000, "sin 210");
  assertEquals(sine(3300), -5000, "sin 330");
  assertEquals(sine(-300), -5000, "sin -30");
  assertEquals(sine(3600 + 450), sine(450), "a full turn");
  assertEquals(sine(305), 5075, "halfway from 30 to 31 degrees");
  assertEquals(cosine(0), TRIG_SCALE, "cos 0");
  assertEquals(cosine(1800), -TRIG_SCALE, "cos 180");
  for (let angle = -3600; angle <= 3600; angle += 37) {
    const square = sine(angle) * sine(angle) + cosine(angle) * cosine(angle);
    assertEquals(Math.abs(square - TRIG_SCALE * TRIG_SCALE) < 2 * TRIG_SCALE * 3, true, `sin² + cos² at ${angle}`);
  }
});

test("rps rules: easing moves 15% of the gap toward zero, and closes a gap too small to step", () => {
  assertEquals(ease(0, 1000, 15), 150, "up");
  assertEquals(ease(1000, 0, 15), 850, "down");
  assertEquals(ease(0, -100, 15), -15, "down, negative");
  assertEquals(ease(0, 6, 15), 6, "a 6-tenth gap snaps");
  assertEquals(ease(0, -6, 15), -6, "and below");
  assertEquals(ease(5, 5, 15), 5, "at rest");
});

test("rps rules: running forward, the camera swings in behind the hero's facing the short way round, eases there and wraps", () => {
  let yaw = { current: START_YAW, target: START_YAW };
  yaw = followYaw(yaw, 1200, true);
  assertEquals(`${yaw.target},${yaw.current}`, `1200,${START_YAW + 18}`, "6% of 30 degrees");
  assertEquals(followYaw(yaw, 3500, false).target, 1200, "not running forward: the target stays");
  assertEquals(followYaw({ current: 900, target: 900 }, -1700, true).target, 1900, "facing -170 is +100 the short way");
  assertEquals(followYaw({ current: 100, target: 100 }, 3500, true).target, -100, "across north the short way");
  for (let tick = 0; tick < 120; tick++) yaw = followYaw(yaw, 1200, true);
  assertEquals(yaw.current, 1200, "settled within four seconds");
  const spun = followYaw({ current: 3595, target: 3700 }, 0, false);
  assertEquals([spun.current, spun.target].join(","), "1,100", "a full turn off both");
});

test("rps rules: the combat timer holds four seconds after a hit, then counts down to zero", () => {
  assertEquals(combatAfter(0, 30, true), COMBAT_HOLD_MS, "a hit");
  assertEquals(combatAfter(100, 30, false), 70, "counts down");
  assertEquals(combatAfter(20, 30, false), 0, "never below zero");
});

test("rps rules: hills behind the hero lift the camera; lower ground never lowers it", () => {
  assertEquals(cameraZOffset(100, 300), 320, "a hill behind");
  assertEquals(cameraZOffset(300, 100), 120, "a valley behind");
  assertEquals(cameraZOffset(100, 300, 150), 350, "on a preset's own base");
});

test("rps rules: the eye stands behind the hero along the yaw, by the distance's horizontal part", () => {
  const eye = eyePoint(HERO, 900, { distance: 1000, attack: -300 });
  assertEquals(`${eye.x},${eye.y}`, `${HERO.x},${HERO.y - 866}`, "north-facing camera, 30 degrees down");
  const east = eyePoint(HERO, 0, { distance: 950, attack: -240 });
  assertEquals(east.y, HERO.y, "east-facing camera stays on the hero's row");
  assertEquals(east.x < HERO.x, true, "and stands west of the hero");
});

test("rps rules: WASD moves 250 units relative to the camera, diagonals between, opposite keys cancel", () => {
  assertEquals(moveAngle(900, { ...NONE, forward: true }), 900, "W");
  assertEquals(moveAngle(900, { ...NONE, back: true }), 2700, "S");
  assertEquals(moveAngle(900, { ...NONE, left: true }), 1800, "A");
  assertEquals(moveAngle(900, { ...NONE, right: true }), 0, "D");
  assertEquals(moveAngle(900, { ...NONE, forward: true, right: true }), 450, "W+D");
  assertEquals(moveAngle(900, { ...NONE, back: true, left: true }), 2250, "S+A");
  assertEquals(moveAngle(900, { ...NONE, back: true, right: true }), 3150, "S+D");
  assertEquals(moveAngle(900, { forward: true, back: true, left: false, right: false }), undefined, "W+S");
  assertEquals(moveAngle(900, NONE), undefined, "none");
  const north = movePoint(HERO, 900, { ...NONE, forward: true });
  assertEquals(`${north?.x},${north?.y}`, `${HERO.x},${HERO.y + 250}`, "W facing north");
  const west = movePoint(HERO, 0, { ...NONE, back: true });
  assertEquals(`${west?.x},${west?.y}`, `${HERO.x - 250},${HERO.y}`, "S facing east");
});

test("rps rules: isqrt rounds down", () => {
  assertEquals([0, 1, 3, 4, 15, 16, 17, 1690000, 1690001].map((value) => isqrt(value)).join(","), "0,1,1,2,3,4,4,1300,1300", "roots");
});

test("rps rules: trees occlude within 350 of the eye or of the sight line to the hero, not beside or beyond it", () => {
  const eye = { x: 0, y: 0 };
  const hero = { x: 0, y: 1000 };
  assertEquals(occludes(eye, hero, { x: 0, y: 500 }), true, "on the line");
  assertEquals(occludes(eye, hero, { x: 350, y: 500 }), true, "350 off the line");
  assertEquals(occludes(eye, hero, { x: 351, y: 500 }), false, "351 off the line");
  assertEquals(occludes(eye, hero, { x: -200, y: -200 }), true, "next to the eye");
  assertEquals(occludes(eye, hero, { x: 0, y: -351 }), false, "behind the eye, out of reach");
  assertEquals(occludes(eye, hero, { x: 0, y: 1100 }), false, "past the hero");
  assertEquals(occludes({ x: 0, y: 0 }, { x: 919, y: 919 }, { x: 600, y: 300 }), true, "diagonal sight, 212 off it");
  assertEquals(occludes({ x: 0, y: 0 }, { x: 919, y: 919 }, { x: 800, y: 200 }), false, "diagonal sight, 424 off it");
});

test("[property] rps rules: vanguard melee stand 180 ahead in a centered line, ranged 150 behind and flanking", () => {
  for (let yaw = 0; yaw < 3600; yaw += 450) {
    const line = [0, 1, 2].map((rank) => vanguardSlot(HERO, yaw, "melee", rank, 3));
    const middle = line[1];
    assertEquals(Math.abs(Math.sqrt(distanceSquared(HERO, middle ?? HERO)) - 180) <= 2, true, `yaw ${yaw}: middle 180 ahead`);
    assertEquals(Math.abs(Math.sqrt(distanceSquared(line[0] ?? HERO, line[2] ?? HERO)) - 200) <= 2, true, `yaw ${yaw}: line 200 wide`);
    const [right, left] = [0, 1].map((rank) => vanguardSlot(HERO, yaw, "ranged", rank, 2));
    for (const flank of [right, left]) {
      const back = flank ?? HERO;
      const along = ((back.x - HERO.x) * cosine(yaw) + (back.y - HERO.y) * sine(yaw)) / TRIG_SCALE;
      assertEquals(Math.abs(along + 150) <= 2, true, `yaw ${yaw}: ranged 150 behind`);
    }
    const side = (point: { x: number; y: number }) => (-(point.x - HERO.x) * sine(yaw) + (point.y - HERO.y) * cosine(yaw)) / TRIG_SCALE;
    assertEquals(Math.abs(side(right ?? HERO) + 120) <= 2, true, `yaw ${yaw}: first ranged on the right`);
    assertEquals(Math.abs(side(left ?? HERO) - 120) <= 2, true, `yaw ${yaw}: second on the left`);
  }
  const north = vanguardSlot(HERO, 900, "melee", 0, 2);
  assertEquals(`${north.x},${north.y}`, `${HERO.x - 50},${HERO.y + 180}`, "two melee facing north: the first on the left");
});

test("[property] rps rules: tight guard slots ring the hero within 200, and the squad regroups only when it strays", () => {
  for (let count = 1; count <= 6; count++) {
    for (let index = 0; index < count; index++) {
      const slot = guardSlot(HERO, 450, index, count);
      assertEquals(distanceSquared(HERO, slot) <= GUARD_LIMIT * GUARD_LIMIT, true, `slot ${index} of ${count}`);
      assertEquals(needsRegroup("guard", slot, slot, HERO), false, "a unit on its slot stays");
    }
  }
  assertEquals(needsRegroup("guard", { x: HERO.x + 200, y: HERO.y }, HERO, HERO), false, "200 from the hero stays");
  assertEquals(needsRegroup("guard", { x: HERO.x + 201, y: HERO.y }, HERO, HERO), true, "201 regroups");
  assertEquals(needsRegroup("vanguard", { x: 96, y: 0 }, { x: 0, y: 0 }, HERO), false, "96 from its slot stays");
  assertEquals(needsRegroup("vanguard", { x: 97, y: 0 }, { x: 0, y: 0 }, HERO), true, "97 regroups");
});

test("rps rules: Tab cycles nearest first, handle id breaking ties, and wraps", () => {
  const candidates = [{ id: 30, distanceSquared: 400 }, { id: 10, distanceSquared: 100 }, { id: 20, distanceSquared: 100 }];
  assertEquals(nextTarget(candidates, undefined), 10, "nearest, lower id");
  assertEquals(nextTarget(candidates, 10), 20, "then the tie");
  assertEquals(nextTarget(candidates, 20), 30, "then farther");
  assertEquals(nextTarget(candidates, 30), 10, "wraps");
  assertEquals(nextTarget(candidates, 99), 10, "a lost target starts over");
  assertEquals(nextTarget([], 10), undefined, "nobody in range");
});

test("rps rules: an outpost goes to a player present without enemies; contested or empty, it stays", () => {
  const seats = (id: number) => id === 0 || id === 1;
  const enemies = (a: number, b: number) => a !== b;
  const NEUTRAL = 27;
  assertEquals(captureOwner(NEUTRAL, [0], seats, enemies), 0, "player 1 alone");
  assertEquals(captureOwner(NEUTRAL, [0, 24], seats, enemies), NEUTRAL, "creeps contest it");
  assertEquals(captureOwner(0, [1], seats, enemies), 1, "taken over");
  assertEquals(captureOwner(0, [0, 1], seats, enemies), 0, "both present: contested");
  assertEquals(captureOwner(0, [], seats, enemies), 0, "empty");
  assertEquals(captureOwner(NEUTRAL, [24], seats, enemies), NEUTRAL, "creeps can't capture");
  const allied = (a: number, b: number) => a !== b && !(seats(a) && seats(b));
  assertEquals(captureOwner(NEUTRAL, [1, 0], seats, allied), 0, "allies together: the lower id");
  assertEquals(captureOwner(1, [1, 0], seats, allied), 1, "the owner keeps it among allies");
});

test("rps rules: income is 20 gold per outpost and rawcodes read big-endian", () => {
  assertEquals([0, 1, 3].map((outposts) => income(outposts)).join(","), "0,20,60", "income");
  assertEquals(fourCC("hfoo"), 1751543663, "hfoo");
  assertEquals(fourCC("Hpal"), 1215324524, "Hpal");
});

test("rps rules: in combat a squad unit keeps fighting until it strays past the leash", () => {
  const far = { x: HERO.x + 300, y: HERO.y };
  assertEquals(needsRegroup("vanguard", far, HERO, HERO, true), false, "300 off its slot, fighting: left alone");
  assertEquals(needsRegroup("guard", far, HERO, HERO, true), false, "past the guard limit, fighting: left alone");
  assertEquals(needsRegroup("guard", { x: HERO.x + LEASH, y: HERO.y }, HERO, HERO, true), false, "at the leash");
  assertEquals(needsRegroup("vanguard", { x: HERO.x + LEASH + 1, y: HERO.y }, HERO, HERO, true), true, "past it");
  assertEquals(needsRegroup("vanguard", far, HERO, HERO, false), true, "out of combat it regroups");
});

test("rps rules: the camera presets start at the exploration camera, all look down from behind, and read out", () => {
  assertEquals(CAMERA_PRESETS.length, 6, "one per key 6 to 0 and -");
  assertEquals(CAMERA_PRESETS[0]?.distance, 950, "key 6 explores");
  assertEquals(CAMERA_PRESETS[DEFAULT_CAMERA]?.name, "Close action", "players start on key 8");
  const wide = CAMERA_PRESETS[1], close = CAMERA_PRESETS[2], explore = CAMERA_PRESETS[0];
  assertEquals(wide !== undefined && close !== undefined && explore !== undefined && wide.distance * 2 === explore.distance + close.distance && wide.attack * 2 === explore.attack + close.attack, true, "key 7 halfway between 6 and 8");
  for (const preset of CAMERA_PRESETS) {
    assertEquals(preset.distance > 0 && preset.attack < 0, true, `${preset.name} behind and above`);
    const eye = eyePoint(HERO, 900, preset);
    assertEquals(eye.x === HERO.x && eye.y < HERO.y, true, `${preset.name} eye behind a north-facing hero`);
  }
  const shoulder = CAMERA_PRESETS[3];
  assertEquals(shoulder === undefined ? "" : describeCamera(shoulder), "Camera: Shoulder (distance 420, angle -10, field of view 70).", "message");
});

test("rps rules: an outpost stands beside its gold mine toward the center, and players' home mines get none", () => {
  const center = { x: 0, y: 0 };
  const north = outpostBeside({ x: 0, y: 5696 }, center);
  assertEquals(`${north.x},${north.y}`, `0,${5696 - OUTPOST_FROM_MINE}`, "a north mine's outpost is south of it");
  const corner = outpostBeside({ x: -7296, y: -7040 }, center);
  assertEquals(corner.x > -7296 && corner.y > -7040, true, "a corner mine's outpost leans in");
  assertEquals(Math.abs(isqrt(distanceSquared(corner, { x: -7296, y: -7040 })) - OUTPOST_FROM_MINE) <= 1, true, "320 away");
  const middle = outpostBeside(center, center);
  assertEquals(`${middle.x},${middle.y}`, `0,${-OUTPOST_FROM_MINE}`, "a mine at the center: straight south");
  const starts = [{ x: -6848, y: 6400 }, { x: -2560, y: 6592 }];
  assertEquals(isHomeMine({ x: -7296, y: 7040 }, starts), true, "player 1's mine");
  assertEquals(isHomeMine({ x: -2048, y: 7168 }, starts), true, "player 2's mine");
  assertEquals(isHomeMine({ x: 2048, y: 7168 }, starts), false, "an empty base's mine is an outpost");
});

test("rps rules: skills are learned lowest rank first in order, each rank at hero level 2n - 1, the ultimate at 6", () => {
  assertEquals(nextSkill(1, [0, 0, 0, 0]), 0, "level 1: the first skill");
  assertEquals(nextSkill(2, [1, 0, 0, 0]), 1, "level 2: the second");
  assertEquals(nextSkill(3, [1, 1, 0, 0]), 2, "level 3: the third");
  assertEquals(nextSkill(4, [1, 1, 1, 0]), 0, "level 4: rank 2 of the first");
  assertEquals(nextSkill(2, [1, 1, 1, 0]), undefined, "rank 2 waits for level 3");
  assertEquals(nextSkill(6, [2, 2, 1, 0]), 3, "level 6: the ultimate first");
  assertEquals(nextSkill(6, [2, 2, 1, 1]), 2, "then the lowest basic skill");
  assertEquals(nextSkill(10, [3, 3, 3, 1]), undefined, "everything learned");
});

test("rps rules: bars fill by whole percents, clamped", () => {
  assertEquals(percentOf(350, 700), 50, "half");
  assertEquals(percentOf(699.5, 700), 99, "rounded down");
  assertEquals(percentOf(800, 700), 100, "clamped high");
  assertEquals(percentOf(-5, 700), 0, "clamped low");
  assertEquals(percentOf(10, 0), 0, "no maximum");
  assertEquals(barWidth(50, 92), 46, "half a bar");
  assertEquals(barWidth(99, 92), 91, "rounded down");
});

test("rps rules: a skill's next rank needs the hero's level, and its slot reads its rank", () => {
  assertEquals(canLearn(0, 1, [0, 0, 0, 0]), true, "rank 1 at level 1");
  assertEquals(canLearn(0, 2, [1, 0, 0, 0]), false, "rank 2 waits for level 3");
  assertEquals(canLearn(0, 3, [1, 0, 0, 0]), true, "rank 2 at level 3");
  assertEquals(canLearn(1, 9, [0, 3, 0, 0]), false, "three ranks at most");
  assertEquals(canLearn(3, 5, [0, 0, 0, 0]), false, "the ultimate waits for level 6");
  assertEquals(canLearn(3, 6, [0, 0, 0, 0]), true, "the ultimate at level 6");
  assertEquals(canLearn(3, 10, [0, 0, 0, 1]), false, "one rank of the ultimate");
  assertEquals(`${rankText(0, 2)} ${rankText(3, 0)}`, "2/3 0/1", "rank text");
});

test("rps rules: dragging right with the right mouse button turns the camera right, a full screen a full turn", () => {
  assertEquals(dragYaw(900, 100, 800), 450, "an eighth of the screen right: 45 degrees right");
  assertEquals(dragYaw(900, -400, 800), 2700, "half the screen left: half a turn left");
  assertEquals(dragYaw(100, 40, 800), 3520, "across north stays in a turn");
  assertEquals(dragYaw(900, 5, 0), 900, "no screen size");
});
