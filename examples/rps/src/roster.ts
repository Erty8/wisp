// What a player can pick at the start of an RPS match: one of Warcraft's four
// races, one of its four heroes, and the retinue that race brings. A hero's
// skills are listed in learning order, three basic skills then the ultimate,
// as SkillRanks counts them; each says how the spell bar casts it.
import { type Role, fourCC } from "./rules";

/**
 * How the spell bar casts a skill: at the Tab target ("enemy"), on the most
 * hurt squad member ("ally"), on the hero ("self"), at the Tab target's spot
 * or ahead of the hero ("point"), at once ("instant"), or not at all
 * ("passive", an aura or an on-hit effect).
 */
export type Targeting = "enemy" | "ally" | "self" | "point" | "instant" | "passive";

export interface Skill {
  readonly name: string;
  /** The ability's rawcode, as a four-letter string. */
  readonly code: string;
  readonly order: string;
  readonly targeting: Targeting;
  /** The icon's name: ReplaceableTextures\CommandButtons\BTN<icon>.blp, DISBTN<icon> in CommandButtonsDisabled. */
  readonly icon: string;
}

export interface Hero {
  readonly name: string;
  readonly code: string;
  /** The hero's portrait icon's name, as for skills. */
  readonly icon: string;
  readonly skills: readonly [Skill, Skill, Skill, Skill];
  /** A ranged hero's missile model: his swings fire it as an aimed shot instead of striking a cone. */
  readonly missile?: string;
}

export interface Soldier {
  readonly code: string;
  readonly role: Role;
  /** What two of them are called, for the recruiter's offer: "Footmen". */
  readonly plural: string;
}

export interface Race {
  readonly name: string;
  readonly heroes: readonly [Hero, Hero, Hero, Hero];
  /** The soldiers a hero can recruit: two melee and two ranged, 10 food, 15 with the hero. */
  readonly army: readonly Soldier[];
}

const skill = (name: string, code: string, order: string, targeting: Targeting, icon: string): Skill => ({ name, code, order, targeting, icon });
const pair = (code: string, role: Role, plural: string): Soldier[] => [{ code, role, plural }, { code, role, plural }];

