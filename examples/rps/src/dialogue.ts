// The RPS map's dialogue and cutscene configuration and its pure rules: which
// sound set a unit type speaks with, which Warcraft voice line a mood plays,
// how long a line stays up, where each procedural camera shot stands, and the
// scenes themselves, as plain data to add to. A scene is personal: it runs
// for one player, whose hero and the NPC he talks to are its actors, and a
// soldier from the hero's squad may chip in. The engine directs the camera
// (`directShot`, `sceneFraming`), varies the voice recordings, and remembers what each player did in flags that
// conditions on openings, lines and choices read.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import { angleGap, atan2Tenths } from "./combat";
import { type Point, type Role, distanceSquared, isqrt, mix, offset, smoothstep } from "./rules";

export type Mood = "neutral" | "question" | "confirm" | "attack" | "command" | "warcry" | "angry";
export type Shot = "OTS" | "CLOSEUP" | "TWOSHOT";
/** Who speaks a line: the player's hero, the NPC he talks to, or a soldier of his squad. */
export type Actor = "hero" | "npc" | "squad";

/**
 * What a line, an opening or a choice needs: a flag the player has, one he
 * hasn't, or gold. Flags are names a scene's effects set, and `seen:<scene>`,
 * which every scene sets on the player who played it to the end.
 */
export type Condition =
  | { readonly flag: string }
  | { readonly notFlag: string }
  | { readonly gold: number }
  | { readonly hero: readonly string[] };

/** What a fight pays once every unit under its tag has fallen: gold, a flag to remember it by, and what the player is told. */
export interface Bounty {
  readonly gold: number;
  readonly flag?: string;
  readonly text: string;
}

/**
 * What a line does as it plays, in order: pay or take gold, recruit two of a
 * role's soldiers for a cost, set or clear a flag, spawn units that join the
 * hero's squad, spawn hostile units that attack him once the scene ends, or
 * heal him, life and mana.
 */
export type Effect =
  | { readonly kind: "gold"; readonly amount: number }
  /**
   * Two of a role's soldiers for a cost: the player's own race's, or with
   * `race` (an index into the roster's RACES) that race's; with `veteran`,
   * its veterans; with `soldier`, that unit type (a sellsword's mercenaries).
   */
  | {
    readonly kind: "recruit"; readonly role: Role; readonly cost: number; readonly race?: number; readonly veteran?: boolean;
    readonly soldier?: { readonly code: string; readonly plural: string };
  }
  | { readonly kind: "flag"; readonly flag: string; readonly value?: boolean }
  | { readonly kind: "spawn"; readonly code: string; readonly count: number; readonly role: Role }
  | {
    readonly kind: "fight"; readonly code: string; readonly count: number;
    /**
     * Where they come from: behind the hero (the default), around the NPC's
     * site, or a camp 900 past it, away from the map's center, all coming for
     * the hero as the scene ends; or at the scene's `objective`, marked on the
     * player's minimap, where they stand guard until he comes.
     */
    readonly at?: "behind" | "site" | "camp" | "objective";
    readonly tag?: string;
    readonly bounty?: Bounty;
  }
  /**
   * The scene's NPC, or his company of a unit type (`code`), turns on the hero
   * as the scene ends, under a tag; with `hold`, they stand dazed that many
   * seconds first.
   */
  | { readonly kind: "hostile"; readonly code?: string; readonly tag: string; readonly hold?: number; readonly bounty?: Bounty }
  /**
   * The scene's NPC, or his company of a unit type (`code`), fights on the
   * hero's side as the scene ends, until every unit under `tag` has fallen;
   * then he goes back to his post. He can't be hurt meanwhile.
   */
  | { readonly kind: "ally"; readonly code?: string; readonly tag: string }
  | { readonly kind: "heal" };

export interface Choice {
  readonly text: string;
  readonly next: string;
  /** Unmet, the choice shows greyed out and can't be picked, or doesn't show with `hidden`. */
  readonly when?: readonly Condition[];
  readonly hidden?: boolean;
}

