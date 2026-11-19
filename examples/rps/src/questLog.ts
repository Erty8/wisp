// Warcraft's own quest log (F9) for the quest engine: each quest a player has
// taken (`LogEntry`, from the map's journal) gets a line in the log, with its
// current objective, marked completed once it is done. Warcraft's log is the
// same for every player, so every client creates every player's quests alike
// and only each player's own client enables his (`QuestSetEnabled`), as the
// map does with his minimap icons. A quest that starts, moves on or ends also
// shows Warcraft's quest message to its player, plays its sound and flashes
// the quest button. Each player's quests live on his seat (`questLog`), so a
// hot reload keeps them.
import { type LogEntry, logChange, logMessage } from "./journal";
import { QUEST_LOG_ICON } from "./constants";
import { type SceneSeat, isLocal, say } from "./sceneHost";

/**
 * Brings a player's quests in Warcraft's log up to date with `entries`, in
 * every client alike: a quest he has newly taken is created (enabled only on
 * his client), one whose objective or state changed is rewritten, and each
 * change is announced to him.
 */
export function syncQuestLog(seat: SceneSeat, entries: readonly LogEntry[]): void {
  const log = seat.questLog ?? new Map<string, { readonly quest: quest; readonly state: string; readonly objective: string }>();
  seat.questLog = log;
  for (const entry of entries) {
    const known = log.get(entry.title);
    const change = logChange(known, entry);
    if (change === undefined && known !== undefined) continue;
    const quest = known?.quest ?? CreateQuest();
    if (known === undefined) {
      QuestSetTitle(quest, entry.title);
      QuestSetIconPath(quest, QUEST_LOG_ICON);
      QuestSetRequired(quest, false);
      QuestSetDiscovered(quest, true);
      QuestSetEnabled(quest, false);
      if (isLocal(seat)) QuestSetEnabled(quest, true);
    }
    QuestSetDescription(quest, entry.objective);
    QuestSetCompleted(quest, entry.state === "done");
    log.set(entry.title, { quest, state: entry.state, objective: entry.objective });
    if (change === undefined) continue;
    say(seat, logMessage(change, entry));
    if (isLocal(seat)) {
      StartSound(change === "discovered" ? bj_questDiscoveredSound : change === "updated" ? bj_questUpdatedSound : bj_questCompletedSound);
      FlashQuestDialogButton();
      ForceQuestDialogUpdate();
    }
  }
}
