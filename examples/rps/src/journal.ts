// The RPS map's quest journal: what each player is in the middle of, shown at
// the right of his screen under the minimap. It is worked out from the flags
// his scenes set (`Condition`, `meets`), so a quest is active while its
// conditions hold and drops off once the flag that settles it is set; nothing
// else is stored.
import { type Condition, meets } from "./dialogue";

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