/** A way into a scene: its first node, while the player meets its conditions. */
export interface Opening {
  readonly when: readonly Condition[];
  readonly start: string;
}

export interface DialogueNode {
  readonly id: string;
  readonly speaker: Actor;
  readonly text: string;
  readonly mood: Mood;
  /** The shot, in place of the one the director picks (`directShot`). */
  readonly shot?: Shot;
  /** An important line: the director frames it in close-up. */
  readonly important?: boolean;
  /** Whom the speaker talks to: by default the hero to the NPC, the NPC and a soldier to the hero. */
  readonly to?: Actor;
  /** An animation the speaker plays as the line starts ("stand" follows); by default the mood's gesture. */
  readonly anim?: string;
  /** Unmet, the line is passed over for its `next`. */
  readonly when?: readonly Condition[];
  /** The voice's pitch in percent, 100 as recorded: two units of a type sound like different people. */
  readonly pitch?: number;
  /** The next node; a node with neither next nor choices ends the scene. */
  readonly next?: string;
  readonly choices?: readonly Choice[];
  /** What the line does as it plays. */
  readonly effects?: readonly Effect[];
}

export interface Scene {
  readonly name: string;
  /** The NPC's name in the subtitles and the unit type he is. */
  readonly npcName: string;
  readonly npcCode: string;
  /** The first node, unless one of the `openings` is met first. */
  readonly start: string;
  readonly openings?: readonly Opening[];
  /** What the NPC calls out to a hero walking past, and its mood. */
  readonly bark?: { readonly text: string; readonly mood: Mood };
  readonly nodes: readonly DialogueNode[];
  /** Where the scene's `objective` fights wait, away from the NPC. */
  readonly objective?: Objective;
}

/**
 * A quest's objective: a named place, by angle (tenths of a degree from east)
 * and distance from the playable area's center, like the NPCs' own spots.
 */
export interface Objective {
  readonly name: string;
  readonly angle: number;
  readonly distance: number;
}

/** The playable area, for keeping an objective inside it. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** How far inside the playable area's edge an objective stays. */
export const OBJECTIVE_MARGIN = 600;

/** Where an objective stands: its angle and distance from the center, pulled in to OBJECTIVE_MARGIN inside the playable area. */
export function objectiveSpot(center: Point, objective: Objective, bounds: Bounds): Point {
  const spot = offset(center.x, center.y, objective.angle, objective.distance, 0);
  const clamp = (value: number, low: number, high: number) => (low > high ? floorDiv(low + high, 2) : Math.max(low, Math.min(high, value)));
  return {
    x: clamp(spot.x, bounds.minX + OBJECTIVE_MARGIN, bounds.maxX - OBJECTIVE_MARGIN),
    y: clamp(spot.y, bounds.minY + OBJECTIVE_MARGIN, bounds.maxY - OBJECTIVE_MARGIN),
  };
}


/** Which of a sound set's lines each mood plays. */
export const MOOD_SUFFIXES: Readonly<Record<Mood, string>> = {
  neutral: "What", question: "What", confirm: "Yes", attack: "YesAttack", command: "Yes", warcry: "Warcry", angry: "Pissed",
};

/**
 * A voice's `take`th recording of a mood's kind (from 1): the voice's file
 * prefix (a unit profile's, src/units.ts), the kind and the take,
 * Units\\Human\\Footman\\FootmanWhat2.wav.
 */
export function recordingFile(prefix: string, mood: Mood, take: number): string {
  return `${prefix}${MOOD_SUFFIXES[mood]}${take}.wav`;
}

/** Sets have at most this many recordings of a kind the map looks for. */
export const MAX_TAKES = 10;

/**
 * How many recordings of a kind a set has: takes 1, 2, 3 and on while
 * `exists` says the file is there, up to MAX_TAKES. The map asks the game
 * (`GetSoundFileDuration` is 0 for a file that isn't there), since sets
 * differ: the Footman has 7 Pissed lines, others 4.
 */
