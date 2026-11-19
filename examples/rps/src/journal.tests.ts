import { assertEquals, test } from "wisp/src/runtime/testing";
import { type Effect, type Scene, MERCENARY_SCENE, SCOUT_SCENE, TAVERN_SCENE } from "./dialogue";
import { JOURNAL, activeQuests, journalText, logChange, logMessage, questLog } from "./journal";
import { QUEST_SCENES } from "./quests";

const titles = (flags: readonly string[]) => activeQuests(new Set(flags)).map((quest) => quest.title).join(",");

/** Every flag a scene's lines or bounties can set. */
function flagsSet(scene: Scene): Set<string> {
  const flags = new Set<string>();
  const bountyFlag = (effect: Effect) => ("bounty" in effect ? effect.bounty?.flag : undefined);
  for (const node of scene.nodes) {
    for (const effect of node.effects ?? []) {
      if (effect.kind === "flag") flags.add(effect.flag);
      const flag = bountyFlag(effect);
      if (flag !== undefined) flags.add(flag);
    }
  }
  return flags;
}

test("[property] rps journal: every quest starts on a flag a scene sets and ends on another one", () => {
  const settable = new Set<string>();
  for (const scene of [...QUEST_SCENES, TAVERN_SCENE, SCOUT_SCENE, MERCENARY_SCENE]) for (const flag of flagsSet(scene)) settable.add(flag);
  for (const entry of JOURNAL) {
    const starts = entry.when.filter((condition) => "flag" in condition), ends = entry.when.filter((condition) => "notFlag" in condition);
    assertEquals(starts.length > 0 && ends.length > 0, true, `${entry.title}: a start and an end`);
    for (const condition of entry.when) {
      const flag = "flag" in condition ? condition.flag : "notFlag" in condition ? condition.notFlag : "";
      assertEquals(settable.has(flag), true, `${entry.title}: ${flag} is set by some scene`);
    }
  }
});

test("rps journal: a quest shows from the choice that starts it until the fight that settles it is won", () => {
  assertEquals(titles([]), "", "nothing under way");
  assertEquals(titles(["campAssault"]), "Blood in the Timberland", "the camp assault");
  assertEquals(titles(["campAssault", "campCleared"]), "", "the camp cleared");
  assertEquals(titles(["helpingSergeant", "gateEnforced", "ogreFight"]), "The Lost Patrol,Silverpine Gate,The Ogre Tax", "several, in the journal's order");
  assertEquals(titles(["helpingSergeant", "knowsMines"]), "", "the scout found");
  assertEquals(titles(["gateForced", "gateSettled"]), "", "the gate settled");
});

test("rps journal: the text heads the list in gold and puts each objective under its title, and is empty with none", () => {
  assertEquals(journalText([]), "", "empty");
  assertEquals(
    journalText(activeQuests(new Set(["ogreFight"]))),
    "|cffffcc00Quests|r|n|n|cffffcc00The Ogre Tax|r|nDefeat Gorm-and-Grum at the quarry.",
    "one quest",
  );
});

const logOf = (flags: readonly string[]) => questLog(new Set(flags)).map((entry) => `${entry.title}:${entry.state}`).join(",");

test("rps journal: Warcraft's quest log lists each quest taken once, under way or done, and leaves out quests never taken", () => {
  assertEquals(logOf([]), "", "nothing taken");
  assertEquals(logOf(["provedToGormak"]), "Gor'mak's Challenge:active", "the challenge taken");
  assertEquals(logOf(["provedToGormak", "pupsBeaten"]), "Gor'mak's Challenge:active", "on to its second stage");
  assertEquals(questLog(new Set(["provedToGormak", "pupsBeaten"]))[0]?.objective, "Return to Gor'mak.", "the second stage's objective");
  assertEquals(logOf(["provedToGormak", "pupsBeaten", "gormakPaid"]), "Gor'mak's Challenge:done", "done");
  assertEquals(logOf(["gormakPaid"]), "", "hiring the trolls outright takes no quest");
  assertEquals(logOf(["gateSettled"]), "", "ordering the captain down takes no quest");
  assertEquals(logOf(["helpingSergeant", "knowsMines", "campAssault"]), "The Lost Patrol:done,Blood in the Timberland:active", "one done, one under way, in the journal's order");
});

test("rps journal: a quest is announced as discovered, updated and completed, once each", () => {
  const active = { title: "The Ogre Tax", state: "active" as const, objective: "Defeat Gorm-and-Grum at the quarry." };
  assertEquals(logChange(undefined, active), "discovered", "new");
  assertEquals(logChange(active, active), undefined, "unchanged");
  assertEquals(logChange(active, { ...active, objective: "Return." }), "updated", "a new stage");
  const done = { ...active, state: "done" as const };
  assertEquals(logChange(active, done), "completed", "done");
  assertEquals(logChange(undefined, done), "completed", "done before the log saw it");
  assertEquals(logChange(done, done), undefined, "announced once");
  assertEquals(logMessage("discovered", active), "|cffffcc00QUEST DISCOVERED|r|nThe Ogre Tax|n  - Defeat Gorm-and-Grum at the quarry.", "the message");
});
