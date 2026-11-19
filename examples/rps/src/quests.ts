// The RPS map's quests: four sites out in the map, each an NPC with a scene and
// the units standing with him, whose choices end in a fight, a turn of sides
// or a follower. They run on the map's current combat; what a fight pays and
// what the player is remembered for come from the scene's effects: `fight`
// raises enemies, `hostile` turns the NPC or his company against the hero,
// and a bounty pays once every unit under its tag has fallen.
import type { Scene } from "./dialogue";

/** Heroes of rank, who can pull it on an officer: the Paladin, the Blood Mage and the Archmage. */
export const NOBLE_HEROES: readonly string[] = ["Hpal", "Hblm", "Hamg"];

/**
 * Unstable Containment: Seris, a Dalaran battle-mage, holds failing wards
 * outside a shattered observatory. Sealing them means fighting the elementals
 * beside her, and she pays once they fall; harvesting
 * their cores pays more, and turns her against the hero.
 */
export const CONTAINMENT_SCENE: Scene = {
  name: "Containment",
  npcName: "Battle-Mage Seris",
  npcCode: "hsor",
  start: "plea",
  openings: [
    { when: [{ flag: "wardsSealed" }], start: "thanks" },
    { when: [{ flag: "sealingWards" }], start: "hurry" },
  ],
  bark: { text: "You! With the swords! I need you, now!", mood: "command" },
  objective: { name: "the ley-line rift", angle: 450, distance: 3800 },
  nodes: [
    { id: "plea", speaker: "npc", mood: "neutral", text: "The containment wards are failing. The elementals Dalaran locked in here have broken loose to the ley-line rift.", next: "stakes" },
    {
      id: "stakes", speaker: "npc", mood: "angry", shot: "CLOSEUP", important: true,
      text: "Put them down at the rift while I re-channel the runes, or they walk out into the countryside.",
      choices: [
        { text: "Seal the wards. We'll hold the constructs.", next: "seal" },
        { text: "Those cores are worth a fortune. I'll take them.", next: "harvest" },
        { text: "Not my problem.", next: "leave" },
      ],
    },
    {
      id: "seal", speaker: "hero", mood: "confirm", text: "Start channelling. We'll handle the constructs at the rift.",
      effects: [
        { kind: "flag", flag: "sealingWards" },
        { kind: "ally", tag: "wards" },
        { kind: "fight", code: "hwat", count: 2, at: "objective", tag: "wards", bounty: { gold: 80, flag: "wardsSealed", text: "The wards hold. Seris pays you 80 gold." } },
        { kind: "fight", code: "hwt3", count: 1, at: "objective", tag: "wards" },
      ],
    },
    {
      id: "harvest", speaker: "npc", mood: "angry", shot: "CLOSEUP", text: "Fool! Those cores could level a city. I won't let you!",
      effects: [
        { kind: "flag", flag: "harvestedCores" },
        { kind: "fight", code: "hwat", count: 2, at: "objective", tag: "cores", bounty: { gold: 140, flag: "coresTaken", text: "You shatter the constructs and pry out their cores: 140 gold in arcane relics." } },
        { kind: "hostile", tag: "cores" },
      ],
    },
    { id: "leave", speaker: "hero", mood: "neutral", text: "Not my problem." },
    { id: "hurry", speaker: "npc", mood: "angry", text: "The runes won't hold forever! Bring those constructs down!" },
    { id: "thanks", speaker: "npc", mood: "confirm", text: "The wards hold, thanks to you. Dalaran won't forget it, {hero}." },
  ],
};

/**
 * The Broken Oath at Silverpine Gate: Captain Haldric's hardliners blockade a
 * pass against wounded blood elf exiles. Force the blockade (his footmen and he
 * turn on the hero, the elves fight beside him and pay), enforce it (the elves
 * turn, he and his footmen fight beside the hero and pay), or,
 * as a hero of rank, order him to stand down and gain a Spellbreaker.
 */