export const RACES: readonly Race[] = [
  {
    name: "Human",
    heroes: [
      { name: "Paladin", code: "Hpal", icon: "HeroPaladin", skills: [
        skill("Holy Light", "AHhb", "holybolt", "ally", "HolyBolt"),
        skill("Divine Shield", "AHds", "divineshield", "instant", "DivineIntervention"),
        skill("Devotion Aura", "AHad", "", "passive", "Devotion"),
        skill("Resurrection", "AHre", "resurrection", "instant", "Resurrection"),
      ] },
      { name: "Archmage", code: "Hamg", icon: "HeroArchMage", missile: "Abilities\\Weapons\\SorceressMissile\\SorceressMissile.mdl", skills: [
        skill("Blizzard", "AHbz", "blizzard", "point", "Blizzard"),
        skill("Water Elemental", "AHwe", "waterelemental", "instant", "SummonWaterElemental"),
        skill("Brilliance Aura", "AHab", "", "passive", "Brilliance"),
        skill("Mass Teleport", "AHmt", "massteleport", "ally", "MassTeleport"),
      ] },
      { name: "Mountain King", code: "Hmkg", icon: "HeroMountainKing", skills: [
        skill("Storm Bolt", "AHtb", "thunderbolt", "enemy", "StormBolt"),
        skill("Thunder Clap", "AHtc", "thunderclap", "instant", "Thunderclap"),
        skill("Bash", "AHbh", "", "passive", "Bash"),
        skill("Avatar", "AHav", "avatar", "instant", "Avatar"),
      ] },
      { name: "Blood Mage", code: "Hblm", icon: "HeroBloodElfPrince", missile: "Abilities\\Weapons\\BloodElfMissile\\BloodElfMissile.mdl", skills: [
        skill("Flame Strike", "AHfs", "flamestrike", "point", "WallOfFire"),
        skill("Banish", "AHbn", "banish", "enemy", "Banish"),
        skill("Siphon Mana", "AHdr", "drain", "enemy", "ManaDrain"),
        skill("Phoenix", "AHpx", "summonphoenix", "instant", "MarkOfFire"),
      ] },
    ],
    army: [...pair("hfoo", "melee", "Footmen"), ...pair("hrif", "ranged", "Riflemen")],
  },
  {
    name: "Orc",
    heroes: [
      { name: "Blademaster", code: "Obla", icon: "HeroBlademaster", skills: [
        skill("Wind Walk", "AOwk", "windwalk", "instant", "WindWalkOn"),
        skill("Mirror Image", "AOmi", "mirrorimage", "instant", "MirrorImage"),
        skill("Critical Strike", "AOcr", "", "passive", "CriticalStrike"),
        skill("Bladestorm", "AOww", "whirlwind", "instant", "Whirlwind"),
      ] },
      { name: "Far Seer", code: "Ofar", icon: "HeroFarseer", missile: "Abilities\\Weapons\\FarseerMissile\\FarseerMissile.mdl", skills: [
        skill("Chain Lightning", "AOcl", "chainlightning", "enemy", "ChainLightning"),
        skill("Far Sight", "AOfs", "farsight", "point", "FarSight"),
        skill("Feral Spirit", "AOsf", "spiritwolf", "instant", "SpiritWolf"),
        skill("Earthquake", "AOeq", "earthquake", "point", "Earthquake"),
      ] },
      { name: "Tauren Chieftain", code: "Otch", icon: "HeroTaurenChieftain", skills: [
        skill("Shockwave", "AOsh", "shockwave", "point", "Shockwave"),
        skill("War Stomp", "AOws", "stomp", "instant", "WarStomp"),
        skill("Endurance Aura", "AOae", "", "passive", "Command"),
        skill("Reincarnation", "AOre", "", "passive", "Reincarnation"),
      ] },
      { name: "Shadow Hunter", code: "Oshd", icon: "ShadowHunter", missile: "Abilities\\Weapons\\WitchDoctorMissile\\WitchDoctorMissile.mdl", skills: [
        skill("Healing Wave", "AOhw", "healingwave", "ally", "HealingWave"),
        skill("Hex", "AOhx", "hex", "enemy", "Hex"),
        skill("Serpent Ward", "AOsw", "ward", "point", "SerpentWard"),
        skill("Big Bad Voodoo", "AOvd", "voodoo", "instant", "BigBadVoodooSpell"),
      ] },
    ],
    army: [...pair("ogru", "melee", "Grunts"), ...pair("ohun", "ranged", "Headhunters")],
  },
  {
    name: "Night Elf",
    heroes: [
      { name: "Demon Hunter", code: "Edem", icon: "HeroDemonHunter", skills: [
        skill("Mana Burn", "AEmb", "manaburn", "enemy", "ManaBurn"),
        skill("Immolation", "AEim", "immolation", "instant", "ImmolationOn"),
        skill("Evasion", "AEev", "", "passive", "Evasion"),
        skill("Metamorphosis", "AEme", "metamorphosis", "instant", "Metamorphosis"),
      ] },
      { name: "Keeper of the Grove", code: "Ekee", icon: "KeeperOfTheGrove", missile: "Abilities\\Weapons\\KeeperGroveMissile\\KeeperGroveMissile.mdl", skills: [
        skill("Entangling Roots", "AEer", "entanglingroots", "enemy", "EntanglingRoots"),
        skill("Force of Nature", "AEfn", "forceofnature", "point", "Ent"),
        skill("Thorns Aura", "AEah", "", "passive", "Thorns"),
        skill("Tranquility", "AEtq", "tranquility", "instant", "Tranquility"),
      ] },
      { name: "Priestess of the Moon", code: "Emoo", icon: "PriestessOfTheMoon", missile: "Abilities\\Weapons\\MoonPriestessMissile\\MoonPriestessMissile.mdl", skills: [
        skill("Scout", "AEst", "scout", "instant", "Scout"),
        skill("Searing Arrows", "AHfa", "flamingarrows", "instant", "SearingArrowsOn"),
        skill("Trueshot Aura", "AEar", "", "passive", "TrueShot"),
        skill("Starfall", "AEsf", "starfall", "instant", "Starfall"),
      ] },
      { name: "Warden", code: "Ewar", icon: "HeroWarden", skills: [
        skill("Fan of Knives", "AEfk", "fanofknives", "instant", "FanOfKnives"),
        skill("Blink", "AEbl", "blink", "point", "Blink"),
        skill("Shadow Strike", "AEsh", "shadowstrike", "enemy", "ShadowStrike"),
        skill("Vengeance", "AEsv", "vengeance", "instant", "SpiritOfVengeance"),
      ] },
    ],
    army: [...pair("esen", "melee", "Huntresses"), ...pair("earc", "ranged", "Archers")],
  },
  {
    name: "Undead",
    heroes: [
      { name: "Death Knight", code: "Udea", icon: "HeroDeathKnight", skills: [
        skill("Death Coil", "AUdc", "deathcoil", "enemy", "DeathCoil"),
        skill("Death Pact", "AUdp", "deathpact", "ally", "DeathPact"),
        skill("Unholy Aura", "AUau", "", "passive", "UnholyAura"),
        skill("Animate Dead", "AUan", "animatedead", "instant", "AnimateDead"),
      ] },
      { name: "Lich", code: "Ulic", icon: "LichVersion2", missile: "Abilities\\Weapons\\LichMissile\\LichMissile.mdl", skills: [
        skill("Frost Nova", "AUfn", "frostnova", "enemy", "Glacier"),
        skill("Frost Armor", "AUfu", "frostarmor", "self", "FrostArmor"),
        skill("Dark Ritual", "AUdr", "darkritual", "ally", "DarkRitual"),
        skill("Death and Decay", "AUdd", "deathanddecay", "point", "DeathAndDecay"),
      ] },
      { name: "Dreadlord", code: "Udre", icon: "HeroDreadLord", skills: [
        skill("Carrion Swarm", "AUcs", "carrionswarm", "point", "CarrionSwarm"),
        skill("Sleep", "AUsl", "sleep", "enemy", "Sleep"),
        skill("Vampiric Aura", "AUav", "", "passive", "VampiricAura"),
        skill("Inferno", "AUin", "inferno", "point", "Infernal"),
      ] },
      { name: "Crypt Lord", code: "Ucrl", icon: "HeroCryptLord", skills: [
        skill("Impale", "AUim", "impale", "point", "Impale"),
        skill("Spiked Carapace", "AUts", "", "passive", "ThornShield"),
        skill("Carrion Beetles", "AUcb", "carrionscarabs", "instant", "CarrionScarabs"),
        skill("Locust Swarm", "AUls", "locustswarm", "instant", "LocustSwarm"),
      ] },
    ],
    army: [...pair("ugho", "melee", "Ghouls"), ...pair("ucry", "ranged", "Crypt Fiends")],
  },
];

/** The pick a player who hasn't chosen in time gets: the Human Mountain King. */
export const DEFAULT_PICK = { race: 0, hero: 2 } as const;

/** Seconds players have to pick before they get DEFAULT_PICK. */
export const PICK_SECONDS = 30;

export function heroOf(race: number, hero: number): Hero {
  const chosen = RACES[race]?.heroes[hero];
  const fallback = RACES[DEFAULT_PICK.race]?.heroes[DEFAULT_PICK.hero];
  if (chosen !== undefined) return chosen;
  if (fallback === undefined) throw new Error("the roster has no default hero");
  return fallback;
}

export function raceOf(race: number): Race {
  const chosen = RACES[race] ?? RACES[DEFAULT_PICK.race];
  if (chosen === undefined) throw new Error("the roster has no default race");
  return chosen;
}

export const icon = (name: string) => `ReplaceableTextures\\CommandButtons\\BTN${name}.blp`;
export const disabledIcon = (name: string) => `ReplaceableTextures\\CommandButtonsDisabled\\DISBTN${name}.blp`;
export const rawcode = (code: string) => fourCC(code);
