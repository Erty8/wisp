import { assertEquals, test } from "wisp/src/runtime/testing";
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import {
  BENCH_SIZE, POOL, SHOP_SIZE, activeTraits, assignSquares, bonusFor, damageFor, drawFrom, findMerge, income, isCreepRound,
  kindAt, levelCost, nextSeed, raised, rollShop, sellValue, shopOdds, starred, traitLines, waveFor,
} from "./rules";

const FOOTMAN = 0, GRUNT = 1, GHOUL = 2, ARCHER = 3, RIFLEMAN = 4, HUNTRESS = 7, MORTAR = 9, KNIGHT = 10;

test("rules: traits count each kind once and unlock their tiers", () => {
  const active = activeTraits([FOOTMAN, FOOTMAN, RIFLEMAN, ARCHER]);
  const human = active.find(({ trait }) => trait === "Human");
  assertEquals(human?.count, 2, "two different humans; the second footman doesn't count");
  assertEquals(human?.tier?.text, "+3 armor", "human tier 1");
  assertEquals(active.find(({ trait }) => trait === "Ranger")?.count, 2, "rifleman and archer are rangers");
  assertEquals(active.find(({ trait }) => trait === "Night Elf")?.tier, undefined, "one night elf is below the first tier");
  assertEquals(active.some(({ trait }) => trait === "Orc"), false, "no orcs");
});

test("rules: a unit adds up the bonuses of its race and role, and only those", () => {
  const active = activeTraits([FOOTMAN, RIFLEMAN, MORTAR, KNIGHT, GRUNT, GHOUL]);
  const knight = bonusFor(KNIGHT, active);
  assertEquals(knight.armor, 6 + 5, "human tier 2 and warrior tier 2");
  assertEquals(bonusFor(RIFLEMAN, active).armor, 6, "a human ranger gets the human armor only");
  assertEquals(bonusFor(RIFLEMAN, active).damagePercent, 15, "rifleman and mortar team make ranger 2");
  assertEquals(bonusFor(GHOUL, active).damagePercent, 0, "one undead");
  assertEquals(bonusFor(HUNTRESS, activeTraits([HUNTRESS, ARCHER])).haste, 1, "night elf 2");
  assertEquals(raised(500, 40), 700, "raised by 40%");
  assertEquals(raised(33, 15), 37, "rounded down");
});

test("rules: trait lines name the reached tier and the next goal", () => {
  assertEquals(traitLines(activeTraits([FOOTMAN, RIFLEMAN])).join(" | "), "Human 2: +3 armor (3: +6 armor) | Warrior 1 (2: +2 armor) | Ranger 1 (2: +15% damage)", "lines");
});

test("rules: units snap to their own square, or the nearest free one on the half", () => {
  const squares = assignSquares([{ column: 3, row: 1 }, { column: 3, row: 1 }, { column: 9, row: -2 }, { column: 3, row: 1 }]);
  assertEquals(squares.map(({ column, row }) => `${column},${row}`).join(" "), "3,1 3,0 7,0 2,1", "first keeps, then nearest free, clamped onto the half");
  const crowd = assignSquares(Array.from({ length: 32 }, () => ({ column: 0, row: 0 })));
  assertEquals(new Set(crowd.map(({ column, row }) => row * 8 + column)).size, 32, "32 units fill the half");
});

test("rules: rounds 1 to 3 and every fifth are creep rounds", () => {
  assertEquals([1, 2, 3, 4, 5, 6, 9, 10, 11].map((round) => isCreepRound(round)).join(","), "true,true,true,false,true,false,false,true,false", "schedule");
});

test("rules: each rawcode is its four letters read big-endian", () => {
  for (const kind of POOL) {
    let id = 0;
    for (let letter = 0; letter < 4; letter++) id = id * 256 + kind.code.charCodeAt(letter);
    assertEquals(kind.id, id, kind.name);
  }
});

test("rules: shop odds add up to 100 at every level and unlock dearer units as levels rise", () => {
  for (let level = 1; level <= 8; level++) {
    const [one, two, three] = shopOdds(level);
    assertEquals(one + two + three, 100, `level ${level}`);
  }
  assertEquals(shopOdds(2)[0], 100, "level 2 sees only cost 1");
  assertEquals(shopOdds(8)[2] > 0, true, "level 8 sees cost 3");
});

