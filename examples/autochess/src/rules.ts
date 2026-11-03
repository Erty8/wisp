// The autochess rules: the unit pool, the shop, the economy, merging three
// copies into a stronger one, and the creep waves. Pure integer functions, so
// every client computes the same game and the tests run in Bun and Lua alike.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";

export type Race = "Human" | "Orc" | "Undead" | "Night Elf";
export type Role = "Warrior" | "Ranger";
export type Trait = Race | Role;

export interface Kind {
  readonly name: string;
  /** The unit's rawcode, its four letters read as a big-endian integer. */
  readonly id: number;
  readonly code: string;
  readonly cost: number;
  readonly race: Race;
  readonly role: Role;
}

export const POOL: readonly Kind[] = [
  { name: "Footman", id: 1751543663, code: "hfoo", cost: 1, race: "Human", role: "Warrior" },
  { name: "Grunt", id: 1869050485, code: "ogru", cost: 1, race: "Orc", role: "Warrior" },
  { name: "Ghoul", id: 1969711215, code: "ugho", cost: 1, race: "Undead", role: "Warrior" },
  { name: "Archer", id: 1700885091, code: "earc", cost: 1, race: "Night Elf", role: "Ranger" },
  { name: "Rifleman", id: 1752328550, code: "hrif", cost: 1, race: "Human", role: "Ranger" },
  { name: "Headhunter", id: 1869116782, code: "ohun", cost: 2, race: "Orc", role: "Ranger" },
  { name: "Crypt Fiend", id: 1969451641, code: "ucry", cost: 2, race: "Undead", role: "Ranger" },
  { name: "Huntress", id: 1702061422, code: "esen", cost: 2, race: "Night Elf", role: "Ranger" },
  { name: "Raider", id: 1869767017, code: "orai", cost: 2, race: "Orc", role: "Warrior" },
  { name: "Mortar Team", id: 1752003693, code: "hmtm", cost: 2, race: "Human", role: "Ranger" },
  { name: "Knight", id: 1751871081, code: "hkni", cost: 3, race: "Human", role: "Warrior" },
  { name: "Tauren", id: 1869898101, code: "otau", cost: 3, race: "Orc", role: "Warrior" },
  { name: "Abomination", id: 1969316463, code: "uabo", cost: 3, race: "Undead", role: "Warrior" },
  { name: "Mountain Giant", id: 1701672039, code: "emtg", cost: 3, race: "Night Elf", role: "Warrior" },
];

/** What a trait adds to each unit that has it. `haste` 1 attacks 25% sooner, 2 attacks 37.5% sooner. */
export interface Bonus {
  readonly armor: number;
  readonly lifePercent: number;
  readonly damagePercent: number;
  readonly haste: number;
}

const NO_BONUS: Bonus = { armor: 0, lifePercent: 0, damagePercent: 0, haste: 0 };

interface TraitTier {
  readonly count: number;
  readonly text: string;
  readonly bonus: Bonus;
}

/** Each trait's tiers, lowest first: different units with the trait on the board unlock them. */
export const TRAITS: readonly (readonly [Trait, readonly TraitTier[]])[] = [
  ["Human", [
    { count: 2, text: "+3 armor", bonus: { ...NO_BONUS, armor: 3 } },
    { count: 3, text: "+6 armor", bonus: { ...NO_BONUS, armor: 6 } },
  ]],
  ["Orc", [
    { count: 2, text: "+20% life", bonus: { ...NO_BONUS, lifePercent: 20 } },
    { count: 3, text: "+40% life", bonus: { ...NO_BONUS, lifePercent: 40 } },
  ]],
  ["Undead", [
    { count: 2, text: "+20% damage", bonus: { ...NO_BONUS, damagePercent: 20 } },
    { count: 3, text: "+45% damage", bonus: { ...NO_BONUS, damagePercent: 45 } },
  ]],
  ["Night Elf", [
    { count: 2, text: "attack 25% sooner", bonus: { ...NO_BONUS, haste: 1 } },
    { count: 3, text: "attack 37.5% sooner", bonus: { ...NO_BONUS, haste: 2 } },
  ]],
  ["Warrior", [
    { count: 2, text: "+2 armor", bonus: { ...NO_BONUS, armor: 2 } },
    { count: 4, text: "+5 armor", bonus: { ...NO_BONUS, armor: 5 } },
  ]],
  ["Ranger", [
    { count: 2, text: "+15% damage", bonus: { ...NO_BONUS, damagePercent: 15 } },
    { count: 4, text: "+35% damage", bonus: { ...NO_BONUS, damagePercent: 35 } },
  ]],
];

