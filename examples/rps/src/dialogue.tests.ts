import { assertEquals, test } from "wisp/src/runtime/testing";
import { angleGap } from "./combat";
import {
  type DialogueNode, HEALER_SCENE, MERCENARY_SCENE, SCOUT_SCENE, WANDERERS, FADE_TICKS, GLIDE_TICKS, RECRUIT_SCENE, SCENES, STARTING_GOLD, TAVERN_SCENE, TALK_DISTANCE, MELEE_COST, RANGED_COST,
  MAX_TAKES, talkTicks, choiceStates, countTakes, recordingFile, directShot, fadeAlpha, fillLine, framing, gestureOf, hasNews, lineTicks, listenerOf, meets, openingOf, recruitOutcome, sceneFraming, shotFace,
  sceneProblems, seenFlag, talkSpot, voiceFile, voiceTicks,
} from "./dialogue";

const FOOTMAN = "Units\\Human\\Footman\\Footman", PALADIN = "Units\\Human\\HeroPaladin\\HeroPaladin";
import { distanceSquared, isqrt } from "./rules";

test("rps dialogue: a unit's mood plays its sound set's first recording of that kind, and a type without one is silent", () => {
  assertEquals(voiceFile(FOOTMAN, "neutral", 0, 4), "Units\\Human\\Footman\\FootmanWhat1.wav", "footman");
  assertEquals(voiceFile(PALADIN, "angry", 0, 4), "Units\\Human\\HeroPaladin\\HeroPaladinPissed1.wav", "paladin");
  assertEquals(voiceFile(undefined, "confirm", 0, 4), undefined, "no voice");
  assertEquals(voiceFile(FOOTMAN, "warcry", 0, 0), undefined, "no recording of the kind");
});

test("rps dialogue: a line stays up 2 seconds plus its reading time", () => {
  assertEquals(lineTicks(""), 66, "empty");
  assertEquals(lineTicks("x".repeat(45)), 66 + 100, "45 characters: 3 more seconds");
});

test("[property] rps dialogue: every scene starts, goes and branches only to its own nodes", () => {
  for (const scene of SCENES) assertEquals(sceneProblems(scene).join("; "), "", scene.name);
  const broken = { ...TAVERN_SCENE, start: "nowhere", openings: [], nodes: [{ id: "a", speaker: "npc" as const, text: "", mood: "neutral" as const, shot: "OTS" as const, next: "b" }] };
  assertEquals(sceneProblems(broken).join("; "), "Tavern: no start node nowhere; Tavern: a goes to no node b", "problems named");
});

test("rps dialogue: the tavern scene branches four ways into its endings, and opens two more ways on a return", () => {
  const decide = TAVERN_SCENE.nodes.find((node) => node.id === "decide");
  assertEquals(decide?.choices?.length, 4, "four choices");
  const endings = TAVERN_SCENE.nodes.filter((node) => node.next === undefined && node.choices === undefined).map((node) => node.id);
  assertEquals(endings.join(","), "vow,haggle,scorn,cold,promise", "five endings");
});

test("rps dialogue: shots frame the speaker over the listener's shoulder, close up off axis, or both from the side", () => {
  const speaker = { x: 0, y: 200 }, listener = { x: 0, y: 0 };
  const ots = framing("OTS", speaker, listener, 30);
  assertEquals(`${ots.target.y},${ots.distance}`, "200,290", "from beside the listener's shoulder, 150 to his right and 40 back");
  assertEquals(Math.abs(ots.yaw - 1269) <= 2, true, `looking at the speaker from there: ${ots.yaw}`);
  const big = framing("OTS", speaker, listener, 90);
  assertEquals(angleGap(big.yaw, 900) > angleGap(ots.yaw, 900), true, "a bigger listener: the camera stands farther aside");
  const close = framing("CLOSEUP", speaker, listener);
  assertEquals(`${close.yaw},${close.fieldOfView},${close.distance}`, "1140,54,190", "24 degrees off axis, on the face");
  const two = framing("TWOSHOT", speaker, listener);
  assertEquals(`${two.target.x},${two.target.y},${two.distance}`, "0,100,530", "the midpoint, from the side");
  assertEquals(angleGap(two.yaw, 900), 900, "perpendicular to the line between them");
  assertEquals(framing("CLOSEUP", speaker, listener, 32, 210).distance, 340, "a face 150 taller: 150 farther back");
  assertEquals(framing("CLOSEUP", speaker, listener, 32, 40).distance, 190, "a shorter face: no closer");
  assertEquals(`${shotFace("CLOSEUP", 210, 60)},${shotFace("TWOSHOT", 210, 60)}`, "210,135", "the speaker's face, or between both");
});