export function countTakes(exists: (take: number) => boolean): number {
  let takes = 0;
  while (takes < MAX_TAKES && exists(takes + 1)) takes++;
  return takes;
}

/**
 * The sound file a voice speaks a mood with: the `variant`th line's recording
 * of the mood's kind, round the `takes` recordings the voice has, so a scene
 * doesn't repeat one; undefined without a voice or with no recordings of the
 * kind.
 */
export function voiceFile(prefix: string | undefined, mood: Mood, variant: number, takes: number): string | undefined {
  return prefix === undefined || takes <= 0 ? undefined : recordingFile(prefix, mood, floorMod(variant, takes) + 1);
}

/** The mood's gesture, for a line that names no animation: a warcry cheers, anger lashes out, a command readies. */
export function gestureOf(mood: Mood): string | undefined {
  if (mood === "warcry") return "stand victory";
  if (mood === "angry") return "attack";
  if (mood === "command") return "stand ready";
  return undefined;
}

/**
 * A line's text with its placeholders filled in: {hero} for the hero's name,
 * {melee} and {ranged} for what two of his race's soldiers of that role are
 * called. Scenes speak to every race this way.
 */
export function fillLine(text: string, values: Readonly<Record<string, string>>): string {
  let filled = text;
  for (const key of Object.keys(values).sort()) filled = filled.split(`{${key}}`).join(values[key] ?? "");
  return filled;
}

export type RecruitOutcome = "hired" | "poor" | "already";

/** Whether a recruit goes through: not if the hero already leads that role's soldiers, nor without the gold. */
export function recruitOutcome(gold: number, cost: number, alreadyLeads: boolean): RecruitOutcome {
  if (alreadyLeads) return "already";
  return gold >= cost ? "hired" : "poor";
}

/** Each player's gold at the start: a pair of mercenaries, or a pair from another race's base. */
export const STARTING_GOLD = 150;

/** How long a line stays up, in camera ticks (0.03 s): 2 seconds, plus a tick for every 15th of a second it takes to read at 15 characters a second. */
export function lineTicks(text: string): number {
  return 66 + floorDiv(text.length * 20, 9);
}

/** How long a speaker talks: `voiceMs` milliseconds of recording, in camera ticks, rounded up. */
export function talkTicks(voiceMs: number): number {
  return voiceMs <= 0 ? 0 : floorDiv(voiceMs + 29, 30);
}

/** A line stays up at least as long as its voice, plus half a second: `voiceMs` milliseconds of recording, in camera ticks. */
export function voiceTicks(voiceMs: number): number {
  return voiceMs <= 0 ? 0 : talkTicks(voiceMs) + 16;
}

/**
 * The animation a speaker plays while he talks: Warcraft picks the model's
 * animation tagged Stand and Talk, or, on a model without one, a stand.
 */
export const TALK_ANIMATION = "stand talk";

/** Whether a player with `flags` and `gold` meets every condition. */
export function meets(conditions: readonly Condition[] | undefined, flags: ReadonlySet<string>, gold: number, hero: string = ""): boolean {
  for (const condition of conditions ?? []) {
    if ("flag" in condition && !flags.has(condition.flag)) return false;
    if ("notFlag" in condition && flags.has(condition.notFlag)) return false;
    if ("gold" in condition && gold < condition.gold) return false;
    if ("hero" in condition && !condition.hero.some((code) => code === hero)) return false;
  }
  return true;
}

/** The flag a scene sets on a player who plays it to the end. */
export function seenFlag(scene: Scene): string {
  return `seen:${scene.name}`;
}

/** The node a scene opens on for a player: the first opening he meets, else the scene's start. */
export function openingOf(scene: Scene, flags: ReadonlySet<string>, gold: number, hero: string = ""): string {
  return scene.openings?.find((opening) => meets(opening.when, flags, gold, hero))?.start ?? scene.start;
}

