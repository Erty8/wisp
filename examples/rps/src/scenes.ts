// The scene engine: personal dialogue scenes, played for one player at a
// time. A hero who walks up to an NPC plays its scene: units around pause,
// the hero can't be hurt, the scene fades in from black, the director cuts
// and glides between procedural shots, the actors turn to each other and
// gesture, and the NPC, the hero and a soldier of his party speak in their
// own voices. NPCs call out to heroes walking past, and the "!" over each NPC
// with something new for a player is kept up. What a line does runs here
// (gold, flags, healing), in ./questRuntime.ts (fights, turns, allies), or in
// the map, through its host (./sceneHost.ts: recruits, units joining). The map
// calls `talkCheck` and `questTick` every 0.5 s, `sceneTick` and `fadeTick`
// every camera tick, and the key and click handlers below.
import { floorMod } from "wisp/src/sim/intMath";
import { atan2Tenths } from "./combat";
import {
  type Actor, type DialogueNode, type Effect, type Mood,
  BARK_RANGE, BARK_RESET_RANGE, FACE_HEIGHT, FADE_TICKS, SCENE_PAUSE_RANGE, TALK_ANIMATION, TALK_RANGE, TALK_RESET_RANGE,
  choiceStates, countTakes, directShot, fadeAlpha, fillLine, framing, gestureOf, hasNews, lineTicks, listenerOf, meets, openingOf,
  recordingFile, sceneFraming, seenFlag, shotFace, talkSpot, talkTicks, voiceFile, voiceTicks,
} from "./dialogue";
import { setFade, showChoices, showSubtitle } from "./letterbox";
import { type Point, distanceSquared, offset } from "./rules";
import { faceHeight, gestureFor, talkAnimation, voiceCandidates } from "./units";
import { BARK_TEXT_SIZE, CAMERA_PERIOD, NEWS_MODEL, QUEST_ICON_FILE, QUEST_ICON_SKIN_KEY, TURN_SECONDS, VOICE_PREFIX } from "./constants";
import { enlist, raiseFight, releaseScene, turn } from "./questRuntime";
import {
  type Npc, type SceneRun, type SceneSeat,
  alive, flagsOf, goldOf, host, isLocal, now, pointOf, say, sceneSeatOf, scenes, shove, unitsInRange,
} from "./sceneHost";

/**
 * Every 0.5 s: a hero within BARK_RANGE of an NPC (but not yet in talking
 * range) hears it call out, once until he has walked TALK_RESET_RANGE away
 * from the last one he talked to; the "!" over NPCs with something new for
 * him is kept up. Scenes start when the map asks (`talkTarget`, `startScene`:
 * this map's interact key).
 */
export function talkCheck(seat: SceneSeat): void {
  const hero = pointOf(seat.hero);
  if (seat.talkedTo !== undefined && distanceSquared(hero, pointOf(seat.talkedTo)) > TALK_RESET_RANGE * TALK_RESET_RANGE) seat.talkedTo = undefined;
  markNews(seat);
  if (!alive(seat.hero)) return;
  barkCheck(seat, hero);
}

/** The nearest NPC within TALK_RANGE of the hero that he can talk to now (not in anyone's scene), and its squared distance. */
export function talkTarget(seat: SceneSeat): { readonly npc: Npc; readonly distanceSquared: number } | undefined {
  if (!alive(seat.hero) || seat.scene !== undefined) return undefined;
  const hero = pointOf(seat.hero);
  let nearest: { readonly npc: Npc; readonly distanceSquared: number } | undefined;
  for (const npc of scenes().npcs) {
    if (!talkable(npc) || inScene(npc.unit)) continue;
    const distance = distanceSquared(hero, pointOf(npc.unit));
    if (distance <= TALK_RANGE * TALK_RANGE && (nearest === undefined || distance < nearest.distanceSquared)) nearest = { npc, distanceSquared: distance };
  }
  return nearest;
}

/** Whether an NPC can still be talked to: alive, and not turned on anyone. */
const talkable = (npc: Npc) => alive(npc.unit) && GetPlayerId(GetOwningPlayer(npc.unit)) === PLAYER_NEUTRAL_PASSIVE;

