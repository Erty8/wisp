// What the scene and quest engine (./scenes.ts, ./questRuntime.ts) needs from
// the map that runs it, and the state it keeps. A map supplies a `SceneHost`
// once per bundle (`installScenes`, from its install(), so a hot reload
// rebinds it); the engine's state lives in the map's own state global
// (`SceneHost.state`), whose fields `SceneState` names, so a reloaded bundle
// continues every scene, fight and bounty under way. Each player the engine
// plays scenes for is a `SceneSeat`: the map's own player record, which
// carries these fields among its own.
import type { Bounty, DialogueNode, Effect, Framing, LastShot, Scene } from "./dialogue";
import type { Letterbox } from "./letterbox";
import { type Point, type Role, fourCC } from "./rules";
import { DEAD_LIFE } from "./constants";

/** A player the engine plays scenes for: his hero, and what his scenes keep. */
export interface SceneSeat {
  readonly id: number;
  readonly player: player;
  readonly hero: unit;
  /** The hero's unit type, which his lines' voice and conditions read, and his name in the subtitles. */
  readonly heroInfo: { readonly code: string; readonly name: string };
  /** The player's scene letterbox, and the scene playing for them, if any. */
  letterbox: Letterbox | undefined;
  scene: SceneRun | undefined;
  /** The NPC the hero last talked to: it starts its scene again only once he has walked away. */
  talkedTo: unit | undefined;
  /** What the player's scenes remember he did. */
  flags?: Set<string> | undefined;
  /** NPCs that have called out to the hero, until he has gone BARK_RESET_RANGE away. */
  barked?: unit[] | undefined;
  /** The "!" over each NPC with something new for this player, and his quest icon on the minimap. */
  news?: Map<unit, { readonly mark: effect; readonly icon: minimapicon }> | undefined;
  /** The player's screen fading to or from black: the tick it began. */
  fade?: { readonly start: number; readonly toBlack: boolean } | undefined;
  /** The player's quests in Warcraft's quest log, by title (./questLog.ts). */
  questLog?: Map<string, { readonly quest: quest; readonly state: string; readonly objective: string }> | undefined;
}

/** An NPC a hero can talk to, the scene he plays, his name and his unit type. */
export interface Npc {
  readonly unit: unit;
  readonly scene: Scene;
  readonly name: string;
  readonly code: string;
  /** The units standing with a quest NPC, who may turn on the hero with him (`hostile`). */
  readonly extras: readonly unit[];
}

/** The engine's part of the map's state global. */
export interface SceneState {
  readonly seats: readonly SceneSeat[];
  /** The NPCs heroes can talk to. */
  readonly npcs: Npc[];
  /** The playable area's center. */
  readonly center: Point;
  /** One group and location reused by every query, so nothing leaks. */
  readonly group: group;
  readonly location: location;
  readonly everything: filterfunc;
  /** Each unit type's voice prefix as found (`voicePrefixOf`), "" for none. */
  voices?: Map<string, string> | undefined;
  /** How many recordings of a mood's kind each unit type's set has, by "code:mood", as measured (`takesOf`). */
  takes?: Map<string, number> | undefined;
  /** Units a scene raised or turned, by "seat:tag"; the bounties waiting on them; and turned units still dazed, until a tick. */
  tagged?: Map<string, unit[]> | undefined;
  bounties?: { readonly seat: number; readonly key: string; readonly bounty: Bounty }[] | undefined;
  /** Each quest objective marked on a player's minimap, by "seat:tag", until every unit under the tag has fallen. */
  objectives?: { readonly key: string; readonly icon: minimapicon }[] | undefined;
  held?: { readonly unit: unit; readonly until: number; readonly seat: number }[] | undefined;
  /** NPCs and companies fighting on a hero's side, until the fight under their key is won, and the post they go back to. */
  allies?: { readonly unit: unit; readonly key: string; readonly post: Point }[] | undefined;
}