/** Whether a scene has something new for a player: he hasn't played it to the end yet. */
export function hasNews(scene: Scene, flags: ReadonlySet<string>): boolean {
  return !flags.has(seenFlag(scene));
}

/** How each choice shows: "open", "greyed" (unmet) or "hidden" (unmet, and marked hidden). */
export type ChoiceState = "open" | "greyed" | "hidden";
export function choiceStates(choices: readonly Choice[], flags: ReadonlySet<string>, gold: number, hero: string = ""): ChoiceState[] {
  return choices.map((choice) => (meets(choice.when, flags, gold, hero) ? "open" : choice.hidden === true ? "hidden" : "greyed"));
}

/** Whom a line's speaker addresses: its `to`, else the hero speaks to the NPC and the NPC or a soldier to the hero. */
export function listenerOf(node: DialogueNode): Actor {
  return node.to ?? (node.speaker === "hero" ? "npc" : "hero");
}

/** Problems with a scene: a missing start or opening, a next or a choice that names no node, or more than 4 choices. */
export function sceneProblems(scene: Scene): string[] {
  const ids = new Set(scene.nodes.map((node) => node.id));
  const problems: string[] = [];
  if (!ids.has(scene.start)) problems.push(`${scene.name}: no start node ${scene.start}`);
  for (const opening of scene.openings ?? []) if (!ids.has(opening.start)) problems.push(`${scene.name}: no opening node ${opening.start}`);
  for (const node of scene.nodes) {
    if (node.next !== undefined && !ids.has(node.next)) problems.push(`${scene.name}: ${node.id} goes to no node ${node.next}`);
    for (const choice of node.choices ?? []) if (!ids.has(choice.next)) problems.push(`${scene.name}: ${node.id} offers no node ${choice.next}`);
    if ((node.choices?.length ?? 0) > 4) problems.push(`${scene.name}: ${node.id} offers more than 4 choices`);
    for (const effect of node.effects ?? []) {
      if (effect.kind === "fight" && effect.at === "objective" && scene.objective === undefined) problems.push(`${scene.name}: ${node.id} fights at an objective the scene doesn't name`);
      if (effect.kind === "fight" && effect.at === "objective" && effect.tag === undefined) problems.push(`${scene.name}: ${node.id} fights at the objective without a tag to mark it by`);
    }
  }
  return problems;
}

/** Where the camera stands for a shot: the point it looks at, its yaw and angle of attack (tenths of a degree), distance and field of view. */
export interface Framing {
  readonly target: Point;
  readonly yaw: number;
  readonly attack: number;
  readonly distance: number;
  readonly fieldOfView: number;
}

/** An over-the-shoulder shot clears the listener's body by 120 to his right, and stands 40 back from there. */
export const SHOULDER_CLEARANCE = 120;
export const SHOULDER_BACK = 40;

/**
 * A procedural shot of the speaker and the listener, from their positions:
 * - OTS: over the listener's right shoulder onto the speaker. The camera
 *   stands beside him, not behind him: SHOULDER_CLEARANCE past his
 *   `listenerRadius` to his right, and SHOULDER_BACK behind that, looking
 *   from there at the speaker, so the listener is a shoulder at the frame's
 *   edge however big his model (straight behind a Dreadlord, his wings
 *   filled the frame);
 * - CLOSEUP: on the speaker's face from the listener's side, 190 away, 24
 *   degrees off axis, a 54-degree field of view;
 * - TWOSHOT: perpendicular to the line between them, on their midpoint, from
 *   330 beyond their distance apart, at least 460.
 */