/** Whether an NPC is in someone's scene. */
function inScene(npc: unit): boolean {
  return scenes().seats.some((seat) => seat.scene?.npc === npc);
}

/**
 * Ambient barks: an NPC with a bark turns to a hero walking past within
 * BARK_RANGE (but not yet close enough to talk) and calls out once, a voiced
 * line over his head for that player alone, until the hero has gone
 * BARK_RESET_RANGE away. The game doesn't stop.
 */
function barkCheck(seat: SceneSeat, hero: Point): void {
  const barked = (seat.barked ?? []).filter((npc) => distanceSquared(hero, pointOf(npc)) <= BARK_RESET_RANGE * BARK_RESET_RANGE);
  seat.barked = barked;
  for (const npc of scenes().npcs) {
    const bark = npc.scene.bark;
    if (bark === undefined || !talkable(npc) || barked.includes(npc.unit) || npc.unit === seat.talkedTo || inScene(npc.unit)) continue;
    const at = pointOf(npc.unit);
    const distance = distanceSquared(hero, at);
    if (distance > BARK_RANGE * BARK_RANGE || distance <= TALK_RANGE * TALK_RANGE) continue;
    barked.push(npc.unit);
    SetUnitFacingTimed(npc.unit, atan2Tenths(hero.y - at.y, hero.x - at.x) / 10, TURN_SECONDS);
    const gesture = gestureFor(npc.code, bark.mood);
    if (gesture !== undefined) {
      SetUnitAnimation(npc.unit, gesture);
      QueueUnitAnimation(npc.unit, "stand");
    }
    speak(seat, npc.code, bark.mood, floorMod(now(), 4), undefined);
    const tag = CreateTextTag();
    SetTextTagText(tag, `${npc.name}: ${fillLine(bark.text, host().lineValues(seat))}`, BARK_TEXT_SIZE);
    SetTextTagPosUnit(tag, npc.unit, 40);
    SetTextTagColor(tag, 255, 220, 120, 255);
    SetTextTagPermanent(tag, false);
    SetTextTagLifespan(tag, 3.0);
    SetTextTagFadepoint(tag, 2.0);
    SetTextTagVisibility(tag, false);
    if (isLocal(seat)) SetTextTagVisibility(tag, true);
  }
}

/** The "!" over each NPC whose scene has something new for this player (`hasNews`), shown to him alone. */
function markNews(seat: SceneSeat): void {
  const marks = seat.news ?? new Map<unit, { readonly mark: effect; readonly icon: minimapicon }>();
  seat.news = marks;
  const flags = flagsOf(seat);
  for (const npc of scenes().npcs) {
    const marked = marks.get(npc.unit);
    const news = !host().switchedOff("marks") && hasNews(npc.scene, flags) && talkable(npc);
    if (news && marked === undefined) {
      // Every client makes the same mark and minimap icon; every player but this one sees through them.
      const mark = AddSpecialEffectTarget(NEWS_MODEL, npc.unit, "overhead");
      const icon = CreateMinimapIconOnUnit(npc.unit, 255, 220, 0, questIconPath(), FOG_OF_WAR_MASKED);
      SetMinimapIconVisible(icon, false);
      if (isLocal(seat)) SetMinimapIconVisible(icon, true);
      else BlzSetSpecialEffectAlpha(mark, 0);
      marks.set(npc.unit, { mark, icon });
    } else if (!news && marked !== undefined) {
      DestroyEffect(marked.mark);
      DestroyMinimapIcon(marked.icon);
      marks.delete(npc.unit);
    }
  }
}

/** Warcraft's quest giver icon for the minimap, from the game's own interface skin, or its file if the skin has no such key. */
function questIconPath(): string {
  const path = SkinManagerGetLocalPath(QUEST_ICON_SKIN_KEY);
  return path === "" ? QUEST_ICON_FILE : path;
}

