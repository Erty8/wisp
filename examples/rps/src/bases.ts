// The RPS map's four race bases: a Human, an Orc, a Night Elf and an Undead
// camp out in the map, each with its race's town hall and barracks, guards
// standing around them, a recruiter who sells the race's soldiers, and a quest
// giver. A player of the base's own race (the race he chose in Warcraft's
// lobby, which his `raceFlag` names to his scenes) gets soldiers free; anyone
// else pays. The quest giver sends the hero to clear a camp at the base's
// objective; once it falls (`veteransFlag`), the recruiter also offers the
// race's veterans, free to kin and dearer to anyone else. The scenes are made
// from the race's data (`baseScene`, `baseQuestScene`), so each base speaks
// its own soldiers' names.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import { atan2Tenths } from "./combat";
import type { Choice, DialogueNode, Effect, Objective, Scene } from "./dialogue";
import { type Race, type Soldier, RACES } from "./roster";
import { type Point, distanceSquared, offset } from "./rules";

/** What a player of another race pays a base for two melee or two ranged soldiers, and for two of its veterans. */
export const BASE_MELEE_COST = 90;
export const BASE_RANGED_COST = 120;
export const VETERAN_MELEE_COST = 150;
export const VETERAN_RANGED_COST = 180;
/** What a base's quest pays besides the veterans. */
export const BASE_QUEST_GOLD = 50;

/** The flag every scene of a player of `race` (by name) sees: set as his hero spawns. */
export const raceFlag = (raceName: string) => `race:${raceName}`;
/** The flag a player gets for taking a base's quest, and for finishing it: its veterans are his to recruit. */
export const questFlag = (raceName: string) => `baseQuest:${raceName}`;
export const veteransFlag = (raceName: string) => `veterans:${raceName}`;

/** A building, a guard or the quest giver of a base: its unit type, `out` along the base's angle (away from the map's center) and `side` to its left. */
export interface BasePart {
  readonly code: string;
  readonly out: number;
  readonly side: number;
}

/** A base's quest: its title, what the giver asks, and the camp at its objective. */
export interface BaseQuest {
  readonly title: string;
  readonly giver: string;
  readonly ask: string;
  /** What the hero is to defeat, as the journal names them. */
  readonly foes: string;
  readonly camp: readonly { readonly code: string; readonly count: number }[];
  readonly objective: Objective;
}

/** One race's base: which race (an index into RACES), where (tenths of a degree from east, and distance from the playable area's center), its buildings and guards, its recruiter's scene, and its quest giver, quest and scene. */
export interface Base {
  readonly race: number;
  readonly angle: number;
  readonly distance: number;
  readonly buildings: readonly BasePart[];
  readonly guards: readonly BasePart[];
  readonly scene: Scene;
  readonly giver: BasePart;
  readonly quest: BaseQuest;
  readonly questScene: Scene;
  /** What keeps the base alive: workers walking their rounds, guards on patrol, a sparring pair and the chatter its people call out. */
  readonly life: BaseLife;
  /** The shopkeeper at the recruiter's other side, and his scene. */
  readonly shop: BasePart;
  readonly shopScene: Scene;
}

/** An item a base's shop sells: its four-letter rawcode, its name and its price. */
export interface Ware {
  readonly code: string;
  readonly name: string;
  readonly cost: number;
}

/** A unit walking back and forth between where it stands and `to` (Warcraft's patrol order). */
export interface Rounds extends BasePart {
  readonly to: { readonly out: number; readonly side: number };
}

export interface BaseLife {
  /** Workers walking from the hall to the houses and the barracks and back. */
  readonly workers: readonly Rounds[];
  /** Guards walking a beat across the front of the base. */
  readonly patrols: readonly Rounds[];
  /** Two soldiers facing each other by the barracks, taking turns swinging (`sparrerOnBeat`). */
  readonly sparring: readonly [BasePart, BasePart];
  /** Lines the base's people call out in turn (`chatterOn`). */
  readonly chatter: readonly string[];
}