export interface ActiveTrait {
  readonly trait: Trait;
  /** Different units with the trait. */
  readonly count: number;
  /** The highest tier reached, or undefined below the first. */
  readonly tier: TraitTier | undefined;
  readonly tiers: readonly TraitTier[];
}

/** Every trait the board's units have, counting each kind once, as autochess does. */
export function activeTraits(kinds: readonly number[]): ActiveTrait[] {
  const distinct = kinds.filter((kind, index) => kinds.indexOf(kind) === index);
  const active: ActiveTrait[] = [];
  for (const [trait, tiers] of TRAITS) {
    const count = distinct.filter((kind) => kindAt(kind).race === trait || kindAt(kind).role === trait).length;
    if (count === 0) continue;
    let tier: TraitTier | undefined;
    for (const candidate of tiers) if (count >= candidate.count) tier = candidate;
    active.push({ trait, count, tier, tiers });
  }
  return active;
}

/** The sum of the reached tiers' bonuses that apply to `kind`. */
export function bonusFor(kind: number, active: readonly ActiveTrait[]): Bonus {
  let bonus = NO_BONUS;
  for (const { trait, tier } of active) {
    if (tier === undefined || (kindAt(kind).race !== trait && kindAt(kind).role !== trait)) continue;
    bonus = {
      armor: bonus.armor + tier.bonus.armor,
      lifePercent: bonus.lifePercent + tier.bonus.lifePercent,
      damagePercent: bonus.damagePercent + tier.bonus.damagePercent,
      haste: bonus.haste + tier.bonus.haste,
    };
  }
  return bonus;
}

/** One line per trait: "Human 2/3: +3 armor", or the next goal below the first tier. */
export function traitLines(active: readonly ActiveTrait[]): string[] {
  return active.map(({ trait, count, tier, tiers }) => {
    const next = tiers.find((candidate) => candidate.count > count);
    const goal = next === undefined ? "" : ` (${next.count}: ${next.text})`;
    return `${trait} ${count}${tier === undefined ? "" : `: ${tier.text}`}${goal}`;
  });
}

/** `value` raised by `percent` percent, rounded down. */
export function raised(value: number, percent: number): number {
  return floorDiv(value * (100 + percent), 100);
}

export interface Square {
  readonly column: number;
  /** 0 to 3 from the south edge of a player's half. */
  readonly row: number;
}

/** A square for each requested one, in order: the request if it's on the half and free, else the nearest free square. */
export function assignSquares(requested: readonly Square[]): Square[] {
  const taken = new Set<number>();
  const assigned: Square[] = [];
  for (const want of requested) {
    const column = Math.min(Math.max(want.column, 0), 7), row = Math.min(Math.max(want.row, 0), 3);
    let found: Square | undefined;
    for (let distance = 0; found === undefined && distance <= 10; distance++) {
      for (let r = 0; r <= 3 && found === undefined; r++) {
        for (let c = 0; c <= 7 && found === undefined; c++) {
          if (Math.abs(c - column) + Math.abs(r - row) === distance && !taken.has(r * 8 + c)) found = { column: c, row: r };
        }
      }
    }
    if (found === undefined) break;
    taken.add(found.row * 8 + found.column);
    assigned.push(found);
  }
  return assigned;
}

/** Rounds 1 to 3 and every fifth round are against creeps; the rest against another player's board when one is left. */
export function isCreepRound(round: number): boolean {
  return round <= 3 || floorMod(round, 5) === 0;
}

export const kindAt = (index: number): Kind => {
  const kind = POOL[index];
  if (kind === undefined) throw new Error(`no unit kind ${index}`);
  return kind;
};

export const SHOP_SIZE = 5;
export const BENCH_SIZE = 8;
export const MAX_LEVEL = 8;
export const MAX_STAR = 3;
export const REROLL_COST = 2;
export const START_GOLD = 5;
export const START_LEVEL = 2;
export const START_HEALTH = 100;
export const ROUND_INCOME = 5;
export const LAST_ROUND = 30;