/** Plays the nearest NPC's scene wherever the hero is, for trying scenes out (the map's -scene command). */
export function playNearest(seat: SceneSeat): void {
  if (seat.scene !== undefined) return;
  const hero = pointOf(seat.hero);
  let nearest: Npc | undefined, best = 0;
  for (const npc of scenes().npcs) {
    if (!talkable(npc)) continue;
    const distance = distanceSquared(hero, pointOf(npc.unit));
    if (nearest === undefined || distance < best) {
      nearest = npc;
      best = distance;
    }
  }
  if (nearest === undefined) say(seat, "No one to talk to.");
  else startScene(seat, nearest);
}

/** The unit playing an actor in a scene: the hero, the NPC, or the soldier who came along, if any. */
function actorUnit(seat: SceneSeat, run: SceneRun, actor: Actor): unit | undefined {
  if (actor === "hero") return seat.hero;
  if (actor === "npc") return run.npc;
  return run.squad;
}

/**
 * The line to play for a node id: the node, or, while the player doesn't meet
 * its conditions or it needs a soldier the hero hasn't brought, the next one
 * after it; undefined at the end.
 */
function lineAt(seat: SceneSeat, run: SceneRun, id: string | undefined): DialogueNode | undefined {
  const flags = flagsOf(seat), gold = goldOf(seat);
  let next = id;
  for (let guard = 0; guard < 16 && next !== undefined; guard++) {
    const node = run.scene.nodes.find((candidate) => candidate.id === next);
    if (node === undefined) return undefined;
    const castable = actorUnit(seat, run, node.speaker) !== undefined && actorUnit(seat, run, listenerOf(node)) !== undefined;
    if (castable && meets(node.when, flags, gold, seat.heroInfo.code)) return node;
    next = node.next;
  }
  return undefined;
}

/**
 * Starts a personal scene: the hero stands down (the map's `standDown`), can't
 * be hurt and steps to TALK_DISTANCE from the NPC; a soldier of his party, if
 * the scene has lines for one, steps up beside him; units within
 * SCENE_PAUSE_RANGE pause, except other players' (they keep playing) and
 * the actors; the map's interface gives way to the letterbox, faded in from
 * black. The scene opens where the player's flags say (`openingOf`).
 */
export function startScene(seat: SceneSeat, npc: Npc): void {
  const { hero } = seat;
  // The run starts on the scene's first node; lineAt then finds where this player's opening leads.
  const opening = npc.scene.nodes[0];
  if (!alive(hero) || !alive(npc.unit) || opening === undefined) return;
  host().standDown(seat);
  SetUnitInvulnerable(hero, true);
  const npcAt = pointOf(npc.unit);
  shove(hero, talkSpot(npcAt, pointOf(hero)));
  const at = pointOf(hero);
  // A soldier who has lines steps up at the hero's shoulder, a little back, on his left.
  const wantsSquad = npc.scene.nodes.some((node) => node.speaker === "squad" || node.to === "squad");
  const member = wantsSquad ? host().sidekick(seat) : undefined;
  if (member !== undefined) {
    IssueImmediateOrder(member.unit, "stop");
    shove(member.unit, offset(at.x, at.y, atan2Tenths(npcAt.y - at.y, npcAt.x - at.x), -70, 110));
  }
  const others = scenes().seats.filter((other) => other !== seat).map((other) => other.player);
  const paused: unit[] = [];
  for (const other of unitsInRange(at.x, at.y, SCENE_PAUSE_RANGE)) {
    if (other === hero || other === npc.unit || other === member?.unit || others.includes(GetOwningPlayer(other))) continue;
    PauseUnit(other, true);
    paused.push(other);
  }
  const run: SceneRun = {
    scene: npc.scene, npc: npc.unit, node: opening, endTick: now(), voice: undefined, paused, npcName: npc.name, npcCode: npc.code,
    squad: member?.unit, squadCode: member?.code, squadName: member === undefined ? "" : GetUnitName(member.unit),
    startTick: now(), lineStart: now(), lineLength: 1, lines: 0, from: undefined, to: undefined, last: undefined, speakerAt: npcAt,
    text: "", speakerName: "", closing: undefined, fights: [], turns: [], allies: [],
  };
  const first = lineAt(seat, run, openingOf(npc.scene, flagsOf(seat), goldOf(seat), seat.heroInfo.code));
  if (first === undefined) {
    for (const unit of paused) PauseUnit(unit, false);
    SetUnitInvulnerable(hero, false);
    return;
  }
  warmVoices(seat, run);
  seat.scene = run;
  host().sceneShown(seat, true);
  seat.fade = { start: now(), toBlack: false };
  // No cinematic mode: it took the player's cursor, keys and clicks, which the scene needs.
  if (isLocal(seat) && seat.letterbox !== undefined) BlzFrameSetVisible(seat.letterbox.root, true);
  playLine(seat, run, first);
}

