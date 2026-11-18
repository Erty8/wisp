import { assertEquals, test } from "wisp/src/runtime/testing";
import { choiceStates, meets, openingOf, sceneProblems } from "./dialogue";
import { CONTAINMENT_SCENE, GATE_SCENE, NOBLE_HEROES, OGRE_SCENE, QUEST_SCENES, QUEST_SITES, TIMBERLAND_SCENE } from "./quests";

const choicesOf = (scene: typeof GATE_SCENE, id: string) => scene.nodes.find((node) => node.id === id)?.choices ?? [];
const effectsOf = (scene: typeof GATE_SCENE, id: string) => scene.nodes.find((node) => node.id === id)?.effects ?? [];

test("[property] rps quests: every quest scene starts, opens and branches only to its own nodes", () => {
  for (const scene of QUEST_SCENES) assertEquals(sceneProblems(scene).join("; "), "", scene.name);
  assertEquals(QUEST_SITES.map((site) => `${site.scene.name}@${site.angle}`).join(","), "Containment@0,Silverpine Gate@900,Timberland@1800,Ogre Tax@2700", "four sites a quarter turn apart");
});

test("rps quests: a hero condition holds only for the heroes it names", () => {
  assertEquals(meets([{ hero: NOBLE_HEROES }], new Set(), 0, "Hpal"), true, "the Paladin");
  assertEquals(meets([{ hero: NOBLE_HEROES }], new Set(), 0, "Hmkg"), false, "the Mountain King");
  assertEquals(meets([{ hero: NOBLE_HEROES }], new Set(), 0), false, "no hero");
});

test("rps quests: the containment mage pays for sealing, and harvesting turns her and pays more", () => {
  assertEquals(choicesOf(CONTAINMENT_SCENE, "stakes").map((choice) => choice.next).join(","), "seal,harvest,leave", "three ways");
  assertEquals(effectsOf(CONTAINMENT_SCENE, "harvest").some((effect) => effect.kind === "hostile"), true, "harvesting turns her");
  assertEquals(effectsOf(CONTAINMENT_SCENE, "seal").some((effect) => effect.kind === "ally" && effect.tag === "wards"), true, "sealing, she fights beside the hero");
  const bounties = (id: string) => effectsOf(CONTAINMENT_SCENE, id).map((effect) => (effect.kind === "fight" ? effect.bounty?.gold ?? 0 : 0)).reduce((a, b) => a + b, 0);
  assertEquals(`${bounties("seal")},${bounties("harvest")}`, "80,140", "what each pays");
  assertEquals(openingOf(CONTAINMENT_SCENE, new Set(["sealingWards"]), 0), "hurry", "mid-fight");
  assertEquals(openingOf(CONTAINMENT_SCENE, new Set(["sealingWards", "wardsSealed"]), 0), "thanks", "after the fight");
});

test("rps quests: at the gate only a hero of rank can order the captain down, and he gains a Spellbreaker", () => {
  const orders = choicesOf(GATE_SCENE, "orders");
  assertEquals(choiceStates(orders, new Set(), 0, "Hmkg").join(","), "open,open,greyed,open", "the Mountain King");
  assertEquals(choiceStates(orders, new Set(), 0, "Hpal").join(","), "open,open,open,open", "the Paladin");
  assertEquals(effectsOf(GATE_SCENE, "yield").some((effect) => effect.kind === "spawn" && effect.code === "hspt"), true, "a Spellbreaker follows");
  const turned = (id: string) => effectsOf(GATE_SCENE, id).map((effect) => (effect.kind === "hostile" ? effect.code ?? "captain" : "")).filter((code) => code !== "").join(",");
  assertEquals(`${turned("force")} / ${turned("enforce")}`, "hfoo,captain / hspt", "who turns each way");
  const allied = (id: string) => effectsOf(GATE_SCENE, id).map((effect) => (effect.kind === "ally" ? effect.code ?? "captain" : "")).filter((code) => code !== "").join(",");
  assertEquals(`${allied("force")} / ${allied("enforce")}`, "hspt / captain,hfoo", "who fights beside the hero each way");
});

test("rps quests: the timberland's night raid meets fewer trolls than the day assault, the chieftain in both", () => {
  const count = (id: string) => effectsOf(TIMBERLAND_SCENE, id).map((effect) => (effect.kind === "fight" ? effect.count : 0)).reduce((a, b) => a + b, 0);
  assertEquals(`${count("day")},${count("night")}`, "6,3", "trolls");
  const chieftain = (id: string) => effectsOf(TIMBERLAND_SCENE, id).some((effect) => effect.kind === "fight" && effect.code === "nftk");
  assertEquals(chieftain("day") && chieftain("night"), true, "the chieftain");
  assertEquals(TIMBERLAND_SCENE.nodes.some((node) => node.speaker === "squad"), true, "the sergeant has his say");
});

test("rps quests: the ogre fights alone in a duel, dazed with his bruisers after the split, and with them at once in an ambush", () => {
  const turns = (id: string) => effectsOf(OGRE_SCENE, id).map((effect) => (effect.kind === "hostile" ? `${effect.code ?? "ogre"}${effect.hold === undefined ? "" : `+${effect.hold}s`}` : "")).filter((turn) => turn !== "").join(",");
  assertEquals(turns("duel"), "ogre", "duel");
  assertEquals(turns("split"), "ogre+4s,nogr+4s", "split");
  assertEquals(turns("ambush"), "ogre,nogr", "ambush");
});