export function framing(shot: Shot, speaker: Point, listener: Point, listenerRadius: number = 32, face: number = FACE_HEIGHT): Framing {
  const toSpeaker = atan2Tenths(speaker.y - listener.y, speaker.x - listener.x);
  const apart = isqrt(distanceSquared(speaker, listener));
  // A taller face is farther from the ground: the camera stands back by as much, so it fits.
  const taller = Math.max(0, face - FACE_HEIGHT);
  if (shot === "OTS") {
    const shoulder = offset(listener.x, listener.y, toSpeaker, 0, -(Math.max(listenerRadius, 0) + SHOULDER_CLEARANCE));
    return {
      target: speaker, yaw: atan2Tenths(speaker.y - shoulder.y, speaker.x - shoulder.x), attack: -80,
      distance: isqrt(distanceSquared(speaker, shoulder)) + SHOULDER_BACK + taller, fieldOfView: 65,
    };
  }
  if (shot === "CLOSEUP") return { target: speaker, yaw: toSpeaker + 240, attack: -30, distance: 190 + taller, fieldOfView: 54 };
  const middle = { x: floorDiv(speaker.x + listener.x, 2), y: floorDiv(speaker.y + listener.y, 2) };
  return { target: middle, yaw: toSpeaker + 900, attack: -100, distance: Math.max(460, apart + 330) + floorDiv(taller, 2), fieldOfView: 70 };
}

/** The height a shot looks at: the speaker's face, or, in a two-shot, halfway between both faces. */
export function shotFace(shot: Shot, speakerFace: number, listenerFace: number): number {
  return shot === "TWOSHOT" ? floorDiv(speakerFace + listenerFace, 2) : speakerFace;
}

/** A line's shot as the director calls it: the shot, and whether the camera glides there instead of cutting. */
export interface Direction {
  readonly shot: Shot;
  readonly glide: boolean;
}

/** The last line's speaker and shot, which the director cuts from. */
export interface LastShot {
  readonly speaker: Actor;
  readonly shot: Shot;
}

/**
 * The shot director. A scene opens on a two-shot of both actors; an angry
 * line, a warcry or an important one is a close-up; the rest go over the
 * listener's shoulder; a node's own shot wins over all of these. A new
 * speaker is a cut to the reverse shot. The same speaker going on never cuts:
 * the camera glides, from a two-shot to his over-the-shoulder shot, from that
 * to a close-up, and on a close-up it stays and drifts.
 */
export function directShot(node: DialogueNode, last: LastShot | undefined): Direction {
  const chosen: Shot = node.shot
    ?? (last === undefined ? "TWOSHOT" : node.important === true || node.mood === "angry" || node.mood === "warcry" ? "CLOSEUP" : "OTS");
  if (last === undefined || last.speaker !== node.speaker) return { shot: chosen, glide: false };
  if (chosen !== last.shot) return { shot: chosen, glide: true };
  return { shot: last.shot === "TWOSHOT" ? "OTS" : "CLOSEUP", glide: true };
}

/** A glide between shots takes 34 ticks (about 1 s). */
export const GLIDE_TICKS = 34;

/** `to` moved by whole turns to within half a turn of `from`, so a glide turns the short way round. */
function nearTurn(from: number, to: number): number {
  return from + floorMod(to - from + 1800, 3600) - 1800;
}

/**
 * The camera `elapsed` ticks into a line: gliding from the last line's
 * framing (`from`) to this one's over GLIDE_TICKS, smoothstepped, when the
 * line glides, at this one's at once when it cuts, and drifting
 * DRIFT_DISTANCE closer and DRIFT_YAW round over the line's `length`.
 */
export function sceneFraming(from: Framing | undefined, to: Framing, elapsed: number, length: number): Framing {
  const drift = floorDiv(Math.min(Math.max(elapsed, 0), length) * 100, Math.max(length, 1));
  const settled = { ...to, yaw: to.yaw + floorDiv(DRIFT_YAW * drift, 100), distance: to.distance - floorDiv(DRIFT_DISTANCE * drift, 100) };
  if (from === undefined || elapsed >= GLIDE_TICKS) return settled;
  const weight = smoothstep(floorDiv(Math.max(elapsed, 0) * 100, GLIDE_TICKS));
  return {
    target: { x: mix(from.target.x, settled.target.x, weight), y: mix(from.target.y, settled.target.y, weight) },
    yaw: mix(from.yaw, nearTurn(from.yaw, settled.yaw), weight),
    attack: mix(from.attack, settled.attack, weight),
    distance: mix(from.distance, settled.distance, weight),
    fieldOfView: mix(from.fieldOfView, settled.fieldOfView, weight),
  };
}