/**
 * Warcraft may drop a sound file's first play while it loads it: every
 * recording a scene's lines may play is played once, silent, as it starts.
 */
function warmVoices(seat: SceneSeat, run: SceneRun): void {
  const warmed = new Set<string>();
  for (const node of run.scene.nodes) {
    const code = actorCode(seat, run, node.speaker);
    if (code === undefined) continue;
    const takes = takesOf(code, node.mood);
    for (let take = 0; take < takes; take++) {
      const file = voiceFile(voicePrefixOf(code), node.mood, take, takes);
      if (file === undefined || warmed.has(file)) continue;
      warmed.add(file);
      const warm = CreateSound(file, false, false, false, 10, 10, "DefaultEAXON");
      SetSoundVolume(warm, 0);
      StartSound(warm);
      KillSoundWhenDone(warm);
    }
  }
}

/**
 * How many recordings of a mood's kind a unit type's set has, measured in the
 * game the first time a scene needs them (`countTakes`: a file that isn't
 * there lasts 0 ms, `GetSoundFileDuration`) and kept. Every client has the
 * same game files and asks the same questions, so every client counts alike.
 * Never less than 1, so a game that can't tell still plays the first take.
 */
function takesOf(code: string, mood: Mood): number {
  const state = scenes();
  const takes = state.takes ?? new Map<string, number>();
  state.takes = takes;
  const key = `${code}:${mood}`;
  const known = takes.get(key);
  if (known !== undefined) return known;
  const prefix = voicePrefixOf(code);
  const counted = prefix === undefined ? 0 : countTakes((take) => GetSoundFileDuration(recordingFile(prefix, mood, take)) > 0);
  // At least the first: if the game can't tell, the line tries take 1, as before.
  const kept = Math.max(counted, 1);
  takes.set(key, kept);
  return kept;
}

/**
 * A unit type's voice: the first of its profile's file prefixes
 * (`voiceCandidates`) the game has recordings under, asked once and kept. If
 * the game can't tell for any of them, the first is tried as it is.
 */
function voicePrefixOf(code: string): string | undefined {
  const state = scenes();
  const voices = state.voices ?? new Map<string, string>();
  state.voices = voices;
  const known = voices.get(code);
  if (known !== undefined) return known === "" ? undefined : known;
  const candidates = voiceCandidates(code);
  const found = candidates.find((prefix) => PROBE_MOODS.some((mood) => GetSoundFileDuration(recordingFile(prefix, mood, 1)) > 0)) ?? candidates[0];
  voices.set(code, found ?? "");
  return found;
}

/** One mood of each kind of recording, to find a voice by. */
const PROBE_MOODS: readonly Mood[] = ["neutral", "confirm", "attack", "warcry", "angry"];

/** The unit type an actor speaks with. */
function actorCode(seat: SceneSeat, run: SceneRun, actor: Actor): string | undefined {
  if (actor === "hero") return seat.heroInfo.code;
  if (actor === "npc") return run.npcCode;
  return run.squadCode;
}

/**
 * Speaks a mood's recording for a unit type, heard by this player alone:
 * every client makes the sound; only his plays it at full volume. With a
 * `serial`, his client measures the recording and sends its length to every
 * client (`voiceSynced`), so the line stays up as long as it is spoken.
 */