test("rules: the random sequence stays in range and reaches every shop roll", () => {
  let seed = 1;
  const seen = new Set<number>();
  for (let draw = 0; draw < 2000; draw++) {
    seed = nextSeed(seed);
    assertEquals(seed >= 0 && seed <= 65536, true, `draw ${draw} seed`);
    const roll = drawFrom(seed, 1, 100);
    assertEquals(roll >= 1 && roll <= 100, true, `draw ${draw} roll`);
    seen.add(roll);
  }
  assertEquals(seen.size, 100, "every roll from 1 to 100");
});

test("[property seed 11] rules: a shop holds five pool units, each of a cost its level allows", () => {
  let seed = 11;
  const random = (low: number, high: number) => {
    seed = nextSeed(seed);
    return drawFrom(seed, low, high);
  };
  for (let run = 0; run < 200; run++) {
    const level = 1 + floorMod(run, 8);
    const offers = rollShop(level, random);
    assertEquals(offers.length, SHOP_SIZE, "shop size");
    const [one, two] = shopOdds(level);
    for (const offer of offers) {
      const cost = kindAt(offer).cost;
      assertEquals(cost === 1 ? one > 0 : cost === 2 ? two > 0 : one + two < 100, true, `level ${level} offers cost ${cost}`);
    }
  }
});

test("rules: rolls at the edges of each odds band pick the matching cost", () => {
  const rolls = (first: number) => {
    let call = 0;
    return (low: number) => call++ === 0 ? first : low;
  };
  assertEquals(kindAt(rollShop(5, rolls(50))[0] ?? -1).cost, 1, "50 of 50/35/15");
  assertEquals(kindAt(rollShop(5, rolls(51))[0] ?? -1).cost, 2, "51 of 50/35/15");
  assertEquals(kindAt(rollShop(5, rolls(85))[0] ?? -1).cost, 2, "85 of 50/35/15");
  assertEquals(kindAt(rollShop(5, rolls(86))[0] ?? -1).cost, 3, "86 of 50/35/15");
});

test("rules: income pays 5 plus 1 per 10 gold saved, up to 5 interest", () => {
  assertEquals(income(0), 5, "no savings");
  assertEquals(income(9), 5, "9 saved");
  assertEquals(income(10), 6, "10 saved");
  assertEquals(income(49), 9, "49 saved");
  assertEquals(income(500), 10, "interest capped");
  assertEquals(levelCost(2), 8, "level 2 to 3");
});

test("rules: selling returns the gold of every copy merged in", () => {
  assertEquals(sellValue(2, 1), 2, "1 star");
  assertEquals(sellValue(2, 2), 6, "2 stars");
  assertEquals(sellValue(3, 3), 27, "3 stars");
  assertEquals(starred(500, 1), 500, "1 star");
  assertEquals(starred(500, 2), 900, "2 stars");
  assertEquals(starred(15, 3), 48, "3 stars");
});

test("rules: three of one kind and star merge, first found first; mixed stars and 3-star units don't", () => {
  const found = findMerge([{ kind: 0, star: 1 }, { kind: 1, star: 1 }, { kind: 0, star: 2 }, { kind: 0, star: 1 }, { kind: 0, star: 1 }, { kind: 0, star: 1 }]);
  assertEquals(found?.join(","), "0,3,4", "first three footmen of 1 star");
  assertEquals(findMerge([{ kind: 0, star: 1 }, { kind: 0, star: 2 }, { kind: 0, star: 1 }]), undefined, "mixed stars");
  assertEquals(findMerge([{ kind: 0, star: 3 }, { kind: 0, star: 3 }, { kind: 0, star: 3 }]), undefined, "already 3 stars");
  assertEquals(BENCH_SIZE, 8, "bench");
});

test("rules: waves grow, stay on the creeps' half, never stack two creeps on one square", () => {
  let previous = 0;
  for (let round = 1; round <= 30; round++) {
    const wave = waveFor(round);
    assertEquals(wave.length >= previous && wave.length <= 8, true, `round ${round} size`);
    previous = wave.length;
    const squares = new Set<number>();
    for (const creep of wave) {
      assertEquals(creep.column >= 0 && creep.column < 8 && creep.row >= 0 && creep.row < 4, true, `round ${round} on the board`);
      squares.add(creep.row * 8 + creep.column);
      assertEquals(kindAt(creep.kind).cost, round < 6 ? 1 : round < 14 ? 2 : 3, `round ${round} cost`);
    }
    assertEquals(squares.size, wave.length, `round ${round} distinct squares`);
  }
  assertEquals(damageFor(0, 30), 0, "a cleared wave costs nothing");
  assertEquals(damageFor(3, 10), 2 + 3 * (1 + floorDiv(10, 5)), "three survivors in round 10");
});