/** A scene fades in from black over 10 ticks (0.3 s) and out to black over 10 as it ends; its bars slide in over 10. */
export const FADE_TICKS = 10;

/** The black's opacity, 0 to 255, `elapsed` ticks into a fade toward black (`toBlack`) or away from it. */
export function fadeAlpha(elapsed: number, toBlack: boolean): number {
  const linear = floorDiv(Math.min(Math.max(elapsed, 0), FADE_TICKS) * 100, FADE_TICKS);
  const shown = floorDiv(255 * smoothstep(linear), 100);
  return toBlack ? shown : 255 - shown;
}

/** An NPC calls out to a hero within 600 of him and turns to face him, once until the hero has gone 900 away. */
export const BARK_RANGE = 600;
export const BARK_RESET_RANGE = 900;

/** The camera looks at head height: this far above the ground under the shot's target, for a unit type whose profile names no face height of its own. */
export const FACE_HEIGHT = 60;

/** The camera holds still over a line: no drift closer and no turn (set these to bring a slow drift back). */
export const DRIFT_DISTANCE = 0;
export const DRIFT_YAW = 0;

/** Where the hero and the NPC stand to talk: 260 apart, room for the camera between them, the NPC where he is, the hero on the side he came from. */
export const TALK_DISTANCE = 260;
export function talkSpot(npc: Point, hero: Point): Point {
  const toHero = atan2Tenths(hero.y - npc.y, hero.x - npc.x);
  return offset(npc.x, npc.y, toHero, TALK_DISTANCE, 0);
}

/** A hero within 350 of an NPC starts its scene; he must go 500 away before the same NPC starts it again. */
export const TALK_RANGE = 350;
export const TALK_RESET_RANGE = 500;
/** Units within 1600 of a personal scene pause for it, other players' excepted. */
export const SCENE_PAUSE_RANGE = 1600;

/** Whether two directions face each other within 10 degrees, for tests of the actors' turn. */
export function facing(a: number, b: number): boolean {
  return angleGap(a + 1800, b) <= 100;
}

