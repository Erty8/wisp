import { assertEquals, test } from "wisp/src/runtime/testing";
import {
  attackFacing, ringCorner, ringSize,
  COMBO_WINDOW_TICKS, PARRY_TICKS, SWING_HALF_ANGLE, SWING_RANGE,
  MELEE_REACH, RECOVER_AFTER_IMPACT, FINISHER_RECOVERY, BUFFER_TICKS, bufferable, STAGGER_TICKS, canAct, stepIn, swingTicks, angleGap, atan2Tenths, autoTarget, isSpellBarClick, targetScore, blockedDamage, guardOutcome, inCone, nextComboStep, swingDamage,
} from "./combat";

test("rps combat: the integer arctangent finds each quadrant's angle within a degree", () => {
  assertEquals([atan2Tenths(0, 100), atan2Tenths(100, 0), atan2Tenths(0, -100), atan2Tenths(-100, 0)].join(","), "0,900,1800,2700", "axes");
  assertEquals(atan2Tenths(0, 0), 0, "no direction");
  assertEquals(atan2Tenths(100, 100), 450, "north-east");
  assertEquals(atan2Tenths(100, -100), 1350, "north-west");
  assertEquals(atan2Tenths(-100, -100), 2250, "south-west");
  assertEquals(atan2Tenths(-100, 100), 3150, "south-east");
  assertEquals(Math.abs(atan2Tenths(5774, 10000) - 300) <= 1, true, "30 degrees");
  assertEquals(Math.abs(atan2Tenths(-18000, 3000) - 2795) <= 2, true, "a long way south, a little east");
});

test("[property] rps combat: the arctangent turns the table's own sine and cosine back into their angle", () => {
  for (let angle = 0; angle < 3600; angle += 13) {
    const back = atan2Tenths(Math.round(5000 * Math.sin(angle * Math.PI / 1800)), Math.round(5000 * Math.cos(angle * Math.PI / 1800)));
    assertEquals(angleGap(back, angle) <= 3, true, `${angle} came back as ${back}`);
  }
});

test("rps combat: angles wrap the short way round", () => {
  assertEquals(angleGap(100, 3500), 200, "across east");
  assertEquals(angleGap(0, 1800), 1800, "opposite");
  assertEquals(angleGap(900, 900), 0, "same");
});

test("rps combat: a swing hits within reach and 55 degrees of its aim, not beside or behind", () => {
  const hero = { x: 0, y: 0 };
  assertEquals(inCone(hero, 900, { x: 0, y: 150 }, SWING_RANGE, SWING_HALF_ANGLE), true, "straight ahead");
  assertEquals(inCone(hero, 900, { x: 0, y: 176 }, SWING_RANGE, SWING_HALF_ANGLE), false, "out of reach");
  assertEquals(inCone(hero, 900, { x: 100, y: 100 }, SWING_RANGE, SWING_HALF_ANGLE), true, "45 degrees off");
  assertEquals(inCone(hero, 900, { x: 140, y: 50 }, SWING_RANGE, SWING_HALF_ANGLE), false, "70 degrees off");
  assertEquals(inCone(hero, 900, { x: 0, y: -100 }, SWING_RANGE, SWING_HALF_ANGLE), false, "behind");
  assertEquals(inCone(hero, 50, { x: 100, y: -30 }, SWING_RANGE, SWING_HALF_ANGLE), true, "across east");
});

test("rps combat: the combo runs 1, 2, 3 within its window and starts over after it", () => {
  assertEquals(nextComboStep(0, 0, 100), 1, "first swing");
  assertEquals(nextComboStep(1, 100, 110), 2, "second");
  assertEquals(nextComboStep(2, 100, 110), 3, "finisher");
  assertEquals(nextComboStep(3, 100, 110), 1, "after the finisher");
  assertEquals(nextComboStep(1, 100, 100 + COMBO_WINDOW_TICKS), 2, "at the window's edge");
  assertEquals(nextComboStep(2, 100, 101 + COMBO_WINDOW_TICKS), 1, "too late");
  assertEquals(`${swingDamage(1)},${swingDamage(2)},${swingDamage(3)}`, "35,35,65", "damage");
});