function speak(seat: SceneSeat, code: string, mood: Mood, variant: number, pitch: number | undefined, serial?: number): sound | undefined {
  const file = voiceFile(voicePrefixOf(code), mood, variant, takesOf(code, mood));
  if (file === undefined) return undefined;
  const voice = CreateSound(file, false, false, false, 10, 10, "DefaultEAXON");
  SetSoundVolume(voice, isLocal(seat) ? 127 : 0);
  if (pitch !== undefined) SetSoundPitch(voice, pitch / 100);
  StartSound(voice);
  KillSoundWhenDone(voice);
  if (serial !== undefined && isLocal(seat)) BlzSendSyncData(VOICE_PREFIX, `${serial}:${GetSoundFileDuration(file)}`);
  return voice;
}

/** A player's measured voice length reaches every client (the map's VOICE_PREFIX sync event): his line stays up at least that long (`voiceTicks`). */
export function voiceSynced(): void {
  const seat = sceneSeatOf(GetTriggerPlayer());
  const run = seat?.scene;
  if (run === undefined) return;
  const [serial, ms] = BlzGetTriggerSyncData().split(":");
  if (S2I(serial ?? "") !== run.lineStart || run.closing !== undefined) return;
  const voiceMs = S2I(ms ?? "");
  run.endTick = Math.max(run.endTick, run.lineStart + voiceTicks(voiceMs));
  if (voiceMs > 0) run.talkUntil = run.lineStart + talkTicks(voiceMs);
}

/** A speaker stops talking when his voice ends: back to his stand. */
function talkTick(run: SceneRun): void {
  if (run.speakerUnit === undefined || run.talkUntil === undefined || now() < run.talkUntil) return;
  run.talkUntil = undefined;
  SetUnitAnimation(run.speakerUnit, "stand");
}

/**
 * Plays a line: the speaker and his listener turn to each other; he gestures (the node's
 * animation, else his mood's) and speaks (the next recording of his mood's
 * kind, at the node's pitch); the line's effects happen; the line shows as
 * text, the speaker's name over it, and any choices show; and the director
 * picks the shot, cutting to it for a new speaker and gliding to it for the
 * same one.
 */
function playLine(seat: SceneSeat, run: SceneRun, node: DialogueNode): void {
  stopVoice(run);
  const speaker = actorUnit(seat, run, node.speaker) ?? seat.hero;
  const listener = actorUnit(seat, run, listenerOf(node)) ?? run.npc;
  const from = pointOf(speaker), to = pointOf(listener);
  // The camera glides from wherever the last line's had got to.
  const glideFrom = run.to === undefined ? undefined : sceneFraming(run.from, run.to, now() - run.lineStart, run.lineLength);
  run.node = node;
  run.lineStart = now();
  run.lineLength = lineTicks(node.text);
  run.endTick = run.lineStart + run.lineLength;
  const toListener = atan2Tenths(to.y - from.y, to.x - from.x);
  SetUnitFacingTimed(speaker, toListener / 10, TURN_SECONDS);
  SetUnitFacingTimed(listener, (toListener + 1800) / 10, TURN_SECONDS);
  // The last speaker falls quiet; this one talks, after his gesture if he has one.
  if (run.speakerUnit !== undefined && run.speakerUnit !== speaker && run.talkUntil !== undefined) SetUnitAnimation(run.speakerUnit, "stand");
  const code = actorCode(seat, run, node.speaker);
  const gesture = node.anim ?? (code === undefined ? gestureOf(node.mood) : gestureFor(code, node.mood));
  const talk = code === undefined ? TALK_ANIMATION : talkAnimation(code);
  if (host().switchedOff("talk")) {
    if (gesture !== undefined) {
      SetUnitAnimation(speaker, gesture);
      QueueUnitAnimation(speaker, "stand");
    }
  } else if (gesture !== undefined) {
    SetUnitAnimation(speaker, gesture);
    QueueUnitAnimation(speaker, talk);
  } else SetUnitAnimation(speaker, talk);
  run.speakerUnit = speaker;
  // Until the voice is measured (`voiceSynced`), he talks for the whole line.
  run.talkUntil = run.endTick;
  run.voice = code === undefined ? undefined : speak(seat, code, node.mood, run.lines, node.pitch, run.lineStart);
  run.lines++;
  for (const effect of node.effects ?? []) applyEffect(seat, run, effect);
  const fill = (text: string) => fillLine(text, host().lineValues(seat));
  run.speakerName = node.speaker === "hero" ? seat.heroInfo.name : node.speaker === "npc" ? run.npcName : run.squadName;
  run.text = fill(node.text);
  // The line as plain text: every client fills every player's, and each sees only his own.
  if (seat.letterbox !== undefined) showSubtitle(seat.letterbox, run.speakerName, run.text);
  const states = choiceStates(node.choices ?? [], flagsOf(seat), goldOf(seat), seat.heroInfo.code);
  if (seat.letterbox !== undefined) {
    showChoices(seat.letterbox, (node.choices ?? []).map((choice, index) => ({ text: fill(choice.text), state: states[index] ?? "open" })));
  }
  const direction = directShot(node, run.last);
  run.last = { speaker: node.speaker, shot: direction.shot };
  run.from = direction.glide ? glideFrom : undefined;
  const listenerCode = actorCode(seat, run, listenerOf(node));
  run.face = shotFace(direction.shot, code === undefined ? FACE_HEIGHT : faceHeight(code), listenerCode === undefined ? FACE_HEIGHT : faceHeight(listenerCode));
  run.to = framing(direction.shot, from, to, Math.floor(BlzGetUnitCollisionSize(listener)), run.face);
  run.speakerAt = from;
}