/** The example: a sergeant at the tavern asks the hero for help, who helps or refuses. */
export const TAVERN_SCENE: Scene = {
  name: "Tavern",
  npcName: "Sergeant Brenn",
  npcCode: "hfoo",
  start: "greet",
  openings: [
    { when: [{ flag: "insultedSergeant" }], start: "cold" },
    { when: [{ flag: "helpingSergeant" }], start: "again" },
  ],
  bark: { text: "You there! A word, if you've a moment.", mood: "question" },
  nodes: [
    { id: "greet", speaker: "npc", mood: "neutral", anim: "stand ready", text: "Hold there, traveller. You're a long way from any banner I know.", next: "ask" },
    { id: "ask", speaker: "hero", mood: "question", text: "I'm after the outposts in this valley. Who holds them?", next: "plea" },
    { id: "plea", speaker: "npc", mood: "angry", pitch: 90, anim: "stand hit", text: "Gnolls, mostly. Worse, by the mines. They took my brother's patrol.", next: "doubt" },
    { id: "doubt", speaker: "squad", mood: "question", text: "Sir, I don't trust him. Patrols don't just vanish.", next: "decide" },
    {
      id: "decide", speaker: "npc", mood: "neutral", pitch: 90, text: "Believe what you like. Will you help, or not?",
      choices: [
        { text: "I'll clear the mines for you.", next: "thanks" },
        { text: "Pay me first.", next: "haggle" },
        { text: "Here, for his family: 50 gold.", next: "charity", when: [{ gold: 50 }] },
        { text: "Your brother's patrol isn't my concern.", next: "scorn" },
      ],
    },
    {
      id: "thanks", speaker: "npc", mood: "confirm", pitch: 110, anim: "stand victory", text: "Then take the east road, and this purse for the trouble.", next: "vow",
      effects: [{ kind: "gold", amount: 50 }, { kind: "flag", flag: "helpingSergeant" }],
    },
    {
      id: "charity", speaker: "npc", mood: "confirm", pitch: 110, text: "That's... generous. Take the east road, then. The mines are past the ridge.", next: "vow",
      effects: [{ kind: "gold", amount: -50 }, { kind: "flag", flag: "helpingSergeant" }],
    },
    { id: "vow", speaker: "hero", mood: "warcry", important: true, text: "For the outposts!" },
    {
      id: "haggle", speaker: "npc", mood: "angry", pitch: 85, text: "A sellsword with no swords behind him? The gnolls can have you. Here they come.",
      effects: [{ kind: "flag", flag: "insultedSergeant" }, { kind: "fight", code: "ngno", count: 2 }],
    },
    {
      id: "scorn", speaker: "npc", mood: "angry", pitch: 85, text: "Then walk on, and pray the gnolls are kinder than you.",
      effects: [{ kind: "flag", flag: "insultedSergeant" }],
    },
    { id: "cold", speaker: "npc", mood: "angry", pitch: 85, text: "You again. I've nothing to say to you, {hero}." },
    { id: "again", speaker: "npc", mood: "neutral", pitch: 110, text: "Back already? The mines are east. My brother won't wait forever.", next: "promise" },
    { id: "promise", speaker: "hero", mood: "confirm", text: "He won't have to." },
  ],
};

/**
 * Ilyra, a night elf scout: she won't talk to a stranger, but to someone who
 * has agreed to help the sergeant she tells where the patrol went, pays for
 * the road and sets `knowsMines`; after that she only hurries the hero on.
 */
export const SCOUT_SCENE: Scene = {
  name: "Scout",
  npcName: "Ilyra",
  npcCode: "earc",
  start: "cold",
  openings: [
    { when: [{ flag: "knowsMines" }], start: "hurry" },
    { when: [{ flag: "helpingSergeant" }], start: "sent" },
  ],
  bark: { text: "Psst. Over here, {hero}.", mood: "question" },
  nodes: [
    { id: "cold", speaker: "npc", mood: "neutral", text: "I don't talk to strangers. The sergeant at the tavern knows who I trust." },
    { id: "sent", speaker: "npc", mood: "question", text: "Brenn sent you? Then listen: the patrol's tracks end at the eastern mine.", next: "ask" },
    { id: "ask", speaker: "hero", mood: "question", text: "What took them?", next: "answer" },
    {
      id: "answer", speaker: "npc", mood: "angry", important: true, text: "Gnolls, led by something bigger. Take this for the road, and don't go alone.", next: "ready",
      effects: [{ kind: "gold", amount: 40 }, { kind: "flag", flag: "knowsMines" }],
    },
    { id: "ready", speaker: "squad", mood: "confirm", text: "We'll be right behind you." },
    { id: "hurry", speaker: "npc", mood: "neutral", text: "The eastern mine, {hero}. Hurry." },
  ],
};

/**
 * Gor'mak, an orc mercenary captain: two forest trolls for 90 gold, or for
 * free once the hero has taken his challenge, two gnolls who attack once the
 * scene ends. He gives the trolls once.
 */