/** The base life tick's beat: every 0.5 s (STANCE_PERIOD). Someone at each base calls out every CHATTER_BEATS beats (8 s), the bases a quarter of that apart. */
export const CHATTER_BEATS = 16;
/** A base's chatter shows to players whose hero is this close to it. */
export const CHATTER_RANGE = 1600;

/** Which line a base calls out on a beat, and which of its people says it; undefined on a beat it is quiet. */
export function chatterOn(beat: number, baseIndex: number, lines: number, speakers: number): { readonly line: number; readonly speaker: number } | undefined {
  const staggered = beat + baseIndex * floorDiv(CHATTER_BEATS, 4);
  if (lines <= 0 || speakers <= 0 || floorMod(staggered, CHATTER_BEATS) !== 0) return undefined;
  const round = floorDiv(staggered, CHATTER_BEATS);
  return { line: floorMod(round, lines), speaker: floorMod(round, speakers) };
}

/** Which of a sparring pair swings on a beat: the first, then (two beats later) the second, a second apart; undefined between swings. */
export function sparrerOnBeat(beat: number): 0 | 1 | undefined {
  const step = floorMod(beat, 4);
  return step === 0 ? 0 : step === 2 ? 1 : undefined;
}

/** Each race's town hall, barracks and houses, its workers, its recruiter's name and greeting, its people's chatter, and its quest. */
const LOOKS: readonly {
  readonly hall: string; readonly barracks: string; readonly house: string; readonly worker: string;
  readonly npcName: string; readonly greeting: string; readonly chatter: readonly string[]; readonly quest: BaseQuest;
  /** The shopkeeper's name and unit type, and his three wares. */
  readonly shop: { readonly keeper: string; readonly code: string; readonly wares: readonly [Ware, Ware, Ware] };
}[] = [
  {
    hall: "htow", barracks: "hbar", house: "hhou", worker: "hpea", npcName: "Marshal Aldren", greeting: "For the Alliance",
    chatter: ["Keep those blades sharp!", "Another wagon from Lordaeron, late again.", "Ready for duty!", "The Marshal wants the walls checked twice."],
    shop: {
      keeper: "Merchant Tomas", code: "hpea",
      wares: [{ code: "phea", name: "a Potion of Healing", cost: 150 }, { code: "rde1", name: "a Ring of Protection +2", cost: 150 }, { code: "rat6", name: "Claws of Attack +6", cost: 300 }],
    },
    quest: {
      title: "Bandits on the King's Road", giver: "Lieutenant Mira", foes: "bandits",
      ask: "Bandits hold the old camp on the King's Road and rob every wagon we send. Break them, and the Marshal opens the armory to you.",
      camp: [{ code: "nban", count: 3 }, { code: "nenf", count: 1 }],
      objective: { name: "the bandit camp", angle: 600, distance: 3200 },
    },
  },
  {
    hall: "ogre", barracks: "obar", house: "otrb", worker: "opeo", npcName: "Blood Captain Gorth", greeting: "For the Horde",
    chatter: ["Work, peons, work!", "Zug zug.", "The kodo are restless tonight.", "Blood and thunder!"],
    shop: {
      keeper: "Trader Grok", code: "opeo",
      wares: [{ code: "phea", name: "a Potion of Healing", cost: 150 }, { code: "bspd", name: "Boots of Speed", cost: 250 }, { code: "ofir", name: "an Orb of Fire", cost: 350 }],
    },
    quest: {
      title: "Wolves at the Pens", giver: "Scout Rokhan", foes: "wolves",
      ask: "A wolf pack dens past the ridge and takes our kodo calves. Kill the pack leader, and Gorth will give you his best.",
      camp: [{ code: "nwlf", count: 3 }, { code: "nwlg", count: 1 }],
      objective: { name: "the wolf den", angle: 1150, distance: 3400 },
    },
  },
  {
    hall: "etol", barracks: "eaom", house: "emow", worker: "ewsp", npcName: "Sentinel Ilara", greeting: "Elune guide you",
    chatter: ["The forest whispers of strangers.", "Elune watches over us.", "Keep your arrows ready.", "The moonwell runs clear today."],
    shop: {
      keeper: "Faelin the Dryad", code: "edry",
      wares: [{ code: "pman", name: "a Potion of Mana", cost: 150 }, { code: "gcel", name: "Gloves of Haste", cost: 300 }, { code: "prvt", name: "a Periapt of Vitality", cost: 350 }],
    },
    quest: {
      title: "Murlocs at the Moonwell", giver: "Warden Thalyss", foes: "murlocs",
      ask: "Murlocs foul the moonwell shore. Drive them back into the water, and Ilara will trust you with her finest.",
      camp: [{ code: "nmrl", count: 3 }, { code: "nmrr", count: 1 }],
      objective: { name: "the moonwell shore", angle: 2450, distance: 3200 },
    },
  },
  {
    hall: "unpl", barracks: "usep", house: "uzig", worker: "uaco", npcName: "Deathlord Varkus", greeting: "The Scourge endures",
    chatter: ["The Scourge never sleeps.", "Our master's will be done.", "Fresh corpses for the Necropolis.", "Bow before the Lich King."],
    shop: {
      keeper: "Acolyte Varn", code: "uaco",
      wares: [{ code: "pman", name: "a Potion of Mana", cost: 150 }, { code: "rnec", name: "a Rod of Necromancy", cost: 200 }, { code: "odef", name: "an Orb of Darkness", cost: 350 }],
    },
    quest: {
      title: "Kobold Tunnels", giver: "Acolyte Mordis", foes: "kobolds",
      ask: "Kobolds tunnel under our blight and gnaw at the crypts. Collapse their tunnels, and Varkus will raise his abominations for you.",
      camp: [{ code: "nkob", count: 3 }, { code: "nkol", count: 1 }],
      objective: { name: "the kobold tunnels", angle: 3350, distance: 3200 },
    },
  },
];

