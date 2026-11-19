// The RPS map's taverns: tavern heroes belong to no race's base, so they
// spawn at a tavern, where a sellsword hires out mercenaries. A tavern hero's
// first contract is free (`TAVERN_HERO_FLAG`, until `FREE_SELLSWORD_FLAG`);
// every other hire, and every hire by a race hero, is paid.
import type { Choice, DialogueNode, Effect, Scene } from "./dialogue";
import type { Role } from "./rules";

/** The flag a tavern hero's scenes see, set as he spawns, and the one his free contract sets. */
export const TAVERN_HERO_FLAG = "tavernHero";
export const FREE_SELLSWORD_FLAG = "freeSellsword";

/** A pair of mercenaries the sellsword hires out: their unit type, what two of them are called, their role in the party and their price. */
export interface Sellsword {
  readonly code: string;
  readonly plural: string;
  readonly role: Role;
  readonly cost: number;
}

export const SELLSWORDS: readonly Sellsword[] = [
  { code: "nogr", plural: "Ogres", role: "melee", cost: 120 },
  { code: "nftr", plural: "Forest Trolls", role: "ranged", cost: 100 },
  { code: "nfsp", plural: "Shadow Priests", role: "ranged", cost: 110 },
];

/** A `recruit` effect for two of a sellsword's mercenaries at a price. */
const hire = (sellsword: Sellsword, cost: number): Effect =>
  ({ kind: "recruit", role: sellsword.role, cost, soldier: { code: sellsword.code, plural: sellsword.plural } });

const PAID: readonly Choice[] = [
  ...SELLSWORDS.map((sellsword, index) => ({ text: `Hire two ${sellsword.plural} (${sellsword.cost} gold).`, next: `paid${index}`, when: [{ gold: sellsword.cost }] })),
  { text: "Not now.", next: "later" },
];

/**
 * The sellsword at each tavern: to a tavern hero who hasn't had his free
 * contract he offers any one pair free; otherwise, and after it, he sells
 * them, each choice greyed out without the gold, until the hero says not now.
 */
export const SELLSWORD_SCENE: Scene = {
  name: "Sellswords",
  npcName: "Krag the Sellsword",
  npcCode: "nogr",
  start: "offer",
  openings: [{ when: [{ flag: TAVERN_HERO_FLAG }, { notFlag: FREE_SELLSWORD_FLAG }], start: "free" }],
  bark: { text: "Swords for hire! Ogre swords, the best kind.", mood: "command" },
  nodes: [
    {
      id: "free", speaker: "npc", mood: "confirm", text: "A tavern hero! Your first contract's on me, {hero}. Take your pick.",
      choices: [...SELLSWORDS.map((sellsword, index) => ({ text: `Two ${sellsword.plural} (free).`, next: `free${index}` })), { text: "Not now.", next: "later" }],
    },
    ...SELLSWORDS.map((sellsword, index): DialogueNode => ({
      id: `free${index}`, speaker: "npc", mood: "warcry", text: `${sellsword.plural}, you're with {hero} now. Earn your keep!`,
      effects: [hire(sellsword, 0), { kind: "flag", flag: FREE_SELLSWORD_FLAG }], next: "more",
    })),
    { id: "offer", speaker: "npc", mood: "neutral", text: "Coin first, then steel, {hero}. Who do you want?", choices: PAID },
    { id: "more", speaker: "npc", mood: "question", text: "Anyone else? Not free, mind.", choices: PAID },
    ...SELLSWORDS.map((sellsword, index): DialogueNode => ({
      id: `paid${index}`, speaker: "npc", mood: "confirm", text: "Contract signed. They're yours.", effects: [hire(sellsword, sellsword.cost)], next: "more",
    })),
    { id: "later", speaker: "hero", mood: "neutral", text: "Not now." },
  ],
};
