// What the interact key (E) does: talk to the nearest NPC in talking range, or
// pick up the nearest item in reach, whichever is closer; nothing with
// neither. The same choice names the hint over the spell bar, so the hint
// always says what E will do.

/** Something E can reach: what it is, its name, and its squared distance from the hero. */
export interface Reachable {
  readonly kind: "talk" | "pickUp";
  readonly name: string;
  readonly distanceSquared: number;
}

/** The nearer of an NPC and an item in reach; talking wins a tie, so an NPC standing on loot still answers. */
export function interaction(npc: Reachable | undefined, loot: Reachable | undefined): Reachable | undefined {
  if (npc === undefined) return loot;
  if (loot === undefined) return npc;
  return loot.distanceSquared < npc.distanceSquared ? loot : npc;
}

/** The hint for what E will do: "E  Talk to Sergeant Brenn", "E  Pick up Claws of Attack", or "" with nothing in reach. */
export function interactHint(reach: Reachable | undefined): string {
  if (reach === undefined) return "";
  return `|cffffcc00E|r  ${reach.kind === "talk" ? "Talk to" : "Pick up"} ${reach.name}`;
}