/** A race's soldiers of a role, its army's or its veterans': their unit type and what two of them are called. */
function soldiersOf(soldiers: readonly Soldier[], role: "melee" | "ranged"): { readonly code: string; readonly plural: string } {
  const soldier = soldiers.find((candidate) => candidate.role === role);
  return { code: soldier?.code ?? "", plural: soldier?.plural ?? "soldiers" };
}

function raceAt(raceIndex: number): Race {
  const race = RACES[raceIndex] ?? RACES[0];
  if (race === undefined) throw new Error("the roster has no races");
  return race;
}

function lookAt(raceIndex: number): (typeof LOOKS)[number] {
  const look = LOOKS[raceIndex] ?? LOOKS[0];
  if (look === undefined) throw new Error("the bases have no looks");
  return look;
}

/** A `recruit` effect for two of a base's soldiers or veterans of a role. */
function hire(raceIndex: number, role: "melee" | "ranged", cost: number, veteran: boolean): Effect {
  return veteran ? { kind: "recruit", role, cost, race: raceIndex, veteran: true } : { kind: "recruit", role, cost, race: raceIndex };
}

/**
 * A base's recruiter scene: to a player of its race ("kin", his `raceFlag`
 * set) it gives two melee or two ranged soldiers free; to anyone else it
 * sells them, each choice greyed out without the gold. Once the player has
 * done the base's quest (`veteransFlag`), a last choice shows: the race's
 * veterans, free to kin and dearer to anyone else. After a hire he asks
 * again, until the hero says not now.
 */
