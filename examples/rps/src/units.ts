// The RPS map's unit profiles: one entry per unit type the map creates, by
// rawcode, holding everything the map knows about it beyond Warcraft's own
// data. Adding a unit type is adding its profile here; a test fails, naming
// the rawcode, for any unit type the map uses without one.
//
// - `name`: what to call it.
// - `life`: its starting life, which the headless journey gives it.
// - `voice`: where its voice recordings may be, as file prefixes
//   (Units\Human\Footman\Footman, to which a kind and a take are added:
//   FootmanWhat1.wav), tried in order; the map asks the game which one has
//   recordings, the first time it needs the voice. Without any, it is silent.
// - `talk`, `gestures`: its own talk animation and mood gestures, in place of
//   the map's ("stand talk", `gestureOf`).
// - `face`: how high its face is above the ground, where a scene's camera
//   looks when it speaks, for a type taller or shorter than the map's 60.
import { type Mood, FACE_HEIGHT, TALK_ANIMATION, gestureOf } from "./dialogue";

export interface UnitProfile {
  readonly name: string;
  readonly life: number;
  readonly voice?: readonly string[];
  readonly talk?: string;
  readonly gestures?: Partial<Record<Mood, string>>;
  readonly face?: number;
}

/** A standard sound set's file prefix: Units\<race>\<set>\<set>. */
const set = (race: string, name: string) => `Units\\${race}\\${name}\\${name}`;

export const UNITS: Readonly<Record<string, UnitProfile>> = {
  // Heroes.
  Hpal: { name: "Paladin", life: 650, voice: [set("Human", "HeroPaladin")], face: 85 },
  Hamg: { name: "Archmage", life: 450, voice: [set("Human", "HeroArchMage")], face: 130 },
  Hmkg: { name: "Mountain King", life: 700, voice: [set("Human", "HeroMountainKing")] },
  Hblm: { name: "Blood Mage", life: 500, voice: [set("Human", "HeroBloodElf")], face: 85 },
  Obla: { name: "Blademaster", life: 600, voice: [set("Orc", "HeroBladeMaster")], face: 85 },
  Ofar: { name: "Far Seer", life: 500, voice: [set("Orc", "HeroFarSeer")], face: 120 },
  Otch: { name: "Tauren Chieftain", life: 750, voice: [set("Orc", "HeroTaurenChieftain")], face: 150 },
  Oshd: { name: "Shadow Hunter", life: 500, voice: [set("Orc", "HeroShadowHunter")], face: 90 },
  Edem: { name: "Demon Hunter", life: 600, voice: [set("NightElf", "HeroDemonHunter")], face: 95 },
  Ekee: { name: "Keeper of the Grove", life: 500, voice: [set("NightElf", "HeroKeeperOfTheGrove")], face: 140 },
  Emoo: { name: "Priestess of the Moon", life: 550, voice: [set("NightElf", "HeroMoonPriestess")], face: 130 },
  Ewar: { name: "Warden", life: 600, voice: [set("NightElf", "HeroWarden")], face: 85 },
  Udea: { name: "Death Knight", life: 650, voice: [set("Undead", "HeroDeathKnight")], face: 130 },
  Ulic: { name: "Lich", life: 450, voice: [set("Undead", "HeroLich")], face: 110 },
  Udre: { name: "Dreadlord", life: 600, voice: [set("Undead", "HeroDreadLord")], face: 120 },
  Ucrl: { name: "Crypt Lord", life: 750, voice: [set("Undead", "HeroCryptLord")], face: 90 },
  // Soldiers the races recruit.
  hfoo: { name: "Footman", life: 420, voice: [set("Human", "Footman")], face: 70 },
  hrif: { name: "Rifleman", life: 535, voice: [set("Human", "Rifleman")] },
  ogru: { name: "Grunt", life: 700, voice: [set("Orc", "Grunt")], face: 85 },
  ohun: { name: "Headhunter", life: 350, voice: [set("Orc", "HeadHunter")] },
  esen: { name: "Huntress", life: 600, voice: [set("NightElf", "Huntress")], face: 120 },
  earc: { name: "Archer", life: 310, voice: [set("NightElf", "Archer")] },
  ugho: { name: "Ghoul", life: 340, voice: [set("Undead", "Ghoul")] },
  ucry: { name: "Crypt Fiend", life: 550, voice: [set("Undead", "CryptFiend")] },
  // NPCs and their companies.
  hmpr: { name: "Priest", life: 290, voice: [set("Human", "Priest")], face: 70 },
  hsor: { name: "Sorceress", life: 400, voice: [set("Human", "Sorceress")], face: 70 },
  hkni: { name: "Knight", life: 835, voice: [set("Human", "Knight")], face: 130 },
  hpea: { name: "Peasant", life: 220, voice: [set("Human", "Peasant")] },
  hspt: { name: "Spellbreaker", life: 600, voice: [set("Human", "BloodElfSpellBreaker"), set("Human", "SpellBreaker"), set("Human", "Spellbreaker")], face: 80 },
  nomg: { name: "Ogre Magi", life: 1000, voice: [set("Creeps", "OgreMagi"), set("Creeps", "Ogre"), set("Creeps", "OgreLord")], face: 210 },
  nogr: { name: "Ogre", life: 600, voice: [set("Creeps", "Ogre")], face: 170 },
  // Creeps, summons and buildings: they fight or stand, and don't speak.
  ngno: { name: "Gnoll", life: 240 },
  ngnb: { name: "Gnoll Brute", life: 330 },
  nftr: { name: "Forest Troll", life: 240, voice: [set("Creeps", "ForestTroll")] },
  nfsp: { name: "Forest Troll Shadow Priest", life: 350 },
  nftk: { name: "Forest Troll Warlord", life: 900 },
  hwat: { name: "Water Elemental", life: 525 },
  hwt3: { name: "Greater Water Elemental", life: 900 },
  ncop: { name: "Outpost", life: 500 },
};

/** Where a unit type's voice may be, in the order to try: none for a type that doesn't speak, or that has no profile. */
export function voiceCandidates(code: string): readonly string[] {
  return UNITS[code]?.voice ?? [];
}

/** The animation a unit type talks with: its own, else the map's. */
export function talkAnimation(code: string): string {
  return UNITS[code]?.talk ?? TALK_ANIMATION;
}

/** How high a unit type's face is above the ground: its own, else the map's (`FACE_HEIGHT`). */
export function faceHeight(code: string): number {
  return UNITS[code]?.face ?? FACE_HEIGHT;
}

/** The gesture a unit type makes for a mood: its own, else the map's (`gestureOf`). */
export function gestureFor(code: string, mood: Mood): string | undefined {
  return UNITS[code]?.gestures?.[mood] ?? gestureOf(mood);
}