/** What a line does: gold, a recruit, a flag, units who join, healing, or a fight, a turn or allies (./questRuntime.ts). */
function applyEffect(seat: SceneSeat, run: SceneRun, effect: Effect): void {
  if (effect.kind === "gold") {
    SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, Math.max(0, goldOf(seat) + effect.amount));
    say(seat, effect.amount >= 0 ? `${run.npcName} gives you ${effect.amount} gold.` : `You give ${run.npcName} ${-effect.amount} gold.`);
  } else if (effect.kind === "recruit") host().recruit(seat, effect);
  else if (effect.kind === "flag") {
    if (effect.value === false) flagsOf(seat).delete(effect.flag);
    else flagsOf(seat).add(effect.flag);
  } else if (effect.kind === "spawn") host().join(seat, effect.code, effect.count, effect.role);
  else if (effect.kind === "heal") {
    SetWidgetLife(seat.hero, BlzGetUnitMaxHP(seat.hero));
    SetUnitState(seat.hero, UNIT_STATE_MANA, BlzGetUnitMaxMana(seat.hero));
    say(seat, `${run.npcName} heals you.`);
  } else if (effect.kind === "ally") enlist(run, effect);
  else if (effect.kind === "hostile") turn(seat, run, effect);
  else raiseFight(seat, run, effect);
}

/**
 * The local player's scene camera, every tick: the line's framing as
 * `sceneFraming` has it this tick (gliding, then drifting), locked to the
 * hero by an offset, at the speaker's face height on a slope. A cut's first
 * tick is instant; the rest move over one tick, so the glide runs smooth.
 */
function applySceneCamera(seat: SceneSeat, run: SceneRun, hero: Point): void {
  if (run.to === undefined) return;
  const state = scenes();
  const elapsed = now() - run.lineStart;
  const shot = sceneFraming(run.from, run.to, elapsed, run.lineLength);
  const duration = elapsed === 0 && run.from === undefined ? 0 : CAMERA_PERIOD;
  SetCameraTargetController(seat.hero, shot.target.x - hero.x, shot.target.y - hero.y, false);
  SetCameraField(CAMERA_FIELD_ROTATION, shot.yaw / 10, duration);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, shot.distance, duration);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, shot.attack / 10, duration);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, shot.fieldOfView, duration);
  // Heads stay framed on a slope: the camera rises by however far the speaker stands above the shot's target.
  MoveLocation(state.location, run.speakerAt.x, run.speakerAt.y);
  const speakerZ = GetLocationZ(state.location);
  MoveLocation(state.location, shot.target.x, shot.target.y);
  const targetZ = GetLocationZ(state.location);
  SetCameraField(CAMERA_FIELD_ZOFFSET, (run.face ?? FACE_HEIGHT) + Math.max(0, speakerZ - targetZ), duration);
}