export function baseScene(raceIndex: number): Scene {
  const race = raceAt(raceIndex), look = lookAt(raceIndex);
  const melee = soldiersOf(race.army, "melee"), ranged = soldiersOf(race.army, "ranged");
  const veteranMelee = soldiersOf(race.veterans, "melee"), veteranRanged = soldiersOf(race.veterans, "ranged");
  const proven = [{ flag: veteransFlag(race.name) }];
  const kin: Choice[] = [
    { text: `Two ${melee.plural} (free).`, next: "kinMelee" },
    { text: `Two ${ranged.plural} (free).`, next: "kinRanged" },
    { text: "Not now.", next: "later" },
    { text: "Your veterans.", next: "kinVeterans", when: proven, hidden: true },
  ];
  const kinVeterans: Choice[] = [
    { text: `Two ${veteranMelee.plural} (free).`, next: "kinVeteranMelee" },
    { text: `Two ${veteranRanged.plural} (free).`, next: "kinVeteranRanged" },
    { text: "Back.", next: "kinMore" },
  ];
  const paid: Choice[] = [
    { text: `Hire two ${melee.plural} (${BASE_MELEE_COST} gold).`, next: "paidMelee", when: [{ gold: BASE_MELEE_COST }] },
    { text: `Hire two ${ranged.plural} (${BASE_RANGED_COST} gold).`, next: "paidRanged", when: [{ gold: BASE_RANGED_COST }] },
    { text: "Not now.", next: "later" },
    { text: "Your veterans.", next: "paidVeterans", when: proven, hidden: true },
  ];
  const paidVeterans: Choice[] = [
    { text: `Hire two ${veteranMelee.plural} (${VETERAN_MELEE_COST} gold).`, next: "paidVeteranMelee", when: [{ gold: VETERAN_MELEE_COST }] },
    { text: `Hire two ${veteranRanged.plural} (${VETERAN_RANGED_COST} gold).`, next: "paidVeteranRanged", when: [{ gold: VETERAN_RANGED_COST }] },
    { text: "Back.", next: "paidMore" },
  ];
  const nodes: DialogueNode[] = [
    { id: "kin", speaker: "npc", mood: "confirm", text: `${look.greeting}, {hero}! You are one of us. Our soldiers march with you, no coin asked.`, choices: kin },
    { id: "kinMore", speaker: "npc", mood: "question", text: "Who else do you need?", choices: kin },
    { id: "kinMelee", speaker: "npc", mood: "confirm", text: `${melee.plural}, fall in behind {hero}!`, effects: [hire(raceIndex, "melee", 0, false)], next: "kinMore" },
    { id: "kinRanged", speaker: "npc", mood: "confirm", text: `${ranged.plural}, fall in behind {hero}!`, effects: [hire(raceIndex, "ranged", 0, false)], next: "kinMore" },
    { id: "kinVeterans", speaker: "npc", mood: "confirm", important: true, text: "You bled for this camp. Our best are yours.", choices: kinVeterans },
    { id: "kinVeteranMelee", speaker: "npc", mood: "warcry", text: `${veteranMelee.plural}, with {hero}!`, effects: [hire(raceIndex, "melee", 0, true)], next: "kinMore" },
    { id: "kinVeteranRanged", speaker: "npc", mood: "warcry", text: `${veteranRanged.plural}, with {hero}!`, effects: [hire(raceIndex, "ranged", 0, true)], next: "kinMore" },
    { id: "stranger", speaker: "npc", mood: "neutral", text: `You're no ${race.name} of ours, {hero}. But gold speaks every tongue.`, choices: paid },
    { id: "paidMore", speaker: "npc", mood: "question", text: "Anything else, while your purse holds?", choices: paid },
    { id: "paidMelee", speaker: "npc", mood: "confirm", text: "Paid in full. They're yours.", effects: [hire(raceIndex, "melee", BASE_MELEE_COST, false)], next: "paidMore" },
    { id: "paidRanged", speaker: "npc", mood: "confirm", text: "Paid in full. They're yours.", effects: [hire(raceIndex, "ranged", BASE_RANGED_COST, false)], next: "paidMore" },
    { id: "paidVeterans", speaker: "npc", mood: "question", text: "You've earned a look at our veterans. They don't come cheap.", choices: paidVeterans },
    { id: "paidVeteranMelee", speaker: "npc", mood: "confirm", text: "Worth every coin. They're yours.", effects: [hire(raceIndex, "melee", VETERAN_MELEE_COST, true)], next: "paidMore" },
    { id: "paidVeteranRanged", speaker: "npc", mood: "confirm", text: "Worth every coin. They're yours.", effects: [hire(raceIndex, "ranged", VETERAN_RANGED_COST, true)], next: "paidMore" },
    { id: "later", speaker: "hero", mood: "neutral", text: "Not now." },
  ];
  return {
    name: `${race.name} Base`,
    npcName: look.npcName,
    npcCode: melee.code,
    start: "stranger",
    openings: [{ when: [{ flag: raceFlag(race.name) }], start: "kin" }],
    bark: { text: `${look.greeting}! Soldiers here, {hero}.`, mood: "command" },
    nodes,
  };
}