export const MERCENARY_SCENE: Scene = {
  name: "Mercenaries",
  npcName: "Gor'mak",
  npcCode: "ogru",
  start: "offer",
  openings: [
    { when: [{ flag: "gormakPaid" }], start: "done" },
    { when: [{ flag: "pupsBeaten" }], start: "respect" },
    { when: [{ flag: "provedToGormak" }], start: "waiting" },
  ],
  objective: { name: "the gnoll den", angle: 1350, distance: 3200 },
  bark: { text: "Strong arms for hire! Coin or blood, {hero}.", mood: "warcry" },
  nodes: [
    {
      id: "offer", speaker: "npc", mood: "neutral", text: "My trolls fight for coin. Ninety gold buys two spears.",
      choices: [
        { text: "Hire two trolls (90 gold).", next: "hire", when: [{ gold: 90 }] },
        { text: "I'll prove I'm worth fighting beside.", next: "prove" },
        { text: "Not today.", next: "leave" },
      ],
    },
    {
      id: "hire", speaker: "npc", mood: "confirm", text: "Gold spends. They're yours.",
      effects: [{ kind: "gold", amount: -90 }, { kind: "spawn", code: "nftr", count: 2, role: "ranged" }, { kind: "flag", flag: "gormakPaid" }],
    },
    {
      id: "prove", speaker: "npc", mood: "warcry", important: true, text: "Ha! Then beat my pups. They're at the gnoll den. Put them down and come back to me.",
      effects: [
        { kind: "fight", code: "ngno", count: 2, at: "objective", tag: "pups", bounty: { gold: 0, flag: "pupsBeaten", text: "Gor'mak's pups are down. Go back to him." } },
        { kind: "flag", flag: "provedToGormak" },
      ],
    },
    {
      id: "respect", speaker: "npc", mood: "confirm", text: "You fight like an orc. The trolls follow you, no charge.",
      effects: [{ kind: "spawn", code: "nftr", count: 2, role: "ranged" }, { kind: "flag", flag: "gormakPaid" }],
    },
    { id: "waiting", speaker: "npc", mood: "angry", text: "My pups still stand at the den. Come back when they don't." },
    { id: "done", speaker: "npc", mood: "neutral", text: "Treat my trolls well, {hero}." },
    { id: "leave", speaker: "hero", mood: "neutral", text: "Not today." },
  ],
};

/**
 * Sister Maren, a priest: she heals the hero, life and mana, for 20 gold, or
 * once for free for a friend of the sergeant's.
 */
export const HEALER_SCENE: Scene = {
  name: "Healer",
  npcName: "Sister Maren",
  npcCode: "hmpr",
  start: "greet",
  bark: { text: "Wounded? The Light mends, {hero}.", mood: "neutral" },
  nodes: [
    {
      id: "greet", speaker: "npc", mood: "neutral", text: "You look worn, {hero}. Let me tend to you.",
      choices: [
        { text: "Heal me (20 gold).", next: "heal", when: [{ gold: 20 }] },
        { text: "Brenn said you help his friends.", next: "favor", when: [{ flag: "helpingSergeant" }, { notFlag: "marenFavor" }], hidden: true },
        { text: "I'm fine.", next: "fine" },
      ],
    },
    { id: "heal", speaker: "npc", mood: "confirm", text: "There. Walk in the Light.", effects: [{ kind: "gold", amount: -20 }, { kind: "heal" }] },
    { id: "favor", speaker: "npc", mood: "confirm", text: "Any friend of Brenn's. No charge, this once.", effects: [{ kind: "heal" }, { kind: "flag", flag: "marenFavor" }] },
    { id: "fine", speaker: "hero", mood: "neutral", text: "I'm fine. Save it for someone who needs it." },
  ],
};

/**
 * Where the wandering NPCs stand: around the playable area's center, 1100
 * out, a third of a turn apart (tenths of a degree from east), facing it.
 */
export const WANDERERS: readonly { readonly scene: Scene; readonly angle: number; readonly distance: number }[] = [
  { scene: SCOUT_SCENE, angle: 450, distance: 1100 },
  { scene: MERCENARY_SCENE, angle: 1650, distance: 1100 },
  { scene: HEALER_SCENE, angle: 2850, distance: 1100 },
];

/** Every scene, by name, for the -scene command. */
export const SCENES: readonly Scene[] = [TAVERN_SCENE, SCOUT_SCENE, MERCENARY_SCENE, HEALER_SCENE];
