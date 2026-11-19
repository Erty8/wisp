import { assertEquals, test } from "wisp/src/runtime/testing";
import { BASES, baseShopScene, CHATTER_BEATS, chatterOn, sparrerOnBeat, BASE_MELEE_COST, baseOfRace, baseSpawn, baseSpot, nearestTavern, tavernSpawn, BASE_QUEST_GOLD, BASE_RANGED_COST, VETERAN_MELEE_COST, VETERAN_RANGED_COST, baseQuestScene, baseScene, questFlag, raceFlag, veteransFlag } from "./bases";
import { choiceStates, openingOf, sceneProblems } from "./dialogue";
import { activeQuests } from "./journal";
import { QUEST_SITES } from "./quests";
import { RACES } from "./roster";
import { distanceSquared } from "./rules";
import { TALK_RANGE } from "./dialogue";

const nodeOf = (raceIndex: number, id: string) => baseScene(raceIndex).nodes.find((node) => node.id === id);
const recruits = (raceIndex: number, id: string) =>
  (nodeOf(raceIndex, id)?.effects ?? []).map((effect) => (effect.kind === "recruit" ? `${effect.role}:${effect.cost}:${effect.race ?? "own"}` : "")).join(",");

test("[property] rps bases: one base per race, each scene branching only to its own nodes, a quarter turn apart and between the quest sites", () => {
  assertEquals(BASES.map((base) => RACES[base.race]?.name).join(","), "Human,Orc,Night Elf,Undead", "one per race");
  for (const base of BASES) {
    assertEquals(sceneProblems(base.scene).join("; "), "", base.scene.name);
    assertEquals(sceneProblems(base.questScene).join("; "), "", base.questScene.name);
    for (const site of QUEST_SITES) assertEquals(base.angle === site.angle, false, `${base.scene.name} apart from ${site.scene.name}`);
    assertEquals(base.guards.length, 4, `${base.scene.name}: four guards`);
  }
  assertEquals(BASES.map((base) => base.angle).join(","), "450,1350,2250,3150", "angles");
});

test("rps bases: a player of the base's race is greeted as kin, anyone else as a stranger", () => {
  const orc = baseScene(1);
  assertEquals(openingOf(orc, new Set([raceFlag("Orc")]), 0), "kin", "an Orc at the Orc base");
  assertEquals(openingOf(orc, new Set([raceFlag("Human")]), 0), "stranger", "a Human at the Orc base");
  assertEquals(openingOf(orc, new Set(), 0), "stranger", "no race known");
});

test("rps bases: kin get the base's soldiers free, strangers pay for them, and can't without the gold", () => {
  assertEquals(`${recruits(1, "kinMelee")} ${recruits(1, "kinRanged")}`, "melee:0:1 ranged:0:1", "free, the Orc base's own soldiers");
  assertEquals(`${recruits(1, "paidMelee")} ${recruits(1, "paidRanged")}`, `melee:${BASE_MELEE_COST}:1 ranged:${BASE_RANGED_COST}:1`, "paid");
  assertEquals(nodeOf(1, "kin")?.choices?.map((choice) => choice.text).join(" | "), "Two Grunts (free). | Two Headhunters (free). | Not now. | Your veterans.", "the base names its own soldiers");
  const paid = nodeOf(1, "stranger")?.choices ?? [];
  assertEquals(choiceStates(paid, new Set(), BASE_MELEE_COST).join(","), "open,greyed,open,hidden", "enough for melee only");
  assertEquals(choiceStates(paid, new Set(), BASE_RANGED_COST).join(","), "open,open,open,hidden", "enough for both");
  assertEquals(choiceStates(nodeOf(1, "kin")?.choices ?? [], new Set(), 0).join(","), "open,open,open,hidden", "kin need no gold");
});