/**
 * A base's quest giver scene: he asks the hero to clear a camp at the base's
 * objective. Taking it (`questFlag`) raises the camp there, marked on the
 * player's minimap; once all of it has fallen, the bounty pays and sets
 * `veteransFlag`, and the base's recruiter offers its veterans. Coming back,
 * he hurries the hero on, or thanks him.
 */
export function baseQuestScene(raceIndex: number): Scene {
  const race = raceAt(raceIndex), look = lookAt(raceIndex);
  const { quest } = look;
  const tag = `base${race.name}`;
  const fights: Effect[] = quest.camp.map((group, index) => (index === 0
    ? { kind: "fight", code: group.code, count: group.count, at: "objective", tag, bounty: { gold: BASE_QUEST_GOLD, flag: veteransFlag(race.name), text: `The ${quest.foes} are beaten: ${BASE_QUEST_GOLD} gold, and ${look.npcName} will give you his veterans now.` } }
    : { kind: "fight", code: group.code, count: group.count, at: "objective", tag }));
  return {
    name: quest.title,
    npcName: quest.giver,
    npcCode: soldiersOf(race.army, "ranged").code,
    start: "ask",
    openings: [
      { when: [{ flag: veteransFlag(race.name) }], start: "thanks" },
      { when: [{ flag: questFlag(race.name) }], start: "hurry" },
    ],
    bark: { text: "{hero}! We could use a hand.", mood: "question" },
    objective: quest.objective,
    nodes: [
      {
        id: "ask", speaker: "npc", mood: "neutral", text: quest.ask,
        choices: [{ text: "I'll deal with them.", next: "accept" }, { text: "Not now.", next: "later" }],
      },
      { id: "accept", speaker: "hero", mood: "confirm", text: `Consider ${quest.objective.name} cleared.`, effects: [{ kind: "flag", flag: questFlag(race.name) }, ...fights] },
      { id: "hurry", speaker: "npc", mood: "angry", text: `The ${quest.foes} still hold ${quest.objective.name}.` },
      { id: "thanks", speaker: "npc", mood: "confirm", text: `${look.npcName} has opened the armory to you, {hero}.` },
      { id: "later", speaker: "hero", mood: "neutral", text: "Not now." },
    ],
  };
}

/**
 * A base's shop scene: the shopkeeper sells his three wares to anyone, each
 * greyed out without the gold, and asks again after a sale, until the hero
 * says not now.
 */
export function baseShopScene(raceIndex: number): Scene {
  const race = raceAt(raceIndex), look = lookAt(raceIndex);
  const { shop } = look;
  const wares: Choice[] = [
    ...shop.wares.map((ware, index) => ({ text: `${ware.name.charAt(0).toUpperCase()}${ware.name.slice(1)} (${ware.cost} gold).`, next: `buy${index}`, when: [{ gold: ware.cost }] })),
    { text: "Not now.", next: "later" },
  ];
  return {
    name: `${race.name} Shop`,
    npcName: shop.keeper,
    npcCode: shop.code,
    start: "wares",
    bark: { text: "Potions and steel, {hero}! Come and look.", mood: "question" },
    nodes: [
      { id: "wares", speaker: "npc", mood: "neutral", text: "Take a look, {hero}. Coin up front.", choices: wares },
      { id: "more", speaker: "npc", mood: "question", text: "Anything else?", choices: wares },
      ...shop.wares.map((ware, index): DialogueNode => ({
        id: `buy${index}`, speaker: "npc", mood: "confirm", text: "A fine choice.", effects: [{ kind: "item", code: ware.code, name: ware.name, cost: ware.cost }], next: "more",
      })),
      { id: "later", speaker: "hero", mood: "neutral", text: "Not now." },
    ],
  };
}

