// The RPS map's quest journal: what each player is in the middle of, shown at
// the right of his screen under the minimap. It is worked out from the flags
// his scenes set (`Condition`, `meets`), so a quest is active while its
// conditions hold and drops off once the flag that settles it is set; nothing
// else is stored. The same flags give each quest's line in Warcraft's own
// quest log (`questLog`, ./questLog.ts): under way, or done.
import { type Condition, meets } from "./dialogue";
import { BASES, questFlag, veteransFlag } from "./bases";
import { RACES } from "./roster";

/** A quest the journal can list: its title, when it is active, and what to do next. */
export interface JournalEntry {
  readonly title: string;
  readonly when: readonly Condition[];
  readonly objective: string;
}

/** Every quest the journal knows, in the order it lists them. */
export const JOURNAL: readonly JournalEntry[] = [
  { title: "The Lost Patrol", when: [{ flag: "helpingSergeant" }, { notFlag: "knowsMines" }], objective: "Ask the scout Ilyra where Brenn's patrol went." },
  { title: "Gor'mak's Challenge", when: [{ flag: "provedToGormak" }, { notFlag: "pupsBeaten" }], objective: "Beat Gor'mak's gnolls at the gnoll den." },
  { title: "Gor'mak's Challenge", when: [{ flag: "pupsBeaten" }, { notFlag: "gormakPaid" }], objective: "Return to Gor'mak." },
  { title: "Unstable Containment", when: [{ flag: "sealingWards" }, { notFlag: "wardsSealed" }], objective: "Destroy the elementals at the ley-line rift." },
  { title: "Unstable Containment", when: [{ flag: "harvestedCores" }, { notFlag: "coresTaken" }], objective: "Defeat Seris, and the elementals at the ley-line rift." },
  { title: "Silverpine Gate", when: [{ flag: "gateForced" }, { notFlag: "gateSettled" }], objective: "Break Captain Haldric's blockade." },
  { title: "Silverpine Gate", when: [{ flag: "gateEnforced" }, { notFlag: "gateSettled" }], objective: "Drive off the blood elf exiles." },
  { title: "Blood in the Timberland", when: [{ flag: "campAssault" }, { notFlag: "campCleared" }], objective: "Clear the troll camp on the ridge." },
  { title: "The Ogre Tax", when: [{ flag: "ogreFight" }, { notFlag: "ogreBeaten" }], objective: "Defeat Gorm-and-Grum at the quarry." },
  // Each race base's quest, from its data.
  ...BASES.map((base) => {
    const race = RACES[base.race]?.name ?? "";
    return { title: base.quest.title, when: [{ flag: questFlag(race) }, { notFlag: veteransFlag(race) }], objective: `Defeat the ${base.quest.foes} at ${base.quest.objective.name}.` };
  }),
];

/** The quests a player with `flags` is in the middle of, in the journal's order. */
export function activeQuests(flags: ReadonlySet<string>): JournalEntry[] {
  return JOURNAL.filter((entry) => meets(entry.when, flags, 0));
}

/** Gold, for the journal's headings. */
const GOLD = "|cffffcc00";
const END = "|r";

/** The journal's text: a heading, then each quest's title in gold over its objective; "" with none, so nothing shows. */
export function journalText(quests: readonly JournalEntry[]): string {
  if (quests.length === 0) return "";
  return [`${GOLD}Quests${END}`, ...quests.map((quest) => `${GOLD}${quest.title}${END}|n${quest.objective}`)].join("|n|n");
}

/** A quest as Warcraft's quest log shows it: under way with its current objective, or done with its last. */
export interface LogEntry {
  readonly title: string;
  readonly state: "active" | "done";
  readonly objective: string;
}

/** Whether a journal entry's quest has begun: every flag it starts on is set. */
const started = (entry: JournalEntry, flags: ReadonlySet<string>) =>
  entry.when.every((condition) => !("flag" in condition) || flags.has(condition.flag));
/** Whether a begun entry is over: a flag that ends it is set. */
const finished = (entry: JournalEntry, flags: ReadonlySet<string>) =>
  started(entry, flags) && entry.when.some((condition) => "notFlag" in condition && flags.has(condition.notFlag));

/**
 * Every quest a player with `flags` has taken, once per title in the
 * journal's order: active with its first active stage's objective, else done
 * with the objective of the last stage he finished. A quest never taken is
 * left out, so the log shows only what he has found.
 */
export function questLog(flags: ReadonlySet<string>): LogEntry[] {
  const titles: string[] = [];
  for (const entry of JOURNAL) if (titles.indexOf(entry.title) < 0) titles.push(entry.title);
  const log: LogEntry[] = [];
  for (const title of titles) {
    const stages = JOURNAL.filter((entry) => entry.title === title);
    const active = stages.find((entry) => meets(entry.when, flags, 0));
    const done = stages.filter((entry) => finished(entry, flags));
    const last = done[done.length - 1];
    if (active !== undefined) log.push({ title, state: "active", objective: active.objective });
    else if (last !== undefined) log.push({ title, state: "done", objective: last.objective });
  }
  return log;
}

/** What changed in a quest since the log last showed it, as Warcraft announces it; undefined when nothing did. */
export type LogChange = "discovered" | "updated" | "completed";

export function logChange(known: { readonly state: string; readonly objective: string } | undefined, entry: LogEntry): LogChange | undefined {
  if (entry.state === "done") return known?.state === "done" ? undefined : "completed";
  if (known === undefined) return "discovered";
  return known.state === entry.state && known.objective === entry.objective ? undefined : "updated";
}

/** The message a change shows the player, in Warcraft's quest message style: its kind in gold, the title, and the objective. */
export function logMessage(change: LogChange, entry: LogEntry): string {
  const heading = change === "discovered" ? "QUEST DISCOVERED" : change === "updated" ? "QUEST UPDATE" : "QUEST COMPLETED";
  return `${GOLD}${heading}${END}|n${entry.title}|n  - ${entry.objective}`;
}