export const GATE_SCENE: Scene = {
  name: "Silverpine Gate",
  npcName: "Captain Haldric",
  npcCode: "hkni",
  start: "halt",
  openings: [{ when: [{ flag: "gateSettled" }], start: "settled" }],
  bark: { text: "Halt! This pass is closed by order of the Alliance!", mood: "command" },
  nodes: [
    { id: "halt", speaker: "npc", mood: "command", shot: "TWOSHOT", text: "Halt! No elf crosses into Alliance lands while I hold this gate.", next: "elves" },
    { id: "elves", speaker: "hero", mood: "question", text: "Those elves are wounded. Where would you have them go?", next: "orders" },
    {
      id: "orders", speaker: "npc", mood: "angry", shot: "CLOSEUP", text: "Back to the wilds they crawled out of. Orders are orders.",
      choices: [
        { text: "Then I'll break your blockade.", next: "force" },
        { text: "You're right. Drive them off.", next: "enforce" },
        { text: "[Noble] Stand down, Captain. That's an order.", next: "command", when: [{ hero: NOBLE_HEROES }] },
        { text: "Not my fight.", next: "leave" },
      ],
    },
    {
      id: "force", speaker: "npc", mood: "angry", text: "So be it. Shields up, men!",
      effects: [
        { kind: "flag", flag: "gateForced" },
        { kind: "hostile", code: "hfoo", tag: "gate", bounty: { gold: 60, flag: "gateSettled", text: "The blockade breaks. The exiles press 60 gold into your hands." } },
        { kind: "hostile", tag: "gate" },
        { kind: "ally", code: "hspt", tag: "gate" },
      ],
    },
    {
      id: "enforce", speaker: "npc", mood: "confirm", text: "Good. Help us push them back where they belong.",
      effects: [
        { kind: "flag", flag: "gateEnforced" },
        { kind: "hostile", code: "hspt", tag: "exiles", bounty: { gold: 80, flag: "gateSettled", text: "The exiles flee into the wilds. Haldric pays you 80 gold." } },
        { kind: "ally", tag: "exiles" },
        { kind: "ally", code: "hfoo", tag: "exiles" },
      ],
    },
    { id: "command", speaker: "hero", mood: "command", important: true, text: "Stand down, Captain. By my authority, these people pass.", next: "yield" },
    {
      id: "yield", speaker: "npc", mood: "confirm", text: "...As you command. Let them through.",
      effects: [{ kind: "spawn", code: "hspt", count: 1, role: "melee" }, { kind: "flag", flag: "gateSettled" }],
    },
    { id: "leave", speaker: "hero", mood: "neutral", text: "Not my fight." },
    { id: "settled", speaker: "npc", mood: "neutral", text: "The pass is quiet now. Move along, {hero}." },
  ],
};

/**
 * Blood in the Timberland: Foreman Gregor's mill has gone quiet since Amani
 * trolls took the woods. The hero (and his sergeant, if he has a squad) picks
 * a daylight assault on the whole camp or a night raid on a sleepier one.
 */
export const TIMBERLAND_SCENE: Scene = {
  name: "Timberland",
  npcName: "Foreman Gregor",
  npcCode: "hpea",
  start: "greet",
  openings: [
    { when: [{ flag: "campCleared" }], start: "grateful" },
    { when: [{ flag: "campAssault" }], start: "waiting" },
  ],
  bark: { text: "Help! The mill needs swords, not saws!", mood: "question" },
  objective: { name: "the troll ridge", angle: 2250, distance: 3800 },
  nodes: [
    { id: "greet", speaker: "npc", mood: "neutral", shot: "OTS", text: "Trolls. Amani trolls, out of the deep woods. They burned the north stacks and took the road.", next: "camp" },
    { id: "camp", speaker: "npc", mood: "question", text: "Their camp's on the ridge past the mill. Hit them in daylight, or wait for dark?", next: "sergeant" },
    { id: "sergeant", speaker: "squad", mood: "question", text: "In daylight we see their priests coming. At night half of them will be asleep.", next: "decide" },
    {
      id: "decide", speaker: "npc", mood: "question", text: "Your call. I just want my saws running.",
      choices: [
        { text: "We attack now, in daylight.", next: "day" },
        { text: "We go in at night.", next: "night" },
        { text: "Later.", next: "later" },
      ],
    },
    {
      id: "day", speaker: "hero", mood: "command", text: "Form up. We hit them now.",
      effects: [
        { kind: "flag", flag: "campAssault" },
        { kind: "fight", code: "nftr", count: 3, at: "objective", tag: "camp", bounty: { gold: 100, flag: "campCleared", text: "The troll camp burns. Gregor pays 100 gold from the mill's strongbox." } },
        { kind: "fight", code: "nfsp", count: 2, at: "objective", tag: "camp" },
        { kind: "fight", code: "nftk", count: 1, at: "objective", tag: "camp" },
      ],
    },
    {
      id: "night", speaker: "hero", mood: "command", text: "We wait for dark, then take the chieftain while the rest sleep.",
      effects: [
        { kind: "flag", flag: "campAssault" },
        { kind: "fight", code: "nftr", count: 1, at: "objective", tag: "camp", bounty: { gold: 100, flag: "campCleared", text: "The chieftain is dead and the camp scattered. Gregor pays 100 gold." } },
        { kind: "fight", code: "nfsp", count: 1, at: "objective", tag: "camp" },
        { kind: "fight", code: "nftk", count: 1, at: "objective", tag: "camp" },
      ],
    },
    { id: "later", speaker: "hero", mood: "neutral", text: "Later. We're not ready." },
    { id: "waiting", speaker: "npc", mood: "angry", text: "The trolls are still up on that ridge!" },
    { id: "grateful", speaker: "npc", mood: "confirm", text: "The saws are running again. Thank you, {hero}." },
  ],
};

