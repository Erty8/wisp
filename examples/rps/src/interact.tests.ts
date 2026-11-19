import { assertEquals, test } from "wisp/src/runtime/testing";
import { interactHint, interaction } from "./interact";

const npc = (distanceSquared: number) => ({ kind: "talk" as const, name: "Sergeant Brenn", distanceSquared });
const loot = (distanceSquared: number) => ({ kind: "pickUp" as const, name: "Claws of Attack", distanceSquared });

test("rps interact: E talks to the NPC or picks up the item, whichever is nearer, and an NPC wins a tie", () => {
  assertEquals(interaction(undefined, undefined), undefined, "nothing in reach");
  assertEquals(interaction(npc(100), undefined)?.kind, "talk", "only an NPC");
  assertEquals(interaction(undefined, loot(100))?.kind, "pickUp", "only an item");
  assertEquals(interaction(npc(400), loot(100))?.kind, "pickUp", "the item nearer");
  assertEquals(interaction(npc(100), loot(400))?.kind, "talk", "the NPC nearer");
  assertEquals(interaction(npc(100), loot(100))?.kind, "talk", "a tie");
});

test("rps interact: the hint says what E will do, and nothing with nothing in reach", () => {
  assertEquals(interactHint(undefined), "", "nothing");
  assertEquals(interactHint(npc(0)), "|cffffcc00E|r  Talk to Sergeant Brenn", "talk");
  assertEquals(interactHint(loot(0)), "|cffffcc00E|r  Pick up Claws of Attack", "pick up");
});