test("rps bases: each base's quest raises a camp at its own objective, marked and paid, and its bounty unlocks the veterans", () => {
  for (const base of BASES) {
    const scene = base.questScene;
    const accept = scene.nodes.find((node) => node.id === "accept")?.effects ?? [];
    const fights = accept.filter((effect) => effect.kind === "fight");
    assertEquals(fights.length > 0 && fights.every((effect) => effect.kind === "fight" && effect.at === "objective" && effect.tag !== undefined), true, `${scene.name}: at the objective, tagged`);
    const race = RACES[base.race]?.name ?? "";
    const bounty = fights.map((effect) => (effect.kind === "fight" ? effect.bounty : undefined)).find((candidate) => candidate !== undefined);
    assertEquals(`${bounty?.gold}:${bounty?.flag}`, `${BASE_QUEST_GOLD}:${veteransFlag(race)}`, `${scene.name}: pays and unlocks`);
    assertEquals(accept.some((effect) => effect.kind === "flag" && effect.flag === questFlag(race)), true, `${scene.name}: taken`);
    assertEquals(scene.objective !== undefined && scene.objective.distance > base.distance, true, `${scene.name}: out past the base`);
  }
  const human = baseQuestScene(0);
  assertEquals(openingOf(human, new Set(), 0), "ask", "not taken");
  assertEquals(openingOf(human, new Set([questFlag("Human")]), 0), "hurry", "taken");
  assertEquals(openingOf(human, new Set([questFlag("Human"), veteransFlag("Human")]), 0), "thanks", "done");
  assertEquals(activeQuests(new Set([questFlag("Human")])).map((quest) => quest.objective).join(","), "Defeat the bandits at the bandit camp.", "in the journal");
  assertEquals(activeQuests(new Set([questFlag("Human"), veteransFlag("Human")])).length, 0, "out of the journal once done");
});

test("rps bases: veterans show once the base's quest is done, free to kin and dearer to strangers", () => {
  const proven = new Set([veteransFlag("Orc")]);
  assertEquals(choiceStates(nodeOf(1, "kin")?.choices ?? [], proven, 0).join(","), "open,open,open,open", "kin, proven");
  assertEquals(choiceStates(nodeOf(1, "stranger")?.choices ?? [], proven, 0).join(","), "greyed,greyed,open,open", "a stranger, proven, broke");
  assertEquals(nodeOf(1, "kinVeterans")?.choices?.map((choice) => choice.text).join(" | "), "Two Tauren (free). | Two Troll Berserkers (free). | Back.", "the Orc veterans");
  const hires = (id: string) => (nodeOf(1, id)?.effects ?? []).map((effect) => (effect.kind === "recruit" ? `${effect.role}:${effect.cost}:${effect.veteran === true}` : "")).join(",");
  assertEquals(`${hires("kinVeteranMelee")} ${hires("paidVeteranRanged")}`, `melee:0:true ranged:${VETERAN_RANGED_COST}:true`, "veteran hires");
  assertEquals(choiceStates(nodeOf(1, "paidVeterans")?.choices ?? [], proven, VETERAN_MELEE_COST).join(","), "open,greyed,open", "enough for veteran melee only");
});

test("[property] rps bases: race heroes spawn in front of their base's recruiter, past talking range, each player in his own lane", () => {
  const center = { x: 0, y: 0 };
  for (const base of BASES) {
    const recruiter = baseSpot(center, base);
    const spots = [0, 1, 2, 3].map((id) => baseSpawn(center, base, id));
    for (const spot of spots) {
      const distance = distanceSquared(spot, recruiter);
      assertEquals(distance > TALK_RANGE * TALK_RANGE && distance < 500 * 500, true, `${base.scene.name}: near the recruiter, past talking range`);
      assertEquals(distanceSquared(spot, center) < distanceSquared(recruiter, center), true, `${base.scene.name}: on the center's side`);
    }
    for (let one = 0; one < spots.length; one++) for (let other = one + 1; other < spots.length; other++) {
      const a = spots[one], b = spots[other];
      if (a !== undefined && b !== undefined) assertEquals(distanceSquared(a, b) >= 150 * 150, true, `${base.scene.name}: lanes ${one} and ${other} apart`);
    }
  }
  assertEquals(baseOfRace(2).scene.name, "Night Elf Base", "a race's base");
});