/**
 * The Ogre Tax Collector: a two-headed ogre magi and his bruisers hold a
 * quarry. Mock him into a duel (he fights alone), set the heads arguing over
 * the split (he and his bruisers stand dazed for 4 seconds as the fight
 * starts), or draw weapons mid-sentence.
 */
export const OGRE_SCENE: Scene = {
  name: "Ogre Tax",
  npcName: "Gorm-and-Grum",
  npcCode: "nomg",
  start: "toll",
  bark: { text: "Shinies! Little one bring shinies!", mood: "angry" },
  nodes: [
    { id: "toll", speaker: "npc", mood: "angry", shot: "CLOSEUP", text: "Shinies! Give Gorm shinies, or Gorm smash!", next: "grum" },
    { id: "grum", speaker: "npc", mood: "question", text: "No, GRUM smash! Gorm smash last time!", next: "terms" },
    {
      id: "terms", speaker: "npc", mood: "command", shot: "OTS", text: "Pay, little one. Or bruisers break little legs.",
      choices: [
        { text: "Two heads and not one brain. Fight me alone, if you dare.", next: "duel" },
        { text: "Here's my gold. So which of you gets more?", next: "split" },
        { text: "[Draw weapons]", next: "ambush" },
        { text: "Walk away.", next: "leave" },
      ],
    },
    {
      id: "duel", speaker: "npc", mood: "angry", important: true, text: "Gorm fight alone! Bruisers, go sit!",
      effects: [{ kind: "flag", flag: "ogreFight" }, { kind: "hostile", tag: "ogre", bounty: { gold: 120, flag: "ogreBeaten", text: "The ogre falls. His hoard of shinies holds 120 gold." } }],
    },
    {
      id: "split", speaker: "npc", mood: "question", text: "Gorm get more! ...No, GRUM get more! Gorm always get more!",
      effects: [
        { kind: "flag", flag: "ogreFight" },
        { kind: "hostile", tag: "ogre", hold: 4, bounty: { gold: 120, flag: "ogreBeaten", text: "The quarry is yours. The ogres' hoard holds 120 gold." } },
        { kind: "hostile", code: "nogr", tag: "ogre", hold: 4 },
      ],
    },
    {
      id: "ambush", speaker: "hero", mood: "attack", text: "Enough talk!",
      effects: [
        { kind: "flag", flag: "ogreFight" },
        { kind: "hostile", tag: "ogre", bounty: { gold: 120, flag: "ogreBeaten", text: "The quarry is yours. The ogres' hoard holds 120 gold." } },
        { kind: "hostile", code: "nogr", tag: "ogre" },
      ],
    },
    { id: "leave", speaker: "hero", mood: "neutral", text: "Not today." },
  ],
};

/** A unit type standing with a quest NPC: how many, in a ring how far from him. */
export interface Extra {
  readonly code: string;
  readonly count: number;
  readonly radius: number;
}

/**
 * Where the quests stand: 2400 from the playable area's center, a quarter
 * turn apart (tenths of a degree from east), each NPC facing the center with
 * his company in rings around him.
 */
export const QUEST_SITES: readonly { readonly scene: Scene; readonly angle: number; readonly distance: number; readonly extras: readonly Extra[] }[] = [
  { scene: CONTAINMENT_SCENE, angle: 0, distance: 2400, extras: [] },
  { scene: GATE_SCENE, angle: 900, distance: 2400, extras: [{ code: "hfoo", count: 3, radius: 220 }, { code: "hspt", count: 2, radius: 380 }] },
  { scene: TIMBERLAND_SCENE, angle: 1800, distance: 2400, extras: [] },
  { scene: OGRE_SCENE, angle: 2700, distance: 2400, extras: [{ code: "nogr", count: 2, radius: 240 }] },
];

/** Every quest's scene. */
export const QUEST_SCENES: readonly Scene[] = QUEST_SITES.map((site) => site.scene);