test("rps combat: a guard parries early hits, blocks later ones while mana lasts, and covers only its front", () => {
  const facing = 900;
  assertEquals(guardOutcome(PARRY_TICKS, facing, 900, 0), "parry", "early, ahead");
  assertEquals(guardOutcome(PARRY_TICKS + 1, facing, 900, 50), "block", "later, mana");
  assertEquals(guardOutcome(PARRY_TICKS + 1, facing, 900, 9), "broken", "later, no mana");
  assertEquals(guardOutcome(0, facing, 900 + 650, 50), "parry", "65 degrees off: still the front");
  assertEquals(guardOutcome(0, facing, 900 + 660, 50), "none", "66 degrees off");
  assertEquals(guardOutcome(0, facing, 2700, 50), "none", "behind");
  assertEquals(blockedDamage(50), 10, "a fifth");
});

test("rps combat: a mouse press within 2 ticks of a spell bar click belongs to the bar, not a swing", () => {
  assertEquals(isSpellBarClick(100, 100), true, "same tick");
  assertEquals(isSpellBarClick(100, 98), true, "the bar's click just before");
  assertEquals(isSpellBarClick(100, 102), true, "just after");
  assertEquals(isSpellBarClick(100, 103), false, "a later bar click is its own");
  assertEquals(isSpellBarClick(100, -100), false, "no bar click");
});

test("rps combat: the automatic target is the enemy ahead over one as near behind, within 700", () => {
  const hero = { x: 0, y: 0 };
  assertEquals(autoTarget(hero, [{ x: 0, y: -300 }, { x: 0, y: 300 }], 900), 1, "ahead beats behind");
  assertEquals(autoTarget(hero, [{ x: 0, y: 500 }, { x: 0, y: -100 }], 900), 1, "much nearer behind still wins: 460 to 500");
  assertEquals(autoTarget(hero, [{ x: 0, y: 701 }], 900), undefined, "out of range");
  assertEquals(targetScore(hero, { x: 300, y: 0 }, 900), 300 + 180, "90 degrees off: 180 more");
});

test("rps combat: a swing lands its impact ticks in and recovers 14 ticks later, the finisher 10 more, and only late presses buffer", () => {
  const ticks = swingTicks(100, 5);
  assertEquals(`${ticks.impact},${ticks.recover}`, `105,${105 + RECOVER_AFTER_IMPACT}`, "default timing");
  assertEquals(swingTicks(0, 9).recover, 23, "a slower model");
  assertEquals(swingTicks(0, 5, 3).recover, 5 + RECOVER_AFTER_IMPACT + FINISHER_RECOVERY, "the finisher recovers longer");
  assertEquals(bufferable(100 - BUFFER_TICKS, 100), true, "8 ticks before the end");
  assertEquals(bufferable(100 - BUFFER_TICKS - 1, 100), false, "spam earlier is dropped");
});

test("rps combat: a melee hero steps in only toward a target just out of reach and ahead, and stops short of it", () => {
  const hero = { x: 0, y: 0 };
  const step = stepIn(hero, { x: 0, y: 250 }, 900);
  assertEquals(`${step?.x},${step?.y}`, "0,120", "250 away: steps 120, stopping 130 short");
  assertEquals(stepIn(hero, { x: 0, y: 140 }, 900), undefined, "already in reach");
  assertEquals(stepIn(hero, { x: 0, y: 301 }, 900), undefined, "beyond reach");
  assertEquals(stepIn(hero, { x: 0, y: 250 }, 1200), undefined, "30 degrees off the aim");
  assertEquals(stepIn(hero, undefined, 900), undefined, "no target");
  assertEquals(stepIn(hero, { x: 0, y: 300 }, 900)?.y, 130, "at most 130");
});

test("rps combat: a staggered hero acts again once the stagger runs out", () => {
  assertEquals(canAct(100, 100 + STAGGER_TICKS), false, "staggered");
  assertEquals(canAct(100 + STAGGER_TICKS, 100 + STAGGER_TICKS), true, "free again");
  assertEquals(canAct(0, 0), true, "never staggered");
});

test("rps combat: a hero attacks toward his target, or his own front without one", () => {
  const hero = { x: 0, y: 0 };
  assertEquals(attackFacing(0, hero, { x: 0, y: 300 }), 900, "the target north: face north");
  assertEquals(attackFacing(450, hero, undefined), 450, "no target: his front");
  assertEquals(attackFacing(450, hero, { x: 0, y: 0 }), 450, "a target on top of him: his front");
});

test("rps combat: the target's ring is twice its collision plus 70 across, at least 110, centered under it", () => {
  assertEquals(ringSize(31), 132, "a footman");
  assertEquals(ringSize(8), 110, "a small unit");
  assertEquals(ringSize(48.5), 166, "fractional collision rounds down");
  const corner = ringCorner({ x: 1000, y: -200 }, 132);
  assertEquals(`${corner.x},${corner.y}`, "934,-266", "the lower-left corner");
});