test("rps bases: tavern heroes spawn at the tavern nearest their start location, beside it and off the sergeant's spot", () => {
  const center = { x: 0, y: 0 };
  const taverns = [{ x: -3000, y: 0 }, { x: 3000, y: 0 }];
  assertEquals(nearestTavern(taverns, { x: 2500, y: 2500 })?.x, 3000, "a start in the north-east");
  assertEquals(nearestTavern(taverns, { x: -2500, y: -2500 })?.x, -3000, "a start in the south-west");
  assertEquals(nearestTavern([], { x: 0, y: 0 }), undefined, "no tavern");
  const tavern = { x: 3000, y: 0 }, sergeant = { x: 2700, y: 0 };
  for (const id of [0, 1, 2, 3]) {
    const spot = tavernSpawn(center, tavern, id);
    assertEquals(distanceSquared(spot, tavern) < 700 * 700, true, `player ${id} at the tavern`);
    assertEquals(distanceSquared(spot, sergeant) >= 200 * 200, true, `player ${id} clear of the sergeant`);
  }
});

test("[property] rps bases: each base has houses, workers on rounds, guards on patrol, a sparring pair and its own chatter", () => {
  for (const base of BASES) {
    const name = base.scene.name;
    assertEquals(base.buildings.length, 4, `${name}: hall, barracks and two houses`);
    assertEquals(base.life.workers.length, 3, `${name}: three workers`);
    assertEquals(base.life.patrols.length, 2, `${name}: two guards on patrol`);
    for (const rounds of [...base.life.workers, ...base.life.patrols]) {
      const span = (rounds.to.out - rounds.out) * (rounds.to.out - rounds.out) + (rounds.to.side - rounds.side) * (rounds.to.side - rounds.side);
      assertEquals(span >= 200 * 200, true, `${name}: ${rounds.code} walks at least 200`);
    }
    assertEquals(base.life.sparring[0].code === base.life.sparring[1].code, true, `${name}: the sparring pair are alike`);
    assertEquals(base.life.chatter.length >= 3 && base.life.chatter.every((line) => line.length > 0), true, `${name}: chatter`);
  }
  assertEquals(new Set(BASES.map((base) => base.life.chatter[0])).size, 4, "each race its own chatter");
});

test("rps bases: someone at each base calls out every 8 s, the bases staggered, each line and speaker in turn", () => {
  const calls = (baseIndex: number) => Array.from({ length: CHATTER_BEATS * 3 }, (_, beat) => chatterOn(beat, baseIndex, 4, 3)).filter((call) => call !== undefined);
  assertEquals(calls(0).length, 3, "three calls in three rounds");
  assertEquals(calls(0).map((call) => `${call?.line}:${call?.speaker}`).join(","), "0:0,1:1,2:2", "lines and speakers in turn");
  const beatsOf = (baseIndex: number) => Array.from({ length: CHATTER_BEATS }, (_, beat) => beat).filter((beat) => chatterOn(beat, baseIndex, 4, 3) !== undefined);
  assertEquals([0, 1, 2, 3].map((index) => beatsOf(index).join("")).join(","), "0,12,8,4", "a quarter of the round apart");
  assertEquals(chatterOn(0, 0, 0, 3), undefined, "nothing to say");
});

test("rps bases: the sparring pair swing in turn, a second apart", () => {
  assertEquals([0, 1, 2, 3, 4, 5, 6, 7].map((beat) => sparrerOnBeat(beat) ?? "-").join(""), "0-1-0-1-", "turns");
});

test("rps bases: each base's shopkeeper sells three wares to anyone, each for its price, greyed out without the gold", () => {
  for (const base of BASES) {
    const scene = base.shopScene;
    assertEquals(sceneProblems(scene).join("; "), "", scene.name);
    let sold = 0;
    for (const node of scene.nodes) {
      for (const effect of node.effects ?? []) {
        if (effect.kind !== "item") continue;
        sold++;
        assertEquals(effect.code.length === 4 && effect.cost > 0, true, `${scene.name}: ${effect.name}`);
      }
    }
    assertEquals(sold, 3, `${scene.name}: three wares`);
    assertEquals(base.shop.side === -base.giver.side, true, `${scene.name}: at the recruiter's other side`);
  }
  const human = baseShopScene(0);
  const wares = human.nodes.find((node) => node.id === "wares")?.choices ?? [];
  assertEquals(wares.map((choice) => choice.text).join(" | "), "A Potion of Healing (150 gold). | A Ring of Protection +2 (150 gold). | Claws of Attack +6 (300 gold). | Not now.", "the Human shop");
  assertEquals(choiceStates(wares, new Set(), 150).join(","), "open,open,greyed,open", "150 gold: not the claws");
  assertEquals(openingOf(human, new Set(), 0), "wares", "anyone, kin or not");
});