test("rps dialogue: the hero takes his place 260 from the NPC, on the side he came from", () => {
  const spot = talkSpot({ x: 1000, y: 1000 }, { x: 1000, y: 600 });
  assertEquals(`${spot.x},${spot.y}`, "1000,740", "south of the NPC");
  assertEquals(Math.abs(isqrt(distanceSquared(spot, { x: 1000, y: 1000 })) - TALK_DISTANCE) <= 1, true, "260 apart");
});

test("rps dialogue: lines fill in the hero and his race's soldiers", () => {
  assertEquals(fillLine("Hire two {melee}, {hero}.", { hero: "Thrall", melee: "Grunts" }), "Hire two Grunts, Thrall.", "filled");
  assertEquals(fillLine("No placeholders.", { hero: "x" }), "No placeholders.", "untouched");
});

test("rps dialogue: a recruit goes through with the gold, once per role, and the starting gold buys both pairs", () => {
  assertEquals(recruitOutcome(STARTING_GOLD, MELEE_COST, false), "hired", "can afford");
  assertEquals(recruitOutcome(MELEE_COST - 1, MELEE_COST, false), "poor", "short");
  assertEquals(recruitOutcome(500, RANGED_COST, true), "already", "already leads them");
  assertEquals(STARTING_GOLD >= MELEE_COST + RANGED_COST, true, "both pairs");
  const offer = RECRUIT_SCENE.nodes.find((node) => node.id === "offer");
  assertEquals(offer?.choices?.map((choice) => choice.next).join(","), "melee,ranged,later", "the offer");
  const recruits: string[] = [];
  for (const node of RECRUIT_SCENE.nodes) for (const effect of node.effects ?? []) if (effect.kind === "recruit") recruits.push(effect.role);
  assertEquals(recruits.join(","), "melee,ranged", "two recruits");
});

test("rps dialogue: each line plays the next recording of its mood's kind, round the ones the set has", () => {
  assertEquals(voiceFile(FOOTMAN, "neutral", 1, 4), "Units\\Human\\Footman\\FootmanWhat2.wav", "the second line");
  assertEquals(voiceFile(FOOTMAN, "neutral", 4, 4), "Units\\Human\\Footman\\FootmanWhat1.wav", "round to the first again");
  assertEquals(voiceFile(FOOTMAN, "angry", 6, 7), "Units\\Human\\Footman\\FootmanPissed7.wav", "all seven of a set with seven");
  assertEquals(voiceFile(PALADIN, "warcry", 3, 1), "Units\\Human\\HeroPaladin\\HeroPaladinWarcry1.wav", "one warcry");
});

test("rps dialogue: a set's recordings of a kind count up from 1 while the files are there, at most 10", () => {
  assertEquals(countTakes((take) => take <= 7), 7, "seven");
  assertEquals(countTakes(() => false), 0, "none");
  assertEquals(countTakes((take) => take !== 3), 2, "a gap ends the count");
  assertEquals(countTakes(() => true), MAX_TAKES, "at most 10");
  assertEquals(recordingFile("Units\\Orc\\Grunt\\Grunt", "attack", 2), "Units\\Orc\\Grunt\\GruntYesAttack2.wav", "a file by take");
});

test("rps dialogue: a line without its own animation gestures by its mood", () => {
  assertEquals(`${gestureOf("warcry")},${gestureOf("angry")},${gestureOf("command")}`, "stand victory,attack,stand ready", "gestures");
  assertEquals(gestureOf("neutral"), undefined, "a neutral line stands");
});

