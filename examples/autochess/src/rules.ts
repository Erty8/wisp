// The autochess rules: the unit pool, the shop, the economy, merging three
// copies into a stronger one, and the creep waves. Pure integer functions, so
// every client computes the same game and the tests run in Bun and Lua alike.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";

export interface Kind {
  readonly name: string;
  /** The unit's rawcode, its four letters read as a big-endian integer. */
  readonly id: number;
  readonly code: string;
  readonly cost: number;
}

export const POOL: readonly Kind[] = [
  { name: "Footman", id: 1751543663, code: "hfoo", cost: 1 },
  { name: "Grunt", id: 1869050485, code: "ogru", cost: 1 },
  { name: "Ghoul", id: 1969711215, code: "ugho", cost: 1 },
  { name: "Archer", id: 1700885091, code: "earc", cost: 1 },
  { name: "Rifleman", id: 1752328550, code: "hrif", cost: 1 },
  { name: "Headhunter", id: 1869116782, code: "ohun", cost: 2 },
  { name: "Crypt Fiend", id: 1969451641, code: "ucry", cost: 2 },
  { name: "Huntress", id: 1702061422, code: "esen", cost: 2 },
  { name: "Raider", id: 1869767017, code: "orai", cost: 2 },
  { name: "Mortar Team", id: 1752003693, code: "hmtm", cost: 2 },
  { name: "Knight", id: 1751871081, code: "hkni", cost: 3 },
  { name: "Tauren", id: 1869898101, code: "otau", cost: 3 },
  { name: "Abomination", id: 1969316463, code: "uabo", cost: 3 },
  { name: "Mountain Giant", id: 1701672039, code: "emtg", cost: 3 },
];

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