/** A personal scene playing: the scene, its NPC, the line up, the tick it ends, its voice and the units it paused. */
export interface SceneRun {
  readonly scene: Scene;
  readonly npc: unit;
  node: DialogueNode;
  endTick: number;
  voice: sound | undefined;
  readonly paused: unit[];
  /** The NPC's name in the subtitles and the unit type whose voice he speaks with. */
  readonly npcName: string;
  readonly npcCode: string;
  /** The soldier of the hero's squad on stage, if the scene has lines for one, his unit type and name. */
  readonly squad: unit | undefined;
  readonly squadCode: string | undefined;
  readonly squadName: string;
  /** The tick the scene began, and the tick the line began and how long it runs. */
  readonly startTick: number;
  lineStart: number;
  lineLength: number;
  /** Lines played so far, which picks each line's recording. */
  lines: number;
  /** The camera: the framing it glides from (undefined on a cut), the line's own, the last line's speaker and shot, and where the speaker stands. */
  from: Framing | undefined;
  to: Framing | undefined;
  last: LastShot | undefined;
  speakerAt: Point;
  /** The height the line's shot looks at: the speaker's face (`faceHeight`), or between both in a two-shot. */
  face?: number | undefined;
  /** The unit speaking the line, and the tick he stops talking (his voice's end, once measured). */
  speakerUnit?: unit | undefined;
  talkUntil?: number | undefined;
  /** The line's filled-in text and speaker's name. */
  text: string;
  speakerName: string;
  /** The tick the scene began fading out, once it is ending. */
  closing: number | undefined;
  /** Enemies the scene raised, who attack once it ends. */
  readonly fights: unit[];
  /** Units that turn on the hero as the scene ends, under their tag, dazed `hold` seconds first. */
  readonly turns: { readonly unit: unit; readonly tag: string; readonly hold: number }[];
  /** Units that fight on the hero's side as the scene ends, until the fight under their tag is won. */
  readonly allies: { readonly unit: unit; readonly tag: string }[];
}

/**
 * What a map supplies the engine: its state, its clock, and what scenes ask
 * of its own systems. Members are plain functions (no `self`), so a map can
 * hand its own functions in as they are.
 */
export interface SceneHost {
  /** The map's state global, which holds the engine's (`SceneState`). */
  readonly state: () => SceneState;
  /** The map's clock, in camera ticks (0.03 s), which every client counts alike. */
  readonly now: () => number;
  /** Whether a debugging switch has turned a visual part off: "talk" (talk animations), "fade", "marks" (the "!" and quest icons). */
  readonly switchedOff: (feature: string) => boolean;
  /** As a scene starts: the hero drops what he is doing (his attacks, held keys) and stops. */
  readonly standDown: (seat: SceneSeat) => void;
  /** A soldier of the hero's party to stand beside him in a scene with lines for one, with his unit type. */
  readonly sidekick: (seat: SceneSeat) => { readonly unit: unit; readonly code: string | undefined } | undefined;
  /** What a scene's placeholders ({hero}, and the map's own) read for this player. */
  readonly lineValues: (seat: SceneSeat) => Readonly<Record<string, string>>;
  /** A `recruit` effect: two soldiers join the hero for a cost (see the effect for whose). */
  readonly recruit: (seat: SceneSeat, hire: Extract<Effect, { kind: "recruit" }>) => void;
  /** A `spawn` effect: units of a type join the hero's party in a role. */
  readonly join: (seat: SceneSeat, code: string, count: number, role: Role) => void;
  /** A scene comes up (true) or has ended (false): the map hides or brings back its own interface. */
  readonly sceneShown: (seat: SceneSeat, shown: boolean) => void;
}

let installed: SceneHost | undefined;

/** Binds the map to the engine; every bundle's install() calls it, so a hot reload rebinds the new bundle's functions. */
export function installScenes(host: SceneHost): void {
  installed = host;
}

export function host(): SceneHost {
  if (installed === undefined) throw new Error("scenes used before installScenes");
  return installed;
}

export const scenes = (): SceneState => host().state();
export const now = (): number => host().now();
export const say = (seat: SceneSeat, text: string) => DisplayTimedTextToPlayer(seat.player, 0, 0, 6, text);
export const isLocal = (seat: SceneSeat) => GetPlayerId(GetLocalPlayer()) === seat.id;
export const alive = (target: unit) => GetWidgetLife(target) > DEAD_LIFE;
/** A unit's position in whole units, so the integer rules see the same point in every client. */
export const pointOf = (target: unit): Point => ({ x: Math.floor(GetUnitX(target)), y: Math.floor(GetUnitY(target)) });
/** A rawcode from its four letters. */
export const rawcode = (code: string) => fourCC(code);

/** Moves a unit to a point, as Warcraft's pathing allows. */
export function shove(target: unit, to: Point): void {
  SetUnitPosition(target, to.x, to.y);
}

/** The units in `radius` of (x, y), through the shared group. */
export function unitsInRange(x: number, y: number, radius: number): unit[] {
  const state = scenes();
  GroupEnumUnitsInRange(state.group, x, y, radius, state.everything);
  const found: unit[] = [];
  const size = BlzGroupGetSize(state.group);
  for (let index = 0; index < size; index++) found.push(BlzGroupUnitAt(state.group, index));
  return found;
}

/** The seat a player plays, if he has one. */
export function sceneSeatOf(target: player): SceneSeat | undefined {
  const id = GetPlayerId(target);
  return scenes().seats.find((seat) => seat.id === id);
}

/** The player's flags: what his scenes remember he did. */
export function flagsOf(seat: SceneSeat): Set<string> {
  const flags = seat.flags ?? new Set<string>();
  seat.flags = flags;
  return flags;
}

export function goldOf(seat: SceneSeat): number {
  return GetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD);
}