/** Percent chance of a cost-1, cost-2 and cost-3 unit in each shop slot at `level`. */
export function shopOdds(level: number): readonly [number, number, number] {
  if (level <= 2) return [100, 0, 0];
  if (level <= 4) return [70, 30, 0];
  if (level <= 6) return [50, 35, 15];
  return [35, 40, 25];
}

/** `random(low, high)` returns an integer in [low, high]. */
export type Random = (low: number, high: number) => number;

/** The next state of the match's random sequence, in [0, 65536]: small products, so 32-bit Lua and Bun agree. */
export function nextSeed(seed: number): number {
  return floorMod(seed * 75 + 74, 65537);
}

/** An integer in [low, high] from a seed that nextSeed made. */
export function drawFrom(seed: number, low: number, high: number): number {
  return low + floorMod(seed, high - low + 1);
}

/** Five pool indices for a new shop at `level`. */
export function rollShop(level: number, random: Random): number[] {
  const [one, two] = shopOdds(level);
  const offers: number[] = [];
  for (let slot = 0; slot < SHOP_SIZE; slot++) {
    const roll = random(1, 100);
    const cost = roll <= one ? 1 : roll <= one + two ? 2 : 3;
    const kinds: number[] = [];
    for (let index = 0; index < POOL.length; index++) if (kindAt(index).cost === cost) kinds.push(index);
    offers.push(kinds[random(0, kinds.length - 1)] ?? 0);
  }
  return offers;
}

/** Gold at the start of a round: the base income and 1 interest per 10 saved, at most 5. */
export function income(gold: number): number {
  return ROUND_INCOME + Math.min(floorDiv(gold, 10), 5);
}

/** Gold to go from `level` to the next one. */
export function levelCost(level: number): number {
  return 4 * level;
}

/** How many copies of a 1-star unit a unit of `star` stars is worth. */
export function copies(star: number): number {
  return star <= 1 ? 1 : star === 2 ? 3 : 9;
}

/** Gold back for selling a unit. */
export function sellValue(cost: number, star: number): number {
  return cost * copies(star);
}

/** A unit's life or damage at `star` stars from its 1-star value, rounded down. */
export function starred(value: number, star: number): number {
  return star <= 1 ? value : star === 2 ? floorDiv(value * 18, 10) : floorDiv(value * 32, 10);
}

export interface Piece {
  readonly kind: number;
  readonly star: number;
}

/** The first three pieces of one kind and star below the top, as indices into `pieces`, or undefined. */
export function findMerge(pieces: readonly Piece[]): readonly [number, number, number] | undefined {
  for (let first = 0; first < pieces.length; first++) {
    const piece = pieces[first];
    if (piece === undefined || piece.star >= MAX_STAR) continue;
    const same: number[] = [first];
    for (let other = first + 1; other < pieces.length && same.length < 3; other++) {
      const candidate = pieces[other];
      if (candidate !== undefined && candidate.kind === piece.kind && candidate.star === piece.star) same.push(other);
    }
    const [a, b, c] = same;
    if (a !== undefined && b !== undefined && c !== undefined) return [a, b, c];
  }
  return undefined;
}

export interface Placed extends Piece {
  /** Board column, 0 to 7 from west to east. */
  readonly column: number;
  /** Row on the creeps' half, 0 (middle of the board) to 3 (north edge). */
  readonly row: number;
}

/** The creeps of `round`: more of them, dearer and with more stars as rounds go by. */
export function waveFor(round: number): Placed[] {
  const count = Math.min(2 + floorDiv(round, 2), 8);
  const cost = round < 6 ? 1 : round < 14 ? 2 : 3;
  const star = round < 10 ? 1 : round < 22 ? 2 : 3;
  const kinds: number[] = [];
  for (let index = 0; index < POOL.length; index++) if (kindAt(index).cost === cost) kinds.push(index);
  const wave: Placed[] = [];
  for (let slot = 0; slot < count; slot++) {
    wave.push({
      kind: kinds[floorMod(round + slot * 3, kinds.length)] ?? 0,
      star,
      column: floorMod(2 * slot, 8) + floorDiv(slot, 4),
      row: 1 + floorDiv(slot, 4),
    });
  }
  return wave;
}

/** Health a player loses to `survivors` creeps left standing in `round`. */
export function damageFor(survivors: number, round: number): number {
  return survivors === 0 ? 0 : 2 + survivors * (1 + floorDiv(round, 5));
}