function stopVoice(run: SceneRun): void {
  if (run.voice !== undefined) StopSound(run.voice, false, true);
  run.voice = undefined;
}

/** The line after this one, or the end: a line with choices waits for one. */
function advance(seat: SceneSeat, run: SceneRun): void {
  if (run.node.choices !== undefined) return;
  const next = lineAt(seat, run, run.node.next);
  if (next === undefined) endScene(seat, run);
  else playLine(seat, run, next);
}

/** Space: skips a line without choices, cutting its voice short. */
export function skipLine(seat: SceneSeat, run: SceneRun): void {
  if (run.closing === undefined && run.node.choices === undefined) advance(seat, run);
}

/** A choice, by click or 1 to 4, jumps to its node, if the player can take it. */
export function chooseLine(seat: SceneSeat, run: SceneRun, index: number): void {
  const choice = run.node.choices?.[index];
  if (run.closing !== undefined || choice === undefined || !meets(choice.when, flagsOf(seat), goldOf(seat), seat.heroInfo.code)) return;
  const next = lineAt(seat, run, choice.next);
  if (next === undefined) endScene(seat, run);
  else playLine(seat, run, next);
}

/**
 * Every camera tick of a scene: a line without choices advances when its time
 * is up, and, once the scene is closing, it finishes when the fade to black
 * has. The player's own client moves the camera.
 */
export function sceneTick(seat: SceneSeat, run: SceneRun): void {
  const hero = pointOf(seat.hero);
  if (run.closing !== undefined) {
    if (now() - run.closing >= FADE_TICKS) return finishScene(seat, run);
  } else {
    talkTick(run);
    if (run.node.choices === undefined && now() >= run.endTick) advance(seat, run);
  }
  if (seat.scene !== run || !isLocal(seat)) return;
  applySceneCamera(seat, run, hero);
}

/** Ends the scene, at its last line or on Esc: the voice stops, the panel and the choices go and the screen fades to black (`finishScene` follows). */
export function endScene(seat: SceneSeat, run: SceneRun): void {
  if (run.closing !== undefined) return;
  stopVoice(run);
  run.closing = now();
  seat.fade = { start: now(), toBlack: true };
  if (seat.letterbox !== undefined) {
    showChoices(seat.letterbox, []);
    showSubtitle(seat.letterbox, "", "");
  }
}

/**
 * Finishes the scene under the black: units unpause, the scene's fights,
 * turns and allies are let loose (`releaseScene`), the hero can be hurt
 * again, the actors stand, the player remembers the scene, the hero's camera
 * and the map's interface come back, and the screen fades in from black.
 */
function finishScene(seat: SceneSeat, run: SceneRun): void {
  for (const unit of run.paused) PauseUnit(unit, false);
  releaseScene(seat, run);
  for (const actor of [seat.hero, run.npc, run.squad]) if (actor !== undefined) SetUnitAnimation(actor, "stand");
  SetUnitInvulnerable(seat.hero, false);
  flagsOf(seat).add(seenFlag(run.scene));
  seat.scene = undefined;
  seat.talkedTo = run.npc;
  seat.fade = { start: now(), toBlack: false };
  markNews(seat);
  if (isLocal(seat)) {
    if (seat.letterbox !== undefined) BlzFrameSetVisible(seat.letterbox.root, false);
    SetCameraTargetController(seat.hero, 0, 0, false);
  }
  host().sceneShown(seat, false);
}

/** Every camera tick: a player's fade runs its course on his own screen, and is dropped once it has faded in. */
export function fadeTick(seat: SceneSeat): void {
  const fade = seat.fade;
  if (fade === undefined) return;
  const elapsed = now() - fade.start;
  if (isLocal(seat) && seat.letterbox !== undefined) setFade(seat.letterbox, host().switchedOff("fade") ? 0 : fadeAlpha(elapsed, fade.toBlack));
  if (!fade.toBlack && elapsed >= FADE_TICKS) seat.fade = undefined;
}
