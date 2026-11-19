import { assertEquals, test } from "wisp/src/runtime/testing";
import { choiceStates, openingOf, sceneProblems } from "./dialogue";
import { FREE_SELLSWORD_FLAG, SELLSWORDS, SELLSWORD_SCENE, TAVERN_HERO_FLAG } from "./tavern";

const nodeOf = (id: string) => SELLSWORD_SCENE.nodes.find((node) => node.id === id);
const hires = (id: string) => (nodeOf(id)?.effects ?? []).map((effect) => (effect.kind === "recruit" ? `${effect.soldier?.code}:${effect.cost}` : effect.kind === "flag" ? effect.flag : "")).join(",");

test("[property] rps tavern: the sellsword's scene branches only to its own nodes, and every hire names its mercenaries", () => {
  assertEquals(sceneProblems(SELLSWORD_SCENE).join("; "), "", "nodes");
  for (const node of SELLSWORD_SCENE.nodes) {
    for (const effect of node.effects ?? []) if (effect.kind === "recruit") assertEquals(effect.soldier !== undefined && SELLSWORDS.some((sellsword) => sellsword.code === effect.soldier?.code), true, node.id);
  }
});

test("rps tavern: a tavern hero's first contract is free, once; everyone else pays", () => {
  assertEquals(openingOf(SELLSWORD_SCENE, new Set([TAVERN_HERO_FLAG]), 0), "free", "a tavern hero's first visit");
  assertEquals(openingOf(SELLSWORD_SCENE, new Set([TAVERN_HERO_FLAG, FREE_SELLSWORD_FLAG]), 0), "offer", "after his free contract");
  assertEquals(openingOf(SELLSWORD_SCENE, new Set(["race:Human"]), 0), "offer", "a race hero");
  assertEquals(hires("free0"), `nogr:0,${FREE_SELLSWORD_FLAG}`, "the free Ogres use up the free contract");
  assertEquals(hires("paid1"), "nftr:100", "paid Forest Trolls");
  assertEquals(nodeOf("free0")?.next, "more", "after the free contract, the paid offer");
  assertEquals(choiceStates(nodeOf("free")?.choices ?? [], new Set(), 0).join(","), "open,open,open,open", "free needs no gold");
  assertEquals(choiceStates(nodeOf("offer")?.choices ?? [], new Set(), 110).join(","), "greyed,open,open,open", "110 gold: not the Ogres");
});