/** A base's hall behind its recruiter, its barracks beside the hall, two melee and two ranged guards in front, and its quest giver at his side. */
function baseOf(raceIndex: number, angle: number): Base {
  const race = raceAt(raceIndex), look = lookAt(raceIndex);
  const melee = soldiersOf(race.army, "melee").code, ranged = soldiersOf(race.army, "ranged").code;
  return {
    race: raceIndex,
    angle,
    distance: 2000,
    buildings: [
      { code: look.hall, out: 450, side: 0 }, { code: look.barracks, out: 300, side: 450 },
      { code: look.house, out: 300, side: -480 }, { code: look.house, out: 650, side: -380 },
    ],
    guards: [
      { code: melee, out: -150, side: 200 }, { code: melee, out: -150, side: -200 },
      { code: ranged, out: 100, side: 300 }, { code: ranged, out: 100, side: -300 },
    ],
    scene: baseScene(raceIndex),
    giver: { code: ranged, out: 50, side: -420 },
    shop: { code: look.shop.code, out: 50, side: 420 },
    shopScene: baseShopScene(raceIndex),
    quest: look.quest,
    questScene: baseQuestScene(raceIndex),
    life: {
      workers: [
        { code: look.worker, out: 260, side: -60, to: { out: 180, side: -380 } },
        { code: look.worker, out: 260, side: 60, to: { out: 160, side: 380 } },
        { code: look.worker, out: 280, side: 0, to: { out: 520, side: -260 } },
      ],
      patrols: [
        { code: melee, out: -220, side: 600, to: { out: -220, side: -600 } },
        { code: melee, out: -320, side: -600, to: { out: -320, side: 600 } },
      ],
      sparring: [{ code: melee, out: 60, side: 620 }, { code: melee, out: 60, side: 760 }],
      chatter: look.chatter,
    },
  };
}

/** The four bases, 2000 from the center in the gaps between the quest sites: Human, Orc, Night Elf and Undead. */
export const BASES: readonly Base[] = [baseOf(0, 450), baseOf(1, 1350), baseOf(2, 2250), baseOf(3, 3150)];

/** Where a base stands: its angle and distance from the playable area's center. */
export function baseSpot(center: Point, base: Base): Point {
  return offset(center.x, center.y, base.angle, base.distance, 0);
}

/** A race's base, by its index into RACES (the first base for one out of range). */
export function baseOfRace(race: number): Base {
  const base = BASES.find((candidate) => candidate.race === race) ?? BASES[0];
  if (base === undefined) throw new Error("the map has no bases");
  return base;
}

/** How far to the side a player stands from the others spawning at the same place: four lanes 160 apart, by player id. */
function lane(id: number): number {
  return (floorMod(id, 4) * 2 - 3) * 80;
}

/**
 * Where a race hero spawns: 350 in front of his race's base's recruiter,
 * toward the map's center, in his own lane, so players of one race spawn
 * side by side.
 */
export function baseSpawn(center: Point, base: Base, id: number): Point {
  const spot = baseSpot(center, base);
  return offset(spot.x, spot.y, base.angle + 1800, 350, lane(id));
}

/** The tavern nearest to a point (a tavern hero's start location), or undefined with none. */
export function nearestTavern(taverns: readonly Point[], to: Point): Point | undefined {
  let best: Point | undefined;
  for (const tavern of taverns) if (best === undefined || distanceSquared(tavern, to) < distanceSquared(best, to)) best = tavern;
  return best;
}

/**
 * Where a tavern hero spawns: 200 from the tavern toward the map's center and
 * off to the side of the sergeant, who stands 300 out, in a row of four spots
 * 120 apart, by player id.
 */
export function tavernSpawn(center: Point, tavern: Point, id: number): Point {
  return offset(tavern.x, tavern.y, atan2Tenths(center.y - tavern.y, center.x - tavern.x), 200, -(250 + floorMod(id, 4) * 120));
}