test("rps dialogue: a line stays up as long as its voice and half a second more", () => {
  assertEquals(voiceTicks(0), 0, "no voice");
  assertEquals(voiceTicks(3000), 116, "3 s of voice: 100 ticks and 16");
  assertEquals(`${talkTicks(0)},${talkTicks(3000)},${talkTicks(3001)}`, "0,100,101", "the speaker talks as long as his voice, rounded up");
});

const line = (fields: Partial<DialogueNode>): DialogueNode => ({ id: "x", speaker: "npc", text: "", mood: "neutral", ...fields });
const shotText = (direction: { readonly shot: string; readonly glide: boolean }) => `${direction.shot} ${direction.glide ? "glide" : "cut"}`;

test("rps dialogue: the director opens wide, cuts to the reverse shot for a new speaker, closes up on anger and important lines", () => {
  assertEquals(directShot(line({}), undefined).shot, "TWOSHOT", "the first line");
  assertEquals(shotText(directShot(line({ speaker: "hero" }), { speaker: "npc", shot: "TWOSHOT" })), "OTS cut", "the reply: a cut over the shoulder");
  assertEquals(directShot(line({ speaker: "hero", mood: "angry" }), { speaker: "npc", shot: "OTS" }).shot, "CLOSEUP", "anger");
  assertEquals(directShot(line({ speaker: "hero", important: true }), { speaker: "npc", shot: "OTS" }).shot, "CLOSEUP", "an important line");
  assertEquals(directShot(line({ speaker: "hero", shot: "TWOSHOT", mood: "angry" }), { speaker: "npc", shot: "OTS" }).shot, "TWOSHOT", "the node's own shot wins");
});

test("rps dialogue: the same speaker going on never cuts to the same shot: the camera glides in", () => {
  assertEquals(shotText(directShot(line({}), { speaker: "npc", shot: "TWOSHOT" })), "OTS glide", "two-shot to his shoulder shot");
  assertEquals(shotText(directShot(line({}), { speaker: "npc", shot: "OTS" })), "CLOSEUP glide", "on to a close-up");
  assertEquals(shotText(directShot(line({ mood: "angry" }), { speaker: "npc", shot: "CLOSEUP" })), "CLOSEUP glide", "a close-up stays");
});

test("rps dialogue: a glide eases from the last framing to the new one, the short way round, then holds still", () => {
  const from = { target: { x: 0, y: 0 }, yaw: 3500, attack: -100, distance: 500, fieldOfView: 70 };
  const to = { target: { x: 100, y: 0 }, yaw: 100, attack: -30, distance: 170, fieldOfView: 54 };
  const start = sceneFraming(from, to, 0, 100);
  assertEquals(`${start.target.x},${start.yaw},${start.distance}`, "0,3500,500", "where the last line left it");
  const middle = sceneFraming(from, to, 17, 100);
  assertEquals(`${middle.target.x},${middle.yaw}`, "50,3600", "halfway, turning through east, not back round");
  const settled = sceneFraming(from, to, GLIDE_TICKS, 100);
  assertEquals(`${settled.target.x},${settled.distance}`, "100,170", "there, holding still");
  assertEquals(sceneFraming(undefined, to, 0, 100).distance, 170, "a cut is there at once");
  assertEquals(sceneFraming(undefined, to, 100, 100).distance, 170, "still there at the line's end: no sway");
});

test("rps dialogue: a scene fades in from black and out to it", () => {
  assertEquals(`${fadeAlpha(0, false)},${fadeAlpha(FADE_TICKS, false)}`, "255,0", "in");
  assertEquals(`${fadeAlpha(0, true)},${fadeAlpha(FADE_TICKS, true)}`, "0,255", "out");
});

