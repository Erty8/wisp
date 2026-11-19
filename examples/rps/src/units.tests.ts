import { assertEquals, test } from "wisp/src/runtime/testing";
import { CREEPS, OUTPOST } from "./constants";
import { type Scene, FACE_HEIGHT, SCENES, TALK_ANIMATION, WANDERERS, gestureOf } from "./dialogue";
import { QUEST_SITES } from "./quests";
import { BASES } from "./bases";
import { SELLSWORDS, SELLSWORD_SCENE } from "./tavern";
import { RACES, TAVERN_HEROES } from "./roster";
import { fourCC } from "./rules";
import { UNITS, faceHeight, gestureFor, talkAnimation, voiceCandidates } from "./units";

/** Every unit type a scene puts on stage or raises: its NPC, and its effects' spawns and fights. */
function sceneCodes(scene: Scene): string[] {
  const codes = [scene.npcCode];
  for (const node of scene.nodes) {
    for (const effect of node.effects ?? []) if (effect.kind === "spawn" || effect.kind === "fight") codes.push(effect.code);
  }
  return codes;
}

/** Every unit type the map creates, by rawcode. */
function usedCodes(): string[] {
  const codes: string[] = [];
  for (const hero of TAVERN_HEROES) codes.push(hero.code);
  for (const race of RACES) {
    for (const hero of race.heroes) codes.push(hero.code);
    for (const soldier of [...race.army, ...race.veterans]) codes.push(soldier.code);
  }
  for (const scene of SCENES) codes.push(...sceneCodes(scene));
  for (const wanderer of WANDERERS) codes.push(...sceneCodes(wanderer.scene));
  codes.push(...sceneCodes(SELLSWORD_SCENE), ...SELLSWORDS.map((sellsword) => sellsword.code));
  for (const base of BASES) {
    codes.push(...sceneCodes(base.scene), ...sceneCodes(base.questScene));
    for (const part of [...base.buildings, ...base.guards, ...base.life.workers, ...base.life.patrols, ...base.life.sparring]) codes.push(part.code);
  }
  for (const site of QUEST_SITES) {
    codes.push(...sceneCodes(site.scene));
    for (const extra of site.extras) codes.push(extra.code);
  }
  return codes;
}

test("[property] rps units: every unit type the map creates has a profile", () => {
  const missing = usedCodes().filter((code) => UNITS[code] === undefined);
  assertEquals(missing.join(","), "", "add a profile to src/units.ts for");
  const profiled = Object.keys(UNITS).map((code) => fourCC(code));
  const missingCreeps = [...CREEPS, OUTPOST].filter((code) => profiled.indexOf(code) < 0);
  assertEquals(missingCreeps.length, 0, "the creeps and the outpost");
});

test("[property] rps units: every profile has a name and life, and every voice is a Units\\ file prefix", () => {
  for (const code of Object.keys(UNITS)) {
    const profile = UNITS[code];
    assertEquals(profile !== undefined && profile.name !== "" && profile.life > 0, true, `${code} named and alive`);
    for (const prefix of voiceCandidates(code)) {
      assertEquals(prefix.substring(0, 6) === "Units\\" && prefix.substring(prefix.length - 4) !== ".wav", true, `${code}: ${prefix}`);
    }
  }
});

test("rps units: a profile's voice guesses come in order, and a unit without one is silent", () => {
  assertEquals(voiceCandidates("hfoo").join(";"), "Units\\Human\\Footman\\Footman", "the footman");
  assertEquals(voiceCandidates("nomg").length, 3, "three guesses for the ogre magi");
  assertEquals(voiceCandidates("ngno").length, 0, "the gnoll doesn't speak");
  assertEquals(voiceCandidates("zzzz").length, 0, "no profile");
});

test("rps units: a unit talks and gestures with its own animations, else the map's", () => {
  assertEquals(talkAnimation("hfoo"), TALK_ANIMATION, "the map's talk");
  assertEquals(gestureFor("hfoo", "angry"), gestureOf("angry"), "the map's gesture");
  assertEquals(gestureFor("zzzz", "warcry"), gestureOf("warcry"), "no profile");
  assertEquals(`${faceHeight("nomg")},${faceHeight("ngno")}`, `210,${FACE_HEIGHT}`, "a tall ogre's face, else the map's");
});