test("rps dialogue: conditions read flags and gold; scenes open by them, and choices grey out or hide", () => {
  const flags = new Set(["helpingSergeant"]);
  assertEquals(meets([{ flag: "helpingSergeant" }, { gold: 50 }], flags, 50), true, "both met");
  assertEquals(meets([{ notFlag: "helpingSergeant" }], flags, 0), false, "a flag he has");
  assertEquals(meets([{ gold: 51 }], flags, 50), false, "short of gold");
  assertEquals(openingOf(TAVERN_SCENE, new Set(), 0), "greet", "the first time");
  assertEquals(openingOf(TAVERN_SCENE, flags, 0), "again", "after agreeing to help");
  assertEquals(openingOf(TAVERN_SCENE, new Set(["insultedSergeant", "helpingSergeant"]), 0), "cold", "the first opening met wins");
  assertEquals(openingOf(RECRUIT_SCENE, new Set([seenFlag(RECRUIT_SCENE)]), 0), "back", "the quartermaster remembers");
  const choices = [{ text: "a", next: "a" }, { text: "b", next: "b", when: [{ gold: 100 }] }, { text: "c", next: "c", when: [{ flag: "x" }], hidden: true }];
  assertEquals(choiceStates(choices, new Set(), 50).join(","), "open,greyed,hidden", "states");
  assertEquals(choiceStates(RECRUIT_SCENE.nodes[0]?.choices ?? [], new Set(), MELEE_COST).join(","), "open,greyed,open", "the quartermaster's, with 60 gold");
});

test("rps dialogue: a scene has news until the player plays it to the end", () => {
  assertEquals(hasNews(TAVERN_SCENE, new Set()), true, "new");
  assertEquals(hasNews(TAVERN_SCENE, new Set([seenFlag(TAVERN_SCENE)])), false, "seen");
});

test("rps dialogue: the hero speaks to the NPC, and the NPC and a soldier to the hero, unless a line says whom", () => {
  assertEquals(`${listenerOf(line({ speaker: "hero" }))},${listenerOf(line({ speaker: "npc" }))},${listenerOf(line({ speaker: "squad" }))}`, "npc,hero,hero", "defaults");
  assertEquals(listenerOf(line({ speaker: "squad", to: "npc" })), "npc", "a soldier to the NPC");
  assertEquals(TAVERN_SCENE.nodes.some((node) => node.speaker === "squad"), true, "the tavern has a soldier's line");
});

test("rps dialogue: the scout talks only to the sergeant's helpers, then only hurries them on", () => {
  assertEquals(openingOf(SCOUT_SCENE, new Set(), 0), "cold", "a stranger");
  assertEquals(openingOf(SCOUT_SCENE, new Set(["helpingSergeant"]), 0), "sent", "sent by the sergeant");
  assertEquals(openingOf(SCOUT_SCENE, new Set(["helpingSergeant", "knowsMines"]), 0), "hurry", "already told");
});

test("rps dialogue: the mercenary sells his trolls for 90 gold, gives them for his challenge, and only once", () => {
  const offer = MERCENARY_SCENE.nodes.find((node) => node.id === "offer")?.choices ?? [];
  assertEquals(choiceStates(offer, new Set(), 89).join(","), "greyed,open,open", "short of gold");
  assertEquals(choiceStates(offer, new Set(), 90).join(","), "open,open,open", "with the gold");
  assertEquals(openingOf(MERCENARY_SCENE, new Set(["provedToGormak"]), 0), "respect", "after the challenge");
  assertEquals(openingOf(MERCENARY_SCENE, new Set(["provedToGormak", "gormakPaid"]), 0), "done", "trolls given");
});

test("rps dialogue: the healer's free heal shows only to the sergeant's helpers, once", () => {
  const greet = HEALER_SCENE.nodes.find((node) => node.id === "greet")?.choices ?? [];
  assertEquals(choiceStates(greet, new Set(), 20).join(","), "open,hidden,open", "a stranger with 20 gold");
  assertEquals(choiceStates(greet, new Set(["helpingSergeant"]), 0).join(","), "greyed,open,open", "a helper with no gold");
  assertEquals(choiceStates(greet, new Set(["helpingSergeant", "marenFavor"]), 0).join(","), "greyed,hidden,open", "the favor used");
});

test("rps dialogue: the wandering NPCs stand a third of a turn apart around the center", () => {
  assertEquals(WANDERERS.map((wanderer) => `${wanderer.scene.name}@${wanderer.angle}`).join(","), "Scout@450,Mercenaries@1650,Healer@2850", "placed");
});
